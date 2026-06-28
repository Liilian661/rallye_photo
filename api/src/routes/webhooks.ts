import { Router, Request, Response } from 'express';
import pool from '../config/database';
import { logAudit } from '../utils/auditLog';
import { sendProCancellationEmail } from '../utils/emailService';

const router = Router();

const CREDIT_PRICE_CENTS = 1200; // 12 € — doit rester aligne sur payments.ts

/**
 * Marque un event Stripe comme traite (INSERT-first idempotence).
 * Renvoie true si l'event est NOUVEAU (a traiter), false si deja vu (a ignorer).
 * S'appuie sur la PRIMARY KEY de processed_webhook_events + capture ER_DUP_ENTRY,
 * ce qui clot la race TOCTOU des anciens SELECT...LIKE.
 * audit: HIGH-003 / HIGH-004
 */
async function markEventProcessed(
  conn: any,
  stripeEventId: string,
  type: string
): Promise<boolean> {
  try {
    await conn.execute(
      'INSERT INTO processed_webhook_events (stripe_event_id, type) VALUES (?, ?)',
      [stripeEventId, type]
    );
    return true;
  } catch (err: any) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return false;
    }
    throw err;
  }
}

/**
 * Lecture defensive de current_period_end (Stripe Basil 2025).
 * Sur les versions recentes, le champ peut etre porte par chaque item plutot
 * que par l'objet subscription. Renvoie un timestamp Unix (secondes) valide ou null.
 * audit: MED-004
 */
function resolvePeriodEnd(subscription: any): number | null {
  const candidate =
    subscription?.current_period_end ??
    subscription?.items?.data?.[0]?.current_period_end;
  const num = Number(candidate);
  return Number.isFinite(num) && num > 0 ? num : null;
}

// POST /webhooks/stripe
// IMPORTANT: must be mounted with express.raw({ type: 'application/json' }) middleware
router.post('/stripe', async (req: Request, res: Response): Promise<void> => {
  const signature    = req.headers['stripe-signature'] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeKey    = process.env.STRIPE_SECRET_KEY;

  if (!webhookSecret || !stripeKey) {
    console.warn('[Webhook] Stripe env vars not configured — event rejected');
    res.status(503).json({ error: 'Stripe non configure' });
    return;
  }

  let event: any;
  try {
    const stripe = require('stripe')(stripeKey);
    // req.body is a Buffer here (express.raw middleware)
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (err: any) {
    console.error('[Webhook] Signature verification failed:', err.message);
    res.status(400).json({ error: 'Invalid signature' });
    return;
  }

  // audit: HIGH-005 — traiter l'event AVANT de repondre. En cas d'echec on
  // renvoie 500 pour declencher la relivraison Stripe (l'idempotence basee sur
  // processed_webhook_events protege des doublons lors du replay).
  try {
    const stripeEventId: string = event.id;
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object, stripeEventId);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object, stripeEventId);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object, stripeEventId);
        break;
      default:
        break;
    }
    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[Webhook] Handler error for', event.type, err);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});

// ---------- HANDLERS ----------

async function handleCheckoutCompleted(session: any, stripeEventId: string) {
  const userId  = session.metadata?.user_id as string | undefined;
  const type    = session.metadata?.type as string | undefined; // 'credit' | 'pro'

  if (!userId) {
    console.warn('[Webhook] checkout.session.completed: missing user_id in metadata');
    return;
  }

  // audit: MED-005 — englober marqueur d'idempotence + mutations metier liees
  // dans une seule transaction sur la meme connexion.
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // audit: HIGH-003 — INSERT-first idempotence (remplace le SELECT...LIKE non fiable)
    const isNew = await markEventProcessed(conn, stripeEventId, 'checkout.session.completed');
    if (!isNew) {
      console.log('[Webhook] Duplicate event, skipping:', stripeEventId);
      await conn.rollback();
      return;
    }

    if (type === 'credit') {
      // audit: LOW-010 — reborner la quantite [1,10], gerer NaN, et verifier la
      // coherence du montant paye avant de crediter.
      const parsed = parseInt(session.metadata?.quantity || '1', 10);
      const quantity = Math.max(1, Math.min(10, Number.isFinite(parsed) ? parsed : 1));
      const expectedTotal = quantity * CREDIT_PRICE_CENTS;
      if (typeof session.amount_total === 'number' && session.amount_total !== expectedTotal) {
        console.warn(
          '[Webhook] credit: amount_total mismatch — expected', expectedTotal,
          'got', session.amount_total, 'for user', userId
        );
        // Montant incoherent : ne pas crediter. Le marqueur reste pose (event traite).
        await conn.commit();
        return;
      }

      await conn.execute(
        'UPDATE users SET event_credits = event_credits + ? WHERE id = ?',
        [quantity, userId]
      );

      await conn.commit();

      // Audit best-effort hors transaction (logAudit utilise le pool global).
      await logAudit('credit.purchase', {
        userId,
        details: { quantity, sessionId: session.id, stripeEventId, amountTotal: session.amount_total },
      });
      console.log('[Webhook] +', quantity, 'event credit(s) added to user', userId);
      return;
    }

    if (type === 'pro') {
      const stripeCustomerId = session.customer as string;
      await conn.execute(
        "UPDATE users SET plan = 'pro', stripe_customer_id = ?, pro_expires_at = NULL WHERE id = ?",
        [stripeCustomerId, userId]
      );
      // Remove grace period lock on events now that user has Pro again
      await conn.execute(
        "UPDATE events SET gallery_locked = 0, gallery_locked_until = NULL WHERE user_id = ? AND gallery_locked = 1",
        [userId]
      );

      // audit: LOW-013 — convertir le parrainage en attente lors d'un upgrade Pro paye.
      const [refResult] = await conn.execute(
        "UPDATE referrals SET status = 'converted', converted_at = NOW() WHERE referred_id = ? AND status = 'pending'",
        [userId]
      );
      const referralConverted = (refResult as any)?.affectedRows > 0;

      await conn.commit();

      await logAudit('plan.upgrade', {
        userId,
        details: { plan: 'pro', sessionId: session.id, stripeEventId, stripeCustomerId },
      });
      if (referralConverted) {
        await logAudit('affiliate.convert', {
          userId,
          details: { sessionId: session.id, stripeEventId },
        });
      }
      console.log('[Webhook] User upgraded to Pro:', userId);
      return;
    }

    // Type inconnu : event marque traite, rien d'autre a faire.
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function handleSubscriptionDeleted(subscription: any, stripeEventId: string) {
  const stripeCustomerId = subscription.customer as string;

  // audit: MED-004 — lecture defensive de current_period_end (fallback items + Number.isFinite)
  const periodEndUnix = resolvePeriodEnd(subscription);
  // Fallback raisonnable si Stripe ne fournit pas l'echeance : fin immediate.
  const endsAt = new Date((periodEndUnix ?? Math.floor(Date.now() / 1000)) * 1000);

  // audit: MED-005 / HIGH-004 — idempotence (tous handlers) + transaction unique.
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const isNew = await markEventProcessed(conn, stripeEventId, 'customer.subscription.deleted');
    if (!isNew) {
      console.log('[Webhook] Duplicate event, skipping:', stripeEventId);
      await conn.rollback();
      return;
    }

    const [rows] = await conn.execute(
      'SELECT id, first_name, last_name, email FROM users WHERE stripe_customer_id = ?',
      [stripeCustomerId]
    );
    const user = (rows as any[])[0];
    if (!user) {
      console.warn('[Webhook] subscription.deleted: no user found for Stripe customer', stripeCustomerId);
      // Event marque traite pour eviter des relivraisons en boucle.
      await conn.commit();
      return;
    }

    // Downgrade plan
    await conn.execute(
      "UPDATE users SET plan = 'free', pro_expires_at = ? WHERE id = ?",
      [endsAt, user.id]
    );

    // Grace period: 48h from subscription end
    const gracePeriodEnd = new Date(endsAt.getTime() + 48 * 60 * 60 * 1000);

    // Lock all active events to read-only during grace period
    await conn.execute(
      "UPDATE events SET gallery_locked = 1, gallery_locked_until = ? WHERE user_id = ? AND status = 'active'",
      [gracePeriodEnd, user.id]
    );

    // Downgrade event tiers from 'pro' to free
    await conn.execute(
      "UPDATE events SET tier = 'free' WHERE user_id = ? AND tier = 'pro'",
      [user.id]
    );

    await conn.commit();

    await logAudit('plan.cancel', {
      userId: user.id,
      details: {
        plan: 'pro',
        subscriptionId: subscription.id,
        endsAt: endsAt.toISOString(),
        gracePeriodEnd: gracePeriodEnd.toISOString(),
      },
    });

    // audit: HIGH-004 — l'idempotence garantit un seul envoi d'email d'annulation.
    sendProCancellationEmail(user.email, user.first_name, endsAt, gracePeriodEnd).catch((err) => {
      console.error('[Webhook] Failed to send cancellation email:', err);
    });

    console.log('[Webhook] Pro subscription cancelled for user:', user.id, 'grace until:', gracePeriodEnd.toISOString());
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function handleSubscriptionUpdated(subscription: any, stripeEventId: string) {
  const stripeCustomerId = subscription.customer as string;
  const status: string = subscription.status;

  // audit: MED-005 / HIGH-004 — idempotence (tous handlers) + transaction unique.
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const isNew = await markEventProcessed(conn, stripeEventId, 'customer.subscription.updated');
    if (!isNew) {
      console.log('[Webhook] Duplicate event, skipping:', stripeEventId);
      await conn.rollback();
      return;
    }

    const [rows] = await conn.execute(
      'SELECT id FROM users WHERE stripe_customer_id = ?',
      [stripeCustomerId]
    );
    const user = (rows as any[])[0];
    if (!user) {
      // audit: LOW-011 — logger un warning plutot qu'un return silencieux quand
      // aucun user n'est trouve (subscription.updated peut preceder checkout.completed).
      console.warn('[Webhook] subscription.updated: no user yet for Stripe customer', stripeCustomerId, '— status', status);
      await conn.commit();
      return;
    }

    if (status === 'active') {
      // Handle renewals: re-activate Pro and remove any grace period locks.
      // audit: MED-004 — poser l'echeance courante si disponible (defensif).
      const periodEndUnix = resolvePeriodEnd(subscription);
      const proExpiresAt = periodEndUnix ? new Date(periodEndUnix * 1000) : null;

      await conn.execute(
        "UPDATE users SET plan = 'pro', pro_expires_at = ? WHERE stripe_customer_id = ?",
        [proExpiresAt, stripeCustomerId]
      );
      await conn.execute(
        "UPDATE events SET gallery_locked = 0, gallery_locked_until = NULL WHERE user_id = ? AND gallery_locked = 1",
        [user.id]
      );

      await conn.commit();
      console.log('[Webhook] Subscription renewed/reactivated for customer', stripeCustomerId);
      return;
    }

    // audit: LOW-014 — gerer les echecs de renouvellement / annulation programmee.
    // past_due / unpaid / incomplete_expired / canceled : poser un verrou de grace
    // au lieu de laisser l'acces Pro indefiniment.
    if (
      status === 'past_due' ||
      status === 'unpaid' ||
      status === 'incomplete_expired' ||
      status === 'canceled'
    ) {
      const periodEndUnix = resolvePeriodEnd(subscription);
      const endsAt = new Date((periodEndUnix ?? Math.floor(Date.now() / 1000)) * 1000);
      const gracePeriodEnd = new Date(endsAt.getTime() + 48 * 60 * 60 * 1000);

      await conn.execute(
        "UPDATE users SET plan = 'free', pro_expires_at = ? WHERE id = ?",
        [endsAt, user.id]
      );
      await conn.execute(
        "UPDATE events SET gallery_locked = 1, gallery_locked_until = ? WHERE user_id = ? AND status = 'active'",
        [gracePeriodEnd, user.id]
      );
      await conn.execute(
        "UPDATE events SET tier = 'free' WHERE user_id = ? AND tier = 'pro'",
        [user.id]
      );

      await conn.commit();
      console.log('[Webhook] Subscription', status, '— Pro access downgraded for customer', stripeCustomerId);
      return;
    }

    // Autres statuts (trialing, incomplete...) : event marque traite, pas de mutation.
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export default router;

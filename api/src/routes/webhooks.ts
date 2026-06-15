import { Router, Request, Response } from 'express';
import pool from '../config/database';
import { logAudit } from '../utils/auditLog';
import { sendProCancellationEmail } from '../utils/emailService';
import { resolveEventTier } from '../config/plans';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// POST /webhooks/stripe
// IMPORTANT: must be mounted with express.raw({ type: 'application/json' }) middleware
router.post('/stripe', async (req: Request, res: Response): Promise<void> => {
  const signature    = req.headers['stripe-signature'] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeKey    = process.env.STRIPE_SECRET_KEY;

  if (!webhookSecret || !stripeKey) {
    console.warn('[Webhook] Stripe env vars not configured — event ignored');
    res.status(200).json({ received: true });
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

  // Always respond 200 quickly; handle async
  res.status(200).json({ received: true });

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;
      default:
        break;
    }
  } catch (err) {
    console.error('[Webhook] Handler error for', event.type, err);
  }
});

// ---------- HANDLERS ----------

async function handleCheckoutCompleted(session: any) {
  const userId  = session.metadata?.user_id as string | undefined;
  const type    = session.metadata?.type as string | undefined; // 'credit' | 'pro'

  if (!userId) {
    console.warn('[Webhook] checkout.session.completed: missing user_id in metadata');
    return;
  }

  if (type === 'credit') {
    const quantity = parseInt(session.metadata?.quantity || '1', 10);
    await pool.execute(
      'UPDATE users SET event_credits = event_credits + ? WHERE id = ?',
      [quantity, userId]
    );
    await logAudit('credit.purchase', {
      userId,
      details: { quantity, sessionId: session.id, amountTotal: session.amount_total },
    });
    console.log('[Webhook] +', quantity, 'event credit(s) added to user', userId);
  }

  if (type === 'pro') {
    const stripeCustomerId = session.customer as string;
    await pool.execute(
      "UPDATE users SET plan = 'pro', stripe_customer_id = ?, pro_expires_at = NULL WHERE id = ?",
      [stripeCustomerId, userId]
    );
    // Remove grace period lock on events now that user has Pro again
    await pool.execute(
      "UPDATE events SET gallery_locked = 0, gallery_locked_until = NULL WHERE user_id = ? AND gallery_locked = 1",
      [userId]
    );
    await logAudit('plan.upgrade', {
      userId,
      details: { plan: 'pro', sessionId: session.id, stripeCustomerId },
    });
    console.log('[Webhook] User upgraded to Pro:', userId);
  }
}

async function handleSubscriptionDeleted(subscription: any) {
  const stripeCustomerId = subscription.customer as string;
  // Stripe sends current_period_end as Unix timestamp
  const endsAt = new Date((subscription.current_period_end as number) * 1000);

  const [rows] = await pool.execute(
    'SELECT id, first_name, last_name, email FROM users WHERE stripe_customer_id = ?',
    [stripeCustomerId]
  );
  const user = (rows as any[])[0];
  if (!user) {
    console.warn('[Webhook] subscription.deleted: no user found for Stripe customer', stripeCustomerId);
    return;
  }

  // Downgrade plan
  await pool.execute(
    "UPDATE users SET plan = 'free', pro_expires_at = ? WHERE id = ?",
    [endsAt, user.id]
  );

  // Grace period: 48h from subscription end
  const gracePeriodEnd = new Date(endsAt.getTime() + 48 * 60 * 60 * 1000);

  // Lock all active events to read-only during grace period
  await pool.execute(
    "UPDATE events SET gallery_locked = 1, gallery_locked_until = ? WHERE user_id = ? AND status = 'active'",
    [gracePeriodEnd, user.id]
  );

  // Downgrade event tiers from 'pro' to what resolveEventTier gives for free user with 0 credits
  await pool.execute(
    "UPDATE events SET tier = 'free' WHERE user_id = ? AND tier = 'pro'",
    [user.id]
  );

  await logAudit('plan.cancel', {
    userId: user.id,
    details: {
      plan: 'pro',
      subscriptionId: subscription.id,
      endsAt: endsAt.toISOString(),
      gracePeriodEnd: gracePeriodEnd.toISOString(),
    },
  });

  sendProCancellationEmail(user.email, user.first_name, endsAt, gracePeriodEnd).catch((err) => {
    console.error('[Webhook] Failed to send cancellation email:', err);
  });

  console.log('[Webhook] Pro subscription cancelled for user:', user.id, 'grace until:', gracePeriodEnd.toISOString());
}

async function handleSubscriptionUpdated(subscription: any) {
  // Handle renewals: re-activate Pro and remove any grace period locks
  if (subscription.status === 'active') {
    const stripeCustomerId = subscription.customer as string;

    const [rows] = await pool.execute(
      'SELECT id FROM users WHERE stripe_customer_id = ?',
      [stripeCustomerId]
    );
    const user = (rows as any[])[0];
    if (!user) return;

    await pool.execute(
      "UPDATE users SET plan = 'pro', pro_expires_at = NULL WHERE stripe_customer_id = ?",
      [stripeCustomerId]
    );
    await pool.execute(
      "UPDATE events SET gallery_locked = 0, gallery_locked_until = NULL WHERE user_id = ? AND gallery_locked = 1",
      [user.id]
    );

    console.log('[Webhook] Subscription renewed/reactivated for customer', stripeCustomerId);
  }
}

export default router;

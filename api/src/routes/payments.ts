import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { logAudit } from '../utils/auditLog';
import { rateLimiter } from '../middleware/rateLimiter';

const router = Router();

// audit: LOW-012 — limiter la creation de session de paiement (chaque appel
// declenche un appel reseau sortant vers Stripe). 10 requetes / minute / IP.
const checkoutLimiter = rateLimiter(10, 60 * 1000);

const CREDIT_PRICE_CENTS      = 1200;  // 12 €
const PRO_MONTHLY_PRICE_CENTS = 2400;  // 24 €/mois
const PRO_YEARLY_PRICE_CENTS  = 19900; // 199 €/an (−31 %)

// POST /payments/checkout
// Body: { type: 'credit', quantity?: number } | { type: 'pro' }
router.post('/checkout', checkoutLimiter, requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    res.status(503).json({ error: 'Paiement non disponible', code: 'STRIPE_NOT_CONFIGURED' });
    return;
  }

  try {
    const stripe   = require('stripe')(stripeKey);
    const userId   = req.user!.userId;
    const panelUrl = process.env.PANEL_URL || 'https://panel.rallye-photo.com';
    const { type, quantity = 1, billing = 'monthly' } = req.body;

    if (type !== 'credit' && type !== 'pro') {
      res.status(400).json({ error: 'Type invalide. Valeurs acceptées : credit, pro' });
      return;
    }

    let session: any;

    if (type === 'credit') {
      const qty = Math.max(1, Math.min(10, parseInt(String(quantity), 10) || 1));

      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{
          price_data: {
            currency:     'eur',
            product_data: {
              name:        qty > 1 ? `${qty} × Crédit Événement` : 'Crédit Événement',
              description: 'Débloque 1 événement premium (150 participants, galerie 60 jours)',
            },
            unit_amount: CREDIT_PRICE_CENTS,
          },
          quantity: qty,
        }],
        // audit: LOW-011 — lier explicitement la session a l'utilisateur (en plus de metadata)
        client_reference_id: userId,
        metadata: {
          user_id:  userId,
          type:     'credit',
          quantity: String(qty),
        },
        success_url: `${panelUrl}/dashboard/pricing?success=credit`,
        cancel_url:  `${panelUrl}/dashboard/pricing?cancelled=1`,
      });
    } else {
      // Pro — abonnement mensuel ou annuel
      const isYearly = billing === 'yearly';
      session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{
          price_data: {
            currency:     'eur',
            product_data: {
              name:        isYearly ? 'Rallye Photo Pro — Annuel' : 'Rallye Photo Pro',
              description: 'Événements illimités · Participants illimités · Galerie 365 jours',
            },
            unit_amount: isYearly ? PRO_YEARLY_PRICE_CENTS : PRO_MONTHLY_PRICE_CENTS,
            recurring:   { interval: isYearly ? 'year' : 'month' },
          },
          quantity: 1,
        }],
        // audit: LOW-011 — lier la session a l'utilisateur et propager user_id sur
        // l'abonnement, pour que subscription.updated/deleted retrouve le user meme
        // si checkout.completed n'a pas encore ete traite.
        client_reference_id: userId,
        metadata: {
          user_id: userId,
          type:    'pro',
          billing: isYearly ? 'yearly' : 'monthly',
        },
        subscription_data: {
          metadata: {
            user_id: userId,
            type:    'pro',
          },
        },
        customer_email: req.user!.email,
        success_url: `${panelUrl}/dashboard/pricing?success=pro`,
        cancel_url:  `${panelUrl}/dashboard/pricing?cancelled=1`,
      });
    }

    logAudit('plan.upgrade', {
      userId,
      details: {
        type,
        quantity: type === 'credit' ? quantity : undefined,
        sessionId: session.id,
        status: 'checkout_initiated',
      },
    });

    res.json({ url: session.url });
  } catch (error: any) {
    console.error('Stripe checkout error:', error.message);
    res.status(500).json({ error: 'Erreur lors de la création de la session de paiement' });
  }
});

export default router;

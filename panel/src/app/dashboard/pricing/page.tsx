'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { IconCheck, IconX } from '@/lib/icons';
import api from '@/lib/api';

const plans = [
  {
    id: 'free',
    name: 'Gratuit',
    price: null,
    priceLabel: 'Gratuit',
    period: '',
    description: 'Pour découvrir le concept',
    features: [
      { text: '1 événement gratuit', included: true },
      { text: '5 défis par événement', included: true },
      { text: '20 participants max', included: true },
      { text: 'Galerie 48h', included: true },
      { text: 'QR Code PDF', included: true },
      { text: 'Défis surprise', included: false },
      { text: 'Export ZIP photos', included: false },
      { text: 'Logo & bannière', included: false },
      { text: 'Watermark rallye.photo', included: true, negative: true },
    ],
    highlight: false,
  },
  {
    id: 'event',
    name: 'Événement',
    price: 12,
    priceLabel: '12€',
    period: 'par crédit',
    description: 'Un achat unique, un vrai rallye',
    badge: 'Le plus populaire',
    features: [
      { text: '1 événement premium (par crédit)', included: true },
      { text: 'Défis illimités', included: true },
      { text: '150 participants max', included: true },
      { text: 'Galerie 60 jours', included: true },
      { text: 'QR Code PDF', included: true },
      { text: 'Défis surprise', included: true },
      { text: 'Export ZIP photos', included: true },
      { text: 'Logo & bannière', included: true },
      { text: 'Sans watermark', included: true },
    ],
    highlight: true,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 24,
    priceLabel: '24€',
    period: '/mois',
    description: 'Pour les professionnels de l\'événementiel',
    features: [
      { text: 'Événements illimités', included: true },
      { text: 'Défis illimités', included: true },
      { text: 'Participants illimités', included: true },
      { text: 'Galerie 1 an', included: true },
      { text: 'QR Code PDF', included: true },
      { text: 'Défis surprise', included: true },
      { text: 'Export ZIP photos', included: true },
      { text: 'Logo & bannière', included: true },
      { text: 'Sans watermark', included: true },
    ],
    highlight: false,
  },
];

export default function PricingPage() {
  const { user, refreshUser } = useAuth();
  const searchParams  = useSearchParams();
  const currentPlan   = user?.plan || 'free';
  const credits       = user?.eventCredits ?? 0;
  const [loading, setLoading]     = useState<string | null>(null); // clé d'action en cours
  const [error, setError]         = useState<string | null>(null);
  const [proYearly, setProYearly] = useState(false);

  const successType  = searchParams.get('success');   // 'credit' | 'pro'
  const wasCancelled = searchParams.get('cancelled') === '1';

  // Rafraîchir le profil si on revient d'un paiement réussi
  // audit: INFO-025 — refreshUser est desormais memoise (useCallback) dans le provider,
  // donc reference stable : on peut l'inclure dans les deps sans eslint-disable ni risque
  // de closure perimee.
  useEffect(() => {
    if (successType) refreshUser?.();
  }, [successType, refreshUser]);

  async function startCheckout(type: 'credit' | 'pro', quantity = 1) {
    const key = type === 'credit' ? `credit-${quantity}` : 'pro';
    setLoading(key);
    setError(null);
    try {
      const { data } = await api.post('/payments/checkout', {
        type,
        ...(type === 'credit' ? { quantity } : { billing: proYearly ? 'yearly' : 'monthly' }),
      });
      window.location.href = data.url;
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Erreur lors de la connexion au paiement.';
      setError(msg);
      setLoading(null);
    }
  }

  return (
    <div className="fade-in">
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <h2 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          marginBottom: 8,
          color: 'var(--rp-text-primary)',
        }}>
          Choisissez votre formule
        </h2>
        <p style={{ color: 'var(--rp-text-muted)', fontSize: 15 }}>
          Sans engagement pour les particuliers · Abonnement pour les pros
        </p>
      </div>

      {/* Banners retour Stripe */}
      {successType === 'credit' && (
        <div style={{
          background: 'rgba(22,163,74,0.08)', border: '1.5px solid #16a34a',
          borderRadius: 12, padding: '14px 20px', marginBottom: 20,
          fontSize: 14, color: '#16a34a', fontWeight: 600,
        }}>
          Crédit événement ajouté ! Vous pouvez maintenant créer un événement premium.
        </div>
      )}
      {successType === 'pro' && (
        <div style={{
          background: 'rgba(22,163,74,0.08)', border: '1.5px solid #16a34a',
          borderRadius: 12, padding: '14px 20px', marginBottom: 20,
          fontSize: 14, color: '#16a34a', fontWeight: 600,
        }}>
          Bienvenue dans le plan Pro ! Tous vos prochains événements seront illimités.
        </div>
      )}
      {wasCancelled && (
        <div style={{
          background: 'rgba(234,179,8,0.08)', border: '1.5px solid #ca8a04',
          borderRadius: 12, padding: '14px 20px', marginBottom: 20,
          fontSize: 14, color: '#ca8a04',
        }}>
          Paiement annulé. Vous pouvez réessayer quand vous voulez.
        </div>
      )}
      {error && (
        <div style={{
          background: 'rgba(239,68,68,0.08)', border: '1.5px solid var(--rp-danger-text)',
          borderRadius: 12, padding: '14px 20px', marginBottom: 20,
          fontSize: 14, color: 'var(--rp-danger-text)',
        }}>
          {error}
        </div>
      )}

      {/* Crédits disponibles */}
      {credits > 0 && (
        <div style={{
          background: 'linear-gradient(135deg, var(--rp-accent-light, rgba(233,30,140,0.08)), var(--rp-bg-card))',
          border: '1.5px solid var(--rp-accent)',
          borderRadius: 16, padding: '14px 20px', marginBottom: 24,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 24 }}>🎟️</span>
          <div>
            <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--rp-text-primary)' }}>
              Vous avez {credits} crédit{credits > 1 ? 's' : ''} événement{credits > 1 ? 's' : ''} disponible{credits > 1 ? 's' : ''}
            </p>
            <p style={{ fontSize: 12, color: 'var(--rp-text-muted)' }}>
              Chaque crédit débloque 1 événement premium (150 participants, galerie 60j)
            </p>
          </div>
        </div>
      )}

      {/* Toggle mensuel / annuel (Pro uniquement) */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 24, alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: proYearly ? 'var(--rp-text-muted)' : 'var(--rp-text-primary)', fontWeight: proYearly ? 400 : 600 }}>
          Mensuel
        </span>
        <button
          onClick={() => setProYearly(!proYearly)}
          aria-label="Basculer facturation"
          style={{
            width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', position: 'relative',
            background: proYearly ? 'var(--rp-accent)' : 'var(--rp-border)',
            transition: 'background 0.2s',
          }}
        >
          <span style={{
            position: 'absolute', width: 18, height: 18, borderRadius: '50%', top: 3,
            left: proYearly ? 23 : 3, background: '#fff', transition: 'left 0.2s',
          }} />
        </button>
        <span style={{ fontSize: 13, color: proYearly ? 'var(--rp-text-primary)' : 'var(--rp-text-muted)', fontWeight: proYearly ? 600 : 400 }}>
          Annuel
          <span style={{ marginLeft: 6, fontSize: 11, background: 'rgba(22,163,74,0.12)', color: '#16a34a', padding: '2px 8px', borderRadius: 50, fontWeight: 700 }}>
            −31%
          </span>
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, maxWidth: 900, margin: '0 auto' }}
        className="pricing-grid"
      >
        {plans.map((plan) => {
          const isCurrent  = currentPlan === plan.id || (plan.id === 'free' && currentPlan === 'free');
          const isProPlan  = plan.id === 'pro';
          const isEventPlan = plan.id === 'event';

          const proPrice     = proYearly ? '199€' : '24€';
          const proPeriod    = proYearly ? '/an' : '/mois';
          const displayPrice = isProPlan ? proPrice : plan.priceLabel;
          const displayPeriod = isProPlan ? proPeriod : plan.period;

          return (
            <div
              key={plan.id}
              className="card"
              style={{
                padding: '1.5rem', position: 'relative',
                borderColor: plan.highlight ? 'var(--rp-accent)' : 'var(--rp-border)',
                borderWidth: plan.highlight ? 2 : undefined,
              }}
            >
              {plan.badge && (
                <div style={{
                  position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
                  background: 'var(--rp-gradient-cta)', color: 'var(--rp-accent-text)',
                  fontSize: 11, fontWeight: 700, padding: '4px 16px',
                  borderRadius: 50, whiteSpace: 'nowrap',
                }}>
                  {plan.badge}
                </div>
              )}

              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, marginBottom: 4, color: 'var(--rp-text-primary)' }}>
                  {plan.name}
                </h3>
                <p style={{ fontSize: 13, color: 'var(--rp-text-muted)', marginBottom: 16 }}>
                  {plan.description}
                </p>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 4 }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: plan.price ? 36 : 28, fontWeight: 700, color: 'var(--rp-text-primary)' }}>
                    {displayPrice}
                  </span>
                  {displayPeriod && (
                    <span style={{ fontSize: 13, color: 'var(--rp-text-muted)' }}>{displayPeriod}</span>
                  )}
                </div>
              </div>

              <div style={{ borderTop: '0.5px solid var(--rp-border)', paddingTop: 16, marginBottom: 20 }}>
                {plan.features.map((feature, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
                    fontSize: 13,
                    color: feature.included && !('negative' in feature && feature.negative)
                      ? 'var(--rp-text-primary)'
                      : 'var(--rp-text-muted)',
                    opacity: feature.included || ('negative' in feature && feature.negative) ? 1 : 0.5,
                  }}>
                    <span style={{ flexShrink: 0 }}>
                      {feature.included && !('negative' in feature && feature.negative)
                        ? <IconCheck size={14} color="var(--rp-success-text)" />
                        : <IconX size={14} color="var(--rp-text-muted)" />
                      }
                    </span>
                    {feature.text}
                  </div>
                ))}
              </div>

              {/* CTA */}
              {plan.id === 'free' && (
                <button disabled style={{
                  width: '100%', padding: '10px 20px', borderRadius: 50,
                  border: '1.5px solid var(--rp-border)', background: 'transparent',
                  color: 'var(--rp-text-muted)', fontSize: 14, fontWeight: 600, cursor: 'default',
                }}>
                  {currentPlan === 'free' ? 'Plan actuel' : 'Inclus'}
                </button>
              )}

              {isEventPlan && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button
                    className={plan.highlight ? 'btn-gradient' : 'btn-primary'}
                    style={{ width: '100%', fontSize: 14, padding: '10px 20px' }}
                    disabled={loading === 'credit-1'}
                    onClick={() => startCheckout('credit', 1)}
                  >
                    {loading === 'credit-1' ? 'Redirection…' : 'Acheter 1 crédit — 12€'}
                  </button>
                  <button
                    className="btn-secondary"
                    style={{ width: '100%', fontSize: 13, padding: '8px 20px' }}
                    disabled={loading === 'credit-3'}
                    onClick={() => startCheckout('credit', 3)}
                  >
                    {loading === 'credit-3' ? 'Redirection…' : 'Pack 3 crédits — 36€'}
                  </button>
                </div>
              )}

              {isProPlan && currentPlan !== 'pro' && (
                <button
                  className="btn-primary"
                  style={{ width: '100%', fontSize: 14, padding: '10px 20px' }}
                  disabled={loading === 'pro'}
                  onClick={() => startCheckout('pro')}
                >
                  {loading === 'pro' ? 'Redirection…' : 'Passer au Pro'}
                </button>
              )}

              {isProPlan && currentPlan === 'pro' && (
                <button disabled style={{
                  width: '100%', padding: '10px 20px', borderRadius: 50,
                  border: '1.5px solid var(--rp-border)', background: 'transparent',
                  color: 'var(--rp-text-muted)', fontSize: 14, fontWeight: 600, cursor: 'default',
                }}>
                  Plan actuel
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ textAlign: 'center', marginTop: '2rem', fontSize: 13, color: 'var(--rp-text-muted)' }}>
        Paiement sécurisé via Stripe · Aucune donnée bancaire stockée sur nos serveurs
        <br />
        <a href="mailto:contact@rallye-photo.com" style={{ color: 'var(--rp-accent)', marginTop: 4, display: 'inline-block' }}>
          contact@rallye-photo.com
        </a>
      </div>
    </div>
  );
}

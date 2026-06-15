'use client';

import { useAuth } from '@/lib/auth';
import { IconCheck, IconX } from '@/lib/icons';

const plans = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    period: '',
    description: 'Pour tester le concept',
    features: [
      { text: '1 evenement', included: true },
      { text: '2 defis par evenement', included: true },
      { text: '30 participants max', included: true },
      { text: 'Galerie 24h', included: true },
      { text: 'Defis surprise', included: false },
      { text: 'Vote du public', included: false },
      { text: 'Telechargement galerie', included: false },
      { text: 'Support prioritaire', included: false },
    ],
    cta: 'Plan actuel',
    popular: false,
  },
  {
    id: 'starter',
    name: 'Starter',
    price: 9,
    period: '/mois',
    description: 'Pour les evenements reguliers',
    features: [
      { text: '5 evenements', included: true },
      { text: '10 defis par evenement', included: true },
      { text: '100 participants max', included: true },
      { text: 'Galerie 7 jours', included: true },
      { text: 'Defis surprise', included: true },
      { text: 'Vote du public', included: false },
      { text: 'Telechargement galerie', included: true },
      { text: 'Support email', included: true },
    ],
    cta: 'Passer au Starter',
    popular: true,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 29,
    period: '/mois',
    description: 'Pour les professionnels',
    features: [
      { text: 'Evenements illimites', included: true },
      { text: 'Defis illimites', included: true },
      { text: 'Participants illimites', included: true },
      { text: 'Galerie 30 jours', included: true },
      { text: 'Defis surprise', included: true },
      { text: 'Vote du public', included: true },
      { text: 'Telechargement galerie', included: true },
      { text: 'Support prioritaire', included: true },
    ],
    cta: 'Passer au Pro',
    popular: false,
  },
];

export default function PricingPage() {
  const { user } = useAuth();
  const currentPlan = user?.plan || 'free';

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
          Choisissez votre plan
        </h2>
        <p style={{ color: 'var(--rp-text-muted)', fontSize: 15 }}>
          Passez au niveau superieur pour debloquer plus de fonctionnalites
        </p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 16,
        maxWidth: 900,
        margin: '0 auto',
      }}
      className="pricing-grid"
      >
        {plans.map((plan) => {
          const isCurrent = currentPlan === plan.id;
          const isUpgrade = !isCurrent && plan.price > 0;

          return (
            <div
              key={plan.id}
              className="card"
              style={{
                padding: '1.5rem',
                position: 'relative',
                borderColor: plan.popular ? 'var(--rp-accent)' : 'var(--rp-border)',
                borderWidth: plan.popular ? 2 : 0.5,
              }}
            >
              {plan.popular && (
                <div style={{
                  position: 'absolute',
                  top: -12,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'var(--rp-gradient-cta)',
                  color: 'var(--rp-accent-text)',
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '4px 16px',
                  borderRadius: 50,
                  whiteSpace: 'nowrap',
                }}>
                  Populaire
                </div>
              )}

              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <h3 style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 20,
                  fontWeight: 700,
                  marginBottom: 4,
                  color: 'var(--rp-text-primary)',
                }}>
                  {plan.name}
                </h3>
                <p style={{
                  fontSize: 13,
                  color: 'var(--rp-text-muted)',
                  marginBottom: 16,
                }}>
                  {plan.description}
                </p>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 2 }}>
                  <span style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 36,
                    fontWeight: 700,
                    color: 'var(--rp-text-primary)',
                  }}>
                    {plan.price === 0 ? 'Gratuit' : `${plan.price}\u20AC`}
                  </span>
                  {plan.period && (
                    <span style={{ fontSize: 14, color: 'var(--rp-text-muted)' }}>
                      {plan.period}
                    </span>
                  )}
                </div>
              </div>

              <div style={{
                borderTop: '0.5px solid var(--rp-border)',
                paddingTop: 16,
                marginBottom: 20,
              }}>
                {plan.features.map((feature, i) => (
                  <div key={i} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 8,
                    fontSize: 13,
                    color: feature.included ? 'var(--rp-text-primary)' : 'var(--rp-text-muted)',
                    opacity: feature.included ? 1 : 0.5,
                  }}>
                    <span style={{ flexShrink: 0 }}>
                      {feature.included ? <IconCheck size={14} color="var(--rp-success-text)" /> : <IconX size={14} color="var(--rp-text-muted)" />}
                    </span>
                    {feature.text}
                  </div>
                ))}
              </div>

              {isCurrent ? (
                <button
                  disabled
                  style={{
                    width: '100%',
                    padding: '10px 20px',
                    borderRadius: 50,
                    border: '1.5px solid var(--rp-border)',
                    background: 'transparent',
                    color: 'var(--rp-text-muted)',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'default',
                  }}
                >
                  Plan actuel
                </button>
              ) : isUpgrade ? (
                <button
                  className={plan.popular ? 'btn-gradient' : 'btn-primary'}
                  style={{ width: '100%', fontSize: 14, padding: '10px 20px' }}
                  onClick={() => alert('Stripe sera bientot disponible !')}
                >
                  {plan.cta}
                </button>
              ) : (
                <div style={{ height: 42 }} />
              )}
            </div>
          );
        })}
      </div>

      <div style={{
        textAlign: 'center',
        marginTop: '2rem',
        padding: '1.5rem',
        color: 'var(--rp-text-muted)',
        fontSize: 13,
      }}>
        <p>Le paiement sera disponible prochainement via Stripe.</p>
        <p style={{ marginTop: 4 }}>Contactez-nous pour toute question sur les plans.</p>
      </div>
    </div>
  );
}

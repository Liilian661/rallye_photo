'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import Link from 'next/link';
import api from '@/lib/api';

export default function SettingsPage() {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [referralLink, setReferralLink] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [copied, setCopied] = useState(false);
  // audit: INFO-031 — distinguer 'chargement' / 'charge' / 'erreur' au lieu d'un "Chargement..."
  // permanent quand l'appel echoue (catch vide).
  const [referralState, setReferralState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const ctrl = new AbortController();
    api.get('/affiliates/me', { signal: ctrl.signal })
      .then(({ data }) => {
        setReferralLink(data.referralLink);
        setReferralCode(data.referralCode);
        setReferralState('ready');
      })
      .catch((err) => {
        if (err.name === 'CanceledError' || err.name === 'AbortError') return;
        setReferralState('error'); // audit: INFO-031 — surface l'echec reseau
      });
    return () => ctrl.abort();
  }, []);

  const copyLink = () => {
    navigator.clipboard.writeText(referralLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div style={{ maxWidth: 560 }} className="fade-in">
      <h2 style={{
        fontFamily: 'var(--font-display)',
        fontSize: 28,
        fontWeight: 700,
        letterSpacing: '-0.02em',
        marginBottom: '2rem',
        color: 'var(--rp-text-primary)',
      }}>
        Paramètres
      </h2>

      {/* Account */}
      <div className="card" style={{ padding: '2rem', marginBottom: 16 }}>
        <h3 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 18,
          fontWeight: 600,
          marginBottom: '1rem',
          color: 'var(--rp-text-primary)',
        }}>
          Mon compte
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <p style={{ fontSize: 13, color: 'var(--rp-text-muted)', marginBottom: 2 }}>Nom</p>
            <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--rp-text-primary)' }}>
              {user?.firstName} {user?.lastName}
            </p>
          </div>
          <div>
            <p style={{ fontSize: 13, color: 'var(--rp-text-muted)', marginBottom: 2 }}>Email</p>
            <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--rp-text-primary)' }}>
              {user?.email}
            </p>
          </div>
          <div>
            <p style={{ fontSize: 13, color: 'var(--rp-text-muted)', marginBottom: 2 }}>Plan</p>
            <span className="badge badge-accent" style={{ textTransform: 'capitalize' }}>
              {user?.plan}
            </span>
          </div>
        </div>
      </div>

      {/* Referral */}
      <div className="card" style={{ padding: '2rem', marginBottom: 16 }}>
        <h3 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 18,
          fontWeight: 600,
          marginBottom: 4,
          color: 'var(--rp-text-primary)',
        }}>
          Lien d&apos;invitation
        </h3>
        <p style={{ fontSize: 13, color: 'var(--rp-text-muted)', marginBottom: 14 }}>
          Partagez ce lien — vous serez récompensé dès que vos invités réalisent leur premier achat.
        </p>
        {referralState === 'ready' && referralLink ? (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <div style={{
                flex: 1,
                background: 'var(--rp-bg)',
                border: '1px solid var(--rp-border)',
                borderRadius: 8,
                padding: '8px 12px',
                fontSize: 12,
                color: 'var(--rp-text-secondary)',
                fontFamily: 'monospace',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {referralLink}
              </div>
              <button
                onClick={copyLink}
                className={copied ? 'btn-primary' : 'btn-secondary'}
                style={{ flexShrink: 0, padding: '8px 16px', fontSize: 12 }}
              >
                {copied ? '✓ Copié' : 'Copier'}
              </button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--rp-text-muted)' }}>
              Code court : <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--rp-accent)' }}>{referralCode}</span>
            </p>
          </>
        ) : referralState === 'error' ? (
          <p style={{ fontSize: 13, color: 'var(--rp-danger-text)' }}>
            Impossible de charger votre lien d&apos;invitation. Reessayez plus tard.
          </p>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--rp-text-muted)' }}>Chargement...</p>
        )}
        <Link href="/dashboard/affiliates" style={{ display: 'inline-block', marginTop: 12 }}>
          <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 0' }}>
            Voir mes statistiques d&apos;affiliation →
          </button>
        </Link>
      </div>

      {/* Appearance */}
      <div className="card" style={{ padding: '2rem', marginBottom: 16 }}>
        <h3 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 18,
          fontWeight: 600,
          marginBottom: '1rem',
          color: 'var(--rp-text-primary)',
        }}>
          Apparence
        </h3>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div>
            <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--rp-text-primary)', marginBottom: 2 }}>
              Thème
            </p>
            <p style={{ fontSize: 13, color: 'var(--rp-text-muted)' }}>
              {theme === 'dark' ? 'Violet & Lime — mode sombre' : 'Pink & Blue — mode clair'}
            </p>
          </div>
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            style={{
              width: 52,
              height: 28,
              borderRadius: 14,
              border: 'none',
              cursor: 'pointer',
              position: 'relative',
              background: theme === 'dark' ? 'var(--rp-secondary)' : 'var(--rp-accent)',
              transition: 'background 0.3s ease',
            }}
          >
            <span style={{
              position: 'absolute',
              width: 22,
              height: 22,
              borderRadius: '50%',
              top: 3,
              left: theme === 'dark' ? 3 : 27,
              background: '#fff',
              transition: 'left 0.3s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
            }}>
              {theme === 'dark' ? '🌙' : '☀️'}
            </span>
          </button>
        </div>
      </div>

    </div>
  );
}

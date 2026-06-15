'use client';

import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import Link from 'next/link';

export default function SettingsPage() {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();

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

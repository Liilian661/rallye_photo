'use client';

import { useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { IconMail } from '@/lib/icons';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur serveur');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1rem',
      background: 'var(--rp-bg-page)',
    }}>
      <div style={{ width: '100%', maxWidth: 420 }} className="fade-in">
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            marginBottom: 8,
            color: 'var(--rp-logo-text)',
          }}>
            rallye<span style={{ color: 'var(--rp-logo-dot)' }}>.</span>photo
          </h1>
        </div>

        <div className="card" style={{ padding: '2rem' }}>
          {sent ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ marginBottom: 12 }}><IconMail size={40} color="var(--rp-accent)" /></div>
              <h2 style={{
                fontFamily: 'var(--font-display)',
                fontSize: 20,
                fontWeight: 700,
                marginBottom: 8,
                color: 'var(--rp-text-primary)',
              }}>
                Email envoye !
              </h2>
              <p style={{ color: 'var(--rp-text-muted)', fontSize: 14, lineHeight: 1.6 }}>
                Si un compte existe avec cet email, vous recevrez un lien pour reinitialiser votre mot de passe.
              </p>
            </div>
          ) : (
            <>
              <h2 style={{
                fontFamily: 'var(--font-display)',
                fontSize: 20,
                fontWeight: 700,
                marginBottom: 8,
                color: 'var(--rp-text-primary)',
                textAlign: 'center',
              }}>
                Mot de passe oublie
              </h2>
              <p style={{
                color: 'var(--rp-text-muted)',
                fontSize: 14,
                textAlign: 'center',
                marginBottom: 24,
              }}>
                Entrez votre email, on vous enverra un lien de reinitialisation.
              </p>

              <form onSubmit={handleSubmit}>
                {error && (
                  <div className="alert-error" style={{ marginBottom: '1rem' }}>
                    {error}
                  </div>
                )}

                <div style={{ marginBottom: '1.5rem' }}>
                  <input
                    type="email"
                    className="input-field"
                    placeholder="vous@exemple.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </div>

                <button
                  type="submit"
                  className="btn-gradient"
                  disabled={loading || !email.trim()}
                  style={{ width: '100%' }}
                >
                  {loading ? 'Envoi...' : 'Envoyer le lien'}
                </button>
              </form>
            </>
          )}
        </div>

        <p style={{
          textAlign: 'center',
          marginTop: '1rem',
          fontSize: 14,
          color: 'var(--rp-text-muted)',
        }}>
          <Link href="/auth/login" style={{ color: 'var(--rp-accent)', fontWeight: 600 }}>
            Retour au login
          </Link>
        </p>
      </div>
    </div>
  );
}

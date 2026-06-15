'use client';

import { useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import api from '@/lib/api';
import { IconError, IconCheckCircle } from '@/lib/icons';

function ResetContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  if (!token) {
    return (
      <div className="card fade-in" style={{
        maxWidth: 420,
        width: '100%',
        padding: '2rem',
        textAlign: 'center',
      }}>
        <div style={{ marginBottom: 12 }}><IconError size={40} /></div>
        <h2 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 22,
          fontWeight: 700,
          marginBottom: 8,
          color: 'var(--rp-text-primary)',
        }}>
          Lien invalide
        </h2>
        <p style={{ color: 'var(--rp-text-muted)', fontSize: 15, marginBottom: 24 }}>
          Ce lien de reinitialisation est invalide ou a expire.
        </p>
        <Link href="/auth/forgot-password">
          <button className="btn-gradient">Demander un nouveau lien</button>
        </Link>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caracteres');
      return;
    }

    if (password !== confirm) {
      setError('Les mots de passe ne correspondent pas');
      return;
    }

    setLoading(true);

    try {
      await api.post('/auth/reset-password', { token, password });
      setSuccess(true);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur serveur');
    } finally {
      setLoading(false);
    }
  };

  return (
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
        {success ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ marginBottom: 12 }}><IconCheckCircle size={40} color="var(--rp-success-text)" /></div>
            <h2 style={{
              fontFamily: 'var(--font-display)',
              fontSize: 20,
              fontWeight: 700,
              marginBottom: 8,
              color: 'var(--rp-text-primary)',
            }}>
              Mot de passe modifie !
            </h2>
            <p style={{
              color: 'var(--rp-text-muted)',
              fontSize: 14,
              marginBottom: 24,
            }}>
              Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.
            </p>
            <button className="btn-gradient" onClick={() => router.push('/auth/login')}>
              Se connecter
            </button>
          </div>
        ) : (
          <>
            <h2 style={{
              fontFamily: 'var(--font-display)',
              fontSize: 20,
              fontWeight: 700,
              marginBottom: 24,
              color: 'var(--rp-text-primary)',
              textAlign: 'center',
            }}>
              Nouveau mot de passe
            </h2>

            <form onSubmit={handleSubmit}>
              {error && (
                <div className="alert-error" style={{ marginBottom: '1rem' }}>
                  {error}
                </div>
              )}

              <div style={{ marginBottom: '1rem' }}>
                <label style={{
                  display: 'block',
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'var(--rp-text-secondary)',
                  marginBottom: 6,
                }}>
                  Nouveau mot de passe
                </label>
                <input
                  type="password"
                  className="input-field"
                  placeholder="Minimum 8 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{
                  display: 'block',
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'var(--rp-text-secondary)',
                  marginBottom: 6,
                }}>
                  Confirmer le mot de passe
                </label>
                <input
                  type="password"
                  className="input-field"
                  placeholder="Retapez le mot de passe"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>

              <button
                type="submit"
                className="btn-gradient"
                disabled={loading}
                style={{ width: '100%' }}
              >
                {loading ? 'Modification...' : 'Modifier le mot de passe'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1rem',
      background: 'var(--rp-bg-page)',
    }}>
      <Suspense fallback={
        <p style={{ color: 'var(--rp-text-muted)' }}>Chargement...</p>
      }>
        <ResetContent />
      </Suspense>
    </div>
  );
}

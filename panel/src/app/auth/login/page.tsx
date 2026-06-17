'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      router.push('/dashboard');
    } catch (err: any) {
      // TODO(audit:LOW-076): garantir des messages d'auth generiques cote backend (anti-enumeration).
      // L'enforcement reel doit etre cote API ; on conserve ici un fallback generique.
      setError(err.response?.data?.error || 'Erreur de connexion');
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
          <p style={{ color: 'var(--rp-text-muted)', fontSize: 15 }}>
            Connectez-vous à votre espace organisateur
          </p>
        </div>

        <div className="card" style={{ padding: '2rem' }}>
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
                Email
              </label>
              <input
                type="email"
                className="input-field"
                placeholder="vous@exemple.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
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
                Mot de passe
              </label>
              <input
                type="password"
                className="input-field"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <button
              type="submit"
              className="btn-gradient"
              disabled={loading}
              style={{ width: '100%' }}
            >
              {loading ? 'Connexion...' : 'Se connecter'}
            </button>
          </form>
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <Link href="/auth/forgot-password" style={{
              fontSize: 13,
              color: 'var(--rp-text-muted)',
            }}>
              Mot de passe oublie ?
            </Link>
          </div>
        </div>

        <p style={{
          textAlign: 'center',
          marginTop: '1rem',
          fontSize: 14,
          color: 'var(--rp-text-muted)',
        }}>
          Pas encore de compte ?{' '}
          <Link href="/auth/register" style={{ color: 'var(--rp-accent)', fontWeight: 600 }}>
            Créer un compte
          </Link>
        </p>
      </div>
    </div>
  );
}

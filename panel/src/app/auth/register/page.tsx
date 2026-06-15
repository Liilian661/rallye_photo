'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';

export default function RegisterPage() {
  const [firstName, setFirstName]     = useState('');
  const [lastName, setLastName]       = useState('');
  const [email, setEmail]             = useState('');
  const [password, setPassword]       = useState('');
  const [newsletter, setNewsletter]   = useState(false);
  const [referralCode, setReferralCode] = useState('');
  const [showRefInput, setShowRefInput] = useState(false);
  const [error, setError]             = useState('');
  const [loading, setLoading]         = useState(false);
  const { register }  = useAuth();
  const router        = useRouter();
  const searchParams  = useSearchParams();

  // Pré-remplir depuis ?ref=CODE dans l'URL
  useEffect(() => {
    const ref = searchParams.get('ref');
    if (ref) {
      setReferralCode(ref.toUpperCase());
      setShowRefInput(true);
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères');
      setLoading(false);
      return;
    }

    try {
      await register({
        firstName, lastName, email, password, newsletter,
        ...(referralCode.trim() ? { referralCode: referralCode.trim().toUpperCase() } : {}),
      });
      router.push('/auth/verify-pending');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur lors de l\'inscription');
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
            Créez votre compte organisateur
          </p>
        </div>

        <div className="card" style={{ padding: '2rem' }}>
          <form onSubmit={handleSubmit}>
            {error && (
              <div className="alert-error" style={{ marginBottom: '1rem' }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--rp-text-secondary)', marginBottom: 6 }}>
                  Prénom
                </label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Jean"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--rp-text-secondary)', marginBottom: 6 }}>
                  Nom
                </label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Dupont"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                />
              </div>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--rp-text-secondary)', marginBottom: 6 }}>
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

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--rp-text-secondary)', marginBottom: 6 }}>
                Mot de passe
              </label>
              <input
                type="password"
                className="input-field"
                placeholder="Minimum 8 caractères"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>

            {/* Code de parrainage */}
            {showRefInput ? (
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--rp-text-secondary)', marginBottom: 6 }}>
                  Code de parrainage <span style={{ fontWeight: 400, color: 'var(--rp-text-muted)' }}>(optionnel)</span>
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="EX: ABC12345"
                    value={referralCode}
                    onChange={(e) => setReferralCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
                    style={{ fontFamily: 'monospace', letterSpacing: '0.05em' }}
                  />
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ flexShrink: 0, fontSize: 12, padding: '0 12px' }}
                    onClick={() => { setShowRefInput(false); setReferralCode(''); }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ marginBottom: '1.25rem' }}>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ fontSize: 12, padding: '4px 0', color: 'var(--rp-text-muted)' }}
                  onClick={() => setShowRefInput(true)}
                >
                  + J&apos;ai un code de parrainage
                </button>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1.5rem' }}>
              <input
                type="checkbox"
                id="newsletter"
                checked={newsletter}
                onChange={(e) => setNewsletter(e.target.checked)}
                style={{ width: 18, height: 18, cursor: 'pointer' }}
              />
              <label htmlFor="newsletter" style={{ fontSize: 13, color: 'var(--rp-text-secondary)', cursor: 'pointer' }}>
                Recevoir les nouveautés et conseils par email
              </label>
            </div>

            <button
              type="submit"
              className="btn-gradient"
              disabled={loading}
              style={{ width: '100%' }}
            >
              {loading ? 'Création...' : 'Créer mon compte'}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', marginTop: '1rem', fontSize: 14, color: 'var(--rp-text-muted)' }}>
          Déjà un compte ?{' '}
          <Link href="/auth/login" style={{ color: 'var(--rp-accent)', fontWeight: 600 }}>
            Se connecter
          </Link>
        </p>
      </div>
    </div>
  );
}

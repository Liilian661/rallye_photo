'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import api from '@/lib/api';
import { IconMail } from '@/lib/icons';

export default function VerifyPendingPage() {
  const { user, refreshUser, logout } = useAuth();
  const router = useRouter();
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState('');

  // Poll every 5s to check if email was verified
  useEffect(() => {
    const interval = setInterval(async () => {
      await refreshUser();
    }, 5000);
    return () => clearInterval(interval);
  }, [refreshUser]);

  // Redirect to dashboard once verified
  useEffect(() => {
    if (user?.emailVerified) {
      router.replace('/dashboard');
    }
  }, [user, router]);

  const handleResend = async () => {
    setResending(true);
    setError('');
    setResent(false);

    try {
      await api.post('/auth/resend-verification');
      setResent(true);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur serveur');
    } finally {
      setResending(false);
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
            color: 'var(--rp-logo-text)',
          }}>
            rallye<span style={{ color: 'var(--rp-logo-dot)' }}>.</span>photo
          </h1>
        </div>

        <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
          <div style={{ marginBottom: 16 }}><IconMail size={48} color="var(--rp-accent)" /></div>

          <h2 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 22,
            fontWeight: 700,
            marginBottom: 8,
            color: 'var(--rp-text-primary)',
          }}>
            Verifiez votre email
          </h2>

          <p style={{
            color: 'var(--rp-text-muted)',
            fontSize: 14,
            lineHeight: 1.6,
            marginBottom: 8,
          }}>
            Un email de verification a ete envoye a :
          </p>

          <p style={{
            color: 'var(--rp-accent)',
            fontSize: 15,
            fontWeight: 600,
            marginBottom: 24,
          }}>
            {user?.email}
          </p>

          <p style={{
            color: 'var(--rp-text-muted)',
            fontSize: 13,
            lineHeight: 1.6,
            marginBottom: 24,
          }}>
            Cliquez sur le lien dans l&apos;email pour activer votre compte.
            Pensez a verifier vos spams.
          </p>

          {resent && (
            <div style={{
              background: 'var(--rp-success-light)',
              color: 'var(--rp-success-text)',
              padding: '10px 16px',
              borderRadius: 12,
              fontSize: 13,
              marginBottom: 16,
            }}>
              Email renvoye avec succes !
            </div>
          )}

          {error && (
            <div className="alert-error" style={{ marginBottom: 16 }}>
              {error}
            </div>
          )}

          <button
            className="btn-gradient"
            onClick={handleResend}
            disabled={resending || resent}
            style={{ width: '100%', marginBottom: 12 }}
          >
            {resending ? 'Envoi...' : resent ? 'Email renvoye !' : 'Renvoyer l\'email'}
          </button>

          <button
            className="btn-ghost"
            onClick={logout}
            style={{ fontSize: 13 }}
          >
            Se deconnecter
          </button>
        </div>
      </div>
    </div>
  );
}

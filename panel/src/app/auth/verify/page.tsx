'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import api from '@/lib/api';
import { IconLoader, IconCheckCircle, IconError } from '@/lib/icons';

function VerifyContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Token manquant');
      return;
    }

    api.get(`/auth/verify-email?token=${token}`)
      .then(() => {
        setStatus('success');
        setMessage('Votre email a bien ete verifie !');
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err.response?.data?.error || 'Token invalide ou expire');
      });
  }, [token]);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1rem',
      background: 'var(--rp-bg-page)',
    }}>
      <div className="card fade-in" style={{
        maxWidth: 420,
        width: '100%',
        padding: '2rem',
        textAlign: 'center',
      }}>
        {status === 'loading' && (
          <>
            <div style={{ marginBottom: 12 }}><IconLoader size={40} color="var(--rp-text-muted)" /></div>
            <p style={{ color: 'var(--rp-text-muted)', fontSize: 16 }}>
              Verification en cours...
            </p>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={{ marginBottom: 12 }}><IconCheckCircle size={40} color="var(--rp-success-text)" /></div>
            <h2 style={{
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              fontWeight: 700,
              marginBottom: 8,
              color: 'var(--rp-text-primary)',
            }}>
              Email verifie !
            </h2>
            <p style={{ color: 'var(--rp-text-muted)', fontSize: 15, marginBottom: 24 }}>
              {message}
            </p>
            <button className="btn-gradient" onClick={() => router.push('/dashboard')}>
              Acceder au dashboard
            </button>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{ marginBottom: 12 }}><IconError size={40} /></div>
            <h2 style={{
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              fontWeight: 700,
              marginBottom: 8,
              color: 'var(--rp-text-primary)',
            }}>
              Erreur
            </h2>
            <p style={{ color: 'var(--rp-text-muted)', fontSize: 15, marginBottom: 24 }}>
              {message}
            </p>
            <button className="btn-gradient" onClick={() => router.push('/auth/login')}>
              Retour au login
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--rp-bg-page)',
      }}>
        <p style={{ color: 'var(--rp-text-muted)' }}>Chargement...</p>
      </div>
    }>
      <VerifyContent />
    </Suspense>
  );
}

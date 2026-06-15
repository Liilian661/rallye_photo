'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 4) {
      setError('Code trop court');
      return;
    }
    setLoading(true);
    router.push(`/join/${trimmed}`);
  };

  return (
    <div className="page-container" style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{ width: '100%', textAlign: 'center' }} className="fade-in">
        <div style={{ marginBottom: 48 }}>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 36,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            marginBottom: 8,
          }}>
            rallye<span style={{ color: 'var(--rp-pink)' }}>.</span>photo
          </h1>
          <p style={{ color: 'var(--rp-text-muted)', fontSize: 16 }}>
            Rejoignez le rallye photo !
          </p>
        </div>

        <div className="card" style={{ padding: '2rem', marginBottom: 24 }}>
          <p style={{
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--rp-text-secondary)',
            marginBottom: 16,
          }}>
            Entrez le code de l&apos;événement
          </p>

          <form onSubmit={handleSubmit}>
            <input
              type="text"
              className="input-field input-code"
              placeholder="ABC123"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
                setError('');
              }}
              maxLength={8}
              autoComplete="off"
              autoCapitalize="characters"
              style={{ marginBottom: 16 }}
            />

            {error && (
              <p style={{
                color: 'var(--rp-red)',
                fontSize: 14,
                marginBottom: 12,
              }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              className="btn-primary"
              disabled={loading || code.trim().length < 4}
            >
              {loading ? 'Recherche...' : 'Rejoindre'}
            </button>
          </form>
        </div>

        <p style={{ fontSize: 13, color: 'var(--rp-text-muted)', lineHeight: 1.6 }}>
          Scannez le QR code ou entrez le code<br />
          fourni par l&apos;organisateur
        </p>
      </div>
    </div>
  );
}

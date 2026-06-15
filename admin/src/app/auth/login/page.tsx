'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie';
import api from '@/lib/api';

export default function AdminLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Login via normal auth
      const { data } = await api.post('/auth/login', { email, password });
      Cookies.set('adminAccessToken', data.accessToken, { expires: 1 });
      Cookies.set('adminRefreshToken', data.refreshToken, { expires: 30 });

      // Check if user is admin
      const { data: profile } = await api.get('/auth/me');
      if (!profile.isAdmin) {
        Cookies.remove('adminAccessToken');
        Cookies.remove('adminRefreshToken');
        setError('Acces refuse - vous n\'etes pas administrateur');
        setLoading(false);
        return;
      }

      Cookies.set('adminUser', JSON.stringify(profile), { expires: 30 });
      router.push('/dashboard');
    } catch (err: any) {
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
      <div style={{ width: '100%', maxWidth: 400 }} className="fade-in">
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            marginBottom: 4,
          }}>
            rallye<span style={{ color: 'var(--rp-accent)' }}>.</span>photo
          </h1>
          <p style={{ color: 'var(--rp-text-muted)', fontSize: 13 }}>Administration</p>
        </div>

        <div className="card" style={{ padding: '1.5rem' }}>
          <form onSubmit={handleSubmit}>
            {error && (
              <div className="alert-error" style={{ marginBottom: '1rem' }}>{error}</div>
            )}

            <div style={{ marginBottom: '0.75rem' }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--rp-text-secondary)', marginBottom: 4 }}>
                Email
              </label>
              <input type="email" className="input-field" placeholder="admin@rallye-photo.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--rp-text-secondary)', marginBottom: 4 }}>
                Mot de passe
              </label>
              <input type="password" className="input-field" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>

            <button type="submit" className="btn-gradient" disabled={loading} style={{ width: '100%' }}>
              {loading ? 'Connexion...' : 'Se connecter'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

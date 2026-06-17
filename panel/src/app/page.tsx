'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie';

// audit: LOW-075 — verifier l'expiration du JWT (claim exp) avant de rediriger vers /dashboard,
// au lieu de se fier a la simple presence du cookie (un token expire/mort envoyait l'utilisateur
// sur /dashboard). Decodage du payload uniquement (pas de verification de signature, faite cote API).
function isAccessTokenValid(token: string | undefined): boolean {
  if (!token) return false;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64));
    if (typeof payload.exp !== 'number') return true; // pas d'exp connu : on laisse le dashboard gerer le 401
    return payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const token = Cookies.get('accessToken');
    if (isAccessTokenValid(token)) {
      router.replace('/dashboard');
    } else {
      router.replace('/auth/login');
    }
  }, [router]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <p style={{ color: 'var(--rp-text-muted)', fontSize: 16 }}>Chargement...</p>
    </div>
  );
}

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // adminAccessToken est HttpOnly (posé par l'API) — non lisible en JS.
    // On utilise adminUser (cookie JS posé après login réussi) comme le layout.
    const token = Cookies.get('adminUser');
    if (token) {
      router.replace('/dashboard');
    } else {
      router.replace('/auth/login');
    }
  }, [router]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <p style={{ color: 'var(--rp-text-muted)' }}>Chargement...</p>
    </div>
  );
}

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // accessToken est HttpOnly (non lisible par js-cookie).
    // On se base sur le cookie `user` (non-HttpOnly) pour savoir si une session est active.
    // Si le cookie est absent ou corrompu, le dashboard redirigera vers /auth/login de toute façon.
    const savedUser = Cookies.get('user');
    if (savedUser) {
      try {
        JSON.parse(savedUser);
        router.replace('/dashboard');
      } catch {
        Cookies.remove('user');
        router.replace('/auth/login');
      }
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

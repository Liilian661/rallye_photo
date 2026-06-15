'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const token = Cookies.get('adminAccessToken');
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

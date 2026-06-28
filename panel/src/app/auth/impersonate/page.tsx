'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Cookies from 'js-cookie';
import api from '@/lib/api';
import { COOKIE_OPTS } from '@/lib/auth';

function ImpersonateContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get('code');
    if (!code) {
      router.replace('/auth/login');
      return;
    }

    api.post('/auth/impersonate-exchange', { code })
      .then(({ data }) => {
        // Les tokens sont posés en cookies HttpOnly par l'API.
        // On stocke uniquement les infos utilisateur en cookie non-HttpOnly pour l'UI.
        if (data.user) {
          Cookies.set('user', JSON.stringify(data.user), { expires: 1, ...COOKIE_OPTS });
        }
        window.location.href = '/dashboard';
      })
      .catch(() => {
        router.replace('/auth/login');
      });
  }, [searchParams, router]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <p style={{ color: 'var(--rp-text-muted)' }}>Connexion en cours...</p>
    </div>
  );
}

export default function ImpersonatePage() {
  return (
    <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}><p>Chargement...</p></div>}>
      <ImpersonateContent />
    </Suspense>
  );
}

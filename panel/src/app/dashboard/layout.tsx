'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie';
import Sidebar from '../components/Sidebar';
import { useAuth, COOKIE_OPTS } from '@/lib/auth';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading, refreshUser } = useAuth();

  // audit: HIGH-016 — les tokens d'impersonation ne transitent plus en query string (?) mais dans
  // le FRAGMENT d'URL (window.location.hash, jamais envoye au serveur ni au Referer). On le lit,
  // on l'efface IMMEDIATEMENT via history.replaceState avant tout rendu/chargement, puis on pose
  // les cookies avec les memes options durcies que le login (sameSite strict + secure en prod).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash; // ex: #impersonate=accessToken%3D...%26refreshToken%3D...
    if (!hash.startsWith('#impersonate=')) return;

    // Effacer le fragment AVANT toute autre operation (pas de fuite via historique/Referer).
    const raw = hash.slice('#impersonate='.length);
    history.replaceState(null, '', window.location.pathname + window.location.search);

    try {
      const params = new URLSearchParams(decodeURIComponent(raw));
      const accessToken = params.get('accessToken');
      const refreshToken = params.get('refreshToken');
      const userData = params.get('user');

      if (accessToken && refreshToken && userData) {
        Cookies.set('accessToken', accessToken, { expires: 1, ...COOKIE_OPTS });
        Cookies.set('refreshToken', refreshToken, { expires: 30, ...COOKIE_OPTS });
        Cookies.set('user', userData, { expires: 30, ...COOKIE_OPTS });
        // Recharger le dashboard avec la session impersonee active.
        window.location.href = '/dashboard';
      }
    } catch {
      // ignore : fragment malforme
    }
  }, []);

  // audit: LOW-069 — la garde de verification email ne doit pas dependre uniquement du cookie 'user'
  // (modifiable cote client). On rafraichit le profil via /auth/me au montage pour rebaser
  // emailVerified/plan sur la source serveur. L'enforcement reel reste cote API (TODO backend).
  useEffect(() => {
    const token = Cookies.get('accessToken');
    if (!token) return;
    // refreshUser() appelle /auth/me et rebase emailVerified/plan/credits sur la source serveur.
    // Un 401 declenche la purge + redirection via l'interceptor api (defense en profondeur).
    refreshUser().catch(() => {});
  }, [refreshUser]);

  useEffect(() => {
    const token = Cookies.get('accessToken');
    if (!token) {
      router.replace('/auth/login');
      return;
    }

    // Block if email not verified (valeur rebasee sur /auth/me ci-dessus). audit: LOW-069
    if (!loading && user && user.emailVerified === false) {
      router.replace('/auth/verify-pending');
    }
  }, [router, user, loading]);

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main className="dashboard-main" style={{
        marginLeft: 260,
        flex: 1,
        minHeight: '100vh',
        padding: '2rem',
        background: 'var(--rp-bg-page)',
        transition: 'background 0.3s ease',
      }}>
        {children}
      </main>
    </div>
  );
}
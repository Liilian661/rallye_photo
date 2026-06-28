'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie';
import Sidebar from '../components/Sidebar';
import { useAuth } from '@/lib/auth';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading, refreshUser } = useAuth();

  // audit: LOW-069 — rafraîchit le profil via /auth/me pour rebaser emailVerified/plan.
  useEffect(() => {
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
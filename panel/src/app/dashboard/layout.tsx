'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Cookies from 'js-cookie';
import Sidebar from '../components/Sidebar';
import { useAuth } from '@/lib/auth';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading, refreshUser } = useAuth();

  // Handle admin impersonation
  useEffect(() => {
    const impersonateData = searchParams.get('impersonate');
    if (impersonateData) {
      try {
        const params = new URLSearchParams(impersonateData);
        const accessToken = params.get('accessToken');
        const refreshToken = params.get('refreshToken');
        const userData = params.get('user');

        if (accessToken && refreshToken && userData) {
          Cookies.set('accessToken', accessToken, { expires: 1 });
          Cookies.set('refreshToken', refreshToken, { expires: 30 });
          Cookies.set('user', userData, { expires: 30 });
          // Remove the query param and reload
          window.location.href = '/dashboard';
        }
      } catch {
        // ignore
      }
    }
  }, [searchParams]);

  useEffect(() => {
    const token = Cookies.get('accessToken');
    if (!token) {
      router.replace('/auth/login');
      return;
    }

    // Block if email not verified
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
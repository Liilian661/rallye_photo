'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import Cookies from 'js-cookie';
import { IconHome, IconUsers, IconCalendar, IconSettings, IconMenu, IconX, IconLogout } from '@/lib/icons';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: IconHome },
  { href: '/dashboard/users', label: 'Utilisateurs', icon: IconUsers },
  { href: '/dashboard/events', label: 'Evenements', icon: IconCalendar },
  { href: '/dashboard/settings', label: 'Settings', icon: IconSettings },
];

export default function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const token = Cookies.get('adminAccessToken');
    if (!token) router.replace('/auth/login');
  }, [router]);

  useEffect(() => { setOpen(false); }, [pathname]);

  const logout = () => {
    Cookies.remove('adminAccessToken');
    Cookies.remove('adminRefreshToken');
    Cookies.remove('adminUser');
    router.push('/auth/login');
  };

  return (
    <div style={{ display: 'flex' }}>
      {/* Hamburger */}
      <button onClick={() => setOpen(true)} className="sidebar-hamburger" style={{
        position: 'fixed', top: 12, left: 12, zIndex: 200, width: 40, height: 40,
        borderRadius: 10, border: '0.5px solid var(--rp-border)', background: 'var(--rp-bg-sidebar)',
        display: 'none', alignItems: 'center', justifyContent: 'center', fontSize: 20,
        cursor: 'pointer', color: 'var(--rp-text-primary)',
      }}>
        <IconMenu size={20} />
      </button>

      {/* Overlay */}
      {open && <div onClick={() => setOpen(false)} style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.5)', zIndex: 299,
      }} />}

      {/* Sidebar */}
      <aside className={`sidebar ${open ? 'sidebar-open' : ''}`} style={{
        width: 240, position: 'fixed', top: 0, left: 0, bottom: 0,
        background: 'var(--rp-bg-sidebar)', borderRight: '0.5px solid var(--rp-border)',
        display: 'flex', flexDirection: 'column', padding: '1.25rem 0.75rem',
        transition: 'transform 0.3s ease', zIndex: 300,
      }}>
        <button onClick={() => setOpen(false)} className="sidebar-close" style={{
          position: 'absolute', top: 12, right: 12, background: 'none', border: 'none',
          fontSize: 20, cursor: 'pointer', color: 'var(--rp-text-muted)', display: 'none',
        }}>
          <IconX size={20} />
        </button>

        <div style={{ paddingLeft: 10, marginBottom: '1.5rem' }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: '#fff' }}>
            rallye<span style={{ color: 'var(--rp-accent)' }}>.</span>photo
          </h1>
          <p style={{ fontSize: 10, color: 'var(--rp-danger-text)', fontWeight: 600, marginTop: 2 }}>
            ADMIN
          </p>
        </div>

        <nav style={{ flex: 1 }}>
          {navItems.map((item) => {
            const isActive = pathname === item.href ||
              (item.href !== '/dashboard' && pathname.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                borderRadius: 8, marginBottom: 2, fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? 'var(--rp-accent)' : 'var(--rp-text-muted)',
                background: isActive ? 'var(--rp-accent-light)' : 'transparent',
              }}>
                <item.icon size={15} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <button onClick={logout} style={{
          padding: '8px 10px', borderRadius: 8, border: 'none',
          background: 'transparent', fontSize: 12, color: 'var(--rp-text-muted)',
          cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <IconLogout size={14} /> Se deconnecter
        </button>
      </aside>

      <main className="dashboard-main" style={{
        marginLeft: 240, flex: 1, minHeight: '100vh', padding: '1.5rem',
        background: 'var(--rp-bg-page)',
      }}>
        {children}
      </main>
    </div>
  );
}
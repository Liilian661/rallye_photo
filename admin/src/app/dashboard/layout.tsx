'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import Cookies from 'js-cookie';
import api from '@/lib/api';
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
  // audit: HIGH-018 / LOW-082 — etat de garde : tant que l'auth n'est pas confirmee, on ne rend
  // PAS les enfants (sinon flash de contenu admin + appels /admin/* premature avant redirection).
  const [authState, setAuthState] = useState<'checking' | 'authorized'>('checking');

  // audit: HIGH-018 — l'autorisation ne doit pas reposer sur la simple presence du cookie :
  // on revalide isAdmin via /auth/me au montage. Un admin dont les droits ont ete retires (ou un
  // visiteur sans token) est redirige vers /auth/login au lieu de garder l'acces UI.
  // Note: l'enforcement reel reste cote API (chaque route /admin/* doit exiger isAdmin) — TODO backend.
  useEffect(() => {
    let active = true;
    const token = Cookies.get('adminAccessToken');
    if (!token) {
      router.replace('/auth/login');
      return;
    }
    api.get('/auth/me')
      .then(({ data }) => {
        if (!active) return;
        if (data?.isAdmin) {
          setAuthState('authorized');
        } else {
          Cookies.remove('adminAccessToken');
          Cookies.remove('adminRefreshToken');
          Cookies.remove('adminUser');
          router.replace('/auth/login');
        }
      })
      .catch(() => {
        // 401/echec : l'interceptor api purge + redirige deja ; on garde le loader (pas de flash).
        if (active) router.replace('/auth/login');
      });
    return () => { active = false; };
  }, [router]);

  useEffect(() => { setOpen(false); }, [pathname]);

  const logout = async () => {
    // Toujours appeler l'API — le cookie HttpOnly refreshToken est envoyé via withCredentials.
    // Pour les anciennes sessions (adminRefreshToken en js-cookie), on l'envoie aussi dans le body.
    const legacyRefreshToken = Cookies.get('adminRefreshToken');
    try {
      await Promise.race([
        api.post('/auth/logout', legacyRefreshToken ? { refreshToken: legacyRefreshToken } : {}),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    } catch { /* ignorer l'erreur réseau, on déconnecte quand même */ }
    Cookies.remove('adminAccessToken');
    Cookies.remove('adminRefreshToken');
    Cookies.remove('adminUser');
    router.push('/auth/login');
  };

  // audit: HIGH-018 / LOW-082 — bloquer le rendu des enfants tant que l'auth n'est pas confirmee :
  // un loader neutre est affiche, aucune page enfant ne se monte ni ne declenche d'appel /admin/*.
  if (authState !== 'authorized') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--rp-bg-page)' }}>
        <p style={{ color: 'var(--rp-text-muted)' }}>Chargement...</p>
      </div>
    );
  }

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
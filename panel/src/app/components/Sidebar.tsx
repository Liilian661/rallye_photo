'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { IconHome, IconCalendar, IconStar, IconSettings, IconMenu, IconX, IconMoon, IconSun, IconLogout, IconUsers } from '@/lib/icons';

const navItems = [
  { href: '/dashboard',             label: 'Dashboard',    icon: IconHome },
  { href: '/dashboard/events',      label: 'Evenements',   icon: IconCalendar },
  { href: '/dashboard/pricing',     label: 'Tarification', icon: IconStar },
  { href: '/dashboard/affiliates',  label: 'Affiliation',  icon: IconUsers },
  { href: '/dashboard/settings',    label: 'Mon compte',   icon: IconSettings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <>
      {/* Hamburger - mobile only */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Menu"
        style={{
          position: 'fixed',
          top: 12, left: 12, zIndex: 200,
          width: 40, height: 40,
          borderRadius: 10,
          border: '0.5px solid var(--rp-border)',
          background: 'var(--rp-bg-sidebar)',
          display: 'none',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: 'var(--rp-text-primary)',
        }}
        className="sidebar-hamburger"
      >
        <IconMenu size={20} />
      </button>

      {/* Overlay */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 299,
          }}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`sidebar ${open ? 'sidebar-open' : ''}`}
        style={{
          width: 260,
          position: 'fixed',
          top: 0, left: 0, bottom: 0,
          background: 'var(--rp-bg-sidebar)',
          borderRight: '0.5px solid var(--rp-border)',
          display: 'flex',
          flexDirection: 'column',
          padding: '1.5rem 1rem',
          transition: 'transform 0.3s ease, background 0.3s ease',
          zIndex: 300,
        }}
      >
        {/* Close - mobile only */}
        <button
          onClick={() => setOpen(false)}
          aria-label="Fermer"
          style={{
            position: 'absolute',
            top: 12, right: 12,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--rp-text-muted)',
            display: 'none',
          }}
          className="sidebar-close"
        >
          <IconX size={22} />
        </button>

        {/* Logo */}
        <div style={{ paddingLeft: 12, flexShrink: 0, marginBottom: '1.5rem' }}>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: 'var(--rp-logo-text)',
          }}>
            rallye<span style={{ color: 'var(--rp-logo-dot)' }}>.</span>photo
          </h1>
          <p style={{ fontSize: 11, color: 'var(--rp-text-muted)', marginTop: 2 }}>
            Panel organisateur
          </p>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {navItems.map((item) => {
            const isActive = pathname === item.href ||
              (item.href !== '/dashboard' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 12px',
                  borderRadius: 10,
                  marginBottom: 3,
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? 'var(--rp-accent)' : 'var(--rp-text-muted)',
                  background: isActive ? 'var(--rp-accent-light)' : 'transparent',
                  transition: 'all 0.15s',
                }}
              >
                <item.icon size={16} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Bottom */}
        <div style={{ flexShrink: 0 }}>
          {/* Theme toggle */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 12px',
            marginBottom: 8,
          }}>
            <span style={{ fontSize: 11, color: 'var(--rp-text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              {theme === 'dark' ? <IconMoon size={14} /> : <IconSun size={14} />}
              {theme === 'dark' ? 'Dark' : 'Light'}
            </span>
            <button
              onClick={toggleTheme}
              aria-label="Toggle theme"
              style={{
                width: 40,
                height: 22,
                borderRadius: 11,
                border: 'none',
                cursor: 'pointer',
                position: 'relative',
                background: theme === 'dark' ? 'var(--rp-secondary)' : 'var(--rp-accent)',
                transition: 'background 0.3s ease',
              }}
            >
              <span style={{
                position: 'absolute',
                width: 16,
                height: 16,
                borderRadius: '50%',
                top: 3,
                left: theme === 'dark' ? 3 : 21,
                background: '#fff',
                transition: 'left 0.3s ease',
              }} />
            </button>
          </div>

          {/* User */}
          <div style={{
            borderTop: '0.5px solid var(--rp-border)',
            paddingTop: '0.5rem',
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 6,
              paddingLeft: 12,
            }}>
              <div style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: theme === 'dark' ? 'var(--rp-secondary)' : 'var(--rp-accent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: 10,
                color: '#fff',
                flexShrink: 0,
              }}>
                {user?.firstName?.[0]}{user?.lastName?.[0]}
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--rp-text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {user?.firstName} {user?.lastName}
                </p>
                <p style={{ fontSize: 9, color: 'var(--rp-text-muted)' }}>
                  Plan {user?.plan}
                  {(user?.eventCredits ?? 0) > 0 && (
                    <span style={{ marginLeft: 6, color: 'var(--rp-accent)', fontWeight: 700 }}>
                      · {user?.eventCredits} crédit{(user?.eventCredits ?? 0) > 1 ? 's' : ''}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <button
              onClick={logout}
              style={{
                width: '100%',
                padding: '6px 12px',
                borderRadius: 8,
                border: 'none',
                background: 'transparent',
                fontSize: 11,
                color: 'var(--rp-text-muted)',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'color 0.15s',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--rp-danger-text)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--rp-text-muted)')}
            >
              <IconLogout size={14} />
              Se deconnecter
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import api from '@/lib/api';

// audit: INFO-034 — typer recentUsers/recentEvents au lieu de `any[]`.
interface RecentUser {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  plan: string;
}

interface RecentEvent {
  id: string;
  name: string;
  status: string;
  first_name: string;
  last_name: string;
}

interface Stats {
  totals: {
    users: number;
    events: number;
    participants: number;
    submissions: number;
    challenges: number;
    activeEvents: number;
    endedEvents: number;
  };
  planCounts: { plan: string; count: number }[];
  recentUsers: RecentUser[];
  recentEvents: RecentEvent[];
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/admin/stats')
      .then(({ data }) => setStats(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p style={{ color: 'var(--rp-text-muted)' }}>Chargement...</p>;
  if (!stats) return <p style={{ color: 'var(--rp-danger-text)' }}>Erreur de chargement</p>;

  const statCards = [
    { label: 'Utilisateurs', value: stats.totals.users, color: 'var(--rp-accent)' },
    { label: 'Evenements', value: stats.totals.events, color: 'var(--rp-secondary-text)' },
    { label: 'Events actifs', value: stats.totals.activeEvents, color: 'var(--rp-success-text)' },
    { label: 'Participants', value: stats.totals.participants, color: 'var(--rp-warning-text)' },
    { label: 'Photos', value: stats.totals.submissions, color: '#FF6B9D' },
    { label: 'Defis', value: stats.totals.challenges, color: 'var(--rp-secondary-text)' },
  ];

  return (
    <div className="fade-in">
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, marginBottom: 20 }}>
        Dashboard Admin
      </h2>

      {/* Stats grid */}
      <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        {/* audit: LOW-068 — cle React stable (label) plutot que l'index, pour une reconciliation correcte. */}
        {statCards.map((s) => (
          <div key={s.label} className="card" style={{ padding: '1rem' }}>
            <p style={{ fontSize: 12, color: 'var(--rp-text-muted)', marginBottom: 4 }}>{s.label}</p>
            <p style={{ fontSize: 26, fontWeight: 700, fontFamily: 'var(--font-display)', color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Plan distribution */}
      <div className="card" style={{ padding: '1.25rem', marginBottom: 24 }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
          Repartition par plan
        </h3>
        <div style={{ display: 'flex', gap: 16 }}>
          {stats.planCounts.map((p) => (
            <div key={p.plan} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className={`badge ${p.plan === 'pro' ? 'badge-accent' : p.plan === 'starter' ? 'badge-secondary' : 'badge-muted'}`}>
                {p.plan}
              </span>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--rp-text-primary)' }}>{p.count}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Recent users */}
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600 }}>
              Derniers inscrits
            </h3>
            <Link href="/dashboard/users"><button className="btn-ghost">Voir tout</button></Link>
          </div>
          {stats.recentUsers.map((u) => (
            <div key={u.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 0', borderBottom: '0.5px solid var(--rp-border-light)',
            }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 500 }}>{u.first_name} {u.last_name}</p>
                <p style={{ fontSize: 11, color: 'var(--rp-text-muted)' }}>{u.email}</p>
              </div>
              <span className={`badge ${u.plan === 'pro' ? 'badge-accent' : u.plan === 'starter' ? 'badge-secondary' : 'badge-muted'}`}>
                {u.plan}
              </span>
            </div>
          ))}
        </div>

        {/* Recent events */}
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600 }}>
              Derniers evenements
            </h3>
            <Link href="/dashboard/events"><button className="btn-ghost">Voir tout</button></Link>
          </div>
          {stats.recentEvents.map((e) => (
            <div key={e.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 0', borderBottom: '0.5px solid var(--rp-border-light)',
            }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 500 }}>{e.name}</p>
                <p style={{ fontSize: 11, color: 'var(--rp-text-muted)' }}>
                  par {e.first_name} {e.last_name}
                </p>
              </div>
              <span className={`badge ${e.status === 'active' ? 'badge-success' : 'badge-muted'}`}>
                {e.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

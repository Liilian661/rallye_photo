'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import api from '@/lib/api';

interface Event {
  id: string;
  name: string;
  code: string;
  status: string;
  deadline: string;
  created_at: string;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/events')
      .then(({ data }) => setEvents(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const activeEvents = events.filter(e => e.status === 'active').length;
  const endedEvents = events.filter(e => e.status === 'ended').length;

  return (
    <div className="fade-in">
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          marginBottom: 4,
          color: 'var(--rp-text-primary)',
        }}>
          Bonjour {user?.firstName}
        </h2>
        <p style={{ color: 'var(--rp-text-muted)', fontSize: 15 }}>
          Bienvenue sur votre espace organisateur
        </p>
      </div>

      <div className="stats-grid" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 12,
        marginBottom: '1.5rem',
      }}>
        <div className="card">
          <p style={{ fontSize: 13, color: 'var(--rp-text-muted)', marginBottom: 4 }}>
            Total événements
          </p>
          <p style={{
            fontSize: 28,
            fontWeight: 700,
            fontFamily: 'var(--font-display)',
            color: 'var(--rp-text-primary)',
          }}>
            {events.length}
          </p>
        </div>
        <div className="card">
          <p style={{ fontSize: 13, color: 'var(--rp-text-muted)', marginBottom: 4 }}>Actifs</p>
          <p style={{
            fontSize: 28,
            fontWeight: 700,
            fontFamily: 'var(--font-display)',
            color: 'var(--rp-accent)',
          }}>
            {activeEvents}
          </p>
        </div>
        <div className="card">
          <p style={{ fontSize: 13, color: 'var(--rp-text-muted)', marginBottom: 4 }}>Terminés</p>
          <p style={{
            fontSize: 28,
            fontWeight: 700,
            fontFamily: 'var(--font-display)',
            color: 'var(--rp-secondary-text)',
          }}>
            {endedEvents}
          </p>
        </div>
      </div>

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '1rem',
      }}>
        <h3 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 20,
          fontWeight: 600,
          color: 'var(--rp-text-primary)',
        }}>
          Vos événements
        </h3>
        <Link href="/dashboard/events/new">
          <button className="btn-gradient">+ Créer</button>
        </Link>
      </div>

      {loading ? (
        <p style={{ color: 'var(--rp-text-muted)', fontSize: 14, padding: '2rem 0' }}>
          Chargement...
        </p>
      ) : events.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '2.5rem 1.5rem' }}>
          <p style={{
            fontSize: 18,
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            marginBottom: 8,
            color: 'var(--rp-text-primary)',
          }}>
            Aucun événement
          </p>
          <p style={{ color: 'var(--rp-text-muted)', fontSize: 14, marginBottom: '1.5rem' }}>
            Créez votre premier rallye photo !
          </p>
          <Link href="/dashboard/events/new">
            <button className="btn-gradient">Créer mon premier événement</button>
          </Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {events.map((event) => (
            <Link key={event.id} href={`/dashboard/events/${event.id}`}>
              <div className="card-interactive" style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <h4 style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 16,
                    fontWeight: 600,
                    marginBottom: 4,
                    color: 'var(--rp-text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {event.name}
                  </h4>
                  <p style={{ fontSize: 12, color: 'var(--rp-text-muted)' }}>
                    <span style={{ fontWeight: 600, color: 'var(--rp-accent)' }}>{event.code}</span>
                    {' · '}
                    {new Date(event.deadline).toLocaleDateString('fr-FR')}
                  </p>
                </div>
                <span className={`badge ${event.status === 'active' && new Date(event.deadline).getTime() > Date.now() ? 'badge-success' : 'badge-muted'}`}
                  style={{ flexShrink: 0, marginLeft: 8 }}>
                  {event.status === 'active' && new Date(event.deadline).getTime() > Date.now() ? 'Actif' : new Date(event.deadline).getTime() <= Date.now() ? 'Expire' : event.status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
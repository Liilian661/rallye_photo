'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import api from '@/lib/api';

interface Event {
  id: string;
  name: string;
  code: string;
  status: string;
  tier: string;
  deadline: string;
  created_at: string;
}

function TierBadge({ tier }: { tier: string }) {
  const map: Record<string, { label: string; color: string }> = {
    free:    { label: 'Gratuit',    color: 'var(--rp-text-muted)' },
    premium: { label: 'Événement',  color: '#f59e0b' },
    pro:     { label: 'Pro',        color: 'var(--rp-accent)' },
  };
  const t = map[tier] ?? map.free;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '2px 8px',
      borderRadius: 50, border: `1px solid ${t.color}`,
      color: t.color, letterSpacing: '0.02em',
    }}>
      {t.label}
    </span>
  );
}

export default function EventsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  // audit: INFO-031 — distinguer l'echec reseau de l'etat vide legitime (sinon "Aucun evenement"
  // s'affiche meme quand l'API a echoue).
  const [loadError, setLoadError] = useState(false);

  const loadEvents = () => {
    setLoading(true);
    setLoadError(false);
    api.get('/events')
      .then(({ data }) => setEvents(data))
      .catch((err) => { console.error(err); setLoadError(true); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadEvents();
  }, []);

  return (
    <div className="fade-in">
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '2rem',
      }}>
        <h2 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          color: 'var(--rp-text-primary)',
        }}>
          Événements
        </h2>
        <Link href="/dashboard/events/new">
          <button className="btn-gradient">+ Créer un événement</button>
        </Link>
      </div>

      {loading ? (
        <p style={{ color: 'var(--rp-text-muted)' }}>Chargement...</p>
      ) : loadError ? (
        /* audit: INFO-031 — etat d'erreur distinct avec bouton Reessayer */
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <p style={{ fontSize: 15, color: 'var(--rp-danger-text)', marginBottom: '1rem' }}>
            Erreur de chargement des événements.
          </p>
          <button className="btn-secondary" onClick={loadEvents}>Réessayer</button>
        </div>
      ) : events.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
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
            Commencez par créer votre premier rallye photo
          </p>
          <Link href="/dashboard/events/new">
            <button className="btn-gradient">Créer mon premier événement</button>
          </Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {events.map((event) => (
            <Link key={event.id} href={`/dashboard/events/${event.id}`}>
              <div className="card-interactive" style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <div>
                  <h4 style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 17,
                    fontWeight: 600,
                    marginBottom: 4,
                    color: 'var(--rp-text-primary)',
                  }}>
                    {event.name}
                  </h4>
                  <p style={{ fontSize: 13, color: 'var(--rp-text-muted)' }}>
                    Code : <span style={{ fontWeight: 600, color: 'var(--rp-accent)' }}>{event.code}</span>
                    {' · '}
                    Deadline : {event.deadline ? new Date(event.deadline).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'Aucune'}
                  </p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                  <span className={`badge ${event.status === 'active' && event.deadline && new Date(event.deadline).getTime() > Date.now() ? 'badge-success' : 'badge-muted'}`}>
                    {event.status === 'active' && event.deadline && new Date(event.deadline).getTime() > Date.now() ? 'Actif' : event.deadline && new Date(event.deadline).getTime() <= Date.now() ? 'Expire' : event.status}
                  </span>
                  <TierBadge tier={event.tier || 'free'} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
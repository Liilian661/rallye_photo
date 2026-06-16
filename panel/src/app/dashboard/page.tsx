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

// audit: LOW-078 — derive actif/termine d'une fonction unique (status ET deadline) reutilisee
// pour les stats ET les badges, afin que les chiffres du tableau de bord soient coherents avec
// l'affichage (un event 'active' a deadline depassee est 'Expire', pas 'Actif').
function isEventActive(e: Event): boolean {
  return e.status === 'active' && new Date(e.deadline).getTime() > Date.now();
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  // audit: INFO-031 — distinguer l'echec reseau de l'etat vide legitime.
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

  // audit: LOW-078 — stats coherentes avec les badges (status + deadline)
  const activeEvents = events.filter(isEventActive).length;
  const endedEvents = events.filter(e => !isEventActive(e)).length;

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
        gridTemplateColumns: 'repeat(4, 1fr)',
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
        {/* audit: INFO-022 — navigation SPA via <Link> (au lieu de window.location.href) + focusable clavier */}
        <Link href="/dashboard/pricing" className="card" style={{ cursor: 'pointer', display: 'block' }}>
          <p style={{ fontSize: 13, color: 'var(--rp-text-muted)', marginBottom: 4 }}>
            {user?.plan === 'pro' ? 'Plan' : 'Crédits'}
          </p>
          {user?.plan === 'pro' ? (
            <p style={{
              fontSize: 18,
              fontWeight: 700,
              fontFamily: 'var(--font-display)',
              color: 'var(--rp-accent)',
            }}>
              Pro ✓
            </p>
          ) : (
            <>
              <p style={{
                fontSize: 28,
                fontWeight: 700,
                fontFamily: 'var(--font-display)',
                color: (user?.eventCredits ?? 0) > 0 ? '#f59e0b' : 'var(--rp-text-muted)',
              }}>
                {user?.eventCredits ?? 0}
              </p>
              <p style={{ fontSize: 11, color: 'var(--rp-text-muted)', marginTop: 2 }}>
                {(user?.eventCredits ?? 0) === 0 ? 'Acheter →' : 'crédit(s) event'}
              </p>
            </>
          )}
        </Link>
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
      ) : loadError ? (
        /* audit: INFO-031 — etat d'erreur distinct avec bouton Reessayer */
        <div className="card" style={{ textAlign: 'center', padding: '2.5rem 1.5rem' }}>
          <p style={{ fontSize: 15, color: 'var(--rp-danger-text)', marginBottom: '1rem' }}>
            Erreur de chargement des événements.
          </p>
          <button className="btn-secondary" onClick={loadEvents}>Réessayer</button>
        </div>
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
                <span className={`badge ${isEventActive(event) ? 'badge-success' : 'badge-muted'}`}
                  style={{ flexShrink: 0, marginLeft: 8 }}>
                  {isEventActive(event) ? 'Actif' : new Date(event.deadline).getTime() <= Date.now() ? 'Expire' : event.status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
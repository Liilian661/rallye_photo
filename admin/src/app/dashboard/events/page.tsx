'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import api from '@/lib/api';

interface Event {
  id: string;
  name: string;
  code: string;
  status: string;
  deadline: string;
  event_date: string;
  created_at: string;
  first_name: string;
  last_name: string;
  organizer_email: string;
  organizer_plan: string;
  challenge_count: number;
  participant_count: number;
  submission_count: number;
}

export default function AdminEventsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  // audit: INFO-031 — distinguer l'etat 'erreur reseau' de l'etat 'liste vide' (ne plus afficher
  // 'Aucun evenement' quand l'API a en realite echoue).
  const [loadError, setLoadError] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');

  const loadEvents = useCallback(async () => {
    setLoadError(false);
    try {
      // audit: INFO-034 — params type au lieu de `any`.
      const params: Record<string, string> = {};
      if (filterStatus) params.status = filterStatus;
      const { data } = await api.get('/admin/events', { params });
      setEvents(data);
    } catch (err) {
      console.error(err);
      setLoadError(true); // audit: INFO-031
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const deleteEvent = async (eventId: string, name: string) => {
    if (!confirm('Supprimer "' + name + '" et toutes ses donnees ?')) return;
    try {
      await api.delete('/admin/events/' + eventId);
      loadEvents();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Erreur');
    }
  };

  return (
    <div className="fade-in">
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, marginBottom: 20 }}>
        Evenements ({events.length})
      </h2>

      {/* Filter */}
      <div style={{ marginBottom: 16 }}>
        <select
          className="input-field"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          style={{ maxWidth: 180 }}
        >
          <option value="">Tous les statuts</option>
          <option value="active">Actif</option>
          <option value="ended">Termine</option>
          <option value="draft">Brouillon</option>
          <option value="archived">Archive</option>
        </select>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        {loading ? (
          <p style={{ padding: '2rem', color: 'var(--rp-text-muted)', textAlign: 'center' }}>Chargement...</p>
        ) : loadError ? (
          // audit: INFO-031 — etat d'erreur explicite avec bouton Reessayer (distinct de la liste vide).
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <p style={{ color: 'var(--rp-danger-text)', marginBottom: 12 }}>Erreur de chargement des evenements</p>
            <button className="btn-ghost" onClick={() => { setLoading(true); loadEvents(); }}>Reessayer</button>
          </div>
        ) : events.length === 0 ? (
          <p style={{ padding: '2rem', color: 'var(--rp-text-muted)', textAlign: 'center' }}>Aucun evenement</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Evenement</th>
                <th>Code</th>
                <th>Organisateur</th>
                <th>Statut</th>
                <th>Defis</th>
                <th>Participants</th>
                <th>Photos</th>
                <th>Deadline</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Link href={`/dashboard/events/${e.id}`} style={{ fontWeight: 500, fontSize: 13, color: 'var(--rp-text-primary)', textDecoration: 'none' }}>
                      {e.name}
                    </Link>
                  </td>
                  <td>
                    <span style={{ color: 'var(--rp-accent)', fontWeight: 600, fontSize: 13, letterSpacing: '0.05em' }}>
                      {e.code}
                    </span>
                  </td>
                  <td>
                    <div>
                      <p style={{ fontSize: 12, fontWeight: 500 }}>{e.first_name} {e.last_name}</p>
                      <p style={{ fontSize: 10, color: 'var(--rp-text-muted)' }}>{e.organizer_email}</p>
                    </div>
                  </td>
                  <td>
                    {/* audit: INFO-030 — cas explicite pour 'archived' (libelle distinct de 'ended'). */}
                    <span className={`badge ${
                      e.status === 'active' ? 'badge-success' :
                      e.status === 'ended' ? 'badge-muted' :
                      e.status === 'draft' ? 'badge-warning' :
                      e.status === 'archived' ? 'badge-secondary' : 'badge-muted'
                    }`}>
                      {e.status === 'archived' ? 'Archive' : e.status}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center' }}>{e.challenge_count}</td>
                  <td style={{ textAlign: 'center' }}>{e.participant_count}</td>
                  <td style={{ textAlign: 'center' }}>{e.submission_count}</td>
                  <td style={{ fontSize: 12, color: 'var(--rp-text-muted)' }}>
                    {e.deadline ? new Date(e.deadline).toLocaleDateString('fr-FR') : '-'}
                  </td>
                  <td>
                    <button
                      className="btn-danger"
                      onClick={() => deleteEvent(e.id, e.name)}
                      style={{ fontSize: 11, padding: '3px 10px' }}
                    >
                      Suppr
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
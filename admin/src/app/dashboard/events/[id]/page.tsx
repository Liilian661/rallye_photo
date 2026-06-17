'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import api from '@/lib/api';
import { IconArrowLeft, IconX, IconDownload } from '@/lib/icons';

interface EventDetail {
  id: string;
  name: string;
  code: string;
  status: string;
  deadline: string;
  event_date: string;
  first_name: string;
  last_name: string;
  organizer_email: string;
}

interface Challenge {
  id: string;
  title: string;
  description: string;
  points: number;
  status: string;
}

interface Participant {
  id: string;
  name: string;
  joined_at: string;
}

interface Submission {
  id: string;
  challenge_id: string;
  participant_id: string;
  participant_name: string;
  challenge_title: string;
  photo_url: string;
  photo_key: string;
  is_winner: boolean;
  submitted_at: string;
}

export default function AdminEventDetailPage() {
  const params = useParams();
  const router = useRouter();
  const eventId = params.id as string;

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'photos' | 'participants'>('photos');

  // audit: INFO-026 — loadData memoise via useCallback([eventId]) et inclus dans les deps du
  // useEffect (coherent avec events/page.tsx et users/page.tsx ; respecte exhaustive-deps).
  const loadData = useCallback(async () => {
    try {
      const { data } = await api.get(`/admin/events/${eventId}`);
      setEvent(data.event);
      setChallenges(data.challenges);
      setParticipants(data.participants);
      setSubmissions(data.submissions);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // audit: INFO-027 — pre-calculer un index Map<participant_id, {count, wins}> via useMemo
  // plutot que de refaire submissions.filter(...) pour chaque participant a chaque render
  // (complexite O(participants*submissions) recalculee inutilement).
  const participantStats = useMemo(() => {
    const stats = new Map<string, { count: number; wins: number }>();
    for (const s of submissions) {
      const entry = stats.get(s.participant_id) || { count: 0, wins: 0 };
      entry.count += 1;
      if (s.is_winner) entry.wins += 1;
      stats.set(s.participant_id, entry);
    }
    return stats;
  }, [submissions]);

  const downloadZip = async () => {
    setDownloading(true);
    try {
      const response = await api.get(`/admin/events/${eventId}/download-zip`, {
        responseType: 'blob',
        timeout: 120000, // 2min for large galleries
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = (event?.code || 'event') + '_photos.zip';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        // audit: INFO-028 / LOW-077 — revoquer l'objectURL dans un finally (jamais fuite, meme si
        // a.click() leve) et de facon differee : revoquer juste apres click() peut faire echouer
        // le telechargement sur certains navigateurs.
        setTimeout(() => window.URL.revokeObjectURL(url), 1000);
      }
    } catch (err: any) {
      alert(err.response?.data?.error || 'Erreur lors du telechargement');
    } finally {
      setDownloading(false);
    }
  };

  const deleteEvent = async () => {
    if (!confirm('Supprimer cet evenement et toutes ses donnees ?')) return;
    try {
      await api.delete(`/admin/events/${eventId}`);
      router.push('/dashboard/events');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Erreur');
    }
  };

  if (loading) return <p style={{ color: 'var(--rp-text-muted)' }}>Chargement...</p>;
  if (!event) return <p style={{ color: 'var(--rp-text-muted)' }}>Evenement non trouve</p>;

  // Group submissions by challenge
  const submissionsByChallenge: Record<string, Submission[]> = {};
  for (const sub of submissions) {
    if (!submissionsByChallenge[sub.challenge_id]) {
      submissionsByChallenge[sub.challenge_id] = [];
    }
    submissionsByChallenge[sub.challenge_id].push(sub);
  }

  const lightbox = previewUrl ? (
    <div
      onClick={() => setPreviewUrl(null)}
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.9)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        cursor: 'pointer',
        padding: '2rem',
      }}
    >
      <img
        src={previewUrl}
        alt="Preview"
        referrerPolicy="no-referrer" /* audit: LOW-085 — ne pas fuiter le Referer vers S3 */
        style={{
          maxWidth: '90%',
          maxHeight: '90vh',
          borderRadius: 12,
          objectFit: 'contain',
        }}
        onClick={(e) => e.stopPropagation()}
      />
      <button
        onClick={() => setPreviewUrl(null)}
        style={{
          position: 'absolute',
          top: 20, right: 20,
          background: 'rgba(255,255,255,0.15)',
          border: 'none',
          color: '#fff',
          fontSize: 24,
          width: 40, height: 40,
          borderRadius: '50%',
          cursor: 'pointer',
        }}
      >
        <IconX size={24} />
      </button>
    </div>
  ) : null;

  return (
    <div className="fade-in">
      {lightbox}

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <button onClick={() => router.back()} className="btn-ghost" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
          <IconArrowLeft size={14} /> Retour
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{
              fontFamily: 'var(--font-display)',
              fontSize: 24, fontWeight: 700, marginBottom: 4,
            }}>
              {event.name}
            </h2>
            <p style={{ fontSize: 13, color: 'var(--rp-text-muted)' }}>
              Code : <span style={{ color: 'var(--rp-accent)', fontWeight: 700, fontSize: 15 }}>{event.code}</span>
              {' \u00B7 '}
              Organisateur : {event.first_name} {event.last_name} ({event.organizer_email})
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span className={`badge ${event.status === 'active' ? 'badge-success' : 'badge-muted'}`}>
              {event.status}
            </span>
            <button onClick={deleteEvent} className="btn-danger">Supprimer</button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 24 }}>
        <div className="card" style={{ padding: '0.75rem', textAlign: 'center' }}>
          <p style={{ fontSize: 11, color: 'var(--rp-text-muted)', marginBottom: 2 }}>Defis</p>
          <p style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--rp-secondary-text)' }}>
            {challenges.length}
          </p>
        </div>
        <div className="card" style={{ padding: '0.75rem', textAlign: 'center' }}>
          <p style={{ fontSize: 11, color: 'var(--rp-text-muted)', marginBottom: 2 }}>Participants</p>
          <p style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--rp-accent)' }}>
            {participants.length}
          </p>
        </div>
        <div className="card" style={{ padding: '0.75rem', textAlign: 'center' }}>
          <p style={{ fontSize: 11, color: 'var(--rp-text-muted)', marginBottom: 2 }}>Photos</p>
          <p style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--rp-warning-text)' }}>
            {submissions.length}
          </p>
        </div>
        <div className="card" style={{ padding: '0.75rem', textAlign: 'center' }}>
          <p style={{ fontSize: 11, color: 'var(--rp-text-muted)', marginBottom: 2 }}>Deadline</p>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--rp-text-primary)', marginTop: 4 }}>
            {event.deadline ? new Date(event.deadline).toLocaleDateString('fr-FR') : '-'}
          </p>
        </div>
      </div>

      {/* Download ZIP button */}
      {submissions.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <button
            className="btn-gradient"
            onClick={downloadZip}
            disabled={downloading}
            style={{ fontSize: 14, padding: '10px 24px' }}
          >
            {downloading ? 'Telechargement en cours...' : <><IconDownload size={16} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} /> Telecharger toutes les photos (.zip)</>}
          </button>
          <span style={{ fontSize: 12, color: 'var(--rp-text-muted)', marginLeft: 12 }}>
            {submissions.length} photo(s)
          </span>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        <button
          onClick={() => setActiveTab('photos')}
          style={{
            padding: '8px 20px',
            borderRadius: 50,
            border: 'none',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            background: activeTab === 'photos' ? 'var(--rp-accent)' : 'var(--rp-bg-card)',
            color: activeTab === 'photos' ? 'var(--rp-accent-text)' : 'var(--rp-text-muted)',
          }}
        >
          Photos
        </button>
        <button
          onClick={() => setActiveTab('participants')}
          style={{
            padding: '8px 20px',
            borderRadius: 50,
            border: 'none',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            background: activeTab === 'participants' ? 'var(--rp-accent)' : 'var(--rp-bg-card)',
            color: activeTab === 'participants' ? 'var(--rp-accent-text)' : 'var(--rp-text-muted)',
          }}
        >
          Participants ({participants.length})
        </button>
      </div>

      {/* Photos tab */}
      {activeTab === 'photos' && (
        <div>
          {challenges.length === 0 ? (
            <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
              <p style={{ color: 'var(--rp-text-muted)' }}>Aucun defi</p>
            </div>
          ) : (
            challenges.map((challenge) => {
              const subs = submissionsByChallenge[challenge.id] || [];
              return (
                <div key={challenge.id} style={{ marginBottom: 24 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <h3 style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 16, fontWeight: 600,
                    }}>
                      {challenge.title}
                    </h3>
                    <span className="badge badge-accent">{challenge.points} pts</span>
                    <span style={{ fontSize: 12, color: 'var(--rp-text-muted)' }}>
                      {subs.length} photo(s)
                    </span>
                  </div>

                  {subs.length === 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--rp-text-muted)', paddingLeft: 4 }}>
                      Aucune soumission
                    </p>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
                      {subs.map((sub) => (
                        <div
                          key={sub.id}
                          style={{
                            borderRadius: 10,
                            border: sub.is_winner ? '2px solid var(--rp-accent)' : '1px solid var(--rp-border)',
                            overflow: 'hidden',
                            background: 'var(--rp-bg-card)',
                            position: 'relative',
                          }}
                        >
                          <img
                            src={sub.photo_url}
                            alt={sub.participant_name}
                            loading="lazy"
                            referrerPolicy="no-referrer" /* audit: LOW-085 — pas de fuite Referer vers S3 */
                            onClick={() => setPreviewUrl(sub.photo_url)}
                            style={{
                              width: '100%',
                              height: 160,
                              objectFit: 'cover',
                              cursor: 'pointer',
                              display: 'block',
                            }}
                          />
                          {sub.is_winner && (
                            <div style={{
                              position: 'absolute',
                              top: 6, right: 6,
                              background: 'var(--rp-accent)',
                              color: 'var(--rp-accent-text)',
                              fontSize: 9, fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: 50,
                            }}>
                              GAGNANT
                            </div>
                          )}
                          <div style={{ padding: '6px 10px' }}>
                            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--rp-text-primary)' }}>
                              {sub.participant_name}
                            </p>
                            <p style={{ fontSize: 10, color: 'var(--rp-text-muted)' }}>
                              {new Date(sub.submitted_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Participants tab */}
      {activeTab === 'participants' && (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          {participants.length === 0 ? (
            <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--rp-text-muted)' }}>
              Aucun participant
            </p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Photos soumises</th>
                  <th>Victoires</th>
                  <th>Rejoint le</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {participants.map((p) => {
                  // audit: INFO-027 — lecture O(1) depuis l'index memoise au lieu d'un filter par ligne.
                  const pStat = participantStats.get(p.id) || { count: 0, wins: 0 };
                  const pWins = pStat.wins;
                  return (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 500 }}>{p.name}</td>
                      <td style={{ textAlign: 'center' }}>{pStat.count}</td>
                      <td style={{ textAlign: 'center' }}>
                        {pWins > 0 ? (
                          <span style={{ color: 'var(--rp-accent)', fontWeight: 700 }}>{pWins}</span>
                        ) : (
                          <span style={{ color: 'var(--rp-text-muted)' }}>0</span>
                        )}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--rp-text-muted)' }}>
                        {new Date(p.joined_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td>
                        <button
                          className="btn-danger"
                          onClick={async () => {
                            if (!confirm('Supprimer ' + p.name + ' et toutes ses photos ?')) return;
                            try {
                              await api.delete('/admin/participants/' + p.id);
                              loadData();
                            } catch (err: any) {
                              alert(err.response?.data?.error || 'Erreur');
                            }
                          }}
                          style={{ fontSize: 11, padding: '3px 10px' }}
                        >
                          Suppr
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
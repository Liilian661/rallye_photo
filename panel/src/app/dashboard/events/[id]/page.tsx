'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import api from '@/lib/api';
import { IconCamera, IconArrowLeft, IconX, IconChevronLeft, IconChevronRight } from '@/lib/icons';
import { io, Socket } from 'socket.io-client';

interface Event {
  id: string;
  name: string;
  description: string;
  event_date: string;
  deadline: string;
  code: string;
  qr_code_url: string;
  status: string;
  tier: string;
  scoring_mode: string;
  team_mode: number;
  theme_color: string;
  logo_key: string | null;
  banner_key: string | null;
  logo_url: string | null;
  banner_url: string | null;
}

interface Challenge {
  id: string;
  title: string;
  description: string;
  points: number;
  status: string;
  is_surprise: boolean;
  notified: number;
}

interface Submission {
  id: string;
  challenge_id: string;
  participant_id: string;
  participant_name: string;
  challenge_title: string;
  photo_url: string;
  media_type?: string;
  is_winner: boolean;
  submitted_at: string;
}

interface Team {
  id: string;
  name: string;
  color: string;
  member_count: number;
  score: number;
}

// audit: MED-025 — validation cote client de la taille/type des images (logo/banniere) AVANT upload.
// L'attribut `accept` est un simple filtre UI contournable ; on verifie ici file.type et file.size.
// La verite reste le serveur (taille/type/magic-bytes) — TODO: confirmer la validation backend.
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

function validateImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return 'Format invalide. Formats acceptes : JPEG, PNG, WebP.';
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return 'Fichier trop volumineux (max 5 MB).';
  }
  return null;
}

// audit: LOW-077 — telechargement blob fiable : anchor insere au DOM, puis revocation differee
// dans un finally (l'objectURL n'est jamais fuite, meme en cas d'exception, et le download n'est
// pas annule par une revocation trop precoce sur certains navigateurs).
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}

export default function EventDetailPage() {
  const params = useParams();
  const router = useRouter();
  const eventId = params.id as string;
  const socketRef = useRef<Socket | null>(null);

  const [event, setEvent] = useState<Event | null>(null);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);

  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPoints, setNewPoints] = useState(10);
  const [showAddChallenge, setShowAddChallenge] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'defis' | 'galerie'>('defis');
  const [teams, setTeams] = useState<Team[]>([]);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamColor, setNewTeamColor] = useState('#e91e8c');
  const [showAddTeam, setShowAddTeam] = useState(false);

  // Edit event state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editHasDeadline, setEditHasDeadline] = useState(true);
  const [editDeadline, setEditDeadline] = useState('');
  const [editScoringMode, setEditScoringMode] = useState<'winner' | 'participation'>('winner');
  const [editTeamMode, setEditTeamMode] = useState(false);
  const [editThemeColor, setEditThemeColor] = useState('#e91e8c');
  const [editSaving, setEditSaving] = useState(false);
  const [notifyLoading, setNotifyLoading] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [eventRes, challengesRes, submissionsRes] = await Promise.all([
        api.get(`/events/${eventId}`),
        api.get(`/events/${eventId}/challenges`),
        api.get(`/events/${eventId}/submissions`),
      ]);
      setEvent(eventRes.data);
      setChallenges(challengesRes.data);
      setSubmissions(submissionsRes.data);

      // Load teams if team mode
      if (eventRes.data.team_mode) {
        try {
          const teamsRes = await api.get(`/events/${eventId}/teams`);
          setTeams(teamsRes.data);
        } catch { /* ignore */ }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // WebSocket - real-time updates
  useEffect(() => {
    if (!eventId) return;

    const socket = io(process.env.NEXT_PUBLIC_API_URL || 'https://api.rallye-photo.com', {
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      socket.emit('join-event', eventId);
    });

    // Listen to ALL events for real-time refresh
    socket.on('new-submission', () => loadData());
    socket.on('participant-joined', () => loadData());
    socket.on('challenge-started', () => loadData());
    socket.on('winner-selected', () => loadData());
    socket.on('winner-revealed', () => loadData());
    socket.on('leaderboard-updated', () => loadData());

    socketRef.current = socket;

    return () => {
      socket.emit('leave-event', eventId);
      socket.disconnect();
    };
  }, [eventId, loadData]);

  const addChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post(`/events/${eventId}/challenges`, {
        title: newTitle,
        description: newDesc || null,
        points: newPoints,
      });
      setNewTitle('');
      setNewDesc('');
      setNewPoints(10);
      setShowAddChallenge(false);
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Erreur');
    }
  };

  const selectWinner = async (challengeId: string, submissionId: string) => {
    try {
      await api.post(`/challenges/${challengeId}/winner/${submissionId}`);
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Erreur');
    }
  };

  const revealWinner = async (challengeId: string) => {
    try {
      await api.post(`/challenges/${challengeId}/reveal`);
      alert('Gagnant revele en live !');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Erreur');
    }
  };

  const deleteChallenge = async (challengeId: string) => {
    if (!confirm('Supprimer ce defi ?')) return;
    try {
      await api.delete(`/challenges/${challengeId}`);
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Erreur');
    }
  };

  const deleteEvent = async () => {
    if (!confirm('Supprimer cet evenement et toutes ses donnees ?')) return;
    try {
      await api.delete(`/events/${eventId}`);
      router.push('/dashboard/events');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Erreur');
    }
  };

  const notifyChallenges = async () => {
    setNotifyLoading(true);
    try {
      const { data } = await api.post(`/events/${eventId}/notify-challenges`);
      alert(data.count + ' defi(s) notifie(s) aux participants !');
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Erreur');
    } finally {
      setNotifyLoading(false);
    }
  };

  // Convert UTC date string to local datetime-local value
  const utcToLocal = (utcStr: string) => {
    const d = new Date(utcStr);
    const offset = d.getTimezoneOffset();
    const local = new Date(d.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16);
  };

  // Convert local datetime-local value to UTC ISO string
  const localToUtc = (localStr: string) => {
    return new Date(localStr).toISOString();
  };

  const openEditModal = () => {
    if (!event) return;
    setEditName(event.name);
    setEditDesc(event.description || '');
    setEditDate(event.event_date ? utcToLocal(event.event_date) : '');
    setEditHasDeadline(!!event.deadline);
    setEditDeadline(event.deadline ? utcToLocal(event.deadline) : '');
    setEditScoringMode((event.scoring_mode as 'winner' | 'participation') || 'winner');
    setEditTeamMode(!!event.team_mode);
    setEditThemeColor(event.theme_color || '#e91e8c');
    setShowEditModal(true);
  };

  const saveEdit = async () => {
    setEditSaving(true);
    try {
      await api.patch(`/events/${eventId}`, {
        name: editName,
        description: editDesc,
        eventDate: editDate ? localToUtc(editDate) : null,
        deadline: editHasDeadline && editDeadline ? localToUtc(editDeadline) : null,
        scoringMode: editScoringMode,
        teamMode: editTeamMode,
        themeColor: editThemeColor,
      });
      setShowEditModal(false);
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Erreur lors de la modification');
    } finally {
      setEditSaving(false);
    }
  };

  const addTeam = async () => {
    if (!newTeamName.trim()) return;
    try {
      await api.post(`/events/${eventId}/teams`, { name: newTeamName.trim(), color: newTeamColor });
      setNewTeamName('');
      setShowAddTeam(false);
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Erreur');
    }
  };

  const deleteTeam = async (teamId: string) => {
    if (!confirm('Supprimer cette equipe ?')) return;
    try {
      await api.delete(`/teams/${teamId}`);
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Erreur');
    }
  };

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (previewIndex === null) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewIndex(null);
      if (e.key === 'ArrowRight' && previewIndex < submissions.length - 1) setPreviewIndex(previewIndex + 1);
      if (e.key === 'ArrowLeft' && previewIndex > 0) setPreviewIndex(previewIndex - 1);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [previewIndex, submissions.length]);

  if (loading) return <p style={{ color: 'var(--rp-text-muted)' }}>Chargement...</p>;
  if (!event) return <p style={{ color: 'var(--rp-text-primary)' }}>Evenement non trouve</p>;

  const isPastDeadline = event.deadline ? new Date(event.deadline).getTime() < Date.now() : false;

  // Lightbox with navigation
  // TODO(audit:INFO-023): completer l'accessibilite (piege/restauration de focus, aria-label sur les
  // boutons de navigation, vignettes <img>/<video> activables au clavier, role=dialog sur la modale
  // d'edition, posters au lieu d'autoPlay sur toutes les miniatures). Fait ici : role/aria-modal +
  // muted sur le lightbox. Le reste est un refactor UI plus large, hors perimetre de ce correctif.
  const lightbox = previewIndex !== null && submissions[previewIndex] ? (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Apercu de la photo"
      onClick={() => setPreviewIndex(null)}
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
      {previewIndex > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); setPreviewIndex(previewIndex - 1); }}
          style={{
            position: 'absolute',
            left: 16, top: '50%', transform: 'translateY(-50%)',
            background: 'rgba(255,255,255,0.15)',
            border: 'none', color: '#fff',
            fontSize: 28, width: 48, height: 48,
            borderRadius: '50%', cursor: 'pointer',
          }}
        >
          <IconChevronLeft size={28} />
        </button>
      )}

      <div onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center', maxWidth: '85%' }}>
        {submissions[previewIndex].media_type === 'video' ? (
          <video
            src={submissions[previewIndex].photo_url}
            // audit: INFO-023 — `muted` requis pour que l'autoplay ne soit pas bloque par le navigateur.
            playsInline autoPlay controls loop muted
            style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: 12, objectFit: 'contain' }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <img
            src={submissions[previewIndex].photo_url}
            alt={submissions[previewIndex].participant_name}
            style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: 12, objectFit: 'contain' }}
          />
        )}
        <div style={{ marginTop: 12, color: '#fff' }}>
          <p style={{ fontSize: 16, fontWeight: 600 }}>
            {submissions[previewIndex].participant_name}
            {submissions[previewIndex].is_winner && (
              <span style={{ color: 'var(--rp-accent)', marginLeft: 8 }}>GAGNANT</span>
            )}
          </p>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
            {submissions[previewIndex].challenge_title}
          </p>
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
            {previewIndex + 1} / {submissions.length}
          </p>
        </div>
      </div>

      {previewIndex < submissions.length - 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); setPreviewIndex(previewIndex + 1); }}
          style={{
            position: 'absolute',
            right: 16, top: '50%', transform: 'translateY(-50%)',
            background: 'rgba(255,255,255,0.15)',
            border: 'none', color: '#fff',
            fontSize: 28, width: 48, height: 48,
            borderRadius: '50%', cursor: 'pointer',
          }}
        >
          <IconChevronRight size={28} />
        </button>
      )}

      <button
        onClick={() => setPreviewIndex(null)}
        style={{
          position: 'absolute',
          top: 16, right: 16,
          background: 'rgba(255,255,255,0.15)',
          border: 'none', color: '#fff',
          fontSize: 24, width: 40, height: 40,
          borderRadius: '50%', cursor: 'pointer',
        }}
      >
        <IconX size={24} />
      </button>
    </div>
  ) : null;

  return (
    <div className="fade-in">
      {lightbox}

      {/* Edit modal */}
      {showEditModal && (
        <div
          onClick={() => setShowEditModal(false)}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', zIndex: 1000,
            padding: '1rem',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{ width: '100%', maxWidth: 480, padding: '1.5rem' }}
          >
            <h3 style={{
              fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700,
              color: 'var(--rp-text-primary)', marginBottom: 20,
            }}>
              Modifier l&apos;evenement
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--rp-text-secondary)', marginBottom: 4, display: 'block' }}>Nom</label>
                <input type="text" className="input-field" value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--rp-text-secondary)', marginBottom: 4, display: 'block' }}>Description</label>
                <input type="text" className="input-field" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--rp-text-secondary)', marginBottom: 4, display: 'block' }}>Date de l&apos;evenement</label>
                <input type="datetime-local" className="input-field" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--rp-text-secondary)', marginBottom: 4, display: 'block' }}>Deadline</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <input
                    type="checkbox"
                    id="editHasDeadline"
                    checked={editHasDeadline}
                    onChange={(e) => setEditHasDeadline(e.target.checked)}
                    style={{ width: 16, height: 16, cursor: 'pointer' }}
                  />
                  <label htmlFor="editHasDeadline" style={{ fontSize: 12, color: 'var(--rp-text-muted)', cursor: 'pointer' }}>
                    Definir une deadline
                  </label>
                </div>
                {editHasDeadline && (
                  <input type="datetime-local" className="input-field" value={editDeadline} onChange={(e) => setEditDeadline(e.target.value)} />
                )}
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--rp-text-secondary)', marginBottom: 8, display: 'block' }}>Mode de scoring</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{
                    display: 'flex', alignItems: 'flex-start', gap: 8,
                    padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                    border: editScoringMode === 'winner' ? '2px solid var(--rp-accent)' : '1.5px solid var(--rp-border)',
                    background: editScoringMode === 'winner' ? 'var(--rp-accent-light, rgba(99,102,241,0.08))' : 'transparent',
                  }}>
                    <input type="radio" name="editScoringMode" checked={editScoringMode === 'winner'} onChange={() => setEditScoringMode('winner')} style={{ marginTop: 2 }} />
                    <div>
                      <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--rp-text-primary)' }}>Competitif - 1 gagnant par defi</p>
                      <p style={{ fontSize: 11, color: 'var(--rp-text-muted)' }}>L&apos;organisateur designe un gagnant</p>
                    </div>
                  </label>
                  <label style={{
                    display: 'flex', alignItems: 'flex-start', gap: 8,
                    padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                    border: editScoringMode === 'participation' ? '2px solid var(--rp-accent)' : '1.5px solid var(--rp-border)',
                    background: editScoringMode === 'participation' ? 'var(--rp-accent-light, rgba(99,102,241,0.08))' : 'transparent',
                  }}>
                    <input type="radio" name="editScoringMode" checked={editScoringMode === 'participation'} onChange={() => setEditScoringMode('participation')} style={{ marginTop: 2 }} />
                    <div>
                      <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--rp-text-primary)' }}>Participation - photo = points</p>
                      <p style={{ fontSize: 11, color: 'var(--rp-text-muted)' }}>Chaque photo soumise rapporte les points</p>
                    </div>
                  </label>
                </div>
              </div>

              <div>
                <label style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                  border: editTeamMode ? '2px solid var(--rp-accent)' : '1.5px solid var(--rp-border)',
                  background: editTeamMode ? 'var(--rp-accent-light, rgba(99,102,241,0.08))' : 'transparent',
                }}>
                  <input type="checkbox" checked={editTeamMode} onChange={(e) => setEditTeamMode(e.target.checked)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                  <div>
                    <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--rp-text-primary)' }}>Mode equipes</p>
                    <p style={{ fontSize: 11, color: 'var(--rp-text-muted)' }}>Les participants rejoignent une equipe</p>
                  </div>
                </label>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--rp-text-secondary)', marginBottom: 8, display: 'block' }}>Couleur du theme</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <input
                    type="color"
                    value={editThemeColor}
                    onChange={(e) => setEditThemeColor(e.target.value)}
                    style={{ width: 48, height: 48, border: 'none', cursor: 'pointer', borderRadius: 8 }}
                  />
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 13, color: 'var(--rp-text-primary)', fontWeight: 600 }}>{editThemeColor}</p>
                    <p style={{ fontSize: 11, color: 'var(--rp-text-muted)' }}>Visible par les participants</p>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button className="btn-ghost" onClick={() => setShowEditModal(false)}>Annuler</button>
              <button className="btn-primary" onClick={saveEdit} disabled={editSaving} style={{ fontSize: 13, padding: '8px 24px' }}>
                {editSaving ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: '1.5rem',
      }}>
        <div>
          <button
            onClick={() => router.back()}
            className="btn-ghost"
            style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <IconArrowLeft size={14} /> Retour
          </button>
          <h2 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: 'var(--rp-text-primary)',
          }}>
            {event.name}
          </h2>
          <p style={{ fontSize: 13, color: 'var(--rp-text-muted)', marginTop: 4 }}>
            Code : <span style={{
              fontWeight: 700,
              color: 'var(--rp-accent)',
              fontSize: 16,
            }}>{event.code}</span>
            {' \u00B7 '}
            Deadline : {event.deadline ? new Date(event.deadline).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'Aucune'}
            {isPastDeadline && (
              <span style={{ color: 'var(--rp-danger-text)', fontWeight: 600 }}> (expiree)</span>
            )}
            {' \u00B7 '}
            Mode : {event.scoring_mode === 'participation' ? 'Participation' : 'Competitif'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className={`badge ${event.status === 'active' && !isPastDeadline ? 'badge-success' : 'badge-muted'}`}
            style={{ padding: '6px 16px', fontSize: 13 }}>
            {isPastDeadline ? 'Expire' : event.status === 'active' ? 'Actif' : event.status}
          </span>
          {(() => {
            const tierMap: Record<string, { label: string; color: string }> = {
              free:    { label: 'Gratuit',   color: 'var(--rp-text-muted)' },
              premium: { label: 'Événement', color: '#f59e0b' },
              pro:     { label: 'Pro',       color: 'var(--rp-accent)' },
            };
            const t = tierMap[event.tier || 'free'] ?? tierMap.free;
            return (
              <span style={{
                fontSize: 12, fontWeight: 700, padding: '4px 12px',
                borderRadius: 50, border: `1.5px solid ${t.color}`,
                color: t.color,
              }}>
                {t.label}
              </span>
            );
          })()}
          <button
            onClick={openEditModal}
            className="btn-secondary"
            style={{ fontSize: 12, padding: '6px 16px' }}
          >
            Modifier
          </button>
          {!isPastDeadline && (
            <button
              onClick={deleteEvent}
              style={{
                background: 'var(--rp-danger-light)',
                color: 'var(--rp-danger-text)',
                border: 'none',
                borderRadius: 50,
                padding: '6px 16px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Supprimer
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
        <button
          onClick={() => setActiveTab('defis')}
          style={{
            padding: '8px 22px',
            borderRadius: 50,
            border: 'none',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            background: activeTab === 'defis' ? 'var(--rp-accent)' : 'var(--rp-bg-card)',
            color: activeTab === 'defis' ? 'var(--rp-accent-text)' : 'var(--rp-text-muted)',
          }}
        >
          Defis ({challenges.length})
        </button>
        <button
          onClick={() => setActiveTab('galerie')}
          style={{
            padding: '8px 22px',
            borderRadius: 50,
            border: 'none',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            background: activeTab === 'galerie' ? 'var(--rp-accent)' : 'var(--rp-bg-card)',
            color: activeTab === 'galerie' ? 'var(--rp-accent-text)' : 'var(--rp-text-muted)',
          }}
        >
          Galerie ({submissions.length})
        </button>
      </div>

      {/* ==================== DEFIS TAB ==================== */}
      {activeTab === 'defis' && (
        <div className="event-detail-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 24 }}>
          <div>
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
                Defis
              </h3>
              <div style={{ display: 'flex', gap: 8 }}>
                {challenges.filter(c => !c.notified && !c.is_surprise).length > 0 && (
                  <button
                    className="btn-secondary"
                    onClick={notifyChallenges}
                    disabled={notifyLoading}
                    style={{ fontSize: 12, padding: '8px 16px' }}
                  >
                    {notifyLoading ? 'Envoi...' : 'Prevenir (' + challenges.filter(c => !c.notified && !c.is_surprise).length + ' nouveau(x))'}
                  </button>
                )}
                <button
                  className="btn-primary"
                  onClick={() => setShowAddChallenge(!showAddChallenge)}
                  style={{ fontSize: 13, padding: '8px 20px' }}
                >
                  + Ajouter
                </button>
              </div>
            </div>

            {showAddChallenge && (
              <div className="card" style={{ marginBottom: 16, padding: '1.25rem' }}>
                <form onSubmit={addChallenge}>
                  <div style={{ marginBottom: 12 }}>
                    <input type="text" className="input-field" placeholder="Titre du defi" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} required />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <input type="text" className="input-field" placeholder="Description (optionnel)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
                  </div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label style={{ fontSize: 13, color: 'var(--rp-text-secondary)' }}>Points :</label>
                      <input type="number" className="input-field" value={newPoints} onChange={(e) => {
                        // audit: LOW-079 — clamp client [1,1000] (le min/max HTML ne borne pas la saisie clavier/collage)
                        const n = parseInt(e.target.value, 10);
                        setNewPoints(Number.isNaN(n) ? 10 : Math.min(1000, Math.max(1, n)));
                      }} min={1} max={1000} style={{ width: 80 }} />
                    </div>
                    <button type="submit" className="btn-primary" style={{ fontSize: 13, padding: '8px 20px' }}>Creer</button>
                    <button type="button" className="btn-ghost" onClick={() => setShowAddChallenge(false)}>Annuler</button>
                  </div>
                </form>
              </div>
            )}

            {challenges.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
                <p style={{ color: 'var(--rp-text-muted)', fontSize: 14 }}>Aucun defi pour le moment</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {challenges.map((challenge) => {
                  const challengeSubmissions = submissions.filter(s => s.challenge_id === challenge.id);
                  const winner = challengeSubmissions.find(s => s.is_winner);

                  return (
                    <div key={challenge.id} className="card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <div>
                          <h4 style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 600, color: 'var(--rp-text-primary)' }}>
                            {challenge.title}
                          </h4>
                          {challenge.description && (
                            <p style={{ fontSize: 13, color: 'var(--rp-text-muted)', marginTop: 2 }}>{challenge.description}</p>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="badge badge-accent">{challenge.points} pts</span>
                          <button onClick={() => deleteChallenge(challenge.id)} className="btn-ghost" style={{ display: 'flex', alignItems: 'center' }}><IconX size={16} /></button>
                        </div>
                      </div>

                      {challengeSubmissions.length > 0 && (
                        <div style={{ borderTop: '0.5px solid var(--rp-border)', paddingTop: 12, marginTop: 8 }}>
                          <p style={{ fontSize: 12, color: 'var(--rp-text-muted)', marginBottom: 10 }}>
                            {challengeSubmissions.length} photo(s) soumise(s)
                            {winner && (
                              <span style={{ color: 'var(--rp-success-text)', fontWeight: 600 }}>
                                {' \u00B7 '}Gagnant : {winner.participant_name}
                              </span>
                            )}
                          </p>

                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 8 }}>
                            {challengeSubmissions.map((sub) => {
                              const globalIndex = submissions.findIndex(s => s.id === sub.id);
                              return (
                                <div key={sub.id} style={{
                                  borderRadius: 10,
                                  border: sub.is_winner ? '2px solid var(--rp-accent)' : '1.5px solid var(--rp-border)',
                                  overflow: 'hidden',
                                  background: 'var(--rp-bg-card)',
                                  position: 'relative',
                                }}>
                                  {sub.media_type === 'video' ? (
                                    <video src={sub.photo_url} playsInline muted loop autoPlay
                                      onClick={() => setPreviewIndex(globalIndex)}
                                      style={{ width: '100%', height: 140, objectFit: 'cover', cursor: 'pointer', display: 'block' }}
                                    />
                                  ) : (
                                    <img src={sub.photo_url} alt={sub.participant_name} loading="lazy"
                                      onClick={() => setPreviewIndex(globalIndex)}
                                      style={{ width: '100%', height: 140, objectFit: 'cover', cursor: 'pointer', display: 'block' }}
                                    />
                                  )}
                                  {sub.is_winner && (
                                    <div style={{ position: 'absolute', top: 6, right: 6, background: 'var(--rp-accent)', color: 'var(--rp-accent-text)', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 50 }}>
                                      GAGNANT
                                    </div>
                                  )}
                                  <div style={{ padding: '8px 10px' }}>
                                    <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--rp-text-primary)', marginBottom: 4 }}>{sub.participant_name}</p>
                                    {event.scoring_mode !== 'participation' && isPastDeadline && !winner && (
                                      <button onClick={() => selectWinner(challenge.id, sub.id)} style={{
                                        width: '100%', padding: '4px 8px', borderRadius: 6, border: 'none',
                                        background: 'var(--rp-accent)', color: 'var(--rp-accent-text)',
                                        fontSize: 11, fontWeight: 700, cursor: 'pointer',
                                      }}>
                                        Choisir
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {event.scoring_mode !== 'participation' && winner && challenge.status === 'judged' && (
                            <button className="btn-gradient" onClick={() => revealWinner(challenge.id)}
                              style={{ fontSize: 13, padding: '6px 18px', marginTop: 4 }}>
                              Reveler en live
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* QR Code sidebar */}
          <div>
            <div className="card" style={{ textAlign: 'center' }}>
              <h4 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, marginBottom: 12, color: 'var(--rp-text-primary)' }}>
                QR Code
              </h4>
              {event.qr_code_url && (
                <img src={event.qr_code_url} alt="QR Code" style={{ width: '100%', maxWidth: 200, margin: '0 auto 12px', display: 'block', borderRadius: 12 }} />
              )}
              <p style={{ fontSize: 22, fontWeight: 700, color: 'var(--rp-accent)', fontFamily: 'var(--font-display)', letterSpacing: '0.1em', marginBottom: 8 }}>
                {event.code}
              </p>
              <p style={{ fontSize: 12, color: 'var(--rp-text-muted)' }}>Partagez ce code ou le QR code a vos invites</p>
              <div style={{ marginTop: 16 }}>
                <button
                onClick={() => {
                  const url = `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.rallye-photo.com'}/join/${event.code}`;
                  navigator.clipboard.writeText(url);
                  alert('Lien copie !');
                }}
                className="btn-secondary"
                style={{ fontSize: 12, padding: '6px 16px', width: '100%' }}
              >
                Copier le lien
              </button>
              <button
                onClick={() => {
                  const url = `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.rallye-photo.com'}/join/${event.code}`;
                  if (navigator.share) {
                    navigator.share({ title: event.name, text: 'Rejoins le rallye photo !', url });
                  } else {
                    navigator.clipboard.writeText(url);
                    alert('Lien copie !');
                  }
                }}
                className="btn-gradient"
                style={{ fontSize: 12, padding: '6px 16px', width: '100%', marginTop: 8 }}
              >
                Partager
              </button>
              <button
                onClick={async () => {
                  try {
                    const response = await api.get(`/events/${event.id}/qr-pdf`, { responseType: 'blob' });
                    downloadBlob(response.data, `rallye-photo-${event.code}.pdf`); // audit: LOW-077
                  } catch (err) {
                    alert('Erreur lors du telechargement');
                  }
                }}
                className="btn-secondary"
                style={{ fontSize: 12, padding: '6px 16px', width: '100%', marginTop: 8 }}
              >
                Telecharger le PDF
              </button>
              <button
                onClick={async () => {
                  try {
                    const response = await api.get(`/events/${event.id}/export-zip`, { responseType: 'blob', timeout: 120000 });
                    downloadBlob(response.data, `rallye-photo-${event.code}.zip`); // audit: LOW-077
                  } catch (err: any) {
                    const msg = err.response?.status === 404 ? 'Aucune photo a exporter' : 'Erreur lors de l\'export';
                    alert(msg);
                  }
                }}
                className="btn-secondary"
                style={{ fontSize: 12, padding: '6px 16px', width: '100%', marginTop: 8 }}
              >
                Exporter les photos (ZIP)
              </button>
              </div>
            </div>

            {/* Branding */}
            <div className="card" style={{ marginTop: 16 }}>
              <h4 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, marginBottom: 12, color: 'var(--rp-text-primary)' }}>
                Personnalisation
              </h4>

              {/* Logo */}
              <div style={{ marginBottom: 16 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--rp-text-secondary)', marginBottom: 8 }}>Logo</p>
                {event.logo_key && event.logo_url ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <div style={{ width: 60, height: 60, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--rp-border)' }}>
                      <img src={event.logo_url} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                    <button onClick={async () => {
                      try {
                        await api.delete(`/events/${event.id}/logo`);
                        loadData();
                      } catch { alert('Erreur'); }
                    }} className="btn-ghost" style={{ fontSize: 11, color: 'var(--rp-danger-text)' }}>Supprimer</button>
                  </div>
                ) : null}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    // audit: MED-025 — valider taille/type avant envoi
                    const validationError = validateImageFile(file);
                    if (validationError) {
                      alert(validationError);
                      e.target.value = '';
                      return;
                    }
                    try {
                      const formData = new FormData();
                      formData.append('logo', file);
                      await api.post(`/events/${event.id}/logo`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
                      loadData();
                      alert('Logo mis a jour !');
                    } catch (err: any) {
                      alert(err.response?.data?.error || 'Erreur upload');
                    }
                    e.target.value = '';
                  }}
                  style={{ fontSize: 12, width: '100%' }}
                />
                <p style={{ fontSize: 11, color: 'var(--rp-text-muted)', marginTop: 4 }}>400x400px, max 5MB</p>
              </div>

              {/* Banner */}
              <div>
                <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--rp-text-secondary)', marginBottom: 8 }}>Banniere</p>
                {event.banner_key && event.banner_url ? (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ width: '100%', height: 80, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--rp-border)', marginBottom: 6 }}>
                      <img src={event.banner_url} alt="Banniere" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                    <button onClick={async () => {
                      try {
                        await api.delete(`/events/${event.id}/banner`);
                        loadData();
                      } catch { alert('Erreur'); }
                    }} className="btn-ghost" style={{ fontSize: 11, color: 'var(--rp-danger-text)' }}>Supprimer</button>
                  </div>
                ) : null}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    // audit: MED-025 — valider taille/type avant envoi
                    const validationError = validateImageFile(file);
                    if (validationError) {
                      alert(validationError);
                      e.target.value = '';
                      return;
                    }
                    try {
                      const formData = new FormData();
                      formData.append('banner', file);
                      await api.post(`/events/${event.id}/banner`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
                      loadData();
                      alert('Banniere mise a jour !');
                    } catch (err: any) {
                      alert(err.response?.data?.error || 'Erreur upload');
                    }
                    e.target.value = '';
                  }}
                  style={{ fontSize: 12, width: '100%' }}
                />
                <p style={{ fontSize: 11, color: 'var(--rp-text-muted)', marginTop: 4 }}>1200x400px, max 5MB</p>
              </div>
            </div>

            {/* Teams management */}
            {!!event.team_mode && (
              <div className="card" style={{ marginTop: 16 }}>
                <h4 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, marginBottom: 12, color: 'var(--rp-text-primary)' }}>
                  Equipes
                </h4>

                {teams.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--rp-text-muted)', marginBottom: 12 }}>Aucune equipe</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                    {teams.map((team) => (
                      <div key={team.id} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '8px 12px', borderRadius: 8,
                        border: '1px solid var(--rp-border)',
                        background: 'var(--rp-bg-secondary)',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 12, height: 12, borderRadius: '50%', background: team.color }} />
                          <div>
                            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--rp-text-primary)' }}>{team.name}</p>
                            <p style={{ fontSize: 11, color: 'var(--rp-text-muted)' }}>{team.member_count} membre{team.member_count > 1 ? 's' : ''} - {team.score} pts</p>
                          </div>
                        </div>
                        <button onClick={() => deleteTeam(team.id)} className="btn-ghost" style={{ padding: 4 }}>
                          <IconX size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {showAddTeam ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="Nom de l'equipe"
                      value={newTeamName}
                      onChange={(e) => setNewTeamName(e.target.value)}
                      style={{ fontSize: 13 }}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label style={{ fontSize: 12, color: 'var(--rp-text-muted)' }}>Couleur :</label>
                      <input
                        type="color"
                        value={newTeamColor}
                        onChange={(e) => setNewTeamColor(e.target.value)}
                        style={{ width: 32, height: 32, border: 'none', cursor: 'pointer', borderRadius: 6 }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={addTeam} className="btn-primary" style={{ fontSize: 12, padding: '6px 16px', flex: 1 }}>Ajouter</button>
                      <button onClick={() => setShowAddTeam(false)} className="btn-ghost" style={{ fontSize: 12 }}>Annuler</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setShowAddTeam(true)} className="btn-secondary" style={{ fontSize: 12, padding: '6px 16px', width: '100%' }}>
                    + Ajouter une equipe
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== GALERIE TAB ==================== */}
      {activeTab === 'galerie' && (
        <div>
          {submissions.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
              <div style={{ marginBottom: 8 }}><IconCamera size={36} color="var(--rp-text-muted)" /></div>
              <p style={{ color: 'var(--rp-text-muted)', fontSize: 15 }}>Aucune photo pour le moment</p>
            </div>
          ) : (
            <>
              <p style={{ fontSize: 13, color: 'var(--rp-text-muted)', marginBottom: 16 }}>
                {submissions.length} photo(s) au total {' \u00B7 '}Cliquez pour agrandir {' \u00B7 '}Fleches clavier pour naviguer
              </p>

              {challenges.map((challenge) => {
                const subs = submissions.filter(s => s.challenge_id === challenge.id);
                if (subs.length === 0) return null;

                return (
                  <div key={challenge.id} style={{ marginBottom: 28 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 600, color: 'var(--rp-text-primary)' }}>
                        {challenge.title}
                      </h3>
                      <span className="badge badge-accent">{challenge.points} pts</span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
                      {subs.map((sub) => {
                        const globalIndex = submissions.findIndex(s => s.id === sub.id);
                        return (
                          <div key={sub.id} onClick={() => setPreviewIndex(globalIndex)} style={{
                            borderRadius: 12, border: sub.is_winner ? '2px solid var(--rp-accent)' : '1px solid var(--rp-border)',
                            overflow: 'hidden', background: 'var(--rp-bg-card)', cursor: 'pointer', position: 'relative',
                          }}>
                            {sub.media_type === 'video' ? (
                              <video src={sub.photo_url} playsInline muted loop autoPlay
                                style={{ width: '100%', height: 200, objectFit: 'cover', display: 'block' }} />
                            ) : (
                              <img src={sub.photo_url} alt={sub.participant_name} loading="lazy"
                                style={{ width: '100%', height: 200, objectFit: 'cover', display: 'block' }} />
                            )}
                            {sub.is_winner && (
                              <div style={{ position: 'absolute', top: 8, right: 8, background: 'var(--rp-accent)', color: 'var(--rp-accent-text)', fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 50 }}>
                                GAGNANT
                              </div>
                            )}
                            <div style={{ padding: '10px 12px' }}>
                              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--rp-text-primary)' }}>{sub.participant_name}</p>
                              <p style={{ fontSize: 11, color: 'var(--rp-text-muted)', marginTop: 2 }}>
                                {new Date(sub.submitted_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
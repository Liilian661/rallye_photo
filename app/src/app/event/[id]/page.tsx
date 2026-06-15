'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import api from '@/lib/api';
import { getParticipant } from '@/lib/participant';
import { IconCamera, IconCheckCircle, IconLock, IconClock, IconAlarm, IconLoader, IconGallery, IconCheck, IconX } from '@/lib/icons';
import CameraModal from '@/components/CameraModal';
import { io, Socket } from 'socket.io-client';

interface EventInfo {
  id: string;
  name: string;
  deadline: string;
  code: string;
  status: string;
  theme_color?: string;
  logo_url?: string;
  banner_url?: string;
}

interface Challenge {
  id: string;
  title: string;
  description: string;
  points: number;
  is_surprise: boolean;
  status: string;
  theme_color?: string;
  vote_enabled: number;
  vote_closed: number;
}

interface Submission {
  id: string;
  challenge_id: string;
  participant_id: string;
  participant_name?: string;
  photo_url: string;
  is_winner: boolean;
  media_type?: string;
}

function compressImage(file: File): Promise<File> {
  return new Promise((resolve) => {
    if (file.size < 500 * 1024) { resolve(file); return; }

    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxDim = 1920;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
        else { width = Math.round(width * (maxDim / height)); height = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, width, height);

      const tryFormat = (format: string, quality: number) => {
        canvas.toBlob((blob) => {
          if (blob && blob.size > 0) {
            const ext = format === 'image/webp' ? 'photo.webp' : 'photo.jpg';
            resolve(new File([blob], ext, { type: format }));
          } else if (format === 'image/webp') {
            tryFormat('image/jpeg', 0.85);
          } else { resolve(file); }
        }, format, quality);
      };
      tryFormat('image/webp', 0.8);
    };

    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

export default function EventPage() {
  const params = useParams();
  const router = useRouter();
  const eventId = params.id as string;
  const socketRef = useRef<Socket | null>(null);

  const [event, setEvent] = useState<EventInfo | null>(null);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [participantName, setParticipantName] = useState('');
  const [participantId, setParticipantId] = useState('');
  const [loading, setLoading] = useState(true);
  const [timeLeft, setTimeLeft] = useState('');
  const [isPastDeadline, setIsPastDeadline] = useState(false);

  const [expandedChallenge, setExpandedChallenge] = useState<string | null>(null);
  const [uploadingChallengeId, setUploadingChallengeId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [votedChallenges, setVotedChallenges] = useState<Record<string, string>>({});
  const [voteCounts, setVoteCounts] = useState<Record<string, Record<string, number>>>({});
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewType, setPreviewType] = useState<string>('photo');
  const [alertChallenges, setAlertChallenges] = useState<{title: string; points: number}[] | null>(null);
  const [cameraForChallenge, setCameraForChallenge] = useState<string | null>(null);
  const [onlineCount, setOnlineCount] = useState(0);

  useEffect(() => {
    const p = getParticipant(eventId);
    if (!p) { router.replace('/'); return; }
    setParticipantId(p.id);
    setParticipantName(p.name);
    setEvent({
      id: eventId,
      name: p.eventName || '',
      deadline: '',
      code: p.eventCode || '',
      status: 'active',
    });
  }, [eventId, router]);

  const loadData = useCallback(async () => {
    const p = getParticipant(eventId);
    if (p?.eventCode) {
      try {
        const { data } = await api.get(`/events/join/${p.eventCode}`);
        setEvent(data);
      } catch (err) { console.error('Event fetch error:', err); }
    }

    try {
      const { data } = await api.get(`/events/${eventId}/challenges`);
      setChallenges(data);
    } catch (err) { console.error('Challenges fetch error:', err); }

    try {
      const { data } = await api.get(`/events/${eventId}/submissions`);
      setSubmissions(data);
    } catch (err) { console.error('Submissions fetch error:', err); }

    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    if (participantId) loadData();
  }, [participantId, loadData]);

  // Apply theme color
  useEffect(() => {
    if (event?.theme_color && event.theme_color !== '#e91e8c') {
      document.documentElement.style.setProperty('--rp-pink', event.theme_color);
      document.documentElement.style.setProperty('--rp-pink-light', event.theme_color + '15');
      return () => {
        document.documentElement.style.removeProperty('--rp-pink');
        document.documentElement.style.removeProperty('--rp-pink-light');
      };
    }
  }, [event?.theme_color]);

  const loadVotes = useCallback(async () => {
    for (const c of challenges) {
      if (c.vote_enabled) {
        try {
          const { data } = await api.get(`/challenges/${c.id}/votes`);
          const counts: Record<string, number> = {};
          for (const v of data.votes) { counts[v.submission_id] = v.vote_count; }
          setVoteCounts(prev => ({ ...prev, [c.id]: counts }));
        } catch { /* ignore */ }
      }
    }
  }, [challenges]);

  useEffect(() => {
    if (challenges.length > 0) loadVotes();
  }, [challenges, loadVotes]);

  useEffect(() => {
    if (!event) return;
    const update = () => {
      if (!event.deadline) return;
      const now = new Date().getTime();
      const deadline = new Date(event.deadline).getTime();
      if (isNaN(deadline)) return;
      const diff = deadline - now;

      if (diff <= 0) { setTimeLeft('Termine'); setIsPastDeadline(true); return; }

      const h = Math.floor(diff / (1000 * 60 * 60));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const s = Math.floor((diff % (1000 * 60)) / 1000);

      if (h > 24) { setTimeLeft(`${Math.floor(h / 24)}j ${h % 24}h`); }
      else if (h > 0) { setTimeLeft(`${h}h ${m}min`); }
      else { setTimeLeft(`${m}min ${s}s`); }
      setIsPastDeadline(false);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [event]);

  useEffect(() => {
    if (!eventId) return;

    const socket = io(process.env.NEXT_PUBLIC_API_URL || 'https://api.rallye-photo.com', {
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => { socket.emit('join-event', eventId); });

    socket.on('new-submission', () => loadData());
    socket.on('participant-joined', () => loadData());
    socket.on('challenge-started', () => loadData());
    socket.on('winner-selected', () => loadData());
    socket.on('winner-revealed', () => loadData());
    socket.on('leaderboard-updated', () => loadData());
    socket.on('vote-enabled', () => loadData());
    socket.on('vote-closed', () => loadData());
    socket.on('vote-cast', () => loadVotes());
    socket.on('online-count', (count: number) => setOnlineCount(count));
    socket.on('new-challenges-alert', (data: any) => {
      if (data && data.challenges) {
        setAlertChallenges(data.challenges);
        loadData();
      }
    });

    socketRef.current = socket;

    return () => {
      socket.emit('leave-event', eventId);
      socket.disconnect();
    };
  }, [eventId, loadData, loadVotes]);

  const handleUpload = async (challengeId: string, file: File, attempt = 1) => {
    const MAX_RETRIES = 3;
    if (!participantId) return;
    setUploadingChallengeId(challengeId);

    const isVideoFile = file.type.startsWith('video/');
    setUploadProgress(attempt > 1 ? `Nouvel essai (${attempt}/${MAX_RETRIES})...` : isVideoFile ? 'Envoi de la video...' : 'Compression...');

    try {
      // Pas de compression pour les videos
      const fileToUpload = isVideoFile ? file : await compressImage(file);
      setUploadProgress(attempt > 1 ? `Envoi (essai ${attempt})...` : 'Envoi...');

      const formData = new FormData();
      formData.append('photo', fileToUpload, fileToUpload.name || (isVideoFile ? 'video.webm' : 'photo.jpg'));
      formData.append('participantId', participantId);

      await api.post(
        `/events/${eventId}/challenges/${challengeId}/submit`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' }, timeout: isVideoFile ? 120000 : 60000 }
      );

      setUploadSuccess(challengeId);
      setExpandedChallenge(null);
      setUploadingChallengeId(null);
      setUploadProgress('');
      await loadData();
      setTimeout(() => setUploadSuccess(null), 3000);
    } catch (err: any) {
      const status = err.response?.status;
      if (attempt < MAX_RETRIES && (!status || status >= 500 || err.code === 'ECONNABORTED')) {
        setUploadProgress(`Erreur, nouvel essai dans ${attempt}s...`);
        await new Promise(r => setTimeout(r, 1000 * attempt));
        return handleUpload(challengeId, file, attempt + 1);
      }
      const msg = err.response?.data?.error
        || (err.code === 'ECONNABORTED' ? 'Temps depasse. Verifiez votre connexion.' : 'Erreur lors de l\'envoi');
      alert(msg);
      setUploadingChallengeId(null);
      setUploadProgress('');
    }
  };

  const openFilePicker = (challengeId: string, useCamera: boolean) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (useCamera) input.setAttribute('capture', 'environment');
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) handleUpload(challengeId, file);
    };
    input.click();
  };

  const castVote = async (challengeId: string, submissionId: string) => {
    try {
      await api.post(`/challenges/${challengeId}/vote`, { participantId, submissionId });
      setVotedChallenges(prev => ({ ...prev, [challengeId]: submissionId }));
      await loadVotes();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Erreur');
    }
  };

  const mySubmissions = submissions.filter(s => s.participant_id === participantId);
  const hasSubmitted = (challengeId: string) => mySubmissions.some(s => s.challenge_id === challengeId);
  const getMySubmission = (challengeId: string) => mySubmissions.find(s => s.challenge_id === challengeId);

  // Trier : defis non faits en premier, puis defis faits
  const sortedChallenges = [...challenges].sort((a, b) => {
    const aSubmitted = hasSubmitted(a.id) ? 1 : 0;
    const bSubmitted = hasSubmitted(b.id) ? 1 : 0;
    return aSubmitted - bSubmitted;
  });

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const deleteSubmission = async (submissionId: string) => {
    if (!confirm('Supprimer cette photo ?')) return;
    setDeletingId(submissionId);
    try {
      await api.delete('/submissions/' + submissionId + '/participant/' + participantId);
      await loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Erreur lors de la suppression');
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="page-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--rp-text-muted)' }}>Chargement...</p>
      </div>
    );
  }

  if (!event) return null;

  return (
    <div className="page-container page-with-nav fade-in">

      {/* Lightbox fullscreen */}
      {previewUrl && (
        <div
          onClick={() => setPreviewUrl(null)}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.92)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', zIndex: 1000,
            cursor: 'pointer', padding: '1rem',
          }}
        >
          {previewType === 'video' ? (
            <video
              src={previewUrl}
              playsInline
              autoPlay
              controls
              loop
              style={{ maxWidth: '100%', maxHeight: '90vh', borderRadius: 12, objectFit: 'contain' }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img
              src={previewUrl}
              alt="Preview"
              style={{ maxWidth: '100%', maxHeight: '90vh', borderRadius: 12, objectFit: 'contain' }}
            />
          )}
          <button
            onClick={() => setPreviewUrl(null)}
            style={{
              position: 'absolute', top: 16, right: 16,
              background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
              width: 40, height: 40, borderRadius: '50%', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <IconX size={22} />
          </button>
        </div>
      )}

      {/* Popup nouveaux defis */}
      {alertChallenges && (
        <div
          onClick={() => setAlertChallenges(null)}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.6)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', zIndex: 999,
            padding: '1.5rem',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--rp-bg-card, #fff)', borderRadius: 16,
              padding: '24px 20px', width: '100%', maxWidth: 340,
              textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 8 }}>&#127775;</div>
            <h3 style={{
              fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700,
              color: 'var(--rp-text-primary, #111)', marginBottom: 4,
            }}>
              {alertChallenges.length === 1 ? 'Nouveau defi !' : 'Nouveaux defis !'}
            </h3>
            <p style={{ fontSize: 13, color: 'var(--rp-text-muted, #888)', marginBottom: 16 }}>
              L&apos;organisateur vient d&apos;ajouter {alertChallenges.length === 1 ? 'un defi' : alertChallenges.length + ' defis'}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {alertChallenges.map((c, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 14px', borderRadius: 10,
                  background: 'var(--rp-pink-light, #fff0f6)',
                  border: '1px solid var(--rp-border, #eee)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <IconCamera size={16} color="var(--rp-pink, #e91e8c)" />
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--rp-text-primary, #111)' }}>{c.title}</span>
                  </div>
                  <span style={{
                    fontSize: 12, fontWeight: 700, color: 'var(--rp-pink, #e91e8c)',
                    background: 'var(--rp-bg-card, #fff)', padding: '2px 10px', borderRadius: 50,
                  }}>
                    {c.points} pts
                  </span>
                </div>
              ))}
            </div>

            <button
              onClick={() => setAlertChallenges(null)}
              className="btn-primary"
              style={{ width: '100%', padding: '12px 16px', fontSize: 15, borderRadius: 12 }}
            >
              C&apos;est parti !
            </button>
          </div>
        </div>
      )}

      {/* Banner */}
      {event.banner_url && (
        <div style={{
          width: 'calc(100% + 2rem)', marginLeft: '-1rem', marginTop: '-1rem', marginBottom: 16,
          height: 140, borderRadius: '0 0 16px 16px', overflow: 'hidden',
        }}>
          <img src={event.banner_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      )}

      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        {/* Logo */}
        {event.logo_url && (
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center' }}>
            <img src={event.logo_url} alt="" style={{
              width: 64, height: 64, borderRadius: 16, objectFit: 'cover',
              border: '2px solid var(--rp-border)',
            }} />
          </div>
        )}
        <p style={{ fontSize: 13, color: 'var(--rp-text-muted)', marginBottom: 4 }}>
          Bienvenue {participantName} !
        </p>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 12 }}>
          {event.name}
        </h1>
        {timeLeft && (
          <div className={`timer ${isPastDeadline ? 'timer-expired' : ''}`}>
            {isPastDeadline ? <IconAlarm size={16} /> : <IconClock size={16} />}
            {' '}{timeLeft}
          </div>
        )}
        {onlineCount > 0 && (
          <p style={{ fontSize: 12, color: 'var(--rp-text-muted)', marginTop: 8 }}>
            {onlineCount} personne{onlineCount > 1 ? 's' : ''} en ligne
          </p>
        )}
      </div>

      <div className="card" style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center', marginBottom: 20, padding: '1rem' }}>
        <div>
          <p style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--rp-pink)' }}>{mySubmissions.length}</p>
          <p style={{ fontSize: 12, color: 'var(--rp-text-muted)' }}>Soumises</p>
        </div>
        <div style={{ width: 1, background: 'var(--rp-border)' }} />
        <div>
          <p style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--rp-blue)' }}>{challenges.length}</p>
          <p style={{ fontSize: 12, color: 'var(--rp-text-muted)' }}>Defis</p>
        </div>
        <div style={{ width: 1, background: 'var(--rp-border)' }} />
        <div>
          <p style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--rp-green)' }}>{mySubmissions.filter(s => s.is_winner).length}</p>
          <p style={{ fontSize: 12, color: 'var(--rp-text-muted)' }}>Gagnes</p>
        </div>
      </div>

      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Les defis</h3>

      {challenges.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
          <div style={{ marginBottom: 8 }}><IconCamera size={36} color="var(--rp-text-muted)" /></div>
          <p style={{ color: 'var(--rp-text-muted)' }}>Aucun defi pour le moment</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sortedChallenges.map((challenge) => {
            const submitted = hasSubmitted(challenge.id);
            const mySub = getMySubmission(challenge.id);
            const isExpanded = expandedChallenge === challenge.id;
            const justUploaded = uploadSuccess === challenge.id;
            const isUploading = uploadingChallengeId === challenge.id;
            const isDeleting = mySub && deletingId === mySub.id;

            return (
              <div
                key={challenge.id}
                className="card-challenge"
                onClick={() => {
                  if (!submitted && !isPastDeadline && !isUploading) {
                    setExpandedChallenge(isExpanded ? null : challenge.id);
                  }
                }}
                style={{
                  borderColor: justUploaded ? 'var(--rp-green)' : 'var(--rp-border)',
                  cursor: submitted || isPastDeadline || isUploading ? 'default' : 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ display: 'flex', alignItems: 'center' }}>
                        {submitted ? <IconCheckCircle size={18} color="var(--rp-green)" /> : isPastDeadline ? <IconLock size={18} /> : <IconCamera size={18} color="var(--rp-pink)" />}
                      </span>
                      <h4 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600 }}>
                        {challenge.title}
                      </h4>
                    </div>
                    {challenge.description && (
                      <p style={{ fontSize: 13, color: 'var(--rp-text-muted)', marginLeft: 26 }}>{challenge.description}</p>
                    )}
                  </div>
                  <span className={`badge ${submitted ? 'badge-green' : 'badge-pink'}`}>{challenge.points} pts</span>
                </div>

                {/* Photo soumise : affichage + boutons reprendre/supprimer */}
                {submitted && mySub && (
                  <div style={{ marginTop: 12 }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--rp-border)', marginBottom: 8, cursor: 'pointer', position: 'relative' }}
                      onClick={() => { setPreviewUrl(mySub.photo_url); setPreviewType(mySub.media_type || 'photo'); }}>
                      {mySub.media_type === 'video' ? (
                        <>
                          <video
                            src={mySub.photo_url}
                            playsInline
                            muted
                            loop
                            autoPlay
                            style={{ width: '100%', maxHeight: 200, objectFit: 'cover', display: 'block' }}
                          />
                          <div style={{
                            position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)',
                            borderRadius: 6, padding: '2px 8px', fontSize: 11, color: '#fff', fontWeight: 600,
                          }}>VIDEO</div>
                        </>
                      ) : (
                        <img
                          src={mySub.photo_url}
                          alt="Ma photo"
                          style={{ width: '100%', maxHeight: 200, objectFit: 'cover', display: 'block' }}
                        />
                      )}
                    </div>
                    {!isPastDeadline && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          className="btn-secondary"
                          style={{ flex: 1, padding: '10px 12px', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                          onClick={() => {
                            if (!confirm('Reprendre la photo ? L\'ancienne sera remplacee.')) return;
                            deleteSubmission(mySub.id).then(() => {
                              setExpandedChallenge(challenge.id);
                            });
                          }}
                          disabled={!!isDeleting}
                        >
                          <IconCamera size={14} /> Reprendre
                        </button>
                        <button
                          style={{
                            flex: 1, padding: '10px 12px', fontSize: 13, fontWeight: 600,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                            borderRadius: 10, border: 'none', cursor: 'pointer',
                            background: 'var(--rp-danger-light, #fef2f2)', color: 'var(--rp-danger-text, #dc2626)',
                          }}
                          onClick={() => deleteSubmission(mySub.id)}
                          disabled={!!isDeleting}
                        >
                          <IconX size={14} /> {isDeleting ? 'Suppression...' : 'Supprimer'}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {isExpanded && !submitted && !isPastDeadline && (
                  <div style={{ marginTop: 16 }} onClick={(e) => e.stopPropagation()}>
                    {isUploading ? (
                      <div className="upload-zone" style={{ borderStyle: 'solid', borderColor: 'var(--rp-pink)', background: 'var(--rp-pink-light)' }}>
                        <div style={{ marginBottom: 8 }}><IconLoader size={36} color="var(--rp-pink)" /></div>
                        <p style={{ fontWeight: 600, color: 'var(--rp-pink)' }}>{uploadProgress}</p>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn-primary" style={{ flex: 1, padding: '14px 16px', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                          onClick={() => openFilePicker(challenge.id, false)}>
                          <IconGallery size={16} /> Galerie
                        </button>
                        <button className="btn-secondary" style={{ flex: 1, padding: '14px 16px', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                          onClick={() => setCameraForChallenge(challenge.id)}>
                          <IconCamera size={16} /> Photo
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {justUploaded && (
                  <div style={{ marginTop: 12, textAlign: 'center', color: 'var(--rp-green)', fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                    <IconCheckCircle size={16} color="var(--rp-green)" /> Photo envoyee !
                  </div>
                )}

                {!!challenge.vote_enabled && !challenge.vote_closed && isPastDeadline && (() => {
                  const challengeSubs = submissions.filter(s => s.challenge_id === challenge.id);
                  const myVote = votedChallenges[challenge.id];
                  const counts = voteCounts[challenge.id] || {};
                  if (challengeSubs.length === 0) return null;

                  return (
                    <div style={{ marginTop: 16 }} onClick={(e) => e.stopPropagation()}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--rp-blue)', marginBottom: 10, textAlign: 'center' }}>
                        Votez pour votre photo preferee !
                      </p>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                        {challengeSubs.map((sub) => {
                          const isOwn = sub.participant_id === participantId;
                          const isVoted = myVote === sub.id;
                          const voteCount = counts[sub.id] || 0;

                          return (
                            <div key={sub.id} style={{
                              borderRadius: 12,
                              border: isVoted ? '2px solid var(--rp-blue)' : '1px solid var(--rp-border)',
                              overflow: 'hidden',
                              background: isVoted ? 'var(--rp-blue-light)' : '#fff',
                              opacity: isOwn ? 0.5 : 1,
                            }}>
                              {sub.media_type === 'video' ? (
                                <video src={sub.photo_url} playsInline muted loop autoPlay style={{ width: '100%', height: 100, objectFit: 'cover', display: 'block' }} />
                              ) : (
                                <img src={sub.photo_url} alt="Photo" style={{ width: '100%', height: 100, objectFit: 'cover', display: 'block' }} />
                              )}
                              <div style={{ padding: '6px 8px', textAlign: 'center' }}>
                                <p style={{ fontSize: 11, fontWeight: 500, color: 'var(--rp-text)', marginBottom: 4 }}>
                                  {isOwn ? 'Vous' : (sub.participant_name || 'Participant')}
                                </p>
                                {voteCount > 0 && (
                                  <p style={{ fontSize: 10, color: 'var(--rp-blue)', fontWeight: 700, marginBottom: 4 }}>
                                    {voteCount} vote{voteCount > 1 ? 's' : ''}
                                  </p>
                                )}
                                {!myVote && !isOwn && (
                                  <button onClick={() => castVote(challenge.id, sub.id)} style={{
                                    width: '100%', padding: '4px 8px', borderRadius: 6, border: 'none',
                                    background: 'var(--rp-blue)', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                                  }}>
                                    Voter
                                  </button>
                                )}
                                {isVoted && (
                                  <p style={{ fontSize: 10, color: 'var(--rp-blue)', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}><IconCheck size={12} color="var(--rp-blue)" /> Votre vote</p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}

      {/* Camera integree */}
      {cameraForChallenge && (
        <CameraModal
          enableVideo={true}
          onCapture={(file) => {
            const challengeId = cameraForChallenge;
            setCameraForChallenge(null);
            handleUpload(challengeId, file);
          }}
          onClose={() => setCameraForChallenge(null)}
        />
      )}
    </div>
  );
}
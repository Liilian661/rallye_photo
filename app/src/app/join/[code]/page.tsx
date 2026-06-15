'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import api from '@/lib/api';
import { getParticipant, saveParticipant } from '@/lib/participant';
import { IconSad, IconAlarm, IconArrowLeft } from '@/lib/icons';

interface EventInfo {
  id: string;
  name: string;
  description: string;
  deadline: string;
  code: string;
  status: string;
  team_mode: number;
}

interface Team {
  id: string;
  name: string;
  color: string;
  member_count: number;
}

export default function JoinPage() {
  const params = useParams();
  const router = useRouter();
  const code = params.code as string;

  const [event, setEvent] = useState<EventInfo | null>(null);
  const [name, setName] = useState('');
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [eventError, setEventError] = useState('');

  useEffect(() => {
    api.get(`/events/join/${code}`)
      .then(async ({ data }) => {
        setEvent(data);
        // Check if already joined
        const existing = getParticipant(data.id);
        if (existing) {
          router.replace(`/event/${data.id}`);
          return;
        }
        // Load teams if team mode
        if (data.team_mode) {
          try {
            const teamsRes = await api.get(`/events/${data.id}/teams`);
            setTeams(teamsRes.data);
          } catch { /* ignore */ }
        }
      })
      .catch((err) => {
        setEventError(err.response?.data?.error || 'Evenement non trouve');
      })
      .finally(() => setLoading(false));
  }, [code, router]);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!event || !name.trim()) return;

    // Require team selection if team mode
    if (event.team_mode && teams.length > 0 && !selectedTeam) {
      setError('Choisissez une equipe');
      return;
    }

    setJoining(true);
    setError('');

    try {
      const { data } = await api.post(`/events/${event.id}/join`, {
        name: name.trim(),
        teamId: selectedTeam || undefined,
      });

      const selectedTeamObj = teams.find(t => t.id === selectedTeam);

      saveParticipant({
        id: data.id,
        name: data.name,
        eventId: event.id,
        eventCode: event.code,
        eventName: event.name,
        teamId: data.teamId || undefined,
        teamName: selectedTeamObj?.name || undefined,
      });
      router.push(`/event/${event.id}`);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Impossible de rejoindre');
    } finally {
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <p style={{ color: 'var(--rp-text-muted)', fontSize: 16 }}>Chargement...</p>
      </div>
    );
  }

  if (eventError) {
    return (
      <div className="page-container" style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
        <div className="card fade-in" style={{ textAlign: 'center', padding: '2rem', width: '100%' }}>
          <div style={{ marginBottom: 12 }}><IconSad size={40} color="var(--rp-text-muted)" /></div>
          <h2 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 22,
            fontWeight: 700,
            marginBottom: 8,
          }}>
            Oups !
          </h2>
          <p style={{ color: 'var(--rp-text-muted)', fontSize: 15, marginBottom: 24 }}>
            {eventError}
          </p>
          <button className="btn-secondary" onClick={() => router.push('/')}>
            Reessayer avec un autre code
          </button>
        </div>
      </div>
    );
  }

  if (!event) return null;

  const isPastDeadline = event.deadline ? new Date(event.deadline) < new Date() : false;

  return (
    <div className="page-container" style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ width: '100%' }} className="fade-in">
        {/* Event info */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <span className="badge badge-pink" style={{ marginBottom: 12, display: 'inline-block' }}>
            {event.code}
          </span>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            marginBottom: 8,
          }}>
            {event.name}
          </h1>
          {event.description && (
            <p style={{ color: 'var(--rp-text-secondary)', fontSize: 15, lineHeight: 1.5 }}>
              {event.description}
            </p>
          )}
        </div>

        {isPastDeadline ? (
          <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
            <div style={{ marginBottom: 8 }}><IconAlarm size={36} color="var(--rp-text-muted)" /></div>
            <p style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>Deadline depassee</p>
            <p style={{ color: 'var(--rp-text-muted)', fontSize: 14 }}>
              Cet evenement n&apos;accepte plus de nouveaux participants
            </p>
          </div>
        ) : (
          <div className="card" style={{ padding: '2rem' }}>
            <p style={{
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--rp-text-secondary)',
              marginBottom: 16,
              textAlign: 'center',
            }}>
              Quel est votre prenom ?
            </p>

            <form onSubmit={handleJoin}>
              <input
                type="text"
                className="input-field"
                placeholder="Votre prenom"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError('');
                }}
                maxLength={30}
                autoComplete="given-name"
                autoFocus
                style={{ marginBottom: 16, textAlign: 'center', fontSize: 18 }}
              />

              {/* Team selection */}
              {event.team_mode && teams.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <p style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--rp-text-secondary)',
                    marginBottom: 10,
                    textAlign: 'center',
                  }}>
                    Choisissez votre equipe
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {teams.map((team) => (
                      <button
                        key={team.id}
                        type="button"
                        onClick={() => { setSelectedTeam(team.id); setError(''); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '12px 16px', borderRadius: 12, cursor: 'pointer',
                          border: selectedTeam === team.id ? `2px solid ${team.color}` : '1.5px solid var(--rp-border)',
                          background: selectedTeam === team.id ? `${team.color}15` : 'var(--rp-bg-card)',
                          transition: 'all 0.15s',
                        }}
                      >
                        <div style={{
                          width: 32, height: 32, borderRadius: '50%',
                          background: team.color,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#fff', fontWeight: 700, fontSize: 14,
                        }}>
                          {team.name.charAt(0).toUpperCase()}
                        </div>
                        <div style={{ flex: 1, textAlign: 'left' }}>
                          <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--rp-text-primary)' }}>{team.name}</p>
                          <p style={{ fontSize: 12, color: 'var(--rp-text-muted)' }}>{team.member_count} membre{team.member_count > 1 ? 's' : ''}</p>
                        </div>
                        {selectedTeam === team.id && (
                          <div style={{
                            width: 22, height: 22, borderRadius: '50%',
                            background: team.color,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <p style={{
                  color: 'var(--rp-red)',
                  fontSize: 14,
                  textAlign: 'center',
                  marginBottom: 12,
                }}>
                  {error}
                </p>
              )}

              <button
                type="submit"
                className="btn-primary"
                disabled={joining || !name.trim()}
              >
                {joining ? 'Connexion...' : 'C\'est parti !'}
              </button>
            </form>
          </div>
        )}

        {/* Back link */}
        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <button className="btn-ghost" onClick={() => router.push('/')} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <IconArrowLeft size={14} /> Autre code
          </button>
        </div>
      </div>
    </div>
  );
}
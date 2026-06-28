'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import api from '@/lib/api';
import { getParticipant } from '@/lib/participant';
import { IconTrophy } from '@/lib/icons';
import { io } from 'socket.io-client';

interface LeaderboardEntry {
  rank: number;
  id: string;
  name: string;
  teamName: string | null;
  teamColor: string | null;
  totalPoints: number;
  totalSubmissions: number;
  wins: number;
}

interface TeamGroup {
  name: string;
  color: string;
  totalPoints: number;
  members: LeaderboardEntry[];
}

export default function LeaderboardPage() {
  const params = useParams();
  const eventId = params.id as string;

  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [participantId, setParticipantId] = useState('');
  const [hasTeams, setHasTeams] = useState(false);

  useEffect(() => {
    const p = getParticipant(eventId);
    if (p) setParticipantId(p.id);
  }, [eventId]);

  // audit: LOW-066/LOW-067 — ref vers la derniere version de loadLeaderboard
  // pour decoupler le useEffect socket (stable sur [eventId]).
  const loadLeaderboardRef = useRef<() => void>(() => {});

  const loadLeaderboard = useCallback(async () => {
    try {
      const p = getParticipant(eventId);
      const headers = p?.participantToken ? { Authorization: `Bearer ${p.participantToken}` } : {};
      const { data } = await api.get(`/events/${eventId}/leaderboard`, { headers });
      setLeaderboard(data);
      setHasTeams(data.some((e: LeaderboardEntry) => e.teamName));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    loadLeaderboardRef.current = loadLeaderboard;
  }, [loadLeaderboard]);

  useEffect(() => {
    loadLeaderboard();
  }, [loadLeaderboard]);

  useEffect(() => {
    // audit: MED-013 — envoyer le token participant au handshake si disponible.
    const participant = getParticipant(eventId) as ({ participantToken?: string } | null);
    const socket = io(process.env.NEXT_PUBLIC_API_URL || 'https://api.rallye-photo.com', {
      transports: ['websocket', 'polling'],
      auth: participant?.participantToken ? { token: participant.participantToken } : undefined,
    });

    socket.on('connect', () => { socket.emit('join-event', eventId); });
    socket.on('leaderboard-updated', () => loadLeaderboardRef.current());
    socket.on('winner-selected', () => loadLeaderboardRef.current());
    socket.on('new-submission', () => loadLeaderboardRef.current());

    return () => {
      socket.emit('leave-event', eventId);
      socket.disconnect();
    };
    // audit: LOW-067 — dependances reduites a [eventId] pour une connexion stable.
  }, [eventId]);

  // Group by teams
  const getTeamGroups = (): TeamGroup[] => {
    const teamMap = new Map<string, TeamGroup>();

    for (const entry of leaderboard) {
      if (entry.teamName) {
        const key = entry.teamName;
        if (!teamMap.has(key)) {
          teamMap.set(key, { name: entry.teamName, color: entry.teamColor || '#e91e8c', totalPoints: 0, members: [] });
        }
        const group = teamMap.get(key)!;
        group.totalPoints += entry.totalPoints;
        group.members.push(entry);
      }
    }

    return Array.from(teamMap.values()).sort((a, b) => b.totalPoints - a.totalPoints);
  };

  const soloPlayers = leaderboard.filter(e => !e.teamName);

  const getRankClass = (rank: number) => {
    if (rank === 1) return 'rank-1';
    if (rank === 2) return 'rank-2';
    if (rank === 3) return 'rank-3';
    return 'rank-other';
  };

  return (
    <div className="page-container page-with-nav fade-in">
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          marginBottom: 4,
        }}>
          <span style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 6 }}><IconTrophy size={22} color="var(--rp-gold)" /></span>Classement
        </h1>
        <p style={{ fontSize: 13, color: 'var(--rp-text-muted)' }}>En temps reel</p>
      </div>

      {loading ? (
        <p style={{ textAlign: 'center', color: 'var(--rp-text-muted)' }}>Chargement...</p>
      ) : leaderboard.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
          <div style={{ marginBottom: 8 }}><IconTrophy size={36} color="var(--rp-text-muted)" /></div>
          <p style={{ color: 'var(--rp-text-muted)', fontSize: 15 }}>Aucun classement pour le moment</p>
        </div>
      ) : hasTeams ? (
        /* ===== TEAM LEADERBOARD ===== */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {getTeamGroups().map((team, teamIndex) => (
            <div key={team.name} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {/* Team header */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '14px 18px',
                background: `${team.color}18`,
                borderBottom: `2px solid ${team.color}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: team.color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontWeight: 800, fontSize: 16,
                  }}>
                    {teamIndex + 1}
                  </div>
                  <div>
                    <p style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, color: 'var(--rp-text-primary)' }}>
                      {team.name}
                    </p>
                    <p style={{ fontSize: 12, color: 'var(--rp-text-muted)' }}>
                      {team.members.length} membre{team.members.length > 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 24, fontWeight: 800,
                    color: team.color,
                  }}>
                    {team.totalPoints}
                  </p>
                  <p style={{ fontSize: 10, color: 'var(--rp-text-muted)' }}>pts</p>
                </div>
              </div>

              {/* Team members */}
              <div style={{ padding: '8px 12px' }}>
                {team.members
                  .sort((a, b) => b.totalPoints - a.totalPoints)
                  .map((entry) => {
                    const isMe = entry.id === participantId;
                    return (
                      <div key={entry.id} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 8px',
                        borderRadius: 10,
                        background: isMe ? 'var(--rp-pink-light)' : undefined,
                        marginBottom: 2,
                      }}>
                        <div style={{ flex: 1 }}>
                          <p style={{
                            fontSize: 14,
                            fontWeight: isMe ? 700 : 500,
                            color: isMe ? 'var(--rp-pink)' : 'var(--rp-text)',
                          }}>
                            {entry.name} {isMe && '(vous)'}
                          </p>
                          <p style={{ fontSize: 11, color: 'var(--rp-text-muted)' }}>
                            {entry.totalSubmissions} photo{entry.totalSubmissions > 1 ? 's' : ''}
                            {entry.wins > 0 && ` \u00B7 ${entry.wins} victoire${entry.wins > 1 ? 's' : ''}`}
                          </p>
                        </div>
                        <p style={{
                          fontFamily: 'var(--font-display)',
                          fontSize: 16, fontWeight: 700,
                          color: entry.totalPoints > 0 ? 'var(--rp-blue)' : 'var(--rp-text-muted)',
                        }}>
                          {entry.totalPoints} <span style={{ fontSize: 10, fontWeight: 400 }}>pts</span>
                        </p>
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}

          {/* Solo players (no team) */}
          {soloPlayers.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{
                padding: '12px 18px',
                borderBottom: '1px solid var(--rp-border)',
              }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--rp-text-muted)' }}>Sans equipe</p>
              </div>
              <div style={{ padding: '8px 12px' }}>
                {soloPlayers.map((entry) => {
                  const isMe = entry.id === participantId;
                  return (
                    <div key={entry.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 8px', borderRadius: 10,
                      background: isMe ? 'var(--rp-pink-light)' : undefined,
                      marginBottom: 2,
                    }}>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: 14, fontWeight: isMe ? 700 : 500, color: isMe ? 'var(--rp-pink)' : 'var(--rp-text)' }}>
                          {entry.name} {isMe && '(vous)'}
                        </p>
                        <p style={{ fontSize: 11, color: 'var(--rp-text-muted)' }}>
                          {entry.totalSubmissions} photo{entry.totalSubmissions > 1 ? 's' : ''}
                        </p>
                      </div>
                      <p style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: entry.totalPoints > 0 ? 'var(--rp-blue)' : 'var(--rp-text-muted)' }}>
                        {entry.totalPoints} <span style={{ fontSize: 10, fontWeight: 400 }}>pts</span>
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ===== CLASSIC LEADERBOARD (no teams) ===== */
        <div className="card" style={{ padding: '0.5rem' }}>
          {leaderboard.map((entry) => {
            const isMe = entry.id === participantId;
            return (
              <div
                key={entry.id}
                className="leaderboard-row"
                style={{
                  background: isMe ? 'var(--rp-pink-light)' : undefined,
                  border: isMe ? '1.5px solid var(--rp-pink)' : '1.5px solid transparent',
                  borderRadius: 16,
                }}
              >
                <div className={`rank-badge ${getRankClass(entry.rank)}`} style={{ fontSize: entry.rank <= 3 ? 18 : 14 }}>
                  {entry.rank}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontWeight: isMe ? 700 : 500, fontSize: 15, color: isMe ? 'var(--rp-pink)' : 'var(--rp-text)' }}>
                    {entry.name} {isMe && '(vous)'}
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--rp-text-muted)' }}>
                    {entry.totalSubmissions} photo{entry.totalSubmissions > 1 ? 's' : ''}
                    {entry.wins > 0 && ` \u00B7 ${entry.wins} victoire${entry.wins > 1 ? 's' : ''}`}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: entry.totalPoints > 0 ? 'var(--rp-blue)' : 'var(--rp-text-muted)' }}>
                    {entry.totalPoints}
                  </p>
                  <p style={{ fontSize: 10, color: 'var(--rp-text-muted)' }}>pts</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
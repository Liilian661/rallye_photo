'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import api from '@/lib/api';
import { getParticipant } from '@/lib/participant';
import { IconSparkles, IconParty, IconTrophy } from '@/lib/icons';
import { io } from 'socket.io-client';

interface Challenge {
  id: string;
  title: string;
  points: number;
  status: string;
}

interface Submission {
  id: string;
  challenge_id: string;
  participant_id: string;
  participant_name: string;
  challenge_title: string;
  is_winner: boolean;
}

// audit: INFO-018 — suppression du champ mort justRevealed (jamais lu)
interface RevealedWinner {
  challengeTitle: string;
  winnerName: string;
  points: number;
  isMe: boolean;
}

export default function ResultsPage() {
  const params = useParams();
  const eventId = params.id as string;

  const [winners, setWinners] = useState<RevealedWinner[]>([]);
  const [loading, setLoading] = useState(true);
  const [participantId, setParticipantId] = useState('');
  const [newReveal, setNewReveal] = useState<RevealedWinner | null>(null);

  // audit: LOW-067 — refs stables pour decoupler le useEffect socket de
  // participantId / loadResults : la connexion ne doit pas se reconstruire
  // a chaque changement de participantId (qui passe de '' a sa vraie valeur).
  const participantIdRef = useRef('');
  const loadResultsRef = useRef<() => void>(() => {});

  useEffect(() => {
    const p = getParticipant(eventId);
    if (p) {
      setParticipantId(p.id);
      participantIdRef.current = p.id;
    }
  }, [eventId]);

  const loadResults = useCallback(async () => {
    try {
      const [challengesRes, submissionsRes] = await Promise.all([
        api.get(`/events/${eventId}/challenges`),
        api.get(`/events/${eventId}/submissions`),
      ]);

      const challenges: Challenge[] = challengesRes.data;
      const allSubmissions: Submission[] = submissionsRes.data;

      const revealedWinners: RevealedWinner[] = challenges
        .filter(c => c.status === 'judged' || allSubmissions.some(
          s => s.challenge_id === c.id && s.is_winner
        ))
        .map(c => {
          const winnerSub = allSubmissions.find(
            s => s.challenge_id === c.id && s.is_winner
          );
          return {
            challengeTitle: c.title,
            winnerName: winnerSub?.participant_name || '???',
            points: c.points,
            isMe: winnerSub?.participant_id === participantId,
          };
        })
        .filter(w => w.winnerName !== '???');

      setWinners(revealedWinners);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [eventId, participantId]);

  // audit: LOW-067 — garder la derniere version de loadResults dans une ref
  // pour que le useEffect socket (stable sur [eventId]) appelle toujours la
  // closure courante sans se re-souscrire.
  useEffect(() => {
    loadResultsRef.current = loadResults;
  }, [loadResults]);

  useEffect(() => {
    if (participantId) loadResults();
  }, [participantId, loadResults]);

  // WebSocket for live reveal
  useEffect(() => {
    // audit: MED-013 — envoyer le token participant au handshake socket si
    // disponible (mode degrade cote serveur si absent). Le champ participantToken
    // est pose par le flux de join (cf unite participant).
    const participant = getParticipant(eventId) as ({ participantToken?: string } | null);
    const socket = io(process.env.NEXT_PUBLIC_API_URL || 'https://api.rallye-photo.com', {
      transports: ['websocket', 'polling'],
      auth: participant?.participantToken ? { token: participant.participantToken } : undefined,
    });

    socket.on('connect', () => {
      socket.emit('join-event', eventId);
    });

    socket.on('winner-revealed', (data: any) => {
      const revealed: RevealedWinner = {
        challengeTitle: data.challengeTitle || 'Défi',
        // audit: INFO-018 — harmonisation du fallback : pas de winnerName affichable -> nom neutre
        winnerName: data.winnerName || 'Gagnant',
        points: data.points || 0,
        // audit: LOW-067 — lire participantId via ref (connexion stable)
        isMe: data.participantId === participantIdRef.current,
      };
      setNewReveal(revealed);
      setTimeout(() => {
        setNewReveal(null);
        loadResultsRef.current();
      }, 5000);
    });

    socket.on('winner-selected', () => loadResultsRef.current());

    return () => {
      socket.emit('leave-event', eventId);
      socket.disconnect();
    };
    // audit: LOW-067 — dependances reduites a [eventId] : plus de
    // reconnexion a chaque changement de participantId / loadResults.
  }, [eventId]);

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
          <span style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 6 }}><IconSparkles size={22} /></span>Resultats
        </h1>
        <p style={{ fontSize: 13, color: 'var(--rp-text-muted)' }}>
          Les gagnants de chaque défi
        </p>
      </div>

      {/* Live reveal overlay */}
      {newReveal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'var(--rp-bg-overlay)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 200,
          padding: '1.5rem',
        }}>
          <div className="reveal-card reveal-animate" style={{ width: '100%', maxWidth: 360 }}>
            <div style={{ marginBottom: 12 }}>
              <IconParty size={48} color={newReveal.isMe ? 'var(--rp-pink)' : 'var(--rp-blue)'} />
            </div>
            <p style={{
              fontSize: 13,
              color: 'var(--rp-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              fontWeight: 600,
              marginBottom: 8,
            }}>
              {newReveal.challengeTitle}
            </p>
            <h2 style={{
              fontFamily: 'var(--font-display)',
              fontSize: 28,
              fontWeight: 700,
              color: newReveal.isMe ? 'var(--rp-pink)' : 'var(--rp-text)',
              marginBottom: 8,
            }}>
              {newReveal.isMe ? 'Vous avez gagné !' : newReveal.winnerName}
            </h2>
            <span className="badge badge-gold" style={{ fontSize: 14, padding: '6px 16px' }}>
              +{newReveal.points} pts
            </span>
          </div>
        </div>
      )}

      {/* Results list */}
      {loading ? (
        <p style={{ textAlign: 'center', color: 'var(--rp-text-muted)' }}>
          Chargement...
        </p>
      ) : winners.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
          <div style={{ marginBottom: 8 }}><IconSparkles size={36} color="var(--rp-text-muted)" /></div>
          <p style={{ color: 'var(--rp-text-muted)', fontSize: 15, marginBottom: 4 }}>
            Pas encore de résultats
          </p>
          <p style={{ color: 'var(--rp-text-muted)', fontSize: 13 }}>
            Les gagnants seront révélés ici en direct !
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {winners.map((winner) => (
            <div
              // audit: LOW-068 — cle stable (titre du defi) au lieu de l'index,
              // pour eviter les reconciliations incorrectes lors des reveals live.
              key={winner.challengeTitle}
              className="card"
              style={{
                borderColor: winner.isMe ? 'var(--rp-pink)' : 'var(--rp-border)',
                background: winner.isMe ? 'var(--rp-pink-light)' : 'var(--rp-bg-card)',
              }}
            >
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <div>
                  <p style={{
                    fontSize: 12,
                    color: 'var(--rp-text-muted)',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: 4,
                  }}>
                    {winner.challengeTitle}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ display: 'flex', alignItems: 'center' }}><IconTrophy size={20} color="var(--rp-gold)" /></span>
                    <p style={{
                      fontSize: 17,
                      fontWeight: 700,
                      fontFamily: 'var(--font-display)',
                      color: winner.isMe ? 'var(--rp-pink)' : 'var(--rp-text)',
                    }}>
                      {winner.winnerName}
                      {winner.isMe && ' (vous !)'}
                    </p>
                  </div>
                </div>
                <span className="badge badge-gold">
                  +{winner.points} pts
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

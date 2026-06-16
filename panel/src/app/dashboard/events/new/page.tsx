'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { templates, Template } from '@/lib/templates';
import { useAuth } from '@/lib/auth';

export default function NewEventPage() {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [hasDeadline, setHasDeadline] = useState(true);
  const [deadline, setDeadline] = useState('');
  const [scoringMode, setScoringMode] = useState<'winner' | 'participation'>('winner');
  const [teamMode, setTeamMode] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { refreshUser } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const deadlineUTC = hasDeadline && deadline ? new Date(deadline).toISOString() : null;
      const eventDateUTC = eventDate ? new Date(eventDate + 'T00:00:00').toISOString() : null;

      const { data } = await api.post('/events', {
        name,
        description: description || null,
        eventDate: eventDateUTC,
        deadline: deadlineUTC,
        scoringMode,
        teamMode,
      });

      // audit: MED-024 — creer les defis du template en parallele (Promise.allSettled) et
      // remonter explicitement les echecs a l'organisateur au lieu de les avaler en console.error.
      if (selectedTemplate) {
        const template = templates.find(t => t.id === selectedTemplate);
        if (template && template.challenges.length > 0) {
          const results = await Promise.allSettled(
            template.challenges.map((challenge) =>
              api.post(`/events/${data.id}/challenges`, {
                title: challenge.title,
                description: challenge.description || null,
                points: challenge.points,
                isSurprise: false,
              })
            )
          );
          const failed = results.filter((r) => r.status === 'rejected').length;
          if (failed > 0) {
            // L'event est cree ; on previent que certains defis n'ont pas pu etre ajoutes
            // (l'organisateur pourra les ajouter manuellement sur la page de l'event).
            setError(
              `Evenement cree, mais ${failed} defi(s) du template n'ont pas pu etre ajoutes. ` +
                `Vous pourrez les creer manuellement.`
            );
            await refreshUser();
            setLoading(false);
            router.push(`/dashboard/events/${data.id}`);
            return;
          }
        }
      }

      await refreshUser(); // met à jour les crédits dans la sidebar
      router.push(`/dashboard/events/${data.id}`);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur lors de la création');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 560 }} className="fade-in">
      <h2 style={{
        fontFamily: 'var(--font-display)',
        fontSize: 28,
        fontWeight: 700,
        letterSpacing: '-0.02em',
        marginBottom: '2rem',
        color: 'var(--rp-text-primary)',
      }}>
        Nouvel événement
      </h2>

      <div className="card" style={{ padding: '2rem' }}>
        <form onSubmit={handleSubmit}>
          {error && (
            <div className="alert-error" style={{ marginBottom: '1rem' }}>
              {error}
            </div>
          )}

          <div style={{ marginBottom: '1rem' }}>
            <label style={{
              display: 'block',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--rp-text-secondary)',
              marginBottom: 6,
            }}>
              Nom de l&apos;événement *
            </label>
            <input
              type="text"
              className="input-field"
              placeholder="Ex: Mariage de Sophie & Thomas"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={{
              display: 'block',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--rp-text-secondary)',
              marginBottom: 6,
            }}>
              Description (optionnel)
            </label>
            <textarea
              className="input-field"
              placeholder="Décrivez votre événement..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              style={{ resize: 'vertical' }}
            />
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <div style={{ flex: 1 }}>
              <label style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--rp-text-secondary)',
                marginBottom: 6,
              }}>
                Date de l&apos;événement
              </label>
              <input
                type="date"
                className="input-field"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--rp-text-secondary)',
                marginBottom: 6,
              }}>
                Deadline des photos
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <input
                  type="checkbox"
                  id="hasDeadline"
                  checked={hasDeadline}
                  onChange={(e) => setHasDeadline(e.target.checked)}
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                />
                <label htmlFor="hasDeadline" style={{ fontSize: 12, color: 'var(--rp-text-muted)', cursor: 'pointer' }}>
                  Definir une deadline
                </label>
              </div>
              {hasDeadline && (
                <input
                  type="datetime-local"
                  className="input-field"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  required
                />
              )}
            </div>
          </div>

          {/* Team mode */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '14px 16px', borderRadius: 10, cursor: 'pointer',
              border: teamMode ? '2px solid var(--rp-accent)' : '1.5px solid var(--rp-border)',
              background: teamMode ? 'var(--rp-accent-light, rgba(var(--rp-accent-rgb, 99,102,241), 0.08))' : 'var(--rp-bg-card)',
            }}>
              <input
                type="checkbox"
                checked={teamMode}
                onChange={(e) => setTeamMode(e.target.checked)}
                style={{ width: 18, height: 18, cursor: 'pointer' }}
              />
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--rp-text-primary)' }}>Mode equipes</p>
                <p style={{ fontSize: 11, color: 'var(--rp-text-muted)', marginTop: 2 }}>Les participants rejoignent une equipe. Le classement est par equipe.</p>
              </div>
            </label>
          </div>

          {/* Template selector */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{
              display: 'block',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--rp-text-secondary)',
              marginBottom: 10,
            }}>
              Template de defis (optionnel)
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedTemplate(selectedTemplate === t.id ? null : t.id)}
                  style={{
                    padding: '14px 12px',
                    borderRadius: 10,
                    cursor: 'pointer',
                    textAlign: 'center',
                    border: selectedTemplate === t.id ? '2px solid var(--rp-accent)' : '1.5px solid var(--rp-border)',
                    background: selectedTemplate === t.id ? 'var(--rp-accent-light, rgba(var(--rp-accent-rgb, 99,102,241), 0.08))' : 'var(--rp-bg-card)',
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ fontSize: 28, marginBottom: 6 }}>{t.emoji}</div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--rp-text-primary)', marginBottom: 2 }}>{t.name}</p>
                  <p style={{ fontSize: 11, color: 'var(--rp-text-muted)' }}>{t.challenges.length} defis</p>
                </button>
              ))}
            </div>
            {selectedTemplate && (
              <div style={{
                marginTop: 10, padding: '10px 14px', borderRadius: 8,
                background: 'var(--rp-bg-secondary, #f8f9fa)',
                border: '1px solid var(--rp-border)',
                maxHeight: 160, overflowY: 'auto',
              }}>
                <p style={{ fontSize: 11, color: 'var(--rp-text-muted)', marginBottom: 6 }}>
                  Defis inclus :
                </p>
                {templates.find(t => t.id === selectedTemplate)?.challenges.map((c, i) => (
                  <p key={i} style={{ fontSize: 12, color: 'var(--rp-text-secondary)', padding: '2px 0' }}>
                    {c.title} — <span style={{ color: 'var(--rp-accent)', fontWeight: 600 }}>{c.points} pts</span>
                  </p>
                ))}
              </div>
            )}
          </div>

          {/* Scoring mode */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{
              display: 'block',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--rp-text-secondary)',
              marginBottom: 10,
            }}>
              Mode de scoring
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                border: scoringMode === 'winner' ? '2px solid var(--rp-accent)' : '1.5px solid var(--rp-border)',
                background: scoringMode === 'winner' ? 'var(--rp-accent-light, rgba(var(--rp-accent-rgb, 99,102,241), 0.08))' : 'var(--rp-bg-card)',
              }}>
                <input
                  type="radio"
                  name="scoringMode"
                  value="winner"
                  checked={scoringMode === 'winner'}
                  onChange={() => setScoringMode('winner')}
                  style={{ marginTop: 2 }}
                />
                <div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--rp-text-primary)' }}>Competitif - 1 gagnant par defi</p>
                  <p style={{ fontSize: 11, color: 'var(--rp-text-muted)', marginTop: 2 }}>L&apos;organisateur ou le vote du public designe un gagnant qui remporte les points</p>
                </div>
              </label>
              <label style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                border: scoringMode === 'participation' ? '2px solid var(--rp-accent)' : '1.5px solid var(--rp-border)',
                background: scoringMode === 'participation' ? 'var(--rp-accent-light, rgba(var(--rp-accent-rgb, 99,102,241), 0.08))' : 'var(--rp-bg-card)',
              }}>
                <input
                  type="radio"
                  name="scoringMode"
                  value="participation"
                  checked={scoringMode === 'participation'}
                  onChange={() => setScoringMode('participation')}
                  style={{ marginTop: 2 }}
                />
                <div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--rp-text-primary)' }}>Participation - photo = points</p>
                  <p style={{ fontSize: 11, color: 'var(--rp-text-muted)', marginTop: 2 }}>Chaque participant qui soumet une photo gagne automatiquement les points du defi</p>
                </div>
              </label>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <button
              type="submit"
              className="btn-gradient"
              disabled={loading}
            >
              {loading ? (selectedTemplate ? 'Creation des defis...' : 'Creation...') : 'Creer l\'evenement'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => router.back()}
            >
              Annuler
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
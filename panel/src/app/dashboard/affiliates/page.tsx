'use client';

import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

interface AffiliateStats {
  totalReferred: number;
  converted: number;
  rewarded: number;
}

interface Referral {
  first_name: string;
  last_name: string;
  status: string;
  created_at: string;
  converted_at: string | null;
}

interface AffiliateData {
  referralCode: string;
  referralLink: string;
  stats: AffiliateStats;
  referrals: Referral[];
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:   { label: 'En attente',  color: 'var(--rp-text-muted)' },
  converted: { label: 'Converti',    color: '#f59e0b' },
  rewarded:  { label: 'Récompensé', color: 'var(--rp-accent)' },
};

export default function AffiliatesPage() {
  const [data, setData] = useState<AffiliateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [editingCode, setEditingCode] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [codeSaving, setCodeSaving] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const { data: d } = await api.get('/affiliates/me');
      setData(d);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const copyLink = () => {
    if (!data) return;
    navigator.clipboard.writeText(data.referralLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const startEditCode = () => {
    setNewCode(data?.referralCode || '');
    setCodeError('');
    setEditingCode(true);
  };

  const saveCode = async () => {
    const clean = newCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.length < 4 || clean.length > 8) {
      setCodeError('Entre 4 et 8 caractères alphanumériques');
      return;
    }
    setCodeSaving(true);
    setCodeError('');
    try {
      const { data: result } = await api.patch('/affiliates/me/code', { code: clean });
      setData((prev) => prev ? {
        ...prev,
        referralCode: result.referralCode,
        referralLink: prev.referralLink.replace(/ref=[^&]+/, `ref=${result.referralCode}`),
      } : prev);
      setEditingCode(false);
    } catch (err: any) {
      setCodeError(err.response?.data?.error || 'Erreur lors de la sauvegarde');
    } finally {
      setCodeSaving(false);
    }
  };

  if (loading) return <p style={{ color: 'var(--rp-text-muted)', padding: '2rem 0' }}>Chargement...</p>;
  if (!data)   return <p style={{ color: 'var(--rp-text-muted)', padding: '2rem 0' }}>Erreur de chargement.</p>;

  return (
    <div className="fade-in" style={{ maxWidth: 640 }}>
      <h2 style={{
        fontFamily: 'var(--font-display)',
        fontSize: 28,
        fontWeight: 700,
        letterSpacing: '-0.02em',
        marginBottom: 6,
        color: 'var(--rp-text-primary)',
      }}>
        Programme d&apos;affiliation
      </h2>
      <p style={{ fontSize: 14, color: 'var(--rp-text-muted)', marginBottom: '1.5rem' }}>
        Invitez vos amis et collègues — ils découvrent Rallye Photo, vous serez récompensé dès que Stripe sera activé.
      </p>

      {/* Referral link */}
      <div className="card" style={{ padding: '1.5rem', marginBottom: 16 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--rp-text-muted)', marginBottom: 10 }}>
          Votre lien d&apos;invitation
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{
            flex: 1,
            background: 'var(--rp-bg)',
            border: '1.5px solid var(--rp-border)',
            borderRadius: 10,
            padding: '10px 14px',
            fontSize: 13,
            color: 'var(--rp-text-secondary)',
            fontFamily: 'monospace',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {data.referralLink}
          </div>
          <button
            className={copied ? 'btn-primary' : 'btn-gradient'}
            style={{ flexShrink: 0, padding: '10px 18px', fontSize: 13 }}
            onClick={copyLink}
          >
            {copied ? '✓ Copié' : 'Copier'}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--rp-text-muted)' }}>Code :</span>
          {editingCode ? (
            <>
              <input
                value={newCode}
                onChange={(e) => setNewCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
                placeholder="4-8 caractères"
                autoFocus
                style={{
                  fontFamily: 'monospace', fontSize: 14, fontWeight: 700,
                  color: 'var(--rp-accent)', background: 'var(--rp-bg)',
                  border: '1.5px solid var(--rp-accent)', borderRadius: 6,
                  padding: '2px 8px', width: 110, outline: 'none',
                }}
              />
              <button
                onClick={saveCode}
                disabled={codeSaving}
                className="btn-primary"
                style={{ fontSize: 12, padding: '3px 12px' }}
              >
                {codeSaving ? '…' : 'OK'}
              </button>
              <button
                onClick={() => setEditingCode(false)}
                className="btn-ghost"
                style={{ fontSize: 12, padding: '3px 8px' }}
              >
                Annuler
              </button>
            </>
          ) : (
            <>
              <span style={{ fontWeight: 700, color: 'var(--rp-accent)', fontFamily: 'monospace', fontSize: 14 }}>
                {data.referralCode}
              </span>
              <button
                onClick={startEditCode}
                className="btn-ghost"
                style={{ fontSize: 11, padding: '2px 8px' }}
              >
                Modifier
              </button>
            </>
          )}
        </div>
        {codeError && (
          <p style={{ fontSize: 11, color: 'var(--rp-danger-text)', marginTop: 4 }}>{codeError}</p>
        )}
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <div className="card" style={{ textAlign: 'center', padding: '1.2rem 1rem' }}>
          <p style={{ fontSize: 28, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--rp-text-primary)', marginBottom: 4 }}>
            {data.stats.totalReferred}
          </p>
          <p style={{ fontSize: 12, color: 'var(--rp-text-muted)' }}>Invités</p>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: '1.2rem 1rem' }}>
          <p style={{ fontSize: 28, fontWeight: 700, fontFamily: 'var(--font-display)', color: '#f59e0b', marginBottom: 4 }}>
            {data.stats.converted}
          </p>
          <p style={{ fontSize: 12, color: 'var(--rp-text-muted)' }}>Convertis</p>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: '1.2rem 1rem' }}>
          <p style={{ fontSize: 28, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--rp-accent)', marginBottom: 4 }}>
            {data.stats.rewarded}
          </p>
          <p style={{ fontSize: 12, color: 'var(--rp-text-muted)' }}>Récompensés</p>
        </div>
      </div>

      {/* How it works */}
      <div className="card" style={{ padding: '1.5rem', marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--rp-text-primary)', marginBottom: 14 }}>
          Comment ça marche ?
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { n: '1', text: 'Partagez votre lien ou votre code à vos amis' },
            { n: '2', text: "Ils s'inscrivent et créent leur compte" },
            { n: '3', text: 'Quand ils réalisent leur premier achat, vous êtes récompensé (1 crédit event)' },
          ].map(({ n, text }) => (
            <div key={n} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{
                flexShrink: 0,
                width: 26, height: 26, borderRadius: '50%',
                background: 'var(--rp-accent)', color: 'var(--rp-accent-text)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700,
              }}>
                {n}
              </div>
              <p style={{ fontSize: 13, color: 'var(--rp-text-secondary)', lineHeight: 1.5, paddingTop: 4 }}>{text}</p>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 11, color: 'var(--rp-text-muted)', marginTop: 14 }}>
          Les récompenses seront activées automatiquement dès l&apos;intégration Stripe.
        </p>
      </div>

      {/* Referral list */}
      {data.referrals.length > 0 && (
        <div className="card" style={{ padding: '1.5rem' }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--rp-text-primary)', marginBottom: 14 }}>
            Vos invités ({data.referrals.length})
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.referrals.map((r, i) => {
              const st = STATUS_LABELS[r.status] ?? STATUS_LABELS.pending;
              // audit: LOW-068 — cle stable (created_at + nom) plutot que l'index, pour eviter
              // des reconciliations React incorrectes quand l'ordre change (referral converti remonte).
              const key = `${r.created_at}-${r.first_name}-${r.last_name}-${i}`;
              return (
                <div key={key} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: 'var(--rp-bg)',
                }}>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--rp-text-primary)' }}>
                      {r.first_name} {r.last_name}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--rp-text-muted)' }}>
                      {new Date(r.created_at).toLocaleDateString('fr-FR')}
                    </p>
                  </div>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '3px 10px',
                    borderRadius: 50, border: `1px solid ${st.color}`, color: st.color,
                  }}>
                    {st.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

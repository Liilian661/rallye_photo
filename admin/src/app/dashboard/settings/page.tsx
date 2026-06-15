'use client';

import { useState, useEffect } from 'react';
import api from '@/lib/api';

interface S3Config {
  configured: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const [endpoint, setEndpoint] = useState('');
  const [region, setRegion] = useState('');
  const [bucket, setBucket] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [isConfigured, setIsConfigured] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const { data } = await api.get<S3Config>('/admin/settings/s3');
      setEndpoint(data.endpoint);
      setRegion(data.region);
      setBucket(data.bucket);
      setIsConfigured(data.configured);
      setAccessKey('');
      setSecretKey('');
    } catch {
      // Pas de config existante
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setTestResult(null);
    setSaving(true);

    try {
      await api.put('/admin/settings/s3', {
        endpoint,
        region,
        bucket,
        accessKey,
        secretKey,
      });
      setMessage({ type: 'success', text: 'Configuration S3 sauvegardee' });
      setIsConfigured(true);
      setAccessKey('');
      setSecretKey('');
    } catch (err: any) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Erreur lors de la sauvegarde' });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTestResult(null);
    setTesting(true);

    try {
      const { data } = await api.post('/admin/settings/s3/test');
      setTestResult(data);
    } catch (err: any) {
      setTestResult({ success: false, message: err.response?.data?.message || 'Erreur lors du test' });
    } finally {
      setTesting(false);
    }
  };

  if (loading) return <p style={{ color: 'var(--rp-text-muted)' }}>Chargement...</p>;

  return (
    <div className="fade-in" style={{ maxWidth: 640 }}>
      <h2 style={{
        fontFamily: 'var(--font-display)',
        fontSize: 24,
        fontWeight: 700,
        marginBottom: 8,
        color: 'var(--rp-text-primary)',
      }}>
        Settings
      </h2>
      <p style={{ fontSize: 13, color: 'var(--rp-text-muted)', marginBottom: 24 }}>
        Configuration des services externes
      </p>

      {/* S3 Storage */}
      <div className="card" style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              background: 'var(--rp-secondary-light)',
              color: 'var(--rp-secondary-text)',
              padding: '4px 8px',
              borderRadius: 6,
            }}>S3</span>
            <div>
              <h3 style={{
                fontFamily: 'var(--font-display)',
                fontSize: 16,
                fontWeight: 600,
                color: 'var(--rp-text-primary)',
              }}>
                Stockage S3 (IONOS)
              </h3>
              <p style={{ fontSize: 12, color: 'var(--rp-text-muted)', marginTop: 2 }}>
                Stockage des photos des participants
              </p>
            </div>
          </div>
          <span className={`badge ${isConfigured ? 'badge-success' : 'badge-warning'}`}>
            {isConfigured ? 'Configure' : 'Non configure'}
          </span>
        </div>

        {/* Messages */}
        {message && (
          <div style={{
            padding: '10px 14px',
            borderRadius: 10,
            fontSize: 13,
            marginBottom: 16,
            background: message.type === 'success' ? 'var(--rp-success-light)' : 'var(--rp-danger-light)',
            color: message.type === 'success' ? 'var(--rp-success-text)' : 'var(--rp-danger-text)',
          }}>
            {message.text}
          </div>
        )}

        {/* Test result */}
        {testResult && (
          <div style={{
            padding: '10px 14px',
            borderRadius: 10,
            fontSize: 13,
            marginBottom: 16,
            background: testResult.success ? 'var(--rp-success-light)' : 'var(--rp-danger-light)',
            color: testResult.success ? 'var(--rp-success-text)' : 'var(--rp-danger-text)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>{testResult.success ? 'OK' : 'FAIL'}</span>
            {testResult.message}
          </div>
        )}

        <form onSubmit={handleSave}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{
                display: 'block', fontSize: 12, fontWeight: 500,
                color: 'var(--rp-text-secondary)', marginBottom: 6,
              }}>
                Endpoint URL *
              </label>
              <input
                type="url"
                className="input-field"
                placeholder="https://s3.eu-central-1.ionoscloud.com"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                required
              />
            </div>
            <div>
              <label style={{
                display: 'block', fontSize: 12, fontWeight: 500,
                color: 'var(--rp-text-secondary)', marginBottom: 6,
              }}>
                Region *
              </label>
              <input
                type="text"
                className="input-field"
                placeholder="eu-central-1"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                required
              />
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{
              display: 'block', fontSize: 12, fontWeight: 500,
              color: 'var(--rp-text-secondary)', marginBottom: 6,
            }}>
              Nom du bucket *
            </label>
            <input
              type="text"
              className="input-field"
              placeholder="rallye-photo-uploads"
              value={bucket}
              onChange={(e) => setBucket(e.target.value)}
              required
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{
                display: 'block', fontSize: 12, fontWeight: 500,
                color: 'var(--rp-text-secondary)', marginBottom: 6,
              }}>
                Access Key *
              </label>
              <input
                type="text"
                className="input-field"
                placeholder={isConfigured ? 'Deja configure' : 'IONOS Access Key'}
                value={accessKey}
                onChange={(e) => setAccessKey(e.target.value)}
                required={!isConfigured}
                autoComplete="off"
              />
            </div>
            <div>
              <label style={{
                display: 'block', fontSize: 12, fontWeight: 500,
                color: 'var(--rp-text-secondary)', marginBottom: 6,
              }}>
                Secret Key *
              </label>
              <input
                type="password"
                className="input-field"
                placeholder={isConfigured ? 'Deja configure' : 'IONOS Secret Key'}
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                required={!isConfigured}
                autoComplete="off"
              />
            </div>
          </div>

          {isConfigured && (
            <p style={{ fontSize: 11, color: 'var(--rp-text-muted)', marginBottom: 12, fontStyle: 'italic' }}>
              Laissez les cles vides pour garder les credentials actuels. Remplissez les deux pour les remplacer.
            </p>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button
              type="submit"
              className="btn-primary"
              disabled={saving}
            >
              {saving ? 'Sauvegarde...' : 'Sauvegarder'}
            </button>

            {isConfigured && (
              <button
                type="button"
                className="btn-secondary"
                onClick={handleTest}
                disabled={testing}
              >
                {testing ? 'Test en cours...' : 'Tester la connexion'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
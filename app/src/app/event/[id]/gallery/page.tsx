'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import api from '@/lib/api';

interface Photo {
  id: string;
  photo_url: string;
  is_winner: boolean;
  submitted_at: string;
  participant_name: string;
  challenge_title: string;
  challenge_id: string;
}

interface GalleryData {
  photos: Photo[];
  expiresAt: string | null;
  permanent: boolean;
  plan: string;
}

export default function GalleryPage() {
  const params = useParams();
  const eventId = params.id as string;

  const [gallery, setGallery] = useState<GalleryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);
  const [expiredAt, setExpiredAt] = useState('');
  const [countdown, setCountdown] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await api.get('/events/' + eventId + '/gallery');
        setGallery(data);
      } catch (err: any) {
        if (err.response?.data?.code === 'GALLERY_EXPIRED') {
          setExpired(true);
          setExpiredAt(err.response.data.expiredAt || '');
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [eventId]);

  useEffect(() => {
    if (!gallery?.expiresAt || gallery.permanent) return;
    const update = () => {
      const diff = new Date(gallery.expiresAt!).getTime() - Date.now();
      if (diff <= 0) { setCountdown('Expire'); setExpired(true); return; }
      const d = Math.floor(diff / (1000 * 60 * 60 * 24));
      const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      if (d > 0) setCountdown(d + 'j ' + h + 'h');
      else if (h > 0) setCountdown(h + 'h ' + m + 'min');
      else setCountdown(m + 'min');
    };
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [gallery]);

  const groupedByChallenge = gallery?.photos.reduce((acc, photo) => {
    if (!acc[photo.challenge_id]) {
      acc[photo.challenge_id] = { title: photo.challenge_title, photos: [] };
    }
    acc[photo.challenge_id].photos.push(photo);
    return acc;
  }, {} as Record<string, { title: string; photos: Photo[] }>) || {};

  if (loading) {
    return (
      <div className="page-container page-with-nav fade-in" style={{ textAlign: 'center', paddingTop: 60 }}>
        <p style={{ color: 'var(--rp-text-muted)' }}>Chargement...</p>
      </div>
    );
  }

  if (expired) {
    return (
      <div className="page-container page-with-nav fade-in">
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <p style={{ fontSize: 48, marginBottom: 12 }}>&#x1F512;</p>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
            Galerie expiree
          </h1>
          <p style={{ fontSize: 14, color: 'var(--rp-text-muted)', lineHeight: 1.5 }}>
            {"L'acces a la galerie a expire" + (expiredAt ? ' le ' + new Date(expiredAt).toLocaleDateString('fr-FR', { dateStyle: 'long' }) : '') + '.'}
          </p>
          <p style={{ fontSize: 13, color: 'var(--rp-text-muted)', marginTop: 8 }}>
            {"L'organisateur peut prolonger l'acces en passant a un plan superieur."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container page-with-nav fade-in">
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4 }}>
          Galerie
        </h1>
        {gallery && !gallery.permanent && countdown && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--rp-gold-light)', color: '#9A7B00', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, marginTop: 6 }}>
            Expire dans {countdown}
          </div>
        )}
        {gallery?.permanent && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--rp-green-light)', color: 'var(--rp-green)', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, marginTop: 6 }}>
            Acces permanent
          </div>
        )}
      </div>

      {Object.keys(groupedByChallenge).length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
          <p style={{ color: 'var(--rp-text-muted)', fontSize: 15 }}>Aucune photo pour le moment</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {Object.entries(groupedByChallenge).map(([challengeId, group]) => (
            <div key={challengeId}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, marginBottom: 10, color: 'var(--rp-text)' }}>
                {group.title}
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                {group.photos.map((photo) => (
                  <div
                    key={photo.id}
                    onClick={() => setSelectedPhoto(photo)}
                    style={{ position: 'relative', aspectRatio: '1', borderRadius: 10, overflow: 'hidden', cursor: 'pointer', border: photo.is_winner ? '2px solid var(--rp-gold)' : '1px solid var(--rp-border)' }}
                  >
                    <img src={photo.photo_url} alt={photo.participant_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                    {photo.is_winner && (
                      <div style={{ position: 'absolute', top: 4, right: 4, background: 'var(--rp-gold)', borderRadius: '50%', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>
                        W
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedPhoto && (
        <div
          onClick={() => setSelectedPhoto(null)}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: 16 }}
        >
          <img src={selectedPhoto.photo_url} alt={selectedPhoto.participant_name} style={{ maxWidth: '100%', maxHeight: '75vh', borderRadius: 12, objectFit: 'contain' }} />
          <div style={{ marginTop: 12, textAlign: 'center', color: '#fff' }}>
            <p style={{ fontSize: 16, fontWeight: 600, fontFamily: 'var(--font-display)' }}>
              {selectedPhoto.participant_name}{selectedPhoto.is_winner ? ' (Winner)' : ''}
            </p>
            <p style={{ fontSize: 13, opacity: 0.7, marginTop: 2 }}>{selectedPhoto.challenge_title}</p>
          </div>
        </div>
      )}
    </div>
  );
}

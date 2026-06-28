import { Router, Response } from 'express';
import pool from '../config/database';
import { EVENT_TIER_LIMITS, EventTier } from '../config/plans';
import { signPhotoToken } from '../utils/photoToken';

const router = Router();

// GET /:eventId/gallery  (mounted on /events)
router.get('/:eventId/gallery', async (req, res: Response): Promise<void> => {
  try {
    const eventId = req.params.eventId as string;

    const [eventRows] = await pool.execute(
      `SELECT e.id, e.gallery_enabled, e.gallery_locked, e.gallery_locked_until,
              e.status, e.deadline, e.user_id, e.photo_secret, e.tier
       FROM events e
       WHERE e.id = ?`,
      [eventId]
    );
    if ((eventRows as any[]).length === 0) {
      res.status(404).json({ error: 'Evenement non trouve' });
      return;
    }

    const event = (eventRows as any[])[0];

    if (!event.gallery_enabled) {
      res.status(403).json({ error: 'Galerie desactivee' });
      return;
    }

    // Gallery only accessible after deadline
    const deadlinePassed = event.deadline && new Date(event.deadline) < new Date();
    if (!deadlinePassed && event.status === 'active') {
      res.status(403).json({
        error: 'Galerie pas encore disponible',
        code: 'GALLERY_NOT_YET',
        message: 'La galerie sera accessible apres la deadline',
      });
      return;
    }

    // Pro grace period: gallery is visible (read-only) but flagged
    const isGracePeriod = event.gallery_locked_until && new Date(event.gallery_locked_until) > new Date();

    // Auto-create gallery_access on first visit post-deadline
    const [accessRows] = await pool.execute(
      'SELECT id, expires_at, permanent FROM gallery_access WHERE event_id = ? ORDER BY created_at DESC LIMIT 1',
      [eventId]
    );

    let expiresAt: Date | null = null;
    let permanent = false;

    if ((accessRows as any[]).length === 0) {
      // Gallery days from event tier
      const tier       = (event.tier || 'free') as EventTier;
      const galleryDays = EVENT_TIER_LIMITS[tier]?.galleryDays ?? EVENT_TIER_LIMITS.free.galleryDays;

      const startDate = event.deadline ? new Date(event.deadline) : new Date();
      expiresAt = new Date(startDate.getTime() + galleryDays * 24 * 60 * 60 * 1000);

      await pool.execute(
        'INSERT INTO gallery_access (id, event_id, expires_at, permanent, paid) VALUES (UUID(), ?, ?, FALSE, FALSE)',
        [eventId, expiresAt.toISOString().slice(0, 19).replace('T', ' ')]
      );
    } else {
      const access = (accessRows as any[])[0];
      permanent  = access.permanent;
      expiresAt  = access.expires_at ? new Date(access.expires_at) : null;
    }

    // Check expiry
    if (!permanent && expiresAt && expiresAt < new Date()) {
      await pool.execute('UPDATE events SET gallery_locked = TRUE WHERE id = ?', [eventId]);
      res.status(403).json({
        error: 'Acces a la galerie expire',
        code: 'GALLERY_EXPIRED',
        expiredAt: expiresAt.toISOString(),
        tier: event.tier,
        message: 'Achetez un credit Event ou passez au Pro pour prolonger l\'acces',
      });
      return;
    }

    // Fetch photos
    const [photos] = await pool.execute(
      `SELECT s.id, s.photo_url, s.photo_key, s.is_winner, s.submitted_at,
              p.name as participant_name, c.title as challenge_title, c.id as challenge_id
       FROM submissions s
       JOIN participants p ON p.id = s.participant_id
       JOIN challenges c ON c.id = s.challenge_id
       WHERE s.event_id = ?
       ORDER BY c.sort_order ASC, s.submitted_at ASC`,
      [eventId]
    );

    const apiBase = process.env.API_URL || 'https://api.rallye-photo.com';
    const photoList = photos as any[];
    for (const photo of photoList) {
      if (photo.photo_key && event.photo_secret) {
        const token = await signPhotoToken(photo.photo_key, eventId, event.photo_secret, 3600);
        photo.photo_url = apiBase + '/photos/' + token;
      }
    }

    res.json({
      photos: photoList,
      expiresAt:    expiresAt ? expiresAt.toISOString() : null,
      permanent,
      tier:         event.tier || 'free',
      isGracePeriod: !!isGracePeriod,
    });
  } catch (error) {
    console.error('Gallery error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /:eventId/gallery/status  (panel info, no photos)
router.get('/:eventId/gallery/status', async (req, res: Response): Promise<void> => {
  try {
    const eventId = req.params.eventId as string;

    const [eventRows] = await pool.execute(
      `SELECT e.id, e.gallery_enabled, e.gallery_locked, e.gallery_locked_until, e.deadline, e.tier
       FROM events e
       WHERE e.id = ?`,
      [eventId]
    );
    if ((eventRows as any[]).length === 0) {
      res.status(404).json({ error: 'Evenement non trouve' });
      return;
    }

    const event = (eventRows as any[])[0];

    const [accessRows] = await pool.execute(
      'SELECT expires_at, permanent FROM gallery_access WHERE event_id = ? ORDER BY created_at DESC LIMIT 1',
      [eventId]
    );
    const access = (accessRows as any[])[0];

    const tier       = (event.tier || 'free') as EventTier;
    const galleryDays = EVENT_TIER_LIMITS[tier]?.galleryDays ?? EVENT_TIER_LIMITS.free.galleryDays;

    res.json({
      enabled:       event.gallery_enabled,
      locked:        event.gallery_locked,
      gracePeriodUntil: event.gallery_locked_until ? new Date(event.gallery_locked_until).toISOString() : null,
      tier:          event.tier || 'free',
      galleryDays,
      expiresAt:     access?.expires_at ? new Date(access.expires_at).toISOString() : null,
      permanent:     access?.permanent || false,
      deadlinePassed: event.deadline ? new Date(event.deadline) < new Date() : false,
    });
  } catch (error) {
    console.error('Gallery status error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;

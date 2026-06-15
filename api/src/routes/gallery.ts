import { Router, Response } from 'express';
import pool from '../config/database';
import { PLANS, PlanName } from '../config/plans';
import { signPhotoToken } from '../utils/photoToken';

const router = Router();

// GET /:eventId/gallery (monte sur /events)
router.get('/:eventId/gallery', async (req, res: Response): Promise<void> => {
  try {
    const eventId = req.params.eventId as string;

    // Recuperer l'event + le plan de l'organisateur
    const [eventRows] = await pool.execute(
      `SELECT e.id, e.gallery_enabled, e.gallery_locked, e.status, e.deadline, e.user_id, e.photo_secret, u.plan
       FROM events e
       JOIN users u ON u.id = e.user_id
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

    // Verifier si la deadline est passee (galerie accessible uniquement apres)
    const deadlinePassed = event.deadline && new Date(event.deadline) < new Date();
    if (!deadlinePassed && event.status === 'active') {
      res.status(403).json({
        error: 'Galerie pas encore disponible',
        code: 'GALLERY_NOT_YET',
        message: 'La galerie sera accessible apres la deadline',
      });
      return;
    }

    // Auto-creer gallery_access si pas encore fait
    const [accessRows] = await pool.execute(
      'SELECT id, expires_at, permanent FROM gallery_access WHERE event_id = ? ORDER BY created_at DESC LIMIT 1',
      [eventId]
    );

    let expiresAt: Date | null = null;
    let permanent = false;

    if ((accessRows as any[]).length === 0) {
      // Premiere visite post-deadline : creer l'acces galerie
      const plan = (event.plan || 'free') as PlanName;
      const galleryDays = PLANS[plan]?.galleryDays || PLANS.free.galleryDays;

      // Le timer d'expiration demarre a partir de la deadline (pas maintenant)
      const startDate = event.deadline ? new Date(event.deadline) : new Date();
      expiresAt = new Date(startDate.getTime() + galleryDays * 24 * 60 * 60 * 1000);

      await pool.execute(
        'INSERT INTO gallery_access (id, event_id, expires_at, permanent, paid) VALUES (UUID(), ?, ?, FALSE, FALSE)',
        [eventId, expiresAt.toISOString().slice(0, 19).replace('T', ' ')]
      );
    } else {
      const access = (accessRows as any[])[0];
      permanent = access.permanent;
      expiresAt = access.expires_at ? new Date(access.expires_at) : null;
    }

    // Verifier expiration
    if (!permanent && expiresAt && expiresAt < new Date()) {
      // Marquer la galerie comme locked
      await pool.execute('UPDATE events SET gallery_locked = TRUE WHERE id = ?', [eventId]);

      res.status(403).json({
        error: 'Acces a la galerie expire',
        code: 'GALLERY_EXPIRED',
        expiredAt: expiresAt.toISOString(),
        plan: event.plan,
        message: 'Passez a un plan superieur pour prolonger l\'acces',
      });
      return;
    }

    // Recuperer les photos
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

    // Generer des tokens photo securises
    const apiBase = process.env.API_URL || 'https://api.rallye-photo.com';
    const photoList = photos as any[];
    for (const photo of photoList) {
      if (photo.photo_key && event.photo_secret) {
        const token = signPhotoToken(photo.photo_key, eventId, event.photo_secret, 3600);
        photo.photo_url = apiBase + '/photos/' + token;
      }
    }

    res.json({
      photos: photoList,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      permanent,
      plan: event.plan,
    });
  } catch (error) {
    console.error('Gallery error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /:eventId/gallery/status -- info galerie sans les photos (pour le panel)
router.get('/:eventId/gallery/status', async (req, res: Response): Promise<void> => {
  try {
    const eventId = req.params.eventId as string;

    const [eventRows] = await pool.execute(
      `SELECT e.id, e.gallery_enabled, e.gallery_locked, e.deadline, u.plan
       FROM events e
       JOIN users u ON u.id = e.user_id
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
    const plan = (event.plan || 'free') as PlanName;
    const galleryDays = PLANS[plan]?.galleryDays || PLANS.free.galleryDays;

    res.json({
      enabled: event.gallery_enabled,
      locked: event.gallery_locked,
      plan: event.plan,
      galleryDays,
      expiresAt: access?.expires_at ? new Date(access.expires_at).toISOString() : null,
      permanent: access?.permanent || false,
      deadlinePassed: event.deadline ? new Date(event.deadline) < new Date() : false,
    });
  } catch (error) {
    console.error('Gallery status error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
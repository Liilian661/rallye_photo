import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import archiver from 'archiver';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import pool from '../config/database';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validateInput';
import { rateLimiter } from '../middleware/rateLimiter';
import { createEventSchema, updateEventSchema } from '../utils/validators';
import { generateUniqueEventCode } from '../utils/codeGenerator';
import { emitToEvent } from '../config/socket';
import { resolveEventTier, getEventLimit, USER_PLANS, EVENT_TIER_LIMITS, EventTier } from '../config/plans';
import { generateEventPhotoSecret } from '../utils/photoToken';
import { getS3Client, getS3Config, uploadToS3, deleteFromS3 } from '../utils/s3Service';
import multer from 'multer';
import sharp from 'sharp';
import { signPhotoToken } from '../utils/photoToken';

const router = Router();

// GET /events
router.get('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, name, description, event_date, deadline, code, qr_code_url, gallery_enabled, gallery_locked, scoring_mode, team_mode, theme_color, logo_key, banner_key, status, tier, created_at FROM events WHERE user_id = ? ORDER BY created_at DESC',
      [req.user!.userId]
    );
    res.json(rows);
  } catch (error) {
    console.error('List events error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /events
router.post('/', requireAuth, validateBody(createEventSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, description, eventDate, deadline, scoringMode, teamMode } = req.body;
    const userId = req.user!.userId;

    const [userRows] = await pool.execute(
      'SELECT plan, event_credits, email_verified FROM users WHERE id = ?',
      [userId]
    );
    const user = (userRows as any[])[0];

    if (!user?.email_verified) {
      res.status(403).json({
        error: 'Vous devez vérifier votre email avant de créer un événement.',
        code: 'EMAIL_NOT_VERIFIED',
      });
      return;
    }

    const plan = user?.plan || 'free';
    const credits = user?.event_credits || 0;

    // Déterminer le tier du nouvel événement
    const tier = resolveEventTier(plan, credits);

    // Pour les events gratuits : vérifier la limite d'events free actifs
    if (tier === 'free') {
      const maxFreeEvents = plan === 'pro' ? -1 : USER_PLANS.free.maxFreeEvents;
      if (maxFreeEvents !== -1) {
        const [existingFree] = await pool.execute(
          "SELECT COUNT(*) as count FROM events WHERE user_id = ? AND tier = 'free'",
          [userId]
        );
        if ((existingFree as any[])[0].count >= maxFreeEvents) {
          res.status(403).json({
            error: 'Vous avez atteint la limite d\'evenements gratuits. Achetez un credit Event ou passez au Pro.',
            code: 'FREE_LIMIT_REACHED',
          });
          return;
        }
      }
    }

    const id = uuidv4();
    const code = await generateUniqueEventCode();
    const photoSecret = generateEventPhotoSecret();
    const joinUrl = (process.env.CLIENT_URL || 'https://app.rallye-photo.com') + '/join/' + code;
    const qrCodeDataUrl = await QRCode.toDataURL(joinUrl, { width: 400, margin: 2 });

    // audit: MED-007 - transaction englobant le decrement conditionnel du credit
    // ET l'INSERT de l'event : on ne tague 'premium' que si le decrement atomique
    // a bien consomme 1 credit (affectedRows === 1). Empeche 2 events premium pour
    // 1 credit en cas de creation concurrente, et l'event premium gratuit en cas de crash.
    const conn = await pool.getConnection();
    let finalTier = tier;
    try {
      await conn.beginTransaction();

      if (tier === 'premium') {
        const [decrement]: any = await conn.execute(
          'UPDATE users SET event_credits = event_credits - 1 WHERE id = ? AND event_credits > 0',
          [userId]
        );
        // Si aucun credit n'a pu etre decremente (course concurrente), retomber en 'free'
        if (decrement.affectedRows !== 1) {
          finalTier = resolveEventTier(plan, 0);
        }
      }

      await conn.execute(
        "INSERT INTO events (id, user_id, name, description, event_date, deadline, code, qr_code_url, scoring_mode, team_mode, photo_secret, status, tier) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)",
        [id, userId, name, description || null, eventDate || null, deadline || null, code, qrCodeDataUrl, scoringMode || 'winner', teamMode ? 1 : 0, photoSecret, finalTier]
      );

      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }

    res.status(201).json({
      id, name, description, eventDate, deadline, code,
      scoringMode: scoringMode || 'winner',
      qrCodeUrl: qrCodeDataUrl, status: 'active', tier: finalTier,
    });
  } catch (error) {
    console.error('Create event error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /events/join/:code
router.get('/join/:code', rateLimiter(30, 60000), async (req, res: Response): Promise<void> => {
  try {
    const { code } = req.params;

    const [rows] = await pool.execute(
      'SELECT id, name, description, event_date, deadline, code, gallery_enabled, team_mode, theme_color, logo_key, banner_key, photo_secret, status, tier FROM events WHERE code = ?',
      [code.toUpperCase()]
    );
    const events = rows as any[];

    if (events.length === 0) {
      res.status(404).json({ error: 'Evenement non trouve' });
      return;
    }

    const event = events[0];

    // audit: LOW-032 - ne pas exposer un evenement non public via /join/:code.
    // Seul un event 'active' est rejoignable ; tout autre status (archived, ended,
    // brouillon, suspendu...) est traite comme termine/indisponible.
    if (event.status !== 'active') {
      res.status(410).json({ error: 'Cet evenement est termine' });
      return;
    }

    res.json({
      id: event.id, name: event.name, description: event.description,
      eventDate: event.event_date, deadline: event.deadline, code: event.code,
      galleryEnabled: event.gallery_enabled, team_mode: event.team_mode,
      theme_color: event.theme_color,
      tier: event.tier || 'free',
      logo_url: event.logo_key && event.photo_secret
        ? (process.env.API_URL || 'https://api.rallye-photo.com') + '/photos/' + signPhotoToken(event.logo_key, event.id, event.photo_secret, 86400)
        : null,
      banner_url: event.banner_key && event.photo_secret
        ? (process.env.API_URL || 'https://api.rallye-photo.com') + '/photos/' + signPhotoToken(event.banner_key, event.id, event.photo_secret, 86400)
        : null,
      status: event.status,
    });
  } catch (error) {
    console.error('Join event error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /events/:id
router.get('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // audit: HIGH-009 - selection explicite des colonnes : ne JAMAIS renvoyer
    // photo_secret (utilise pour signer les tokens photo). photo_secret est lu
    // separement uniquement pour generer les URLs signees ci-dessous.
    const [rows] = await pool.execute(
      `SELECT id, user_id, name, description, event_date, deadline, code, qr_code_url,
              gallery_enabled, gallery_locked, gallery_locked_until, scoring_mode, team_mode,
              theme_color, logo_key, banner_key, status, tier, created_at,
              photo_secret
       FROM events WHERE id = ? AND user_id = ?`,
      [req.params.id, req.user!.userId]
    );
    const events = rows as any[];

    if (events.length === 0) {
      res.status(404).json({ error: 'Evenement non trouve' });
      return;
    }

    const event = events[0];
    const apiBase = process.env.API_URL || 'https://api.rallye-photo.com';
    // audit: HIGH-009 - retirer photo_secret de l'objet renvoye au client
    const { photo_secret, ...eventPublic } = event;

    // audit: HIGH-009 - on diffuse eventPublic (sans photo_secret), pas event
    const result = {
      ...eventPublic,
      logo_url: event.logo_key && event.photo_secret
        ? apiBase + '/photos/' + signPhotoToken(event.logo_key, event.id, event.photo_secret, 86400)
        : null,
      banner_url: event.banner_key && event.photo_secret
        ? apiBase + '/photos/' + signPhotoToken(event.banner_key, event.id, event.photo_secret, 86400)
        : null,
    };

    res.json(result);
  } catch (error) {
    console.error('Get event error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /events/:id
router.patch('/:id', requireAuth, validateBody(updateEventSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, description, eventDate, deadline, galleryEnabled, status, scoringMode, teamMode } = req.body;

    // Validation assurée par validateBody(updateEventSchema) — Zod reject avant d'arriver ici.
    const fields: string[] = [];
    const values: any[] = [];

    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (description !== undefined) { fields.push('description = ?'); values.push(description); }
    if (eventDate !== undefined) { fields.push('event_date = ?'); values.push(eventDate); }
    if (deadline !== undefined) { fields.push('deadline = ?'); values.push(deadline); }
    if (galleryEnabled !== undefined) { fields.push('gallery_enabled = ?'); values.push(galleryEnabled); }
    if (status !== undefined) { fields.push('status = ?'); values.push(status); }
    if (scoringMode !== undefined) { fields.push('scoring_mode = ?'); values.push(scoringMode); }
    if (teamMode !== undefined) { fields.push('team_mode = ?'); values.push(teamMode ? 1 : 0); }
    if (req.body.themeColor !== undefined) { fields.push('theme_color = ?'); values.push(req.body.themeColor); }

    if (fields.length === 0) {
      res.status(400).json({ error: 'Aucune modification' });
      return;
    }

    values.push(req.params.id, req.user!.userId);

    await pool.execute(
      'UPDATE events SET ' + fields.join(', ') + ' WHERE id = ? AND user_id = ?',
      values
    );

    res.json({ message: 'Evenement mis a jour' });
  } catch (error) {
    console.error('Update event error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /events/:id
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const eventId = req.params.id;

    // Verify ownership and collect S3 keys before deleting
    const [eventRows] = await pool.execute(
      'SELECT id, logo_key, banner_key FROM events WHERE id = ? AND user_id = ?',
      [eventId, req.user!.userId]
    );
    if ((eventRows as any[]).length === 0) {
      res.status(404).json({ error: 'Evenement non trouve' });
      return;
    }
    const event = (eventRows as any[])[0];

    const [subRows] = await pool.execute(
      'SELECT photo_key FROM submissions WHERE event_id = ? AND photo_key IS NOT NULL',
      [eventId]
    );
    const s3Keys: string[] = (subRows as any[]).map((s: any) => s.photo_key);
    if (event.logo_key) s3Keys.push(event.logo_key);
    if (event.banner_key) s3Keys.push(event.banner_key);

    await pool.execute('DELETE FROM events WHERE id = ? AND user_id = ?', [eventId, req.user!.userId]);

    // Delete S3 files after DB cleanup (non-blocking, errors logged)
    if (s3Keys.length > 0) {
      Promise.all(s3Keys.map(key => deleteFromS3(key).catch(err => console.error('S3 delete error for', key, err)))).catch(() => {});
    }

    res.json({ message: 'Evenement supprime' });
  } catch (error) {
    console.error('Delete event error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /events/:id/qr-pdf
router.get('/:id/qr-pdf', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, name, code, event_date FROM events WHERE id = ? AND user_id = ?',
      [req.params.id, req.user!.userId]
    );
    const events = rows as any[];
    if (events.length === 0) {
      res.status(404).json({ error: 'Evenement non trouve' });
      return;
    }

    const event = events[0];
    const appUrl = process.env.APP_URL || 'https://app.rallye-photo.com';
    const joinUrl = `${appUrl}/join/${event.code}`;

    // Generate QR code as PNG buffer
    const qrBuffer = await QRCode.toBuffer(joinUrl, {
      width: 600,
      margin: 1,
      color: { dark: '#1a1a1a', light: '#ffffff' },
      errorCorrectionLevel: 'H',
    });

    // Create PDF (A4)
    const doc = new PDFDocument({ size: 'A4', margin: 0 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=rallye-photo-${event.code}.pdf`);
    doc.pipe(res);

    const W = 595.28;
    const H = 841.89;
    const pink = '#e91e8c';
    const dark = '#1a1a1a';
    const muted = '#888888';

    // Background
    doc.rect(0, 0, W, H).fill('#fafafa');

    // Top bar
    doc.rect(0, 0, W, 6).fill(pink);

    // Brand - draw as single string
    doc.fontSize(18).font('Helvetica-Bold').fillColor(dark);
    const brandY = 50;
    const part1 = 'rallye';
    const part2 = '.';
    const part3 = 'photo';
    const w1 = doc.widthOfString(part1);
    const w2 = doc.widthOfString(part2);
    const w3 = doc.widthOfString(part3);
    const totalW = w1 + w2 + w3;
    const brandX = (W - totalW) / 2;
    doc.text(part1, brandX, brandY, { continued: false });
    doc.fillColor(pink).text(part2, brandX + w1, brandY, { continued: false });
    doc.fillColor(dark).text(part3, brandX + w1 + w2, brandY, { continued: false });

    // Event name
    doc.fontSize(28).font('Helvetica-Bold').fillColor(dark);
    doc.text(event.name, 50, 90, { align: 'center', width: W - 100 });

    // Event date
    if (event.event_date) {
      const dateStr = new Date(event.event_date).toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      });
      doc.fontSize(14).font('Helvetica').fillColor(muted);
      doc.text(dateStr, 50, 130, { align: 'center', width: W - 100 });
    }

    // QR Code container
    const qrSize = 260;
    const qrBoxSize = qrSize + 40;
    const qrBoxX = (W - qrBoxSize) / 2;
    const qrBoxY = 170;

    doc.roundedRect(qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 16).fill('#ffffff');
    doc.roundedRect(qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 16)
       .strokeColor('#e5e5e5').lineWidth(1).stroke();

    doc.image(qrBuffer, qrBoxX + 20, qrBoxY + 20, { width: qrSize });

    // Code label
    const codeY = qrBoxY + qrBoxSize + 30;
    doc.fontSize(13).font('Helvetica').fillColor(muted);
    doc.text('Code de l\'evenement', 50, codeY, { align: 'center', width: W - 100 });

    // Code badge
    const codeFontSize = 36;
    doc.fontSize(codeFontSize).font('Helvetica-Bold');
    const codeWidth = doc.widthOfString(event.code);
    const badgeW = codeWidth + 60;
    const badgeX = (W - badgeW) / 2;
    const badgeY = codeY + 25;

    doc.roundedRect(badgeX, badgeY, badgeW, 56, 12).fill(pink);
    doc.fontSize(codeFontSize).font('Helvetica-Bold').fillColor('#ffffff');
    doc.text(event.code, badgeX, badgeY + 12, { width: badgeW, align: 'center' });

    // Instructions
    const instrY = badgeY + 85;
    doc.fontSize(15).font('Helvetica-Bold').fillColor(dark);
    doc.text('Comment participer ?', 50, instrY, { align: 'center', width: W - 100 });

    const steps = [
      'Scannez le QR code avec votre telephone',
      'Entrez votre prenom pour rejoindre',
      'Relevez les defis photo et amusez-vous !',
    ];

    let stepY = instrY + 30;
    for (let i = 0; i < steps.length; i++) {
      const circleX = 170;
      doc.circle(circleX, stepY + 8, 12).fill(pink);
      doc.fontSize(13).font('Helvetica-Bold').fillColor('#ffffff');
      doc.text(String(i + 1), circleX - 5, stepY + 2, { width: 10, align: 'center' });
      doc.fontSize(13).font('Helvetica').fillColor(dark);
      doc.text(steps[i], circleX + 22, stepY + 1, { width: 260 });
      stepY += 30;
    }

    // Footer link
    doc.fontSize(10).font('Helvetica').fillColor(muted);
    doc.text(joinUrl, 50, H - 50, { align: 'center', width: W - 100, link: joinUrl });

    // Bottom bar
    doc.rect(0, H - 6, W, 6).fill(pink);

    doc.end();
  } catch (error) {
    console.error('QR PDF error:', error);
    res.status(500).json({ error: 'Erreur generation PDF' });
  }
});

// GET /events/:id/export-zip
router.get('/:id/export-zip', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [eventRows] = await pool.execute(
      'SELECT id, name, code, tier FROM events WHERE id = ? AND user_id = ?',
      [req.params.id, req.user!.userId]
    );
    if ((eventRows as any[]).length === 0) {
      res.status(404).json({ error: 'Evenement non trouve' });
      return;
    }

    const event = (eventRows as any[])[0];

    // audit: LOW-028 - faire respecter le controle de tier exportZip cote serveur
    const exportTier = (EVENT_TIER_LIMITS[event.tier as EventTier] ?? EVENT_TIER_LIMITS.free);
    if (!exportTier.exportZip) {
      res.status(403).json({
        error: 'L\'export ZIP est reserve aux evenements premium ou pro.',
        code: 'TIER_FORBIDDEN',
      });
      return;
    }

    // audit: LOW-031 - borner le volume exporte (cap) pour limiter le risque DoS
    // memoire/temps (recuperation S3 sequentielle non paginee). Entier en dur, non
    // injectable, interpole directement.
    const EXPORT_ZIP_MAX = 2000;
    const [subRows] = await pool.execute(
      `SELECT s.id, s.photo_key, s.media_type, s.submitted_at,
              p.name as participant_name, c.title as challenge_title
       FROM submissions s
       JOIN participants p ON p.id = s.participant_id
       JOIN challenges c ON c.id = s.challenge_id
       WHERE s.event_id = ?
       ORDER BY c.title, p.name
       LIMIT ${EXPORT_ZIP_MAX}`,
      [req.params.id]
    );
    const submissions = subRows as any[];

    if (submissions.length === 0) {
      res.status(404).json({ error: 'Aucune photo a exporter' });
      return;
    }

    const client = await getS3Client();
    const config = await getS3Config();
    if (!client || !config) {
      res.status(503).json({ error: 'S3 non configure' });
      return;
    }

    // Sanitize filename
    const safeName = event.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_').slice(0, 50);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=rallye-photo-${safeName}.zip`);

    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.pipe(res);

    archive.on('error', (err: Error) => {
      console.error('Archive error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Erreur ZIP' });
    });

    for (const sub of submissions) {
      if (!sub.photo_key) continue;

      try {
        const s3Response = await client.send(new GetObjectCommand({
          Bucket: config.bucket,
          Key: sub.photo_key,
        }));

        if (s3Response.Body) {
          // Build folder/filename
          const challenge = sub.challenge_title.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_').slice(0, 40);
          const participant = sub.participant_name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_').slice(0, 30);
          const ext = sub.media_type === 'video' ? (sub.photo_key.endsWith('.mp4') ? 'mp4' : 'webm') : 'webp';
          const fileName = `${challenge}/${participant}.${ext}`;

          archive.append(s3Response.Body as any, { name: fileName });
        }
      } catch (err) {
        console.error(`S3 fetch error for ${sub.photo_key}:`, err);
      }
    }

    await archive.finalize();
  } catch (error) {
    console.error('Export ZIP error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur export' });
  }
});

// --- Branding uploads ---
const brandingUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Format non supporte (JPG, PNG ou WebP)'));
    }
  },
});

// POST /events/:id/logo
router.post('/:id/logo', requireAuth, brandingUpload.single('logo'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [rows] = await pool.execute('SELECT id, code, photo_secret, tier FROM events WHERE id = ? AND user_id = ?', [req.params.id, req.user!.userId]);
    if ((rows as any[]).length === 0) { res.status(404).json({ error: 'Evenement non trouve' }); return; }
    if (!req.file) { res.status(400).json({ error: 'Fichier manquant' }); return; }

    const event = (rows as any[])[0];
    // audit: LOW-027 - faire respecter le controle de tier branding cote serveur
    if (!(EVENT_TIER_LIMITS[event.tier as EventTier] ?? EVENT_TIER_LIMITS.free).branding) {
      res.status(403).json({ error: 'Le branding est reserve aux evenements premium ou pro.', code: 'TIER_FORBIDDEN' });
      return;
    }
    const buffer = await sharp(req.file.buffer).resize({ width: 400, height: 400, fit: 'cover' }).webp({ quality: 85 }).toBuffer();
    const key = `${event.code}/branding/logo.webp`;

    await uploadToS3(key, buffer, 'image/webp');
    await pool.execute('UPDATE events SET logo_key = ? WHERE id = ?', [key, req.params.id]);

    const apiBase = process.env.API_URL || 'https://api.rallye-photo.com';
    const url = apiBase + '/photos/' + signPhotoToken(key, event.id, event.photo_secret, 86400);
    res.json({ logo_url: url });
  } catch (error) {
    console.error('Logo upload error:', error);
    res.status(500).json({ error: 'Erreur upload logo' });
  }
});

// POST /events/:id/banner
router.post('/:id/banner', requireAuth, brandingUpload.single('banner'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [rows] = await pool.execute('SELECT id, code, photo_secret, tier FROM events WHERE id = ? AND user_id = ?', [req.params.id, req.user!.userId]);
    if ((rows as any[]).length === 0) { res.status(404).json({ error: 'Evenement non trouve' }); return; }
    if (!req.file) { res.status(400).json({ error: 'Fichier manquant' }); return; }

    const event = (rows as any[])[0];
    // audit: LOW-027 - faire respecter le controle de tier branding cote serveur
    if (!(EVENT_TIER_LIMITS[event.tier as EventTier] ?? EVENT_TIER_LIMITS.free).branding) {
      res.status(403).json({ error: 'Le branding est reserve aux evenements premium ou pro.', code: 'TIER_FORBIDDEN' });
      return;
    }
    const buffer = await sharp(req.file.buffer).resize({ width: 1200, height: 400, fit: 'cover' }).webp({ quality: 80 }).toBuffer();
    const key = `${event.code}/branding/banner.webp`;

    await uploadToS3(key, buffer, 'image/webp');
    await pool.execute('UPDATE events SET banner_key = ? WHERE id = ?', [key, req.params.id]);

    const apiBase = process.env.API_URL || 'https://api.rallye-photo.com';
    const url = apiBase + '/photos/' + signPhotoToken(key, event.id, event.photo_secret, 86400);
    res.json({ banner_url: url });
  } catch (error) {
    console.error('Banner upload error:', error);
    res.status(500).json({ error: 'Erreur upload banniere' });
  }
});

// DELETE /events/:id/logo
router.delete('/:id/logo', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // audit: LOW-030 - recuperer la cle S3 avant de la perdre (NULL) puis supprimer l'objet
    const [rows] = await pool.execute('SELECT logo_key FROM events WHERE id = ? AND user_id = ?', [req.params.id, req.user!.userId]);
    const key = (rows as any[])[0]?.logo_key;
    await pool.execute('UPDATE events SET logo_key = NULL WHERE id = ? AND user_id = ?', [req.params.id, req.user!.userId]);
    if (key) {
      deleteFromS3(key).catch(err => console.error('S3 delete logo error for', key, err));
    }
    res.json({ message: 'Logo supprime' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur' });
  }
});

// DELETE /events/:id/banner
router.delete('/:id/banner', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // audit: LOW-030 - recuperer la cle S3 avant de la perdre (NULL) puis supprimer l'objet
    const [rows] = await pool.execute('SELECT banner_key FROM events WHERE id = ? AND user_id = ?', [req.params.id, req.user!.userId]);
    const key = (rows as any[])[0]?.banner_key;
    await pool.execute('UPDATE events SET banner_key = NULL WHERE id = ? AND user_id = ?', [req.params.id, req.user!.userId]);
    if (key) {
      deleteFromS3(key).catch(err => console.error('S3 delete banner error for', key, err));
    }
    res.json({ message: 'Banniere supprimee' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur' });
  }
});

export default router;
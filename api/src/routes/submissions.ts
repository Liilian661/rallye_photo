import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import sharp from 'sharp';
import pool from '../config/database';
import { requireAuth, AuthRequest, requireAuthOrParticipant, DualAuthRequest } from '../middleware/auth';
// audit: HIGH-010 / HIGH-011 — auth participant derivee d'un token signe
import { requireParticipant, ParticipantRequest } from '../middleware/participantAuth';
import { emitToEvent } from '../config/socket';
import { uploadToS3, deleteFromS3 } from '../utils/s3Service';
import { signPhotoToken } from '../utils/photoToken';
import { rateLimiter } from '../middleware/rateLimiter';
import { scanBuffer } from '../utils/antivirusService';

// Aligner la concurrence Sharp sur le sémaphore d'upload
const MAX_CONCURRENT_UPLOADS = 2;
sharp.concurrency(MAX_CONCURRENT_UPLOADS);
let activeUploads = 0;
const uploadQueue: Array<{ resolve: () => void }> = [];

function acquireUploadSlot(): Promise<void> {
  if (activeUploads < MAX_CONCURRENT_UPLOADS) {
    activeUploads++;
    return Promise.resolve();
  }
  return new Promise((resolve) => { uploadQueue.push({ resolve }); });
}

function releaseUploadSlot(): void {
  activeUploads--;
  const next = uploadQueue.shift();
  if (next) { activeUploads++; next.resolve(); }
}

// --- Retry helper pour S3 ---
async function uploadToS3WithRetry(key: string, buffer: Buffer, contentType: string, retries = 3): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await uploadToS3(key, buffer, contentType);
    } catch (error: any) {
      console.error(`S3 upload attempt ${attempt}/${retries} failed:`, error.message);
      if (attempt === retries) throw error;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error('S3 upload failed after retries');
}

// Types de fichiers acceptes
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB pour les videos
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Format de fichier non supporte'));
    }
  },
});

function sanitizeForS3(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase()
    .slice(0, 80);
}

function isVideo(mimetype: string): boolean {
  return ALLOWED_VIDEO_TYPES.includes(mimetype);
}

function getExtension(mimetype: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'webp', 'image/png': 'webp', 'image/webp': 'webp',
    'image/heic': 'webp', 'image/heif': 'webp',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mp4',
  };
  return map[mimetype] || 'webp';
}

const router = Router();

// POST /events/:eventId/challenges/:challengeId/submit
// audit: HIGH-011 / CRIT-001 — requireParticipant AVANT multer (lit le header, pas le body).
// participantId est derive du token verifie, jamais du body.
router.post('/events/:eventId/challenges/:challengeId/submit', rateLimiter(5, 60000), requireParticipant, upload.single('photo'), async (req: ParticipantRequest, res: Response): Promise<void> => {
  let slotAcquired = false;
  // audit: LOW-039 — cle S3 uploadee mais pas encore referencee en base ;
  // nettoyee dans le catch general si l'INSERT echoue (evite les orphelins).
  let s3KeyUploaded: string | null = null;

  try {
    const eventId = req.params.eventId as string;
    const challengeId = req.params.challengeId as string;
    // audit: HIGH-011 — participantId vient du token, pas du body
    const participantId = req.participant!.participantId;

    // audit: CRIT-001 — le token doit etre lie a CET event
    if (req.participant!.eventId !== eventId) {
      res.status(403).json({ error: 'Acces refuse' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'Fichier manquant' });
      return;
    }

    const fileIsVideo = isVideo(req.file.mimetype);

    // Verifier event
    const [eventRows] = await pool.execute(
      'SELECT id, status, deadline, gallery_locked_until, code, scoring_mode, photo_secret FROM events WHERE id = ?',
      [eventId]
    );
    if ((eventRows as any[]).length === 0) {
      res.status(404).json({ error: 'Evenement non trouve' });
      return;
    }

    const event = (eventRows as any[])[0];
    if (event.status !== 'active') {
      res.status(403).json({ error: 'Evenement non actif' });
      return;
    }

    if (event.deadline && new Date(event.deadline) < new Date()) {
      res.status(403).json({ error: 'La deadline est depassee' });
      return;
    }

    // Grace period Pro: gallery locked → read-only, no new submissions
    if (event.gallery_locked_until && new Date(event.gallery_locked_until) > new Date()) {
      res.status(403).json({
        error: 'Cet evenement est temporairement en lecture seule (periode de grace de 48h suite a une annulation Pro)',
        code: 'GRACE_PERIOD_LOCKED',
      });
      return;
    }

    // Verifier challenge
    const [challengeRows] = await pool.execute(
      'SELECT id, title FROM challenges WHERE id = ? AND event_id = ?',
      [challengeId, eventId]
    );
    if ((challengeRows as any[]).length === 0) {
      res.status(404).json({ error: 'Defi non trouve' });
      return;
    }
    const challengeTitle = (challengeRows as any[])[0].title;

    // Verifier participant
    const [participantRows] = await pool.execute(
      'SELECT id, name FROM participants WHERE id = ? AND event_id = ?',
      [participantId, eventId]
    );
    if ((participantRows as any[]).length === 0) {
      res.status(404).json({ error: 'Participant non trouve' });
      return;
    }
    const participantName = (participantRows as any[])[0].name;

    // Antivirus scan before any processing
    const scanResult = await scanBuffer(req.file.buffer, req.file.originalname || 'upload');
    if (!scanResult.clean) {
      res.status(422).json({
        error: `Fichier refuse : contenu malveillant detecte (${scanResult.virus})`,
        code: 'VIRUS_DETECTED',
      });
      return;
    }

    // Attendre un slot disponible
    await acquireUploadSlot();
    slotAcquired = true;

    let uploadBuffer: Buffer;
    let contentType: string;
    let ext: string;

    if (fileIsVideo) {
      // Video : pas de traitement, upload direct
      uploadBuffer = req.file.buffer;
      contentType = req.file.mimetype === 'video/quicktime' ? 'video/mp4' : req.file.mimetype;
      ext = getExtension(req.file.mimetype);
    } else {
      // Image : convertir en WebP avec sharp
      uploadBuffer = await sharp(req.file.buffer)
        .resize({ width: 2000, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      contentType = 'image/webp';
      ext = 'webp';
    }

    // Liberer le buffer original
    req.file.buffer = Buffer.alloc(0);

    // audit: LOW-043 — refuser explicitement si l'event n'a pas de photo_secret :
    // signer avec une cle degeneree rendrait la photo definitivement inaccessible (403).
    if (!event.photo_secret) {
      res.status(503).json({ error: 'Configuration de l\'evenement incomplete. Contactez l\'organisateur.' });
      return;
    }

    // Structure S3
    const id = uuidv4();
    // audit: MED-020 — garde-fou : un titre de defi qui se reduit a vide (emoji/symboles)
    // produirait une cle 'code//fichier' rejetee par assertValidS3Key. Fallback non-vide.
    const folderDefi = sanitizeForS3(challengeTitle) || 'defi';
    const fileName = sanitizeForS3(participantName) + '_' + id.slice(0, 8) + '.' + ext;
    const s3Key = event.code + '/' + folderDefi + '/' + fileName;
    const mediaType = fileIsVideo ? 'video' : 'photo';

    // Upload vers S3 avec retry
    await uploadToS3WithRetry(s3Key, uploadBuffer, contentType);
    s3KeyUploaded = s3Key; // audit: LOW-039 — pour nettoyer S3 si l'INSERT echoue

    // Generer un token securise
    const apiBase = process.env.API_URL || 'https://api.rallye-photo.com';
    const photoToken = signPhotoToken(s3Key, eventId, event.photo_secret, 86400);
    const photoUrl = apiBase + '/photos/' + photoToken;

    // audit: LOW-039 — is_winner determine directement dans l'INSERT (atomique),
    // plus d'UPDATE separe pouvant laisser une soumission sans is_winner.
    const isWinner = event.scoring_mode === 'participation';

    // INSERT avec gestion du doublon
    try {
      await pool.execute(
        'INSERT INTO submissions (id, event_id, challenge_id, participant_id, photo_url, photo_key, media_type, is_winner) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, eventId, challengeId, participantId, photoUrl, s3Key, mediaType, isWinner]
      );
      s3KeyUploaded = null; // INSERT reussi : le fichier est desormais reference
    } catch (dbError: any) {
      if (dbError.code === 'ER_DUP_ENTRY') {
        try { await deleteFromS3(s3Key); } catch {}
        s3KeyUploaded = null;
        res.status(409).json({ error: 'Tu as deja soumis pour ce defi' });
        return;
      }
      throw dbError;
    }

    emitToEvent(eventId, 'new-submission', {
      id, challengeId, participantId, participantName, photoUrl, mediaType,
    });

    res.status(201).json({ id, challengeId, photoUrl, mediaType });
  } catch (error: any) {
    console.error('Submit error:', error);
    // audit: LOW-039 — nettoyer le fichier S3 deja uploade si l'INSERT a echoue
    if (s3KeyUploaded) {
      try { await deleteFromS3(s3KeyUploaded); } catch (e) { console.error('S3 orphan cleanup failed:', e); }
    }
    if (error.message?.includes('S3 non configure')) {
      res.status(503).json({ error: 'Stockage S3 non configure. Contactez l\'organisateur.' });
    } else {
      res.status(500).json({ error: 'Erreur serveur, reessayez' });
    }
  } finally {
    if (slotAcquired) releaseUploadSlot();
  }
});

// GET /events/:eventId/submissions
// Accepte JWT organisateur (doit posséder l'event) OU token participant (doit appartenir à l'event)
router.get('/events/:eventId/submissions', requireAuthOrParticipant, async (req: DualAuthRequest, res: Response): Promise<void> => {
  try {
    const eventId = req.params.eventId;

    // Vérifier l'appartenance : organisateur doit posséder l'event, participant doit être membre
    if (req.user) {
      const [ownerRows] = await pool.execute('SELECT id FROM events WHERE id = ? AND user_id = ?', [eventId, req.user.userId]);
      if ((ownerRows as any[]).length === 0) {
        res.status(403).json({ error: 'Accès refusé' });
        return;
      }
    } else if (req.participant) {
      if (req.participant.eventId !== eventId) {
        res.status(403).json({ error: 'Accès refusé' });
        return;
      }
    }
    const [eventRows] = await pool.execute('SELECT photo_secret FROM events WHERE id = ?', [eventId]);
    const eventSecret = (eventRows as any[])[0]?.photo_secret;

    const [rows] = await pool.execute(
      'SELECT s.id, s.challenge_id, s.participant_id, s.photo_url, s.photo_key, s.is_winner, s.submitted_at, s.media_type, p.name as participant_name, c.title as challenge_title FROM submissions s JOIN participants p ON p.id = s.participant_id JOIN challenges c ON c.id = s.challenge_id WHERE s.event_id = ? ORDER BY s.submitted_at DESC',
      [eventId]
    );

    const apiBase = process.env.API_URL || 'https://api.rallye-photo.com';
    const submissions = rows as any[];
    for (const sub of submissions) {
      if (eventSecret && sub.photo_key) {
        const token = signPhotoToken(sub.photo_key, eventId, eventSecret, 86400);
        sub.photo_url = apiBase + '/photos/' + token;
      }
    }

    res.json(submissions);
  } catch (error) {
    console.error('List submissions error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /challenges/:challengeId/submissions — organisateur uniquement
router.get('/challenges/:challengeId/submissions', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const challengeId = req.params.challengeId;
    const [challengeRows] = await pool.execute('SELECT event_id FROM challenges WHERE id = ?', [challengeId]);
    const eventId = (challengeRows as any[])[0]?.event_id;

    // Vérifier que l'organisateur possède l'event lié au challenge
    if (eventId) {
      const [ownerRows] = await pool.execute('SELECT id FROM events WHERE id = ? AND user_id = ?', [eventId, req.user!.userId]);
      if ((ownerRows as any[]).length === 0) {
        res.status(403).json({ error: 'Accès refusé' });
        return;
      }
    }
    let eventSecret: string | null = null;
    if (eventId) {
      const [eventRows] = await pool.execute('SELECT photo_secret FROM events WHERE id = ?', [eventId]);
      eventSecret = (eventRows as any[])[0]?.photo_secret;
    }

    const [rows] = await pool.execute(
      'SELECT s.id, s.participant_id, s.photo_url, s.photo_key, s.is_winner, s.submitted_at, s.media_type, p.name as participant_name FROM submissions s JOIN participants p ON p.id = s.participant_id WHERE s.challenge_id = ? ORDER BY s.submitted_at ASC',
      [challengeId]
    );

    const apiBase = process.env.API_URL || 'https://api.rallye-photo.com';
    const submissions = rows as any[];
    for (const sub of submissions) {
      if (eventSecret && eventId && sub.photo_key) {
        const token = signPhotoToken(sub.photo_key, eventId, eventSecret, 86400);
        sub.photo_url = apiBase + '/photos/' + token;
      }
    }

    res.json(submissions);
  } catch (error) {
    console.error('List challenge submissions error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /submissions/:id
router.delete('/submissions/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [rows] = await pool.execute(
      'SELECT s.id, s.photo_key, s.event_id FROM submissions s JOIN events e ON e.id = s.event_id WHERE s.id = ? AND e.user_id = ?',
      [req.params.id, req.user!.userId]
    );
    if ((rows as any[]).length === 0) {
      res.status(404).json({ error: 'Soumission non trouvee' });
      return;
    }
    const submission = (rows as any[])[0];
    try { await deleteFromS3(submission.photo_key); } catch (error) {
      console.error('S3 delete error (continuing):', error);
    }
    await pool.execute('DELETE FROM submissions WHERE id = ?', [req.params.id]);
    emitToEvent(submission.event_id, 'new-submission', {});
    res.json({ message: 'Supprime' });
  } catch (error) {
    console.error('Delete submission error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /submissions/:id/participant
// audit: HIGH-010 — plus de participantId dans l'URL (devinable). Le participantId
// est derive du token participant signe et l'appartenance est verifiee.
router.delete('/submissions/:id/participant', requireParticipant, async (req: ParticipantRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const participantId = req.participant!.participantId;
    const [rows] = await pool.execute(
      'SELECT s.id, s.photo_key, s.event_id FROM submissions s WHERE s.id = ? AND s.participant_id = ?',
      [id, participantId]
    );
    if ((rows as any[]).length === 0) {
      res.status(404).json({ error: 'Soumission non trouvee' });
      return;
    }
    const submission = (rows as any[])[0];
    const [eventRows] = await pool.execute('SELECT status, deadline FROM events WHERE id = ?', [submission.event_id]);
    const event = (eventRows as any[])[0];
    if (!event || event.status !== 'active') {
      res.status(403).json({ error: 'Evenement non actif' });
      return;
    }
    if (event.deadline && new Date(event.deadline) < new Date()) {
      res.status(403).json({ error: 'La deadline est depassee' });
      return;
    }
    try { await deleteFromS3(submission.photo_key); } catch (error) {
      console.error('S3 delete error (continuing):', error);
    }
    await pool.execute('DELETE FROM submissions WHERE id = ?', [id]);
    emitToEvent(submission.event_id, 'new-submission', {});
    res.json({ message: 'Supprime' });
  } catch (error) {
    console.error('Participant delete submission error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
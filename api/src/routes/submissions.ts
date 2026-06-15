import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import sharp from 'sharp';
import pool from '../config/database';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { emitToEvent } from '../config/socket';
import { uploadToS3, deleteFromS3 } from '../utils/s3Service';
import { signPhotoToken } from '../utils/photoToken';
import { rateLimiter } from '../middleware/rateLimiter';

// Limiter sharp a 1 thread pour economiser la RAM
sharp.concurrency(1);

// --- Semaphore pour limiter les uploads concurrents ---
const MAX_CONCURRENT_UPLOADS = 2;
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
router.post('/events/:eventId/challenges/:challengeId/submit', rateLimiter(5, 60000), upload.single('photo'), async (req, res: Response): Promise<void> => {
  let slotAcquired = false;

  try {
    const eventId = req.params.eventId as string;
    const challengeId = req.params.challengeId as string;
    const { participantId } = req.body;

    if (!req.file) {
      res.status(400).json({ error: 'Fichier manquant' });
      return;
    }

    if (!participantId) {
      res.status(400).json({ error: 'Participant ID manquant' });
      return;
    }

    const fileIsVideo = isVideo(req.file.mimetype);

    // Verifier event
    const [eventRows] = await pool.execute(
      'SELECT id, status, deadline, code, scoring_mode, photo_secret FROM events WHERE id = ?',
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

    // Structure S3
    const id = uuidv4();
    const folderDefi = sanitizeForS3(challengeTitle);
    const fileName = sanitizeForS3(participantName) + '_' + id.slice(0, 8) + '.' + ext;
    const s3Key = event.code + '/' + folderDefi + '/' + fileName;
    const mediaType = fileIsVideo ? 'video' : 'photo';

    // Upload vers S3 avec retry
    await uploadToS3WithRetry(s3Key, uploadBuffer, contentType);

    // Generer un token securise
    const apiBase = process.env.API_URL || 'https://api.rallye-photo.com';
    const photoToken = signPhotoToken(s3Key, eventId, event.photo_secret, 86400);
    const photoUrl = apiBase + '/photos/' + photoToken;

    // INSERT avec gestion du doublon
    try {
      await pool.execute(
        'INSERT INTO submissions (id, event_id, challenge_id, participant_id, photo_url, photo_key, media_type) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, eventId, challengeId, participantId, photoUrl, s3Key, mediaType]
      );
    } catch (dbError: any) {
      if (dbError.code === 'ER_DUP_ENTRY') {
        try { await deleteFromS3(s3Key); } catch {}
        res.status(409).json({ error: 'Tu as deja soumis pour ce defi' });
        return;
      }
      throw dbError;
    }

    // Mode participation : auto-win
    if (event.scoring_mode === 'participation') {
      await pool.execute('UPDATE submissions SET is_winner = TRUE WHERE id = ?', [id]);
    }

    emitToEvent(eventId, 'new-submission', {
      id, challengeId, participantId, participantName, photoUrl, mediaType,
    });

    res.status(201).json({ id, challengeId, photoUrl, mediaType });
  } catch (error: any) {
    console.error('Submit error:', error);
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
router.get('/events/:eventId/submissions', async (req, res: Response): Promise<void> => {
  try {
    const eventId = req.params.eventId;
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

// GET /challenges/:challengeId/submissions
router.get('/challenges/:challengeId/submissions', async (req, res: Response): Promise<void> => {
  try {
    const challengeId = req.params.challengeId;
    const [challengeRows] = await pool.execute('SELECT event_id FROM challenges WHERE id = ?', [challengeId]);
    const eventId = (challengeRows as any[])[0]?.event_id;
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
    res.json({ message: 'Supprime' });
  } catch (error) {
    console.error('Delete submission error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /submissions/:id/participant/:participantId
router.delete('/submissions/:id/participant/:participantId', async (req, res: Response): Promise<void> => {
  try {
    const { id, participantId } = req.params;
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
import { Router, Response, Request } from 'express';
import pool from '../config/database';
import { verifyPhotoToken } from '../utils/photoToken';
import { getS3Client, getS3Config } from '../utils/s3Service';
import { GetObjectCommand } from '@aws-sdk/client-s3';

const router = Router();

// Cache des secrets event en memoire (evite un query BDD a chaque image)
const secretCache = new Map<string, { secret: string; expires: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getEventSecret(eventId: string): Promise<string | null> {
  const cached = secretCache.get(eventId);
  if (cached && cached.expires > Date.now()) {
    return cached.secret;
  }

  const [rows] = await pool.execute(
    'SELECT photo_secret FROM events WHERE id = ?',
    [eventId]
  );
  const event = (rows as any[])[0];
  if (!event || !event.photo_secret) return null;

  secretCache.set(eventId, {
    secret: event.photo_secret,
    expires: Date.now() + CACHE_TTL,
  });

  return event.photo_secret;
}

// GET /photos/:token - Sert une image protegee
router.get('/:token', async (req: Request, res: Response): Promise<void> => {
  try {
    const token = req.params.token as string;

    // Decode le token pour recuperer l'eventId (sans verifier encore)
    const jwt = require('jsonwebtoken');
    const decoded = jwt.decode(token) as any;
    if (!decoded || !decoded.e) {
      res.status(403).json({ error: 'Token invalide' });
      return;
    }

    // Recuperer le secret de l'event
    const secret = await getEventSecret(decoded.e);
    if (!secret) {
      res.status(403).json({ error: 'Acces refuse' });
      return;
    }

    // Verifier le token completement
    const result = verifyPhotoToken(token, secret);
    if (!result) {
      res.status(403).json({ error: 'Token expire ou invalide' });
      return;
    }

    // Fetch l'image depuis S3
    const client = await getS3Client();
    const config = await getS3Config();

    if (!client || !config) {
      res.status(500).json({ error: 'Stockage non configure' });
      return;
    }

    const command = new GetObjectCommand({
      Bucket: config.bucket,
      Key: result.photoKey,
    });

    const s3Response = await client.send(command);

    if (!s3Response.Body) {
      res.status(404).json({ error: 'Photo non trouvee' });
      return;
    }

    // Headers de cache (le token expire, donc on peut cacher cote navigateur)
    res.set({
      'Content-Type': s3Response.ContentType || 'image/webp',
      'Cache-Control': 'private, max-age=3600',
      'Content-Length': s3Response.ContentLength?.toString(),
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });

    // Stream l'image vers le client
    const stream = s3Response.Body as any;
    stream.pipe(res);
  } catch (error: any) {
    console.error('Photo serve error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
});

export default router;
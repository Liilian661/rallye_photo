import { Router, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import pool from '../config/database';
import { requireAdmin, AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validateInput';
import { adminCreateUserSchema } from '../utils/validators';
import { hashPassword } from '../utils/crypto';
import { encrypt } from '../utils/encryption';
import { testS3Connection, invalidateS3Cache } from '../utils/s3Service';
import { logAudit } from '../utils/auditLog';

const router = Router();

// audit: MED-014 - allowlist d'hotes S3 https autorises (anti-SSRF).
// L'endpoint S3 est utilise par testS3Connection (requete sortante) : on n'autorise
// que des hosts IONOS connus et on rejette tout host prive/loopback.
const ALLOWED_S3_HOST_SUFFIXES = [
  '.ionoscloud.com',
  '.ionos.com',
  '.ionos.de',
  '.ionos.fr',
];

// audit: INFO-016 - echapper les metacaracteres LIKE (\ % _) pour eviter la sur-correspondance
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => '\\' + c);
}

function isPrivateOrLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h === '0.0.0.0' || h.endsWith('.localhost')) return true;
  // IPv6 loopback / link-local
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  // IPv4 ranges privees / loopback / link-local / metadata cloud
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true; // inclut 169.254.169.254 (metadata)
  return false;
}

// audit: MED-014 - schema Zod de la config S3 ; endpoint doit etre une URL https
// pointant vers un host de l'allowlist, non prive/loopback.
const s3SettingsSchema = z.object({
  endpoint: z.string().trim().min(1).refine((val) => {
    try {
      const u = new URL(val);
      if (u.protocol !== 'https:') return false;
      if (isPrivateOrLoopbackHost(u.hostname)) return false;
      return ALLOWED_S3_HOST_SUFFIXES.some((suf) =>
        u.hostname === suf.slice(1) || u.hostname.endsWith(suf)
      );
    } catch {
      return false;
    }
  }, { message: 'Endpoint S3 invalide (https + host IONOS autorise requis)' }),
  region: z.string().trim().min(1).max(64),
  bucket: z.string().trim().min(1).max(255),
  accessKey: z.string().trim().optional().nullable(),
  secretKey: z.string().trim().optional().nullable(),
});

// All admin routes require admin
router.use(requireAdmin);

// GET /admin/stats
router.get('/stats', async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [usersCount] = await pool.execute('SELECT COUNT(*) as count FROM users');
    const [eventsCount] = await pool.execute('SELECT COUNT(*) as count FROM events');
    const [participantsCount] = await pool.execute('SELECT COUNT(*) as count FROM participants');
    const [submissionsCount] = await pool.execute('SELECT COUNT(*) as count FROM submissions');
    const [challengesCount] = await pool.execute('SELECT COUNT(*) as count FROM challenges');

    const [activeEvents] = await pool.execute("SELECT COUNT(*) as count FROM events WHERE status = 'active'");
    const [endedEvents] = await pool.execute("SELECT COUNT(*) as count FROM events WHERE status = 'ended'");

    const [planCounts] = await pool.execute(
      'SELECT plan, COUNT(*) as count FROM users GROUP BY plan ORDER BY count DESC'
    );

    const [recentUsers] = await pool.execute(
      'SELECT id, first_name, last_name, email, plan, created_at FROM users ORDER BY created_at DESC LIMIT 5'
    );

    const [recentEvents] = await pool.execute(
      `SELECT e.id, e.name, e.code, e.status, e.created_at, u.first_name, u.last_name, u.email as organizer_email
       FROM events e JOIN users u ON e.user_id = u.id
       ORDER BY e.created_at DESC LIMIT 5`
    );

    res.json({
      totals: {
        users: (usersCount as any[])[0].count,
        events: (eventsCount as any[])[0].count,
        participants: (participantsCount as any[])[0].count,
        submissions: (submissionsCount as any[])[0].count,
        challenges: (challengesCount as any[])[0].count,
        activeEvents: (activeEvents as any[])[0].count,
        endedEvents: (endedEvents as any[])[0].count,
      },
      planCounts,
      recentUsers,
      recentEvents,
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /admin/users
router.get('/users', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const search = req.query.search as string || '';
    const plan = req.query.plan as string || '';

    let query = `SELECT id, first_name, last_name, email, plan, is_admin, email_verified,
                        newsletter, created_at, updated_at
                 FROM users WHERE 1=1`;
    const params: any[] = [];

    if (search) {
      // audit: INFO-016 - echapper % _ \ et utiliser ESCAPE pour eviter les jokers injectes
      query += " AND (first_name LIKE ? ESCAPE '\\\\' OR last_name LIKE ? ESCAPE '\\\\' OR email LIKE ? ESCAPE '\\\\')";
      const s = '%' + escapeLike(search) + '%';
      params.push(s, s, s);
    }

    if (plan) {
      query += ' AND plan = ?';
      params.push(plan);
    }

    query += ' ORDER BY created_at DESC';

    const [rows] = await pool.execute(query, params);
    const users = rows as any[];

    // Get event counts per user
    const [eventCounts] = await pool.execute(
      'SELECT user_id, COUNT(*) as count FROM events GROUP BY user_id'
    );
    const eventMap: Record<string, number> = {};
    (eventCounts as any[]).forEach(r => { eventMap[r.user_id] = r.count; });

    const result = users.map(u => ({
      ...u,
      eventCount: eventMap[u.id] || 0,
    }));

    res.json(result);
  } catch (error) {
    console.error('Admin users error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /admin/users — créer un utilisateur déjà vérifié
router.post('/users', validateBody(adminCreateUserSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { firstName, lastName, email, password, plan = 'free' } = req.body;

    const [existing] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
    if ((existing as any[]).length > 0) {
      res.status(409).json({ error: 'Un compte existe déjà avec cet email' });
      return;
    }

    const id = uuidv4();
    const passwordHash = await hashPassword(password);
    const referralCode = crypto.randomBytes(8).toString('hex').substring(0, 8).toUpperCase();

    await pool.execute(
      `INSERT INTO users (id, first_name, last_name, email, password_hash, newsletter, email_verified, plan, referral_code)
       VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)`,
      [id, firstName, lastName, email, passwordHash, plan, referralCode]
    );

    await logAudit('admin.create_user', {
      userId: req.user!.userId,
      entityType: 'user',
      entityId: id,
      details: { email, plan, createdBy: req.user!.userId },
    });

    res.status(201).json({ id, email, firstName, lastName, plan, email_verified: 1 });
  } catch (error) {
    console.error('Admin create user error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /admin/users/:id
router.patch('/users/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { plan, is_admin } = req.body;

    // audit: MED-014 - validation stricte des entrees (pas de validateBody sur cette route)
    // audit: LOW-045 - rejeter une requete sans champ modifiable (400 au lieu de 200 trompeur)
    const hasPlan = plan !== undefined;
    const hasIsAdmin = typeof is_admin === 'number' || typeof is_admin === 'boolean';
    if (!hasPlan && !hasIsAdmin) {
      res.status(400).json({ error: 'Aucun champ a modifier (plan ou is_admin)' });
      return;
    }

    if (hasPlan) {
      if (!['free', 'pro'].includes(plan)) {
        res.status(400).json({ error: 'Plan invalide (free ou pro)' });
        return;
      }
      // audit: LOW-045 - 404 si l'utilisateur n'existe pas
      const [r]: any = await pool.execute('UPDATE users SET plan = ? WHERE id = ?', [plan, id]);
      if (r.affectedRows === 0) {
        res.status(404).json({ error: 'Utilisateur non trouve' });
        return;
      }
      // audit: LOW-045/INFO-014 - tracer la modification de plan via l'action admin
      // dediee (admin.update_user existe desormais dans le type AuditAction, plus de cast).
      await logAudit('admin.update_user', {
        userId: req.user!.userId,
        details: { adminAction: 'update_user_plan', targetUserId: id, plan },
      });
    }

    if (hasIsAdmin) {
      const [r]: any = await pool.execute('UPDATE users SET is_admin = ? WHERE id = ?', [is_admin ? 1 : 0, id]);
      if (r.affectedRows === 0) {
        res.status(404).json({ error: 'Utilisateur non trouve' });
        return;
      }
      // audit: LOW-045/INFO-014 - tracer toute modification d'elevation de privilege
      // (admin.update_user existe dans le type AuditAction : cast retire).
      await logAudit('admin.update_user', {
        userId: req.user!.userId,
        details: { adminAction: 'update_user_is_admin', targetUserId: id, is_admin: is_admin ? 1 : 0 },
      });
    }

    res.json({ message: 'Utilisateur mis a jour' });
  } catch (error) {
    console.error('Admin update user error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /admin/users/:id
router.delete('/users/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // Prevent self-delete
    if (id === req.user!.userId) {
      res.status(400).json({ error: 'Impossible de supprimer votre propre compte' });
      return;
    }

    // audit: MED-015 - collecter les cles S3 (photos + branding) AVANT suppression DB
    const [eventsForKeys] = await pool.execute('SELECT id, logo_key, banner_key FROM events WHERE user_id = ?', [id]);
    const eventList = eventsForKeys as any[];
    const s3Keys: string[] = [];
    for (const ev of eventList) {
      if (ev.logo_key) s3Keys.push(ev.logo_key);
      if (ev.banner_key) s3Keys.push(ev.banner_key);
    }
    if (eventList.length > 0) {
      const placeholders = eventList.map(() => '?').join(',');
      const [subKeys] = await pool.execute(
        `SELECT photo_key FROM submissions WHERE event_id IN (${placeholders}) AND photo_key IS NOT NULL`,
        eventList.map(e => e.id)
      );
      for (const s of subKeys as any[]) {
        if (s.photo_key) s3Keys.push(s.photo_key);
      }
    }

    // audit: HIGH-013 - encapsuler les DELETE multi-tables dans une transaction
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Delete in order: submissions, participants, challenges, events, refresh_tokens, user
      for (const event of eventList) {
        await conn.execute('DELETE FROM submissions WHERE event_id = ?', [event.id]);
        await conn.execute('DELETE FROM participants WHERE event_id = ?', [event.id]);
        await conn.execute('DELETE FROM challenges WHERE event_id = ?', [event.id]);
      }
      await conn.execute('DELETE FROM events WHERE user_id = ?', [id]);
      await conn.execute('DELETE FROM refresh_tokens WHERE user_id = ?', [id]);
      await conn.execute('DELETE FROM users WHERE id = ?', [id]);
      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }

    // audit: MED-015 - nettoyage S3 best-effort apres commit (erreurs seulement loguees)
    if (s3Keys.length > 0) {
      const { deleteFromS3 } = require('../utils/s3Service');
      Promise.all(s3Keys.map((key: string) =>
        deleteFromS3(key).catch((err: any) => console.error('S3 delete error for', key, err))
      )).catch(() => {});
    }

    // audit: INFO-014 - tracer la suppression d'utilisateur via l'action admin dediee
    // (admin.delete_user existe dans le type AuditAction ; l'ancien 'event.delete' etait
    // semantiquement incorrect pour une suppression de compte).
    await logAudit('admin.delete_user', {
      userId: req.user!.userId,
      details: { adminAction: 'delete_user', targetUserId: id },
    });

    res.json({ message: 'Utilisateur supprime' });
  } catch (error) {
    console.error('Admin delete user error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /admin/events
router.get('/events', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const status = req.query.status as string || '';
    if (status && !['active', 'ended', 'archived'].includes(status)) {
      res.status(400).json({ error: 'Statut invalide' });
      return;
    }

    let query = `SELECT e.id, e.name, e.description, e.code, e.status, e.deadline, e.event_date,
                        e.created_at, e.gallery_enabled, e.gallery_locked,
                        u.first_name, u.last_name, u.email as organizer_email, u.plan as organizer_plan,
                        (SELECT COUNT(*) FROM challenges WHERE event_id = e.id) as challenge_count,
                        (SELECT COUNT(*) FROM participants WHERE event_id = e.id) as participant_count,
                        (SELECT COUNT(*) FROM submissions WHERE event_id = e.id) as submission_count
                 FROM events e
                 JOIN users u ON e.user_id = u.id
                 WHERE 1=1`;
    const params: any[] = [];

    if (status) {
      query += ' AND e.status = ?';
      params.push(status);
    }

    query += ' ORDER BY e.created_at DESC';

    const [rows] = await pool.execute(query, params);
    res.json(rows);
  } catch (error) {
    console.error('Admin events error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /admin/events/:id
router.get('/events/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const [eventRows] = await pool.execute(
      `SELECT e.id, e.name, e.description, e.code, e.status, e.deadline, e.event_date,
              e.created_at, e.updated_at, e.gallery_enabled, e.gallery_locked, e.gallery_locked_until,
              e.scoring_mode, e.team_mode, e.theme_color, e.tier, e.logo_key, e.banner_key,
              e.user_id, e.referral_code,
              u.first_name, u.last_name, u.email as organizer_email
       FROM events e JOIN users u ON e.user_id = u.id WHERE e.id = ?`,
      [id]
    );
    const event = (eventRows as any[])[0];
    if (!event) {
      res.status(404).json({ error: 'Evenement non trouve' });
      return;
    }

    const [challenges] = await pool.execute(
      'SELECT * FROM challenges WHERE event_id = ? ORDER BY sort_order',
      [id]
    );

    const [participants] = await pool.execute(
      'SELECT * FROM participants WHERE event_id = ? ORDER BY joined_at',
      [id]
    );

    const [submissions] = await pool.execute(
      `SELECT s.*, p.name as participant_name, c.title as challenge_title
       FROM submissions s
       JOIN participants p ON s.participant_id = p.id
       JOIN challenges c ON s.challenge_id = c.id
       WHERE s.event_id = ?
       ORDER BY s.submitted_at DESC`,
      [id]
    );

    // Renouveler les URLs presignees
    const { getSignedDownloadUrl } = require('../utils/s3Service');
    const subsArray = submissions as any[];
    for (const sub of subsArray) {
      if (sub.photo_key) {
        try {
          sub.photo_url = await getSignedDownloadUrl(sub.photo_key, 86400);
        } catch {
          // Garder l'ancienne URL
        }
      }
    }

    res.json({ event, challenges, participants, submissions: subsArray });
  } catch (error) {
    console.error('Admin event detail error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /admin/events/:id
router.delete('/events/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // audit: LOW-046 - verifier l'existence avant suppression (404 si inexistant)
    const [evRows] = await pool.execute('SELECT id, logo_key, banner_key FROM events WHERE id = ?', [id]);
    if ((evRows as any[]).length === 0) {
      res.status(404).json({ error: 'Evenement non trouve' });
      return;
    }
    const ev = (evRows as any[])[0];

    // audit: MED-015 - collecter les cles S3 (photos + branding) AVANT suppression DB
    const [subKeys] = await pool.execute(
      'SELECT photo_key FROM submissions WHERE event_id = ? AND photo_key IS NOT NULL',
      [id]
    );
    const s3Keys: string[] = (subKeys as any[]).map((s: any) => s.photo_key);
    if (ev.logo_key) s3Keys.push(ev.logo_key);
    if (ev.banner_key) s3Keys.push(ev.banner_key);

    // audit: HIGH-013 - encapsuler les DELETE multi-tables dans une transaction
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('DELETE FROM submissions WHERE event_id = ?', [id]);
      await conn.execute('DELETE FROM participants WHERE event_id = ?', [id]);
      await conn.execute('DELETE FROM challenges WHERE event_id = ?', [id]);
      await conn.execute('DELETE FROM events WHERE id = ?', [id]);
      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }

    // audit: MED-015 - nettoyage S3 best-effort apres commit
    if (s3Keys.length > 0) {
      const { deleteFromS3 } = require('../utils/s3Service');
      Promise.all(s3Keys.map((key: string) =>
        deleteFromS3(key).catch((err: any) => console.error('S3 delete error for', key, err))
      )).catch(() => {});
    }

    // audit: INFO-014 - tracer la suppression d'evenement via l'action admin dediee
    // (admin.delete_event existe desormais dans le type AuditAction).
    await logAudit('admin.delete_event', {
      userId: req.user!.userId,
      entityType: 'event',
      entityId: id as string,
      details: { adminAction: 'delete_event' },
    });

    res.json({ message: 'Evenement supprime' });
  } catch (error) {
    console.error('Admin delete event error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// SETTINGS S3
// ============================================

// GET /admin/settings/s3 ? Retourne la config S3 (secrets masques)
router.get('/settings/s3', async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [rows] = await pool.execute(
      "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('s3_endpoint', 's3_region', 's3_bucket', 's3_access_key', 's3_secret_key')"
    );
    const settings = rows as { setting_key: string; setting_value: string }[];

    const map: Record<string, string> = {};
    for (const s of settings) {
      map[s.setting_key] = s.setting_value;
    }

    // audit: INFO-017 - exposer des booleens de configuration explicites plutot qu'une
    // chaine masquee non vide systematique (frontend non trompeur), sans fuiter le secret.
    const accessKeyConfigured = !!map['s3_access_key'];
    const secretKeyConfigured = !!map['s3_secret_key'];

    res.json({
      configured: !!(map['s3_endpoint'] && map['s3_region'] && map['s3_bucket'] && accessKeyConfigured && secretKeyConfigured),
      endpoint: map['s3_endpoint'] || '',
      region: map['s3_region'] || '',
      bucket: map['s3_bucket'] || '',
      // Ne jamais retourner les secrets en clair : seulement un indicateur masque
      accessKey: accessKeyConfigured ? '???????? (configure)' : '',
      secretKey: secretKeyConfigured ? '???????? (configure)' : '',
      accessKeyConfigured,
      secretKeyConfigured,
    });
  } catch (error) {
    console.error('Admin get S3 settings error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /admin/settings/s3 ? Met a jour la config S3 (chiffre les secrets)
router.put('/settings/s3', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // audit: MED-014 - valider req.body via Zod (endpoint = URL https allowlistee anti-SSRF)
    const parsed = s3SettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      const details = parsed.error.issues.map((e) => e.path.join('.') + ': ' + e.message);
      res.status(400).json({ error: 'Donnees invalides', details });
      return;
    }
    const { endpoint, region, bucket, accessKey, secretKey } = parsed.data;

    // Upsert endpoint, region, bucket (toujours) - valeurs deja trim()ees par Zod
    const settings: { key: string; value: string }[] = [
      { key: 's3_endpoint', value: endpoint },
      { key: 's3_region', value: region },
      { key: 's3_bucket', value: bucket },
    ];

    // Les secrets ne sont mis a jour que si remplis (sinon on garde les anciens)
    if (accessKey && secretKey) {
      settings.push(
        { key: 's3_access_key', value: encrypt(accessKey) },
        { key: 's3_secret_key', value: encrypt(secretKey) },
      );
    } else if (accessKey || secretKey) {
      res.status(400).json({ error: 'Remplissez les deux cles ou aucune' });
      return;
    } else {
      // Verifier qu'il y a deja des cles en BDD
      const [existing] = await pool.execute(
        "SELECT COUNT(*) as count FROM settings WHERE setting_key IN ('s3_access_key', 's3_secret_key')"
      );
      if ((existing as any[])[0].count < 2) {
        res.status(400).json({ error: 'Access Key et Secret Key sont obligatoires pour la premiere configuration' });
        return;
      }
    }

    for (const s of settings) {
      await pool.execute(
        `INSERT INTO settings (setting_key, setting_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW()`,
        [s.key, s.value]
      );
    }

    // Invalider le cache S3 pour prendre en compte les nouveaux credentials
    invalidateS3Cache();

    res.json({ message: 'Configuration S3 sauvegardee' });
  } catch (error) {
    console.error('Admin update S3 settings error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /admin/settings/s3/test ? Teste la connexion S3
router.post('/settings/s3/test', async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Invalider le cache avant le test pour utiliser les derniers credentials
    invalidateS3Cache();
    const result = await testS3Connection();
    res.json(result);
  } catch (error) {
    console.error('Admin test S3 error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur lors du test' });
  }
});

// GET /admin/events/:id/download-zip
router.get('/events/:id/download-zip', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const archiver = require('archiver');

    // Get event info
    const [eventRows] = await pool.execute('SELECT code, name FROM events WHERE id = ?', [id]);
    const event = (eventRows as any[])[0];
    if (!event) {
      res.status(404).json({ error: 'Evenement non trouve' });
      return;
    }

    // Get all submissions with S3 keys
    const [submissions] = await pool.execute(
      `SELECT s.photo_key, s.photo_url, p.name as participant_name, c.title as challenge_title
       FROM submissions s
       JOIN participants p ON s.participant_id = p.id
       JOIN challenges c ON s.challenge_id = c.id
       WHERE s.event_id = ?
       ORDER BY c.sort_order, p.name`,
      [id]
    );

    const subs = submissions as any[];
    if (subs.length === 0) {
      res.status(404).json({ error: 'Aucune photo pour cet evenement' });
      return;
    }

    // Import S3 utils
    const { getS3Client, getS3Config } = require('../utils/s3Service');
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const client = await getS3Client();
    const config = await getS3Config();

    if (!client || !config) {
      res.status(503).json({ error: 'S3 non configure' });
      return;
    }

    // audit: LOW-047 - pre-recuperer les objets S3 AVANT d'envoyer les headers, afin de
    // pouvoir repondre 502 si rien n'est recuperable (au lieu d'un ZIP vide en 200).
    const fetched: { folder: string; fileName: string; body: any }[] = [];
    for (const sub of subs) {
      try {
        const command = new GetObjectCommand({
          Bucket: config.bucket,
          Key: sub.photo_key,
        });
        const s3Response = await client.send(command);
        if (s3Response.Body) {
          const folder = sub.challenge_title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 40);
          const fileName = (sub.participant_name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9 ]/g, '') || 'participant').slice(0, 30) + '.webp';
          fetched.push({ folder, fileName, body: s3Response.Body });
        }
      } catch (err) {
        console.error('Failed to fetch S3 object:', sub.photo_key, err);
      }
    }

    if (fetched.length === 0) {
      res.status(502).json({ error: 'Impossible de recuperer les photos depuis S3' });
      return;
    }

    // Set response headers for ZIP download
    const zipName = event.code + '_' + event.name.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30) + '.zip';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="' + zipName + '"');

    // Create ZIP stream
    const archive = archiver('zip', { zlib: { level: 5 } });
    // audit: LOW-047 - ecouter les erreurs d'archive pour ne pas laisser la reponse pendante
    archive.on('error', (err: Error) => {
      console.error('Admin ZIP archive error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Erreur ZIP' });
    });
    archive.pipe(res);

    for (const f of fetched) {
      archive.append(f.body, { name: f.folder + '/' + f.fileName });
    }

    await archive.finalize();
  } catch (error) {
    console.error('Admin download zip error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
});

// GET /admin/audit-logs
router.get('/audit-logs', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const limit  = Math.min(parseInt(req.query.limit  as string || '50',  10), 200);
    const offset = Math.max(parseInt(req.query.offset as string || '0',   10), 0);
    const userId = req.query.userId as string || '';
    const action = req.query.action as string || '';

    let query = `SELECT a.id, a.user_id, a.action, a.entity_type, a.entity_id, a.details, a.ip, a.created_at,
                        u.first_name, u.last_name, u.email
                 FROM audit_logs a
                 LEFT JOIN users u ON u.id = a.user_id
                 WHERE 1=1`;
    const params: any[] = [];

    if (userId) {
      query += ' AND a.user_id = ?';
      params.push(userId);
    }
    if (action) {
      // audit: INFO-016 - echapper les metacaracteres LIKE
      query += " AND a.action LIKE ? ESCAPE '\\\\'";
      params.push('%' + escapeLike(action) + '%');
    }

    // audit: LOW-049 - interpoler directement les entiers DEJA valides (parseInt + clamp)
    // car mysql2 lie LIMIT/OFFSET en strings -> 'Incorrect arguments to mysqld_stmt_execute'.
    const safeLimit = Number.isFinite(limit) ? limit : 50;
    const safeOffset = Number.isFinite(offset) ? offset : 0;
    query += ` ORDER BY a.created_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`;

    const [rows] = await pool.execute(query, params);
    res.json(rows);
  } catch (error) {
    console.error('Admin audit logs error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /admin/affiliates - Overview of referral program
router.get('/affiliates', async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    // audit: INFO-015 - COALESCE(SUM(CASE ...)) pour eviter NULL et la dependance au sql_mode
    const [totals] = await pool.execute(
      `SELECT COUNT(*) as total,
              COALESCE(SUM(CASE WHEN status='converted' THEN 1 ELSE 0 END), 0) as converted,
              COALESCE(SUM(CASE WHEN status='rewarded' THEN 1 ELSE 0 END), 0) as rewarded
       FROM referrals`
    );
    const [topReferrers] = await pool.execute(
      `SELECT u.id, u.first_name, u.last_name, u.email, COUNT(r.id) as referred_count
       FROM referrals r
       JOIN users u ON u.id = r.referrer_id
       GROUP BY r.referrer_id
       ORDER BY referred_count DESC
       LIMIT 10`
    );
    res.json({ totals: (totals as any[])[0], topReferrers });
  } catch (error) {
    console.error('Admin affiliates error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /admin/impersonate/:userId - Generate tokens to login as a user
router.post('/impersonate/:userId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;

    // audit: HIGH-012 - lire aussi is_admin pour interdire d'impersonner un admin
    const [rows] = await pool.execute(
      'SELECT id, email, first_name, last_name, plan, is_admin FROM users WHERE id = ?',
      [userId]
    );
    const user = (rows as any[])[0];

    if (!user) {
      res.status(404).json({ error: 'Utilisateur non trouve' });
      return;
    }

    // audit: HIGH-012 - interdire l'impersonation d'un compte admin (escalade laterale)
    if (user.is_admin) {
      res.status(403).json({ error: 'Impossible d\'impersonner un administrateur' });
      return;
    }

    const { generateAccessToken, generateRefreshToken, hashToken } = require('../utils/crypto');
    const { v4: uuidv4 } = require('uuid');

    const adminId = req.user!.userId;
    const accessToken = generateAccessToken({ userId: user.id, email: user.email, impersonatedBy: adminId });
    const refreshToken = generateRefreshToken();
    const hashedRefresh = hashToken(refreshToken);

    // audit: HIGH-012 - TTL court (1h) + marquage impersonated_by pour audit/revocation,
    // au lieu d'un refresh token persistant 30j independant de la session admin.
    await pool.execute(
      'INSERT INTO refresh_tokens (id, user_id, token_hash, impersonated_by, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))',
      [uuidv4(), user.id, hashedRefresh, adminId]
    );

    // audit: INFO-014 - 'admin.impersonate' fait desormais partie du type AuditAction
    // (ajoute dans utils/auditLog.ts), le cast 'as any' n'est plus necessaire.
    await logAudit('admin.impersonate', {
      userId: adminId,
      details: { targetUserId: user.id, targetEmail: user.email },
    });

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        plan: user.plan,
        impersonated: true,
      },
    });
  } catch (error) {
    console.error('Admin impersonate error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /admin/participants/:id - Remove a participant and their submissions
router.delete('/participants/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const [rows] = await pool.execute('SELECT id, event_id FROM participants WHERE id = ?', [id]);
    if ((rows as any[]).length === 0) {
      res.status(404).json({ error: 'Participant non trouve' });
      return;
    }

    // audit: MED-015 - collecter les cles S3 des soumissions AVANT suppression DB
    const [subKeys] = await pool.execute(
      'SELECT photo_key FROM submissions WHERE participant_id = ? AND photo_key IS NOT NULL',
      [id]
    );
    const s3Keys: string[] = (subKeys as any[]).map((s: any) => s.photo_key);

    // audit: HIGH-013 - transaction pour la suppression multi-tables
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Delete their submissions first, then the participant
      await conn.execute('DELETE FROM submissions WHERE participant_id = ?', [id]);
      await conn.execute('DELETE FROM participants WHERE id = ?', [id]);
      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }

    // audit: MED-015 - nettoyage S3 best-effort apres commit
    if (s3Keys.length > 0) {
      const { deleteFromS3 } = require('../utils/s3Service');
      Promise.all(s3Keys.map((key: string) =>
        deleteFromS3(key).catch((err: any) => console.error('S3 delete error for', key, err))
      )).catch(() => {});
    }

    // audit: INFO-014 - tracer la suppression de participant (action admin mutatrice)
    await logAudit('admin.delete_participant', {
      userId: req.user!.userId,
      details: { adminAction: 'delete_participant', participantId: id },
    });

    res.json({ message: 'Participant supprime' });
  } catch (error) {
    console.error('Admin delete participant error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
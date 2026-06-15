import { Router, Response } from 'express';
import pool from '../config/database';
import { requireAdmin, AuthRequest } from '../middleware/auth';
import { encrypt } from '../utils/encryption';
import { testS3Connection, invalidateS3Cache } from '../utils/s3Service';
import { logAudit } from '../utils/auditLog';

const router = Router();

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
      query += ' AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)';
      const s = '%' + search + '%';
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

// PATCH /admin/users/:id
router.patch('/users/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { plan, is_admin } = req.body;

    if (plan) {
      if (!['free', 'pro'].includes(plan)) {
        res.status(400).json({ error: 'Plan invalide (free ou pro)' });
        return;
      }
      await pool.execute('UPDATE users SET plan = ? WHERE id = ?', [plan, id]);
    }

    if (typeof is_admin === 'number' || typeof is_admin === 'boolean') {
      await pool.execute('UPDATE users SET is_admin = ? WHERE id = ?', [is_admin ? 1 : 0, id]);
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

    // Delete in order: submissions, participants, challenges, events, refresh_tokens, user
    const [events] = await pool.execute('SELECT id FROM events WHERE user_id = ?', [id]);
    for (const event of events as any[]) {
      await pool.execute('DELETE FROM submissions WHERE event_id = ?', [event.id]);
      await pool.execute('DELETE FROM participants WHERE event_id = ?', [event.id]);
      await pool.execute('DELETE FROM challenges WHERE event_id = ?', [event.id]);
    }
    await pool.execute('DELETE FROM events WHERE user_id = ?', [id]);
    await pool.execute('DELETE FROM refresh_tokens WHERE user_id = ?', [id]);
    await pool.execute('DELETE FROM users WHERE id = ?', [id]);

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
      `SELECT e.*, u.first_name, u.last_name, u.email as organizer_email
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
    await pool.execute('DELETE FROM submissions WHERE event_id = ?', [id]);
    await pool.execute('DELETE FROM participants WHERE event_id = ?', [id]);
    await pool.execute('DELETE FROM challenges WHERE event_id = ?', [id]);
    await pool.execute('DELETE FROM events WHERE id = ?', [id]);
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
      // Ne jamais retourner les secrets en clair
      if (s.setting_key === 's3_access_key' || s.setting_key === 's3_secret_key') {
        map[s.setting_key] = '????????' + (s.setting_value ? ' (configure)' : '');
      } else {
        map[s.setting_key] = s.setting_value;
      }
    }

    res.json({
      configured: settings.length === 5,
      endpoint: map['s3_endpoint'] || '',
      region: map['s3_region'] || '',
      bucket: map['s3_bucket'] || '',
      accessKey: map['s3_access_key'] || '',
      secretKey: map['s3_secret_key'] || '',
    });
  } catch (error) {
    console.error('Admin get S3 settings error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /admin/settings/s3 ? Met a jour la config S3 (chiffre les secrets)
router.put('/settings/s3', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { endpoint, region, bucket, accessKey, secretKey } = req.body;

    if (!endpoint || !region || !bucket) {
      res.status(400).json({ error: 'Endpoint, region et bucket sont obligatoires' });
      return;
    }

    // Upsert endpoint, region, bucket (toujours)
    const settings: { key: string; value: string }[] = [
      { key: 's3_endpoint', value: endpoint.trim() },
      { key: 's3_region', value: region.trim() },
      { key: 's3_bucket', value: bucket.trim() },
    ];

    // Les secrets ne sont mis a jour que si remplis (sinon on garde les anciens)
    if (accessKey && secretKey) {
      settings.push(
        { key: 's3_access_key', value: encrypt(accessKey.trim()) },
        { key: 's3_secret_key', value: encrypt(secretKey.trim()) },
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

    // Set response headers for ZIP download
    const zipName = event.code + '_' + event.name.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30) + '.zip';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="' + zipName + '"');

    // Create ZIP stream
    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.pipe(res);

    // Add each photo to the ZIP
    for (const sub of subs) {
      try {
        const command = new GetObjectCommand({
          Bucket: config.bucket,
          Key: sub.photo_key,
        });
        const s3Response = await client.send(command);

        if (s3Response.Body) {
          // Folder structure: challenge_title/participant_name.webp
          const folder = sub.challenge_title.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 40);
          const fileName = sub.participant_name.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 30) + '.webp';
          archive.append(s3Response.Body, { name: folder + '/' + fileName });
        }
      } catch (err) {
        console.error('Failed to fetch S3 object:', sub.photo_key, err);
      }
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
      query += ' AND a.action LIKE ?';
      params.push('%' + action + '%');
    }

    query += ' ORDER BY a.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

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
    const [totals] = await pool.execute(
      `SELECT COUNT(*) as total, SUM(status='converted') as converted, SUM(status='rewarded') as rewarded FROM referrals`
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

    const [rows] = await pool.execute(
      'SELECT id, email, first_name, last_name, plan FROM users WHERE id = ?',
      [userId]
    );
    const user = (rows as any[])[0];

    if (!user) {
      res.status(404).json({ error: 'Utilisateur non trouve' });
      return;
    }

    const { generateAccessToken, generateRefreshToken, hashToken } = require('../utils/crypto');
    const { v4: uuidv4 } = require('uuid');

    const adminId = req.user!.userId;
    const accessToken = generateAccessToken({ userId: user.id, email: user.email, impersonatedBy: adminId });
    const refreshToken = generateRefreshToken();
    const hashedRefresh = hashToken(refreshToken);

    await pool.execute(
      'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))',
      [uuidv4(), user.id, hashedRefresh]
    );

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

    // Delete their submissions first, then the participant
    await pool.execute('DELETE FROM submissions WHERE participant_id = ?', [id]);
    await pool.execute('DELETE FROM participants WHERE id = ?', [id]);

    res.json({ message: 'Participant supprime' });
  } catch (error) {
    console.error('Admin delete participant error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validateInput';
import { createChallengeSchema } from '../utils/validators';
import { emitToEvent } from '../config/socket';
import { getEventLimit, EVENT_TIER_LIMITS, EventTier } from '../config/plans';
import { deleteFromS3 } from '../utils/s3Service';
// audit: HIGH-008 / CRIT-001 — auth participant pour le vote
import { requireParticipant, ParticipantRequest } from '../middleware/participantAuth';
// audit: HIGH-006 — detection optionnelle de l'organisateur (token user JWT)
import { verifyAccessToken } from '../utils/crypto';
import { rateLimiter } from '../middleware/rateLimiter';

const router = Router();

// audit: HIGH-006 — un organisateur authentifie ET PROPRIETAIRE de l'event voit TOUS
// les defis (y compris les surprises non revelees pour les gerer) ; un visiteur ou
// participant ne voit que les defis non-surprise ou deja reveles.
async function isEventOwnerRequest(req: any, eventId: string): Promise<boolean> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  try {
    const decoded = verifyAccessToken(authHeader.split(' ')[1]);
    const [rows] = await pool.execute(
      'SELECT 1 FROM events WHERE id = ? AND user_id = ? LIMIT 1',
      [eventId, decoded.userId]
    );
    return (rows as any[]).length > 0;
  } catch {
    return false;
  }
}

// GET /events/:eventId/challenges
router.get('/events/:eventId/challenges', rateLimiter(60, 60000), async (req, res: Response): Promise<void> => {
  try {
    const ownerView = await isEventOwnerRequest(req, req.params.eventId as string);
    const sql = ownerView
      ? 'SELECT id, title, description, points, is_surprise, status, sort_order, notified, created_at FROM challenges WHERE event_id = ? ORDER BY sort_order ASC, created_at ASC'
      : 'SELECT id, title, description, points, is_surprise, status, sort_order, notified, created_at FROM challenges WHERE event_id = ? AND (is_surprise = 0 OR notified = 1) ORDER BY sort_order ASC, created_at ASC';
    const [rows] = await pool.execute(sql, [req.params.eventId]);
    res.json(rows);
  } catch (error) {
    console.error('List challenges error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /events/:eventId/challenges
router.post('/events/:eventId/challenges', requireAuth, validateBody(createChallengeSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const eventId = req.params.eventId as string;
    const { title, description, points, isSurprise } = req.body;

    const [eventRows] = await pool.execute(
      'SELECT id, tier FROM events WHERE id = ? AND user_id = ?',
      [eventId, req.user!.userId]
    );
    if ((eventRows as any[]).length === 0) {
      res.status(404).json({ error: 'Evenement non trouve' });
      return;
    }

    const tier = (eventRows as any[])[0]?.tier || 'free';

    // audit: LOW-029 — defis surprise reserves aux tiers premium/pro.
    // Si le tier ne l'autorise pas, on force isSurprise=false plutot que de rejeter.
    const surpriseAllowed = (EVENT_TIER_LIMITS[tier as EventTier] ?? EVENT_TIER_LIMITS.free).surpriseChallenges;
    const effectiveIsSurprise = surpriseAllowed ? (isSurprise || false) : false;

    const [challengeCount] = await pool.execute(
      'SELECT COUNT(*) as count FROM challenges WHERE event_id = ?',
      [eventId]
    );
    const count = (challengeCount as any[])[0].count;
    const limit = getEventLimit(tier, 'challenges');

    if (count >= limit) {
      res.status(403).json({
        error: `Limite de ${limit} defis atteinte pour les evenements gratuits. Achetez un credit Event ou passez au Pro.`,
      });
      return;
    }

    const id = uuidv4();

    await pool.execute(
      'INSERT INTO challenges (id, event_id, title, description, points, is_surprise, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, eventId, title, description || null, points, effectiveIsSurprise, count]
    );

    const challenge = { id, eventId, title, description, points, isSurprise: effectiveIsSurprise, status: 'active' };

    if (!effectiveIsSurprise) {
      emitToEvent(eventId, 'challenge-started', challenge);
    }

    res.status(201).json(challenge);
  } catch (error) {
    console.error('Create challenge error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /challenges/:id/winner/:submissionId
router.post('/challenges/:id/winner/:submissionId', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, submissionId } = req.params;

    const [challengeRows] = await pool.execute(
      'SELECT c.id, c.event_id FROM challenges c JOIN events e ON e.id = c.event_id WHERE c.id = ? AND e.user_id = ?',
      [id, req.user!.userId]
    );
    if ((challengeRows as any[]).length === 0) {
      res.status(404).json({ error: 'Defi non trouve' });
      return;
    }

    const eventId = (challengeRows as any[])[0].event_id as string;

    // audit: MED-009 — selection de gagnant dans une transaction unique.
    // audit: LOW-020 — verifier affectedRows : ne marquer 'judged' que si le
    // submissionId designe un gagnant valide pour ce defi (sinon 404).
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('UPDATE submissions SET is_winner = FALSE WHERE challenge_id = ?', [id]);
      const [winRes] = await conn.execute('UPDATE submissions SET is_winner = TRUE WHERE id = ? AND challenge_id = ?', [submissionId, id]);
      if ((winRes as any).affectedRows !== 1) {
        await conn.rollback();
        res.status(404).json({ error: 'Soumission non trouvee pour ce defi' });
        return;
      }
      await conn.execute("UPDATE challenges SET status = 'judged' WHERE id = ?", [id]);
      await conn.commit();
    } catch (txError) {
      await conn.rollback();
      throw txError;
    } finally {
      conn.release();
    }

    emitToEvent(eventId, 'winner-selected', { challengeId: id, submissionId });
    emitToEvent(eventId, 'leaderboard-updated', {});

    res.json({ message: 'Gagnant designe' });
  } catch (error) {
    console.error('Set winner error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});



// POST /challenges/:id/reveal
router.post('/challenges/:id/reveal', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const [rows] = await pool.execute(
      'SELECT c.event_id, s.id as submission_id, s.photo_url, p.name as winner_name, c.title, c.points FROM challenges c JOIN submissions s ON s.challenge_id = c.id AND s.is_winner = TRUE JOIN participants p ON p.id = s.participant_id JOIN events e ON e.id = c.event_id WHERE c.id = ? AND e.user_id = ?',
      [id, req.user!.userId]
    );
    const results = rows as any[];

    if (results.length === 0) {
      res.status(404).json({ error: 'Aucun gagnant trouve pour ce defi' });
      return;
    }

    const result = results[0];

    await pool.execute('UPDATE challenges SET revealed_at = NOW() WHERE id = ?', [id]);

    emitToEvent(result.event_id as string, 'winner-revealed', {
      challengeId: id,
      challengeTitle: result.title,
      points: result.points,
      winnerName: result.winner_name,
      photoUrl: result.photo_url,
    });


    res.json({ message: 'Gagnant revele' });
  } catch (error) {
    console.error('Reveal winner error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /challenges/:id
router.delete('/challenges/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [rows] = await pool.execute(
      'SELECT c.id, c.event_id FROM challenges c JOIN events e ON e.id = c.event_id WHERE c.id = ? AND e.user_id = ?',
      [req.params.id, req.user!.userId]
    );
    if ((rows as any[]).length === 0) {
      res.status(404).json({ error: 'Defi non trouve' });
      return;
    }

    // Collect S3 keys before deletion
    const [subRows] = await pool.execute(
      'SELECT photo_key FROM submissions WHERE challenge_id = ? AND photo_key IS NOT NULL',
      [req.params.id]
    );
    const s3Keys: string[] = (subRows as any[]).map((s: any) => s.photo_key);

    // audit: LOW-015 — suppressions DB multi-tables dans une transaction unique.
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('DELETE FROM votes WHERE challenge_id = ?', [req.params.id]);
      await conn.execute('DELETE FROM submissions WHERE challenge_id = ?', [req.params.id]);
      await conn.execute('DELETE FROM challenges WHERE id = ?', [req.params.id]);
      await conn.commit();
    } catch (txError) {
      await conn.rollback();
      throw txError;
    } finally {
      conn.release();
    }

    // Delete S3 files (non-blocking)
    // TODO(audit:LOW-015): remplacer le fire-and-forget S3 par une file de retry persistee
    // pour eviter les cles orphelines en cas d'echec S3 sans trace en base.
    if (s3Keys.length > 0) {
      Promise.all(s3Keys.map(key => deleteFromS3(key).catch(err => console.error('S3 delete error for', key, err)))).catch(() => {});
    }

    res.json({ message: 'Defi supprime' });
  } catch (error) {
    console.error('Delete challenge error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /events/:eventId/notify-challenges - Notify participants of new challenges
router.post('/events/:eventId/notify-challenges', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const eventId = req.params.eventId as string;

    // Verify ownership
    const [eventRows] = await pool.execute(
      'SELECT id, name FROM events WHERE id = ? AND user_id = ?',
      [eventId, req.user!.userId]
    );
    if ((eventRows as any[]).length === 0) {
      res.status(404).json({ error: 'Evenement non trouve' });
      return;
    }

    // Get challenges that haven't been notified yet
    const [rows] = await pool.execute(
      'SELECT id, title, points FROM challenges WHERE event_id = ? AND is_surprise = 0 AND notified = 0 ORDER BY sort_order ASC',
      [eventId]
    );
    const newChallenges = rows as any[];

    if (newChallenges.length === 0) {
      res.status(400).json({ error: 'Aucun nouveau defi a notifier' });
      return;
    }

    // Mark as notified
    const ids = newChallenges.map((c: any) => c.id);
    await pool.execute(
      'UPDATE challenges SET notified = 1 WHERE id IN (' + ids.map(() => '?').join(',') + ')',
      ids
    );

    // Emit websocket event
    emitToEvent(eventId, 'new-challenges-alert', {
      challenges: newChallenges.map((c: any) => ({ title: c.title, points: c.points })),
    });

    res.json({ message: 'Participants prevenus', count: newChallenges.length });
  } catch (error) {
    console.error('Notify challenges error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
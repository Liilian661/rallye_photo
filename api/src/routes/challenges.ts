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
router.get('/events/:eventId/challenges', async (req, res: Response): Promise<void> => {
  try {
    // audit: HIGH-006 — masquer les defis surprise non reveles aux non-organisateurs.
    // Un defi surprise est considere revele une fois notifie (notified = 1).
    const ownerView = await isEventOwnerRequest(req, req.params.eventId as string);
    const sql = ownerView
      ? 'SELECT id, title, description, points, is_surprise, status, sort_order, vote_enabled, vote_closed, notified, created_at FROM challenges WHERE event_id = ? ORDER BY sort_order ASC, created_at ASC'
      : 'SELECT id, title, description, points, is_surprise, status, sort_order, vote_enabled, vote_closed, notified, created_at FROM challenges WHERE event_id = ? AND (is_surprise = 0 OR notified = 1) ORDER BY sort_order ASC, created_at ASC';
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

// POST /challenges/:id/enable-vote - Organizer enables public vote
router.post('/challenges/:id/enable-vote', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const [rows] = await pool.execute(
      'SELECT c.id, c.event_id, c.title, c.status, c.vote_enabled, e.tier FROM challenges c JOIN events e ON e.id = c.event_id WHERE c.id = ? AND e.user_id = ?',
      [id, req.user!.userId]
    );
    if ((rows as any[]).length === 0) {
      res.status(404).json({ error: 'Defi non trouve' });
      return;
    }

    const challenge = (rows as any[])[0];

    // audit: LOW-017 — autoriser le vote public selon le TIER de l'event (publicVote),
    // pas seulement le plan user. Un event premium (credit consomme) par un user free
    // doit pouvoir activer le vote.
    const tier = (challenge.tier as EventTier) || 'free';
    if (!(EVENT_TIER_LIMITS[tier] ?? EVENT_TIER_LIMITS.free).publicVote) {
      res.status(403).json({ error: 'Le vote du public est reserve aux evenements Premium ou Pro' });
      return;
    }

    if (challenge.status === 'judged') {
      res.status(400).json({ error: 'Un gagnant a deja ete designe' });
      return;
    }

    await pool.execute('UPDATE challenges SET vote_enabled = 1, vote_closed = 0 WHERE id = ?', [id]);

    emitToEvent(challenge.event_id, 'vote-enabled', { challengeId: id });


    res.json({ message: 'Vote active' });
  } catch (error) {
    console.error('Enable vote error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /challenges/:id/close-vote - Organizer closes vote, auto-select winner
router.post('/challenges/:id/close-vote', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const [rows] = await pool.execute(
      'SELECT c.id, c.event_id, c.vote_enabled FROM challenges c JOIN events e ON e.id = c.event_id WHERE c.id = ? AND e.user_id = ?',
      [id, req.user!.userId]
    );
    if ((rows as any[]).length === 0) {
      res.status(404).json({ error: 'Defi non trouve' });
      return;
    }

    const challenge = (rows as any[])[0];

    if (!challenge.vote_enabled) {
      res.status(400).json({ error: 'Le vote n\'est pas active' });
      return;
    }

    // Count votes per submission
    // audit: LOW-019 — departage deterministe des ex aequo : a egalite de votes,
    // la soumission la plus ancienne (MIN submitted_at) l'emporte.
    const [voteCounts] = await pool.execute(
      `SELECT v.submission_id, COUNT(*) as vote_count, MIN(s.submitted_at) as first_submitted
       FROM votes v
       JOIN submissions s ON s.id = v.submission_id
       WHERE v.challenge_id = ?
       GROUP BY v.submission_id
       ORDER BY vote_count DESC, first_submitted ASC
       LIMIT 1`,
      [id]
    );

    const top = (voteCounts as any[])[0];

    if (!top) {
      res.status(400).json({ error: 'Aucun vote enregistre' });
      return;
    }

    // audit: MED-009 — auto-selection du gagnant dans une transaction unique.
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('UPDATE submissions SET is_winner = FALSE WHERE challenge_id = ?', [id]);
      await conn.execute('UPDATE submissions SET is_winner = TRUE WHERE id = ?', [top.submission_id]);
      await conn.execute("UPDATE challenges SET status = 'judged', vote_closed = 1 WHERE id = ?", [id]);
      await conn.commit();
    } catch (txError) {
      await conn.rollback();
      throw txError;
    } finally {
      conn.release();
    }

    emitToEvent(challenge.event_id, 'vote-closed', { challengeId: id });
    emitToEvent(challenge.event_id, 'winner-selected', { challengeId: id, submissionId: top.submission_id });
    emitToEvent(challenge.event_id, 'leaderboard-updated', {});

    res.json({ message: 'Vote ferme, gagnant designe', winnerId: top.submission_id, voteCount: top.vote_count });
  } catch (error) {
    console.error('Close vote error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /challenges/:challengeId/vote - Participant casts a vote
// audit: HIGH-008 / CRIT-001 — requireParticipant : participantId derive du token, pas du body.
router.post('/challenges/:challengeId/vote', requireParticipant, async (req: ParticipantRequest, res: Response): Promise<void> => {
  try {
    const { challengeId } = req.params;
    const { submissionId } = req.body;
    // audit: HIGH-008 — participantId vient du token signe
    const participantId = req.participant!.participantId;

    if (!submissionId) {
      res.status(400).json({ error: 'submissionId requis' });
      return;
    }

    // Check vote is enabled
    // audit: LOW-018 — joindre events pour rejeter le vote sur un event archive.
    const [challengeRows] = await pool.execute(
      'SELECT c.id, c.event_id, c.vote_enabled, c.vote_closed, e.status as event_status FROM challenges c JOIN events e ON e.id = c.event_id WHERE c.id = ?',
      [challengeId]
    );
    const challenge = (challengeRows as any[])[0];

    if (!challenge) {
      res.status(404).json({ error: 'Defi non trouve' });
      return;
    }

    // audit: HIGH-008 — le token doit etre lie a l'event du defi
    if (challenge.event_id !== req.participant!.eventId) {
      res.status(403).json({ error: 'Acces refuse' });
      return;
    }

    // audit: LOW-018 — pas de vote sur un evenement archive
    if (challenge.event_status === 'archived') {
      res.status(410).json({ error: 'Cet evenement est termine' });
      return;
    }

    if (!challenge.vote_enabled || challenge.vote_closed) {
      res.status(400).json({ error: 'Le vote n\'est pas ouvert pour ce defi' });
      return;
    }

    // Check participant exists and belongs to this event
    const [partRows] = await pool.execute(
      'SELECT id FROM participants WHERE id = ? AND event_id = ?',
      [participantId, challenge.event_id]
    );
    if ((partRows as any[]).length === 0) {
      res.status(403).json({ error: 'Participant non trouve' });
      return;
    }

    // Check submission exists for this challenge
    const [subRows] = await pool.execute(
      'SELECT id, participant_id FROM submissions WHERE id = ? AND challenge_id = ?',
      [submissionId, challengeId]
    );
    if ((subRows as any[]).length === 0) {
      res.status(404).json({ error: 'Soumission non trouvee' });
      return;
    }

    // Can't vote for own photo
    const sub = (subRows as any[])[0];
    if (sub.participant_id === participantId) {
      res.status(400).json({ error: 'Vous ne pouvez pas voter pour votre propre photo' });
      return;
    }

    // audit: MED-008 — anti double-vote par contrainte UNIQUE(challenge_id, participant_id)
    // (MIGRATION_VOTES_UNIQUE.sql) + capture ER_DUP_ENTRY, au lieu d'un SELECT-puis-INSERT TOCTOU.
    const id = uuidv4();
    try {
      await pool.execute(
        'INSERT INTO votes (id, challenge_id, participant_id, submission_id) VALUES (?, ?, ?, ?)',
        [id, challengeId, participantId, submissionId]
      );
    } catch (dbError: any) {
      if (dbError.code === 'ER_DUP_ENTRY') {
        res.status(400).json({ error: 'Vous avez deja vote pour ce defi' });
        return;
      }
      throw dbError;
    }

    // Emit real-time update
    emitToEvent(challenge.event_id, 'vote-cast', { challengeId, submissionId });

    res.status(201).json({ message: 'Vote enregistre' });
  } catch (error) {
    console.error('Cast vote error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /challenges/:challengeId/votes - Get vote counts
// audit: LOW-025 — n'expose plus le decompte de votes en clair a tout tiers :
// exige un token participant du MEME event que le defi.
router.get('/challenges/:challengeId/votes', requireParticipant, async (req: ParticipantRequest, res: Response): Promise<void> => {
  try {
    const { challengeId } = req.params;

    // Verifier que le defi appartient bien a l'event du token participant
    const [chRows] = await pool.execute('SELECT event_id FROM challenges WHERE id = ?', [challengeId]);
    const chEventId = (chRows as any[])[0]?.event_id;
    if (!chEventId || chEventId !== req.participant!.eventId) {
      res.status(403).json({ error: 'Acces refuse' });
      return;
    }

    const [rows] = await pool.execute(
      `SELECT v.submission_id, COUNT(*) as vote_count, p.name as participant_name
       FROM votes v
       JOIN submissions s ON s.id = v.submission_id
       JOIN participants p ON p.id = s.participant_id
       WHERE v.challenge_id = ?
       GROUP BY v.submission_id, p.name
       ORDER BY vote_count DESC`,
      [challengeId]
    );

    const totalVotes = (rows as any[]).reduce((sum: number, r: any) => sum + r.vote_count, 0);

    // audit: LOW-059 — renvoyer le vote du participant courant pour que l'app puisse
    // restaurer l'etat 'Votre vote' apres un rechargement (et eviter de reproposer le vote).
    const [myVoteRows] = await pool.execute(
      'SELECT submission_id FROM votes WHERE challenge_id = ? AND participant_id = ? LIMIT 1',
      [challengeId, req.participant!.participantId]
    );
    const myVote = (myVoteRows as any[])[0]?.submission_id ?? null;

    res.json({ votes: rows, totalVotes, myVote });
  } catch (error) {
    console.error('Get votes error:', error);
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
import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validateInput';
import { createChallengeSchema } from '../utils/validators';
import { emitToEvent } from '../config/socket';

const router = Router();

// GET /events/:eventId/challenges
router.get('/events/:eventId/challenges', async (req, res: Response): Promise<void> => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, title, description, points, is_surprise, status, sort_order, vote_enabled, vote_closed, notified, created_at FROM challenges WHERE event_id = ? ORDER BY sort_order ASC, created_at ASC',
      [req.params.eventId]
    );
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
      'SELECT id FROM events WHERE id = ? AND user_id = ?',
      [eventId, req.user!.userId]
    );
    if ((eventRows as any[]).length === 0) {
      res.status(404).json({ error: 'Evenement non trouve' });
      return;
    }

    const [challengeCount] = await pool.execute(
      'SELECT COUNT(*) as count FROM challenges WHERE event_id = ?',
      [eventId]
    );
    const count = (challengeCount as any[])[0].count;

    const [userRows] = await pool.execute('SELECT plan FROM users WHERE id = ?', [req.user!.userId]);
    const plan = (userRows as any[])[0]?.plan || 'free';

    const limits: Record<string, number> = { free: 2, starter: 10, pro: 999999 };
    if (count >= (limits[plan] || 2)) {
      res.status(403).json({ error: 'Limite de defis atteinte pour le plan ' + plan });
      return;
    }

    const id = uuidv4();

    await pool.execute(
      'INSERT INTO challenges (id, event_id, title, description, points, is_surprise, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, eventId, title, description || null, points, isSurprise || false, count]
    );

    const challenge = { id, eventId, title, description, points, isSurprise, status: 'active' };

    if (!isSurprise) {
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

    await pool.execute('UPDATE submissions SET is_winner = FALSE WHERE challenge_id = ?', [id]);
    await pool.execute('UPDATE submissions SET is_winner = TRUE WHERE id = ? AND challenge_id = ?', [submissionId, id]);
    await pool.execute("UPDATE challenges SET status = 'judged' WHERE id = ?", [id]);

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
      'SELECT c.id, c.event_id, c.title, c.status, c.vote_enabled FROM challenges c JOIN events e ON e.id = c.event_id WHERE c.id = ? AND e.user_id = ?',
      [id, req.user!.userId]
    );
    if ((rows as any[]).length === 0) {
      res.status(404).json({ error: 'Defi non trouve' });
      return;
    }

    const challenge = (rows as any[])[0];

    // Check plan is Pro
    const [userRows] = await pool.execute('SELECT plan FROM users WHERE id = ?', [req.user!.userId]);
    const plan = (userRows as any[])[0]?.plan || 'free';
    if (plan !== 'pro') {
      res.status(403).json({ error: 'Le vote du public est reserve au plan Pro' });
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
    const [voteCounts] = await pool.execute(
      `SELECT submission_id, COUNT(*) as vote_count
       FROM votes WHERE challenge_id = ?
       GROUP BY submission_id
       ORDER BY vote_count DESC
       LIMIT 1`,
      [id]
    );

    const top = (voteCounts as any[])[0];

    if (!top) {
      res.status(400).json({ error: 'Aucun vote enregistre' });
      return;
    }

    // Auto-select winner
    await pool.execute('UPDATE submissions SET is_winner = FALSE WHERE challenge_id = ?', [id]);
    await pool.execute('UPDATE submissions SET is_winner = TRUE WHERE id = ?', [top.submission_id]);
    await pool.execute("UPDATE challenges SET status = 'judged', vote_closed = 1 WHERE id = ?", [id]);

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
router.post('/challenges/:challengeId/vote', async (req, res: Response): Promise<void> => {
  try {
    const { challengeId } = req.params;
    const { participantId, submissionId } = req.body;

    if (!participantId || !submissionId) {
      res.status(400).json({ error: 'participantId et submissionId requis' });
      return;
    }

    // Check vote is enabled
    const [challengeRows] = await pool.execute(
      'SELECT id, event_id, vote_enabled, vote_closed FROM challenges WHERE id = ?',
      [challengeId]
    );
    const challenge = (challengeRows as any[])[0];

    if (!challenge) {
      res.status(404).json({ error: 'Defi non trouve' });
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

    // Check if already voted
    const [existingVote] = await pool.execute(
      'SELECT id FROM votes WHERE challenge_id = ? AND participant_id = ?',
      [challengeId, participantId]
    );
    if ((existingVote as any[]).length > 0) {
      res.status(400).json({ error: 'Vous avez deja vote pour ce defi' });
      return;
    }

    const id = uuidv4();
    await pool.execute(
      'INSERT INTO votes (id, challenge_id, participant_id, submission_id) VALUES (?, ?, ?, ?)',
      [id, challengeId, participantId, submissionId]
    );

    // Emit real-time update
    emitToEvent(challenge.event_id, 'vote-cast', { challengeId, submissionId });

    res.status(201).json({ message: 'Vote enregistre' });
  } catch (error) {
    console.error('Cast vote error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /challenges/:challengeId/votes - Get vote counts
router.get('/challenges/:challengeId/votes', async (req, res: Response): Promise<void> => {
  try {
    const { challengeId } = req.params;

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

    res.json({ votes: rows, totalVotes });
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
      'SELECT c.id FROM challenges c JOIN events e ON e.id = c.event_id WHERE c.id = ? AND e.user_id = ?',
      [req.params.id, req.user!.userId]
    );
    if ((rows as any[]).length === 0) {
      res.status(404).json({ error: 'Defi non trouve' });
      return;
    }

    // Delete votes first
    await pool.execute('DELETE FROM votes WHERE challenge_id = ?', [req.params.id]);
    await pool.execute('DELETE FROM challenges WHERE id = ?', [req.params.id]);
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
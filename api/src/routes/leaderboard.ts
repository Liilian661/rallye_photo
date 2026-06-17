import { Router, Response } from 'express';
import pool from '../config/database';

const router = Router();

// GET /events/:eventId/leaderboard
router.get('/events/:eventId/leaderboard', async (req, res: Response): Promise<void> => {
  try {
    const eventId = req.params.eventId as string;

    const [eventRows] = await pool.execute('SELECT scoring_mode FROM events WHERE id = ?', [eventId]);
    const scoringMode = (eventRows as any[])[0]?.scoring_mode || 'winner';

    let query: string;

    if (scoringMode === 'participation') {
      // audit: LOW-044 - COUNT(DISTINCT challenge) pour eviter le sur-comptage
      // si plusieurs soumissions existent pour un meme (participant, challenge).
      // En mode participation, 'wins' = nombre de defis releves (semantique assumee).
      query = `SELECT
        p.id,
        p.name,
        p.team_id,
        t.name as team_name,
        t.color as team_color,
        COALESCE(SUM(c.points), 0) as total_points,
        COUNT(DISTINCT s.challenge_id) as total_submissions,
        COUNT(DISTINCT s.challenge_id) as wins
       FROM participants p
       LEFT JOIN submissions s ON s.participant_id = p.id AND s.event_id = ?
       LEFT JOIN challenges c ON c.id = s.challenge_id
       LEFT JOIN teams t ON t.id = p.team_id
       WHERE p.event_id = ?
       GROUP BY p.id, p.name, p.team_id, t.name, t.color
       ORDER BY total_points DESC, total_submissions DESC`;
    } else {
      query = `SELECT
        p.id,
        p.name,
        p.team_id,
        t.name as team_name,
        t.color as team_color,
        COALESCE(SUM(CASE WHEN s.is_winner = TRUE THEN c.points ELSE 0 END), 0) as total_points,
        COUNT(s.id) as total_submissions,
        SUM(CASE WHEN s.is_winner = TRUE THEN 1 ELSE 0 END) as wins
       FROM participants p
       LEFT JOIN submissions s ON s.participant_id = p.id AND s.event_id = ?
       LEFT JOIN challenges c ON c.id = s.challenge_id
       LEFT JOIN teams t ON t.id = p.team_id
       WHERE p.event_id = ?
       GROUP BY p.id, p.name, p.team_id, t.name, t.color
       ORDER BY total_points DESC, wins DESC, total_submissions DESC`;
    }

    const [rows] = await pool.execute(query, [eventId, eventId]);

    const leaderboard = (rows as any[]).map((row: any, index: number) => ({
      rank: index + 1,
      id: row.id,
      name: row.name,
      teamName: row.team_name || null,
      teamColor: row.team_color || null,
      totalPoints: Number(row.total_points),
      totalSubmissions: Number(row.total_submissions),
      wins: Number(row.wins),
    }));

    res.json(leaderboard);
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
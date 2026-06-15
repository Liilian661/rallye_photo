import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { emitToEvent } from '../config/socket';

const router = Router();

// POST /events/:eventId/teams - Create a team
router.post('/events/:eventId/teams', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { eventId } = req.params;
    const { name, color } = req.body;

    if (!name || name.trim().length === 0) {
      res.status(400).json({ error: 'Nom requis' });
      return;
    }

    // Verify event ownership
    const [eventRows] = await pool.execute(
      'SELECT id, team_mode FROM events WHERE id = ? AND user_id = ?',
      [eventId, req.user!.userId]
    );
    if ((eventRows as any[]).length === 0) {
      res.status(404).json({ error: 'Evenement non trouve' });
      return;
    }

    const id = uuidv4();
    await pool.execute(
      'INSERT INTO teams (id, event_id, name, color) VALUES (?, ?, ?, ?)',
      [id, eventId, name.trim(), color || '#e91e8c']
    );

    res.status(201).json({ id, name: name.trim(), color: color || '#e91e8c' });
  } catch (error) {
    console.error('Create team error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /events/:eventId/teams - List teams with member count and score
router.get('/events/:eventId/teams', async (req, res: Response): Promise<void> => {
  try {
    const { eventId } = req.params;

    const [rows] = await pool.execute(
      `SELECT t.id, t.name, t.color,
        (SELECT COUNT(*) FROM participants p WHERE p.team_id = t.id) as member_count,
        COALESCE(
          (SELECT SUM(c.points) FROM submissions s 
           JOIN challenges c ON c.id = s.challenge_id 
           JOIN participants p ON p.id = s.participant_id 
           WHERE p.team_id = t.id AND s.event_id = ? AND s.is_winner = 1), 0
        ) as score
       FROM teams t WHERE t.event_id = ? ORDER BY score DESC, t.name ASC`,
      [eventId, eventId]
    );

    res.json(rows);
  } catch (error) {
    console.error('List teams error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /teams/:id - Delete a team
router.delete('/teams/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [rows] = await pool.execute(
      'SELECT t.id, t.event_id FROM teams t JOIN events e ON e.id = t.event_id WHERE t.id = ? AND e.user_id = ?',
      [req.params.id, req.user!.userId]
    );
    if ((rows as any[]).length === 0) {
      res.status(404).json({ error: 'Equipe non trouvee' });
      return;
    }

    // Remove team_id from participants
    await pool.execute('UPDATE participants SET team_id = NULL WHERE team_id = ?', [req.params.id]);
    await pool.execute('DELETE FROM teams WHERE id = ?', [req.params.id]);

    res.json({ message: 'Equipe supprimee' });
  } catch (error) {
    console.error('Delete team error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;

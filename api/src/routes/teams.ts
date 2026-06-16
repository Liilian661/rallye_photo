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

    // audit: LOW-024 - validation du nom (longueur)
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (trimmedName.length === 0 || trimmedName.length > 100) {
      res.status(400).json({ error: 'Nom requis (1-100 caracteres)' });
      return;
    }

    // audit: LOW-024 - validation de la couleur (hex), defaut si absente
    const teamColor = color === undefined || color === null || color === ''
      ? '#e91e8c'
      : color;
    if (!/^#[0-9a-fA-F]{6}$/.test(teamColor)) {
      res.status(400).json({ error: 'Couleur invalide (format hex #rrggbb)' });
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

    // audit: LOW-024 - exiger team_mode active
    const ev = (eventRows as any[])[0];
    if (!ev.team_mode) {
      res.status(400).json({ error: 'Le mode equipe n\'est pas active pour cet evenement' });
      return;
    }

    // audit: LOW-024 - limite du nombre d'equipes par evenement
    const MAX_TEAMS = 50;
    const [teamCount] = await pool.execute(
      'SELECT COUNT(*) as count FROM teams WHERE event_id = ?',
      [eventId]
    );
    if ((teamCount as any[])[0].count >= MAX_TEAMS) {
      res.status(403).json({ error: 'Limite du nombre d\'equipes atteinte' });
      return;
    }

    const id = uuidv4();
    await pool.execute(
      'INSERT INTO teams (id, event_id, name, color) VALUES (?, ?, ?, ?)',
      [id, eventId, trimmedName, teamColor]
    );

    res.status(201).json({ id, name: trimmedName, color: teamColor });
  } catch (error) {
    console.error('Create team error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /events/:eventId/teams - List teams with member count and score
router.get('/events/:eventId/teams', async (req, res: Response): Promise<void> => {
  try {
    const { eventId } = req.params;

    // audit: LOW-026 - ne pas exposer les equipes d'un evenement archive/inexistant.
    // TODO(audit:LOW-026): la liste reste publique car l'app participant n'a pas
    // encore de token d'authentification (cf CRIT-001) ; exiger un token participant
    // du meme event une fois l'auth participant en place pour fermer totalement l'IDOR.
    const [evRows] = await pool.execute(
      "SELECT status FROM events WHERE id = ?",
      [eventId]
    );
    if ((evRows as any[]).length === 0 || (evRows as any[])[0].status === 'archived') {
      res.status(404).json({ error: 'Evenement non trouve' });
      return;
    }

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

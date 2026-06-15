import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import { validateBody } from '../middleware/validateInput';
import { joinEventSchema } from '../utils/validators';
import { emitToEvent } from '../config/socket';

const router = Router();

// POST /events/:eventId/join
router.post('/events/:eventId/join', validateBody(joinEventSchema), async (req, res: Response): Promise<void> => {
  try {
    const eventId = req.params.eventId as string;
    const { name, deviceId, teamId } = req.body;

    const [eventRows] = await pool.execute(
      'SELECT id, status, deadline, team_mode FROM events WHERE id = ?',
      [eventId]
    );
    if ((eventRows as any[]).length === 0) {
      res.status(404).json({ error: 'Evenement non trouve' });
      return;
    }

    const event = (eventRows as any[])[0];
    if (event.status === 'archived') {
      res.status(410).json({ error: 'Cet evenement est termine' });
      return;
    }

    const [ownerRows] = await pool.execute(
      'SELECT u.plan FROM users u JOIN events e ON e.user_id = u.id WHERE e.id = ?',
      [eventId]
    );
    const plan = (ownerRows as any[])[0]?.plan || 'free';
    const limits: Record<string, number> = { free: 30, starter: 100, pro: 999999 };

    const [participantCount] = await pool.execute(
      'SELECT COUNT(*) as count FROM participants WHERE event_id = ?',
      [eventId]
    );
    const count = (participantCount as any[])[0].count;

    if (count >= (limits[plan] || 30)) {
      res.status(403).json({ error: 'Nombre maximum de participants atteint' });
      return;
    }

    // Validate team if team_mode is on
    if (event.team_mode && teamId) {
      const [teamRows] = await pool.execute(
        'SELECT id FROM teams WHERE id = ? AND event_id = ?',
        [teamId, eventId]
      );
      if ((teamRows as any[]).length === 0) {
        res.status(400).json({ error: 'Equipe invalide' });
        return;
      }
    }

    const [existing] = await pool.execute(
      'SELECT id, team_id FROM participants WHERE event_id = ? AND name = ?',
      [eventId, name]
    );

    if ((existing as any[]).length > 0) {
      const participant = (existing as any[])[0];
      // Update team if changed
      if (teamId && participant.team_id !== teamId) {
        await pool.execute('UPDATE participants SET team_id = ? WHERE id = ?', [teamId, participant.id]);
      }
      res.json({ id: participant.id, name, eventId, teamId: teamId || participant.team_id, reconnected: true });
      return;
    }

    const id = uuidv4();

    await pool.execute(
      'INSERT INTO participants (id, event_id, name, device_id, team_id) VALUES (?, ?, ?, ?, ?)',
      [id, eventId, name, deviceId || null, teamId || null]
    );

    emitToEvent(eventId, 'participant-joined', { id, name, teamId });

    res.status(201).json({ id, name, eventId, teamId: teamId || null, reconnected: false });
  } catch (error) {
    console.error('Join event error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /events/:eventId/participants
router.get('/events/:eventId/participants', async (req, res: Response): Promise<void> => {
  try {
    const [rows] = await pool.execute(
      'SELECT p.id, p.name, p.team_id, p.joined_at, t.name as team_name, t.color as team_color FROM participants p LEFT JOIN teams t ON t.id = p.team_id WHERE p.event_id = ? ORDER BY p.joined_at ASC',
      [req.params.eventId]
    );
    res.json(rows);
  } catch (error) {
    console.error('List participants error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
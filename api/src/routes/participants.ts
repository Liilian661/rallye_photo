import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import { validateBody } from '../middleware/validateInput';
import { joinEventSchema } from '../utils/validators';
import { emitToEvent } from '../config/socket';
import { getEventLimit } from '../config/plans';
// audit: CRIT-001 — token participant signe emis au join, et garde sur la liste
import { signParticipantToken, requireParticipant, ParticipantRequest } from '../middleware/participantAuth';
import { rateLimiter } from '../middleware/rateLimiter';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { deleteFromS3 } from '../utils/s3Service';

const router = Router();

// POST /events/:eventId/join
router.post('/events/:eventId/join', rateLimiter(10, 60000), validateBody(joinEventSchema), async (req, res: Response): Promise<void> => {
  try {
    const eventId = req.params.eventId as string;
    const { name, deviceId, teamId } = req.body;

    const [eventRows] = await pool.execute(
      'SELECT id, status, deadline, team_mode, tier FROM events WHERE id = ?',
      [eventId]
    );
    if ((eventRows as any[]).length === 0) {
      res.status(404).json({ error: 'Evenement non trouve' });
      return;
    }

    const event = (eventRows as any[])[0];
    if (event.status !== 'active') {
      res.status(410).json({ error: 'Cet evenement est termine' });
      return;
    }

    const tier = event.tier || 'free';
    const participantLimit = getEventLimit(tier, 'participants');

    // audit: LOW-023 — ne rattacher a une equipe que si team_mode est actif,
    // et valider l'appartenance de l'equipe a CET event des qu'un teamId est fourni.
    // Sinon le teamId etait insere sans validation (rattachement a une equipe d'un autre event).
    let effectiveTeamId: string | null = null;
    if (event.team_mode && teamId) {
      const [teamRows] = await pool.execute(
        'SELECT id FROM teams WHERE id = ? AND event_id = ?',
        [teamId, eventId]
      );
      if ((teamRows as any[]).length === 0) {
        res.status(400).json({ error: 'Equipe invalide' });
        return;
      }
      effectiveTeamId = teamId;
    }

    const [existing] = await pool.execute(
      'SELECT id, team_id, device_id FROM participants WHERE event_id = ? AND name = ?',
      [eventId, name]
    );

    // audit: MED-010 — reconnexion liee au device_id pour eviter l'usurpation
    // d'un participant existant par simple devinette du prenom.
    // Implementation PRUDENTE (le frontend join n'envoie pas encore de deviceId) :
    //  - si le participant stocke a un device_id, on EXIGE un deviceId fourni egal
    //    (sinon le prenom est traite comme deja pris -> 409, l'usurpation est bloquee) ;
    //  - si aucun device_id n'est encore enregistre cote serveur, on autorise la
    //    reconnexion legacy par (event_id, name) et on enregistre le deviceId fourni
    //    pour verrouiller les reconnexions futures.
    // TODO(audit:MED-010): faire envoyer un deviceId stable par les pages de join
    //   (app/src/app/join/[code]/page.tsx, app/src/app/page.tsx) pour un verrouillage complet.
    if ((existing as any[]).length > 0) {
      const participant = (existing as any[])[0];
      if (participant.device_id) {
        const sameDevice = !!deviceId && participant.device_id === deviceId;
        if (!sameDevice) {
          res.status(409).json({ error: 'Ce prenom est deja utilise pour cet evenement. Choisissez-en un autre.' });
          return;
        }
      } else if (deviceId) {
        // Premiere reconnexion avec un deviceId : on l'enregistre pour verrouiller la suite.
        await pool.execute('UPDATE participants SET device_id = ? WHERE id = ?', [deviceId, participant.id]);
      }
      // Update team if changed (audit: LOW-023 — utiliser l'equipe validee)
      if (effectiveTeamId && participant.team_id !== effectiveTeamId) {
        await pool.execute('UPDATE participants SET team_id = ? WHERE id = ?', [effectiveTeamId, participant.id]);
      }
      // audit: CRIT-001 — token signe (reconnexion)
      const participantToken = signParticipantToken(participant.id, eventId);
      res.json({ id: participant.id, name, eventId, teamId: effectiveTeamId || participant.team_id, reconnected: true, participantToken });
      return;
    }

    const id = uuidv4();

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [countRows] = await conn.execute(
        'SELECT COUNT(*) as count FROM participants WHERE event_id = ? FOR UPDATE',
        [eventId]
      );
      const count = (countRows as any[])[0].count;
      if (count >= participantLimit) {
        await conn.rollback();
        res.status(403).json({ error: 'Nombre maximum de participants atteint pour cet evenement' });
        return;
      }
      await conn.execute(
        'INSERT INTO participants (id, event_id, name, device_id, team_id) VALUES (?, ?, ?, ?, ?)',
        [id, eventId, name, deviceId || null, effectiveTeamId]
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    emitToEvent(eventId, 'participant-joined', { id, name, teamId: effectiveTeamId });

    // audit: CRIT-001 — token signe (nouveau participant)
    const participantToken = signParticipantToken(id, eventId);
    res.status(201).json({ id, name, eventId, teamId: effectiveTeamId, reconnected: false, participantToken });
  } catch (error) {
    console.error('Join event error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /events/:eventId/participants
// audit: HIGH-007 — IDOR : liste des participants exposee sans auth. On exige
// desormais un token participant du MEME event (verifie ci-dessous). Le panel
// organisateur dispose de ses propres endpoints (events/admin) pour cette donnee.
router.get('/events/:eventId/participants', requireParticipant, async (req: ParticipantRequest, res: Response): Promise<void> => {
  try {
    if (req.participant!.eventId !== req.params.eventId) {
      res.status(403).json({ error: 'Acces refuse' });
      return;
    }
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

// DELETE /events/:eventId/participants/:participantId
router.delete('/events/:eventId/participants/:participantId', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { eventId, participantId } = req.params;

    // Verify event ownership
    const [eventRows] = await pool.execute(
      'SELECT id FROM events WHERE id = ? AND user_id = ?',
      [eventId, req.user!.userId]
    );
    if ((eventRows as any[]).length === 0) {
      res.status(404).json({ error: 'Evenement non trouve' });
      return;
    }

    // Collect S3 keys for participant's submissions
    const [subRows] = await pool.execute(
      'SELECT photo_key FROM submissions WHERE event_id = ? AND participant_id = ? AND photo_key IS NOT NULL',
      [eventId, participantId]
    );
    const s3Keys: string[] = (subRows as any[]).map((s: any) => s.photo_key);

    // Delete participant's submissions then the participant
    await pool.execute('DELETE FROM submissions WHERE event_id = ? AND participant_id = ?', [eventId, participantId]);
    const [deleteResult] = await pool.execute(
      'DELETE FROM participants WHERE id = ? AND event_id = ?',
      [participantId, eventId]
    );
    if ((deleteResult as any).affectedRows === 0) {
      res.status(404).json({ error: 'Participant non trouve' });
      return;
    }

    // Delete S3 files (non-blocking)
    if (s3Keys.length > 0) {
      Promise.all(s3Keys.map(key => deleteFromS3(key).catch(err => console.error('S3 delete error for', key, err)))).catch(() => {});
    }

    // Notify connected clients
    emitToEvent(eventId, 'participant-removed', { participantId });

    res.json({ message: 'Participant expulse' });
  } catch (error) {
    console.error('Remove participant error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
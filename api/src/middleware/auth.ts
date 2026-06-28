import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/crypto';
import { verifyParticipantToken } from './participantAuth';
import pool from '../config/database';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
  };
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  // Accepter le token depuis le header Authorization OU depuis le cookie HttpOnly
  let token: string | undefined;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.cookies?.accessToken) {
    token = req.cookies.accessToken as string;
  }

  if (!token) {
    res.status(401).json({ error: 'Token manquant' });
    return;
  }

  try {
    const decoded = verifyAccessToken(token);
    req.user = decoded;
    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      res.status(401).json({ error: 'Token expire', code: 'TOKEN_EXPIRED' });
    } else {
      res.status(401).json({ error: 'Token invalide' });
    }
  }
}

// Middleware qui accepte soit un JWT organisateur, soit un token participant.
// req.user est rempli si organisateur, req.participant si participant.
export interface DualAuthRequest extends Request {
  user?: { userId: string; email: string };
  participant?: { participantId: string; eventId: string };
}

export function requireAuthOrParticipant(
  req: DualAuthRequest,
  res: Response,
  next: NextFunction
): void {
  // Accepter le token depuis header Authorization OU cookie HttpOnly
  let token: string | undefined;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.cookies?.accessToken) {
    token = req.cookies.accessToken as string;
  }

  if (!token) {
    res.status(401).json({ error: 'Authentification requise' });
    return;
  }

  try {
    req.user = verifyAccessToken(token);
    next();
    return;
  } catch {}

  const participant = verifyParticipantToken(token);
  if (participant) {
    req.participant = participant;
    next();
    return;
  }

  res.status(401).json({ error: 'Token invalide' });
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  requireAuth(req, res, async () => {
    try {
      const [rows] = await pool.execute(
        'SELECT is_admin FROM users WHERE id = ?',
        [req.user!.userId]
      );
      const user = (rows as any[])[0];
      if (!user || !user.is_admin) {
        res.status(403).json({ error: 'Acces refuse' });
        return;
      }
      next();
    } catch {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });
}

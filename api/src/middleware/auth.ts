import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/crypto';
import pool from '../config/database';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
  };
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token manquant' });
    return;
  }

  const token = authHeader.split(' ')[1];

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

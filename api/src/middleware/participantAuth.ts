import { Request, Response, NextFunction } from 'express';
import jwt, { SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';

// audit: CRIT-001 / HIGH-008 / HIGH-010 / HIGH-011
// Authentification participant : un token signe est emis au join et derive
// l'identite du participant (participantId + eventId) pour submit/vote/delete.
// On ne se fie plus jamais a un participantId fourni par le client.

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // Coherent avec crypto.ts : echec au demarrage si le secret est absent.
  throw new Error('[Startup] JWT_SECRET est requis. Définissez-le dans votre .env');
}

// Cle DERIVEE du JWT_SECRET, dediee aux tokens participant (isolation de domaine).
const PARTICIPANT_KEY = crypto
  .createHash('sha256')
  .update(JWT_SECRET + ':participant')
  .digest('hex');

const PARTICIPANT_EXPIRES_IN = '30d';

interface ParticipantClaims {
  pid: string;
  eid: string;
  typ: 'participant';
}

export interface ParticipantRequest extends Request {
  participant?: {
    participantId: string;
    eventId: string;
  };
}

export function signParticipantToken(participantId: string, eventId: string): string {
  const claims: ParticipantClaims = { pid: participantId, eid: eventId, typ: 'participant' };
  // 'as any' aligne sur crypto.ts : @types/jsonwebtoken@9 type expiresIn comme
  // un StringValue (template literal) auquel un string simple n'est pas assignable.
  const options: SignOptions = { expiresIn: PARTICIPANT_EXPIRES_IN as any };
  return jwt.sign(claims, PARTICIPANT_KEY, options);
}

export function verifyParticipantToken(
  token: string
): { participantId: string; eventId: string } | null {
  try {
    // 'as any' aligne sur photoToken.ts : jwt.verify renvoie string | JwtPayload,
    // qui n'est pas castable directement vers une interface (TS2352).
    const decoded = jwt.verify(token, PARTICIPANT_KEY) as any;
    if (!decoded || decoded.typ !== 'participant' || !decoded.pid || !decoded.eid) {
      return null;
    }
    return { participantId: decoded.pid as string, eventId: decoded.eid as string };
  } catch {
    return null;
  }
}

export function requireParticipant(
  req: ParticipantRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentification participant requise' });
    return;
  }

  const token = authHeader.split(' ')[1];
  const verified = verifyParticipantToken(token);
  if (!verified) {
    res.status(401).json({ error: 'Token participant invalide' });
    return;
  }

  req.participant = { participantId: verified.participantId, eventId: verified.eventId };
  next();
}

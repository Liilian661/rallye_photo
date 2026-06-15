import bcrypt from 'bcrypt';
import jwt, { SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12');
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-me';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateAccessToken(payload: { userId: string; email: string }): string {
  const options: SignOptions = {
    expiresIn: (process.env.JWT_ACCESS_EXPIRES || '15m') as any,
  };
  return jwt.sign(payload, JWT_SECRET, options);
}

export function generateRefreshToken(): string {
  return crypto.randomUUID();
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function verifyAccessToken(token: string): { userId: string; email: string } {
  return jwt.verify(token, JWT_SECRET) as { userId: string; email: string };
}

export function generateEmailToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

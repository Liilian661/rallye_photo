import bcrypt from 'bcrypt';
import jwt, { SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';

const BCRYPT_ROUNDS = Math.max(10, parseInt(process.env.BCRYPT_ROUNDS || '12'));
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('[Startup] JWT_SECRET est requis. Définissez-le dans votre .env');
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// audit: MED-002 — hash bcrypt factice (meme cout BCRYPT_ROUNDS) calcule une seule fois
// au chargement du module, pour egaliser le temps de reponse de /auth/login quand l'email
// n'existe pas (anti-enumeration par timing). Genere depuis une valeur aleatoire : il ne
// correspond a aucun mot de passe, donc bcrypt.compare retournera toujours false.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), BCRYPT_ROUNDS);

// audit: MED-002 — execute une comparaison bcrypt factice (cout constant) sans reveler
// l'inexistence de l'utilisateur.
export async function comparePasswordDummy(password: string): Promise<boolean> {
  return bcrypt.compare(password, DUMMY_PASSWORD_HASH);
}

export function generateAccessToken(payload: { userId: string; email: string; impersonatedBy?: string }): string {
  const options: SignOptions = {
    expiresIn: (process.env.JWT_ACCESS_EXPIRES || '15m') as any,
  };
  return jwt.sign(payload, JWT_SECRET!, options);
}

export function generateRefreshToken(): string {
  return crypto.randomUUID();
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function verifyAccessToken(token: string): { userId: string; email: string; impersonatedBy?: string } {
  return jwt.verify(token, JWT_SECRET!) as { userId: string; email: string; impersonatedBy?: string };
}

export function generateEmailToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

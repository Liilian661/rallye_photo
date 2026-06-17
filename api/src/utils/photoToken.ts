import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// Pepper global - ne change jamais, stocke dans l'env
const PHOTO_PEPPER = process.env.PHOTO_PEPPER;
if (!PHOTO_PEPPER) {
  throw new Error('[Startup] PHOTO_PEPPER est requis. Définissez-le dans votre .env');
}

/**
 * Genere un secret unique par event (appele a la creation de l'event)
 * 64 bytes random en hex = 128 chars
 */
export function generateEventPhotoSecret(): string {
  return crypto.randomBytes(64).toString('hex');
}

/**
 * Derive une cle de signature a partir du secret event + pepper + salt
 * Utilise PBKDF2 avec 100k iterations
 */
function deriveSigningKey(eventSecret: string, salt: string): string {
  return crypto.pbkdf2Sync(
    eventSecret + PHOTO_PEPPER,
    salt,
    100000,
    64,
    'sha512'
  ).toString('hex');
}

/**
 * Signe un token photo pour une image donnee
 */
export function signPhotoToken(
  photoKey: string,
  eventId: string,
  eventSecret: string,
  expiresInSeconds: number = 86400 // 24h par defaut
): string {
  // Salt unique par token
  const salt = crypto.randomBytes(16).toString('hex');
  
  // Derive la cle de signature
  const signingKey = deriveSigningKey(eventSecret, salt);
  
  // Nonce anti-replay
  const nonce = crypto.randomBytes(8).toString('hex');
  
  const payload = {
    k: photoKey,    // photo_key S3
    e: eventId,     // event_id
    s: salt,        // salt unique
    n: nonce,       // nonce anti-replay
  };

  return jwt.sign(payload, signingKey, {
    expiresIn: expiresInSeconds,
    algorithm: 'HS512',
  });
}

/**
 * Verifie et decode un token photo
 * Retourne le photo_key S3 si valide, null sinon
 */
// audit: LOW-003 — expectedEventId optionnel : defense en profondeur. Quand l'appelant
// connait l'event attendu via un contexte serveur independant, on rejette tout token
// dont l'eventId verifie ne correspond pas, plutot que de faire confiance au seul champ
// du token pour resoudre le secret.
export function verifyPhotoToken(
  token: string,
  eventSecret: string,
  expectedEventId?: string
): { photoKey: string; eventId: string } | null {
  try {
    // Decode sans verifier d'abord pour extraire le salt
    const decoded = jwt.decode(token) as any;
    if (!decoded || !decoded.s || !decoded.k || !decoded.e) return null;

    // Re-derive la cle avec le salt du token
    const signingKey = deriveSigningKey(eventSecret, decoded.s);

    // Verification complete (signature + expiration)
    const verified = jwt.verify(token, signingKey, {
      algorithms: ['HS512'],
    }) as any;

    // audit: LOW-003 — rejette si l'eventId verifie ne correspond pas a l'event attendu.
    if (expectedEventId !== undefined && verified.e !== expectedEventId) {
      return null;
    }

    return {
      photoKey: verified.k,
      eventId: verified.e,
    };
  } catch {
    return null;
  }
}
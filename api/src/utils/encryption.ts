import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error('ENCRYPTION_KEY manquante ou invalide dans .env (doit etre 64 chars hex = 32 bytes)');
  }
  return Buffer.from(key, 'hex');
}

/**
 * Chiffre une valeur en AES-256-GCM
 * Retourne: iv:tag:ciphertext (tout en hex)
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;
}

/**
 * Dechiffre une valeur chiffree par encrypt()
 */
export function decrypt(encryptedValue: string): string {
  const key = getEncryptionKey();
  const parts = encryptedValue.split(':');

  if (parts.length !== 3) {
    throw new Error('Format de donnee chiffree invalide');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const ciphertext = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Genere une cle de chiffrement aleatoire (a mettre dans .env)
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString('hex');
}
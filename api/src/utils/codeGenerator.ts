import crypto from 'crypto';
import pool from '../config/database';

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// audit: MED-001 — utilise crypto.randomInt (CSPRNG) au lieu de Math.random pour
// rendre les codes d'event imprevisibles/non enumerables.
function randomCode(length: number = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CHARS.charAt(crypto.randomInt(0, CHARS.length));
  }
  return code;
}

// audit: MED-001 — le SELECT d'unicite ci-dessous reste un pre-check best-effort
// (reduction des collisions). La garantie reelle d'unicite repose sur la contrainte
// UNIQUE(events.code) ajoutee par MIGRATION_EVENT_CODE_UNIQUE.sql : l'appelant (events.ts)
// doit capturer ER_DUP_ENTRY a l'INSERT et reessayer en cas de course concurrente (TOCTOU).
export async function generateUniqueEventCode(): Promise<string> {
  let code: string;
  let exists = true;

  do {
    code = randomCode(6);
    const [rows] = await pool.execute(
      'SELECT id FROM events WHERE code = ?',
      [code]
    );
    exists = (rows as any[]).length > 0;
  } while (exists);

  return code;
}

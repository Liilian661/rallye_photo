import pool from '../config/database';

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(length: number = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CHARS.charAt(Math.floor(Math.random() * CHARS.length));
  }
  return code;
}

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

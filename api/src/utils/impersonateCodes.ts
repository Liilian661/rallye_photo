import crypto from 'crypto';

interface ImpersonateCode {
  userId: string;
  adminId: string;
  expiresAt: number;
}

const codes = new Map<string, ImpersonateCode>();

// Nettoyage lazy des codes expirés toutes les 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [code, entry] of codes) {
    if (entry.expiresAt <= now) codes.delete(code);
  }
}, 5 * 60 * 1000);

export function createImpersonateCode(userId: string, adminId: string): string {
  const code = crypto.randomBytes(32).toString('hex');
  codes.set(code, { userId, adminId, expiresAt: Date.now() + 60_000 });
  return code;
}

export function consumeImpersonateCode(code: string): ImpersonateCode | null {
  const entry = codes.get(code);
  if (!entry) return null;
  codes.delete(code); // usage unique
  if (entry.expiresAt <= Date.now()) return null;
  return entry;
}

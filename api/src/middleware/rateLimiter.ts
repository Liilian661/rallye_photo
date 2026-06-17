import { Request, Response, NextFunction } from 'express';

// audit: MED-012 — Store en memoire process-locale.
// EN CLUSTER (PM2 cluster / multi-instance) ce compteur est par-process : les
// limites sont multipliees par le nombre d'instances et incoherentes apres
// redemarrage. TODO(audit:MED-012): passer sur un store partage Redis
// (ex: rate-limit-redis) pour un comptage global fiable.
const requests = new Map<string, { count: number; resetTime: number }>();

// audit: MED-012 — Borne la taille de la Map pour eviter une croissance memoire
// non bornee (DoS par enumeration d'IP uniques). Au-dela de cette taille on
// declenche un nettoyage lazy, puis on evince la plus ancienne entree si besoin.
const MAX_ENTRIES = 50000;

// audit: MED-012 — Nettoyage lazy des entrees expirees (en complement du timer
// periodique), declenche quand la Map approche la borne.
function pruneExpired(now: number): void {
  for (const [ip, record] of requests) {
    if (now > record.resetTime) {
      requests.delete(ip);
    }
  }
}

export function rateLimiter(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const record = requests.get(ip);

    if (!record || now > record.resetTime) {
      // audit: MED-012 — borne de taille + nettoyage lazy avant insertion
      if (requests.size >= MAX_ENTRIES) {
        pruneExpired(now);
        if (requests.size >= MAX_ENTRIES) {
          // Map toujours pleine d'entrees actives : evince la plus ancienne
          // (insertion order) pour garder une borne stricte.
          const oldest = requests.keys().next().value;
          if (oldest !== undefined) requests.delete(oldest);
        }
      }
      requests.set(ip, { count: 1, resetTime: now + windowMs });
      next();
      return;
    }

    if (record.count >= maxRequests) {
      res.status(429).json({ error: 'Trop de requetes, reessayez plus tard' });
      return;
    }

    record.count++;
    next();
  };
}

setInterval(() => {
  pruneExpired(Date.now());
}, 5 * 60 * 1000);

import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';

// --- Redis setup (optionnel) ---
// Si REDIS_URL est defini, on utilise Redis pour un comptage global (cluster-safe).
// Sinon on reste sur la Map in-memory (compat mode sans Redis).
let redis: Redis | null = null;

if (process.env.REDIS_URL) {
  try {
    redis = new Redis(process.env.REDIS_URL, {
      // Eviter de bloquer le demarrage si Redis est indisponible
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
    redis.on('error', (err) => {
      // Log sans crash : on basculera sur la Map locale dans le middleware
      console.error('[RateLimiter] Redis error (fallback to local Map):', err.message);
    });
    // Connexion non bloquante
    redis.connect().catch((err) => {
      console.error('[RateLimiter] Redis connect failed (fallback to local Map):', err.message);
    });
  } catch (err: any) {
    console.error('[RateLimiter] Redis init failed (fallback to local Map):', err.message);
    redis = null;
  }
}

// --- Map in-memory (fallback) ---
// audit: MED-012 — Store en memoire process-locale.
// EN CLUSTER (PM2 cluster / multi-instance) ce compteur est par-process : les
// limites sont multipliees par le nombre d'instances et incoherentes apres
// redemarrage. Configurer REDIS_URL pour un comptage global fiable.
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

// --- Logique Redis ---
async function checkRateRedis(
  key: string,
  maxRequests: number,
  windowSecs: number
): Promise<boolean> {
  // Retourne true si la requete est autorisee, false si elle depasse la limite.
  // Leve une exception si Redis est down (l'appelant capturera et basculera sur la Map).
  const count = await redis!.incr(key);
  if (count === 1) {
    // Premiere requete dans cette fenetre : poser le TTL
    await redis!.expire(key, windowSecs);
  }
  return count <= maxRequests;
}

// --- Logique Map locale ---
function checkRateLocal(
  ip: string,
  maxRequests: number,
  windowMs: number,
  now: number
): boolean {
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
    return true;
  }

  if (record.count >= maxRequests) {
    return false;
  }

  record.count++;
  return true;
}

// --- Middleware principal ---
export function rateLimiter(maxRequests: number, windowMs: number) {
  const windowSecs = Math.ceil(windowMs / 1000);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    // Tenter Redis si disponible et connecte
    if (redis && redis.status === 'ready') {
      try {
        const redisKey = `rl:${ip}`;
        const allowed = await checkRateRedis(redisKey, maxRequests, windowSecs);
        if (!allowed) {
          res.status(429).json({ error: 'Trop de requetes, reessayez plus tard' });
          return;
        }
        next();
        return;
      } catch (err: any) {
        // Redis down : fallback gracieux sur la Map locale
        console.error('[RateLimiter] Redis check failed, falling back to local Map:', err.message);
      }
    }

    // Fallback Map locale
    const allowed = checkRateLocal(ip, maxRequests, windowMs, now);
    if (!allowed) {
      res.status(429).json({ error: 'Trop de requetes, reessayez plus tard' });
      return;
    }
    next();
  };
}

setInterval(() => {
  pruneExpired(Date.now());
}, 5 * 60 * 1000);

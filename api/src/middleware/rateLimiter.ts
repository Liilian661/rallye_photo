import { Request, Response, NextFunction } from 'express';

const requests = new Map<string, { count: number; resetTime: number }>();

export function rateLimiter(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const record = requests.get(ip);

    if (!record || now > record.resetTime) {
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
  const now = Date.now();
  for (const [ip, record] of requests) {
    if (now > record.resetTime) {
      requests.delete(ip);
    }
  }
}, 5 * 60 * 1000);

import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import { hashPassword, comparePassword, generateAccessToken, generateRefreshToken, hashToken, generateEmailToken } from '../utils/crypto';
import { registerSchema, loginSchema } from '../utils/validators';
import { validateBody } from '../middleware/validateInput';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimiter';
import { sendVerificationEmail, sendResetPasswordEmail, sendWelcomeEmail } from '../utils/emailService';
import { logAudit } from '../utils/auditLog';

const router = Router();

function getIp(req: any): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
}

function generateReferralCode(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

// POST /auth/register
router.post('/register', rateLimiter(5, 60000), validateBody(registerSchema), async (req, res: Response): Promise<void> => {
  try {
    const { firstName, lastName, email, password, newsletter, referralCode } = req.body;

    const [existing] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
    if ((existing as any[]).length > 0) {
      res.status(409).json({ error: 'Un compte existe deja avec cet email' });
      return;
    }

    const id            = uuidv4();
    const passwordHash  = await hashPassword(password);
    const emailToken    = generateEmailToken();
    const myReferralCode = generateReferralCode();

    // Resolve referrer
    let referrerId: string | null = null;
    if (referralCode && typeof referralCode === 'string') {
      const code = referralCode.toUpperCase().trim();
      const [refRows] = await pool.execute(
        'SELECT id FROM users WHERE referral_code = ? AND id != ?',
        [code, id]
      );
      const referrer = (refRows as any[])[0];
      if (referrer) referrerId = referrer.id;
    }

    await pool.execute(
      'INSERT INTO users (id, first_name, last_name, email, password_hash, newsletter, email_verify_token, referral_code, referred_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, firstName, lastName, email, passwordHash, newsletter, emailToken, myReferralCode, referrerId]
    );

    // Track referral
    if (referrerId) {
      await pool.execute(
        'INSERT INTO referrals (id, referrer_id, referred_id, status) VALUES (?, ?, ?, ?)',
        [uuidv4(), referrerId, id, 'pending']
      ).catch((err) => console.error('[Referral] Insert failed:', err));
    }

    const accessToken      = generateAccessToken({ userId: id, email });
    const refreshToken     = generateRefreshToken();
    const refreshTokenHash = hashToken(refreshToken);
    const refreshExpires   = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const familyId         = uuidv4();

    await pool.execute(
      'INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, expires_at) VALUES (?, ?, ?, ?, ?)',
      [uuidv4(), id, refreshTokenHash, familyId, refreshExpires]
    );

    sendVerificationEmail(email, firstName, emailToken).catch((err) => {
      console.error('Failed to send verification email:', err);
    });

    logAudit('user.register', {
      userId: id,
      details: { email, referredBy: referrerId ?? undefined },
      ip: getIp(req),
    });

    res.status(201).json({
      user: { id, firstName, lastName, email, plan: 'free', eventCredits: 0 },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /auth/verify-email?token=xxx
router.get('/verify-email', async (req, res: Response): Promise<void> => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
      res.status(400).json({ error: 'Token manquant' });
      return;
    }

    const [rows] = await pool.execute(
      'SELECT id, first_name, email FROM users WHERE email_verify_token = ?',
      [token]
    );
    const users = rows as any[];

    if (users.length === 0) {
      res.status(400).json({ error: 'Token invalide ou deja utilise' });
      return;
    }

    const user = users[0];

    await pool.execute(
      'UPDATE users SET email_verified = 1, email_verify_token = NULL WHERE id = ?',
      [user.id]
    );

    logAudit('user.verify_email', { userId: user.id, ip: getIp(req) });

    // Send welcome email non-blocking
    sendWelcomeEmail(user.email, user.first_name).catch((err) => {
      console.error('Failed to send welcome email:', err);
    });

    res.json({ message: 'Email verifie avec succes' });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /auth/resend-verification
router.post('/resend-verification', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, first_name, email, email_verified FROM users WHERE id = ?',
      [req.user!.userId]
    );
    const users = rows as any[];

    if (users.length === 0) {
      res.status(404).json({ error: 'Utilisateur non trouve' });
      return;
    }

    const user = users[0];

    if (user.email_verified) {
      res.json({ message: 'Email deja verifie' });
      return;
    }

    const newToken = generateEmailToken();
    await pool.execute(
      'UPDATE users SET email_verify_token = ? WHERE id = ?',
      [newToken, user.id]
    );

    await sendVerificationEmail(user.email, user.first_name, newToken);

    res.json({ message: 'Email de verification renvoye' });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /auth/forgot-password
router.post('/forgot-password', rateLimiter(3, 60000), async (req, res: Response): Promise<void> => {
  try {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ error: 'Email requis' });
      return;
    }

    const [rows] = await pool.execute(
      'SELECT id, first_name, email FROM users WHERE email = ?',
      [email]
    );
    const users = rows as any[];

    if (users.length === 0) {
      res.json({ message: 'Si un compte existe avec cet email, un lien de reinitialisation a ete envoye' });
      return;
    }

    const user       = users[0];
    const resetToken = generateEmailToken();
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000);

    await pool.execute(
      'UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
      [resetToken, resetExpires, user.id]
    );

    await sendResetPasswordEmail(user.email, user.first_name, resetToken);

    logAudit('user.forgot_password', { userId: user.id, ip: getIp(req) });

    res.json({ message: 'Si un compte existe avec cet email, un lien de reinitialisation a ete envoye' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /auth/reset-password
router.post('/reset-password', rateLimiter(5, 60000), async (req, res: Response): Promise<void> => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      res.status(400).json({ error: 'Token et mot de passe requis' });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caracteres' });
      return;
    }

    const [rows] = await pool.execute(
      'SELECT id FROM users WHERE reset_token = ? AND reset_token_expires > UTC_TIMESTAMP()',
      [token]
    );
    const users = rows as any[];

    if (users.length === 0) {
      res.status(400).json({ error: 'Token invalide ou expire' });
      return;
    }

    const passwordHash = await hashPassword(password);

    await pool.execute(
      'UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?',
      [passwordHash, users[0].id]
    );

    await pool.execute('DELETE FROM refresh_tokens WHERE user_id = ?', [users[0].id]);

    logAudit('user.reset_password', { userId: users[0].id, ip: getIp(req) });

    res.json({ message: 'Mot de passe reinitialise avec succes' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /auth/login
router.post('/login', rateLimiter(10, 60000), validateBody(loginSchema), async (req, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    const [rows] = await pool.execute(
      'SELECT id, first_name, last_name, email, password_hash, plan, event_credits FROM users WHERE email = ?',
      [email]
    );
    const users = rows as any[];

    if (users.length === 0) {
      res.status(401).json({ error: 'Email ou mot de passe incorrect' });
      return;
    }

    const user = users[0];
    const validPassword = await comparePassword(password, user.password_hash);

    if (!validPassword) {
      res.status(401).json({ error: 'Email ou mot de passe incorrect' });
      return;
    }

    const accessToken      = generateAccessToken({ userId: user.id, email: user.email });
    const refreshToken     = generateRefreshToken();
    const refreshTokenHash = hashToken(refreshToken);
    const refreshExpires   = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const familyId         = uuidv4();

    await pool.execute(
      'INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, expires_at) VALUES (?, ?, ?, ?, ?)',
      [uuidv4(), user.id, refreshTokenHash, familyId, refreshExpires]
    );

    logAudit('user.login', { userId: user.id, ip: getIp(req) });

    res.json({
      user: {
        id:           user.id,
        firstName:    user.first_name,
        lastName:     user.last_name,
        email:        user.email,
        plan:         user.plan,
        eventCredits: user.event_credits ?? 0,
      },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /auth/refresh
router.post('/refresh', async (req, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      res.status(400).json({ error: 'Refresh token manquant' });
      return;
    }

    const tokenHash = hashToken(refreshToken);

    const [rows] = await pool.execute(
      `SELECT rt.id, rt.user_id, rt.expires_at, rt.family_id, rt.used_at, u.email
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = ?`,
      [tokenHash]
    );
    const tokens = rows as any[];

    if (tokens.length === 0) {
      res.status(401).json({ error: 'Refresh token invalide' });
      return;
    }

    const record = tokens[0];

    // ── Reuse detection ──────────────────────────────────────────────────────
    // Si le token existe mais a déjà été consommé (used_at non null),
    // c'est un signe de vol : on invalide toute la famille.
    if (record.used_at !== null) {
      if (record.family_id) {
        await pool.execute('DELETE FROM refresh_tokens WHERE family_id = ?', [record.family_id]);
      } else {
        await pool.execute('DELETE FROM refresh_tokens WHERE user_id = ?', [record.user_id]);
      }
      console.warn('[Security] Refresh token reuse detected for user', record.user_id, '— all sessions invalidated');
      logAudit('user.logout', {
        userId: record.user_id,
        details: { reason: 'refresh_token_reuse', familyId: record.family_id ?? null },
        ip: getIp(req),
      });
      res.status(401).json({ error: 'Session invalide, veuillez vous reconnecter' });
      return;
    }
    // ────────────────────────────────────────────────────────────────────────

    if (new Date(record.expires_at) < new Date()) {
      await pool.execute('DELETE FROM refresh_tokens WHERE id = ?', [record.id]);
      res.status(401).json({ error: 'Refresh token expire' });
      return;
    }

    // Marquer le token courant comme consommé (ne pas supprimer → reuse detection)
    await pool.execute('UPDATE refresh_tokens SET used_at = NOW() WHERE id = ?', [record.id]);

    const newAccessToken  = generateAccessToken({ userId: record.user_id, email: record.email });
    const newRefreshToken = generateRefreshToken();
    const newRefreshHash  = hashToken(newRefreshToken);
    const refreshExpires  = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await pool.execute(
      'INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, expires_at) VALUES (?, ?, ?, ?, ?)',
      [uuidv4(), record.user_id, newRefreshHash, record.family_id ?? uuidv4(), refreshExpires]
    );

    // Nettoyage opportuniste : supprimer les tokens consommés de plus de 30 jours
    pool.execute(
      'DELETE FROM refresh_tokens WHERE user_id = ? AND used_at IS NOT NULL AND used_at < DATE_SUB(NOW(), INTERVAL 30 DAY)',
      [record.user_id]
    ).catch(() => {});

    res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch (error) {
    console.error('Refresh error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /auth/logout
router.post('/logout', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      const tokenHash = hashToken(refreshToken);
      await pool.execute('DELETE FROM refresh_tokens WHERE token_hash = ?', [tokenHash]);
    }

    await pool.execute(
      'DELETE FROM refresh_tokens WHERE user_id = ? AND expires_at < NOW()',
      [req.user!.userId]
    );

    logAudit('user.logout', { userId: req.user!.userId, ip: getIp(req) });

    res.json({ message: 'Deconnexion reussie' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /auth/me
router.get('/me', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, first_name, last_name, email, plan, event_credits, referral_code, newsletter, email_verified, is_admin, created_at FROM users WHERE id = ?',
      [req.user!.userId]
    );
    const users = rows as any[];

    if (users.length === 0) {
      res.status(404).json({ error: 'Utilisateur non trouve' });
      return;
    }

    const user = users[0];
    res.json({
      id:           user.id,
      firstName:    user.first_name,
      lastName:     user.last_name,
      email:        user.email,
      plan:         user.plan,
      eventCredits: user.event_credits ?? 0,
      referralCode: user.referral_code,
      newsletter:   user.newsletter,
      emailVerified: user.email_verified,
      isAdmin:      !!user.is_admin,
      createdAt:    user.created_at,
    });
  } catch (error) {
    console.error('Me error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;

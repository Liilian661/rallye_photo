import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import { hashPassword, comparePassword, generateAccessToken, generateRefreshToken, hashToken, generateEmailToken } from '../utils/crypto';
import { registerSchema, loginSchema } from '../utils/validators';
import { validateBody } from '../middleware/validateInput';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimiter';
import { sendVerificationEmail, sendResetPasswordEmail } from '../utils/emailService';

const router = Router();

// POST /auth/register
router.post('/register', rateLimiter(5, 60000), validateBody(registerSchema), async (req, res: Response): Promise<void> => {
  try {
    const { firstName, lastName, email, password, newsletter } = req.body;

    const [existing] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
    if ((existing as any[]).length > 0) {
      res.status(409).json({ error: 'Un compte existe deja avec cet email' });
      return;
    }

    const id = uuidv4();
    const passwordHash = await hashPassword(password);
    const emailToken = generateEmailToken();

    await pool.execute(
      'INSERT INTO users (id, first_name, last_name, email, password_hash, newsletter, email_verify_token) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, firstName, lastName, email, passwordHash, newsletter, emailToken]
    );

    const accessToken = generateAccessToken({ userId: id, email });
    const refreshToken = generateRefreshToken();
    const refreshTokenHash = hashToken(refreshToken);
    const refreshExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await pool.execute(
      'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
      [uuidv4(), id, refreshTokenHash, refreshExpires]
    );

    // Send verification email (non-blocking)
    sendVerificationEmail(email, firstName, emailToken).catch((err) => {
      console.error('Failed to send verification email:', err);
    });

    res.status(201).json({
      user: { id, firstName, lastName, email, plan: 'free' },
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
      'SELECT id, first_name FROM users WHERE email_verify_token = ?',
      [token]
    );
    const users = rows as any[];

    if (users.length === 0) {
      res.status(400).json({ error: 'Token invalide ou deja utilise' });
      return;
    }

    await pool.execute(
      'UPDATE users SET email_verified = 1, email_verify_token = NULL WHERE id = ?',
      [users[0].id]
    );

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

    const user = users[0];
    const resetToken = generateEmailToken();
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000);

    await pool.execute(
      'UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
      [resetToken, resetExpires, user.id]
    );

    await sendResetPasswordEmail(user.email, user.first_name, resetToken);

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
      'SELECT id, first_name, last_name, email, password_hash, plan FROM users WHERE email = ?',
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

    const accessToken = generateAccessToken({ userId: user.id, email: user.email });
    const refreshToken = generateRefreshToken();
    const refreshTokenHash = hashToken(refreshToken);
    const refreshExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await pool.execute(
      'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
      [uuidv4(), user.id, refreshTokenHash, refreshExpires]
    );

    res.json({
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        plan: user.plan,
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
      'SELECT rt.id, rt.user_id, rt.expires_at, u.email FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id WHERE rt.token_hash = ?',
      [tokenHash]
    );
    const tokens = rows as any[];

    if (tokens.length === 0) {
      res.status(401).json({ error: 'Refresh token invalide' });
      return;
    }

    const record = tokens[0];

    if (new Date(record.expires_at) < new Date()) {
      await pool.execute('DELETE FROM refresh_tokens WHERE id = ?', [record.id]);
      res.status(401).json({ error: 'Refresh token expire' });
      return;
    }

    await pool.execute('DELETE FROM refresh_tokens WHERE id = ?', [record.id]);

    const newAccessToken = generateAccessToken({ userId: record.user_id, email: record.email });
    const newRefreshToken = generateRefreshToken();
    const newRefreshHash = hashToken(newRefreshToken);
    const refreshExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await pool.execute(
      'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
      [uuidv4(), record.user_id, newRefreshHash, refreshExpires]
    );

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
      'SELECT id, first_name, last_name, email, plan, newsletter, email_verified, is_admin, created_at FROM users WHERE id = ?',
      [req.user!.userId]
    );
    const users = rows as any[];

    if (users.length === 0) {
      res.status(404).json({ error: 'Utilisateur non trouve' });
      return;
    }

    const user = users[0];
    res.json({
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      plan: user.plan,
      newsletter: user.newsletter,
      emailVerified: user.email_verified,
      isAdmin: !!user.is_admin,
      createdAt: user.created_at,
    });
  } catch (error) {
    console.error('Me error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
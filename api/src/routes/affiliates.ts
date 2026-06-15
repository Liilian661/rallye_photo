import { Router, Response } from 'express';
import pool from '../config/database';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /affiliates/me — Referral code + stats for current user
router.get('/me', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;

    const [userRows] = await pool.execute(
      'SELECT referral_code FROM users WHERE id = ?',
      [userId]
    );
    const user = (userRows as any[])[0];
    if (!user) {
      res.status(404).json({ error: 'Utilisateur non trouve' });
      return;
    }

    const [statsRows] = await pool.execute(
      `SELECT
         COUNT(*)                                                  AS total_referred,
         SUM(status IN ('converted','rewarded'))                  AS converted,
         SUM(status = 'rewarded')                                 AS rewarded
       FROM referrals WHERE referrer_id = ?`,
      [userId]
    );
    const s = (statsRows as any[])[0];

    const [referralRows] = await pool.execute(
      `SELECT r.status, r.created_at, r.converted_at,
              u.first_name, u.last_name
       FROM referrals r
       JOIN users u ON u.id = r.referred_id
       WHERE r.referrer_id = ?
       ORDER BY r.created_at DESC
       LIMIT 20`,
      [userId]
    );

    const panelUrl = process.env.PANEL_URL || 'https://panel.rallye-photo.com';
    const referralLink = `${panelUrl}/auth/register?ref=${user.referral_code}`;

    res.json({
      referralCode: user.referral_code,
      referralLink,
      stats: {
        totalReferred: Number(s?.total_referred) || 0,
        converted:     Number(s?.converted)      || 0,
        rewarded:      Number(s?.rewarded)        || 0,
      },
      referrals: referralRows,
    });
  } catch (error) {
    console.error('Affiliates /me error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /affiliates/me/code — Personnaliser son code de parrainage
router.patch('/me/code', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const { code } = req.body;

    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'Code requis' });
      return;
    }

    const clean = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (clean.length < 4 || clean.length > 8) {
      res.status(400).json({ error: 'Le code doit contenir entre 4 et 8 caractères alphanumériques' });
      return;
    }

    // Vérifier unicité
    const [existing] = await pool.execute(
      'SELECT id FROM users WHERE referral_code = ? AND id != ?',
      [clean, userId]
    );
    if ((existing as any[]).length > 0) {
      res.status(409).json({ error: 'Ce code est déjà utilisé, choisissez-en un autre' });
      return;
    }

    await pool.execute('UPDATE users SET referral_code = ? WHERE id = ?', [clean, userId]);

    res.json({ referralCode: clean });
  } catch (error) {
    console.error('Affiliates PATCH /me/code error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;

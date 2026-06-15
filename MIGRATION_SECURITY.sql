-- ============================================================
-- MIGRATION_SECURITY.sql
-- Refresh token reuse detection (token family rotation)
-- ============================================================

-- Ajoute family_id (groupe de tokens issus du même login)
-- et used_at (marqueur de consommation, NULL = encore valide)
ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS family_id VARCHAR(36) NULL AFTER token_hash,
  ADD COLUMN IF NOT EXISTS used_at   DATETIME    NULL AFTER expires_at;

-- Index pour invalidation rapide d'une famille entière
ALTER TABLE refresh_tokens
  ADD INDEX IF NOT EXISTS idx_rt_family (family_id);

-- Nettoyage : supprimer les tokens consommés depuis plus de 30 jours
-- (à lancer manuellement ou via event MySQL si activé)
-- DELETE FROM refresh_tokens WHERE used_at IS NOT NULL AND used_at < DATE_SUB(NOW(), INTERVAL 30 DAY);

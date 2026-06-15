-- ============================================================
-- MIGRATION_FEATURES.sql
-- Email de bienvenue, Affiliation, Logs d'audit, Stripe Pro
-- ============================================================

-- 1. Audit logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id          VARCHAR(36)   NOT NULL PRIMARY KEY,
  user_id     VARCHAR(36)   NULL,
  action      VARCHAR(100)  NOT NULL,
  entity_type VARCHAR(50)   NULL,
  entity_id   VARCHAR(36)   NULL,
  details     JSON          NULL,
  ip          VARCHAR(45)   NULL,
  created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_user    (user_id),
  INDEX idx_audit_action  (action),
  INDEX idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Colonnes affiliation + stripe sur users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS referral_code      VARCHAR(8)   UNIQUE NULL       AFTER event_credits,
  ADD COLUMN IF NOT EXISTS referred_by        VARCHAR(36)  NULL              AFTER referral_code,
  ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(100) UNIQUE NULL       AFTER referred_by,
  ADD COLUMN IF NOT EXISTS pro_expires_at     DATETIME     NULL              AFTER stripe_customer_id;

-- 3. Table referrals
CREATE TABLE IF NOT EXISTS referrals (
  id           VARCHAR(36)                               NOT NULL PRIMARY KEY,
  referrer_id  VARCHAR(36)                               NOT NULL,
  referred_id  VARCHAR(36)                               NOT NULL,
  status       ENUM('pending','converted','rewarded')    NOT NULL DEFAULT 'pending',
  reward_given TINYINT                                   NOT NULL DEFAULT 0,
  created_at   TIMESTAMP                                 NOT NULL DEFAULT CURRENT_TIMESTAMP,
  converted_at DATETIME                                  NULL,
  UNIQUE KEY uk_referred (referred_id),
  INDEX idx_ref_referrer (referrer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Colonne grace period Pro sur events
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS gallery_locked_until DATETIME NULL AFTER gallery_locked;

-- 5. Générer des codes d'affiliation pour les utilisateurs existants (MD5 pour reproductibilité)
UPDATE users
SET referral_code = UPPER(SUBSTRING(REPLACE(UUID(), '-', ''), 1, 8))
WHERE referral_code IS NULL;

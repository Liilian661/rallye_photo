-- ============================================================
-- MIGRATION_AUTH_TOKEN_HARDENING.sql
-- audit: HIGH-002 / LOW-007 — Durcissement des tokens email
--
-- 1) Ajoute une date d'expiration au token de verification d'email
--    (email_verify_token_expires), par symetrie avec reset_token_expires.
-- 2) Note : email_verify_token et reset_token sont desormais stockes HASHES
--    (SHA-256 hex = 64 caracteres) par le code applicatif (api/src/routes/auth.ts).
--    Si ces colonnes sont plus courtes que VARCHAR(64), on les elargit.
--    Les tokens en clair existants deviendront non verifiables apres deploiement
--    (ils n'etaient de toute facon valables que jusqu'a verification/reset).
--
-- Ordre de migration recommande : PLANS -> FEATURES -> SECURITY -> EVENT_CODE_UNIQUE
--   -> AUTH_TOKEN_HARDENING. Idempotent.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verify_token_expires DATETIME NULL AFTER email_verify_token;

-- S'assurer que les colonnes peuvent contenir un digest SHA-256 hex (64 caracteres).
-- MODIFY est idempotent (re-applique le meme type sans erreur).
ALTER TABLE users
  MODIFY COLUMN email_verify_token VARCHAR(64) NULL,
  MODIFY COLUMN reset_token        VARCHAR(64) NULL;

-- Invalider les tokens en clair pre-existants (ils ne matcheront plus les hash).
UPDATE users
SET email_verify_token = NULL, email_verify_token_expires = NULL
WHERE email_verify_token IS NOT NULL;

UPDATE users
SET reset_token = NULL, reset_token_expires = NULL
WHERE reset_token IS NOT NULL;

-- ============================================================
-- MIGRATION_IMPERSONATION.sql
-- audit: HIGH-012
-- Marque les refresh tokens emis lors d'une impersonation admin :
--  - impersonated_by : id de l'admin a l'origine de l'impersonation (NULL sinon)
-- Permet l'audit et la revocation ciblee des sessions d'impersonation,
-- en complement du TTL court applique cote API.
-- Ordre d'execution recommande : apres MIGRATION_SECURITY.sql.
-- ============================================================

ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS impersonated_by VARCHAR(36) NULL AFTER family_id;

ALTER TABLE refresh_tokens
  ADD INDEX IF NOT EXISTS idx_rt_impersonated_by (impersonated_by);

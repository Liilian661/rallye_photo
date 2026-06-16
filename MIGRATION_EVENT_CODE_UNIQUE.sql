-- ============================================================
-- MIGRATION_EVENT_CODE_UNIQUE.sql
-- audit: MED-001 — Contrainte d'unicite sur events.code
--
-- But : remplacer la garantie d'unicite TOCTOU (SELECT-puis-INSERT dans
-- generateUniqueEventCode + events.ts) par une contrainte UNIQUE en base.
-- L'appelant (api/src/routes/events.ts) doit desormais capturer ER_DUP_ENTRY
-- a l'INSERT et regenerer un code en cas de collision concurrente.
--
-- Ordre de migration recommande : PLANS -> FEATURES -> SECURITY -> EVENT_CODE_UNIQUE.
-- Idempotent : ne s'execute que si l'index n'existe pas deja.
-- ============================================================

-- Pre-requis : aucune valeur dupliquee ne doit exister avant d'ajouter la contrainte.
-- (Decommenter pour diagnostiquer d'eventuels doublons avant migration.)
-- SELECT code, COUNT(*) c FROM events GROUP BY code HAVING c > 1;

-- Ajout conditionnel de la contrainte UNIQUE sur events.code.
-- MySQL/MariaDB n'acceptant pas "ADD UNIQUE IF NOT EXISTS", on teste
-- l'existence dans information_schema avant d'executer l'ALTER.
SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'events'
    AND INDEX_NAME   = 'uk_events_code'
);

SET @ddl := IF(
  @idx_exists = 0,
  'ALTER TABLE events ADD CONSTRAINT uk_events_code UNIQUE (code)',
  'SELECT "uk_events_code already exists, skipping" AS note'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================
-- MIGRATION_WEBHOOK_IDEMPOTENCY.sql
-- Idempotence robuste des webhooks Stripe (HIGH-003 / HIGH-004)
-- A executer UNE SEULE FOIS en production.
-- Ordre des migrations : PLANS -> FEATURES -> SECURITY -> WEBHOOK_IDEMPOTENCY
-- ============================================================

-- Marqueur d'idempotence : chaque event Stripe traite est insere ici.
-- La cle primaire sur stripe_event_id garantit qu'un INSERT-first
-- echouera (ER_DUP_ENTRY) sur toute relivraison/replay du meme event,
-- permettant de l'ignorer atomiquement.
CREATE TABLE IF NOT EXISTS processed_webhook_events (
  stripe_event_id VARCHAR(255) NOT NULL PRIMARY KEY,
  type            VARCHAR(100) NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

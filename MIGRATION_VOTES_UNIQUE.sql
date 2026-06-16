-- ============================================================
-- MIGRATION_VOTES_UNIQUE.sql
-- Contrainte d'unicite anti double-vote (HIGH-008 / MED-008)
-- A executer UNE SEULE FOIS en production.
-- Ordre des migrations : PLANS -> FEATURES -> SECURITY -> WEBHOOK_IDEMPOTENCY -> VOTES_UNIQUE
-- ============================================================

-- Empeche tout participant de voter deux fois pour un meme defi.
-- L'INSERT applicatif (challenges.ts POST /:challengeId/vote) s'appuie
-- desormais sur cette contrainte : un second vote concurrent echoue
-- avec ER_DUP_ENTRY (capture serveur) au lieu d'un SELECT-puis-INSERT
-- non atomique (TOCTOU).
--
-- NB : si des doublons existent deja, les supprimer AVANT d'ajouter la
-- contrainte (sinon l'ALTER echoue) :
--   DELETE v1 FROM votes v1
--   JOIN votes v2
--     ON v1.challenge_id = v2.challenge_id
--    AND v1.participant_id = v2.participant_id
--    AND v1.id > v2.id;

ALTER TABLE votes
  ADD CONSTRAINT uniq_vote_per_challenge_participant
  UNIQUE (challenge_id, participant_id);

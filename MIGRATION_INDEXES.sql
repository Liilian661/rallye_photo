-- ============================================================
-- MIGRATION_INDEXES.sql
-- Index manquants critiques identifies par audit performance (2026-07-25).
-- Idempotent : ADD INDEX IF NOT EXISTS (MariaDB 10.1+).
-- A executer apres toutes les migrations existantes.
-- ============================================================

-- events.user_id : toutes les routes organisateur filtrent par user_id
ALTER TABLE events ADD INDEX IF NOT EXISTS idx_events_user_id (user_id);

-- events.status : webhooks + admin filtrent sur status
ALTER TABLE events ADD INDEX IF NOT EXISTS idx_events_status (status);

-- events.created_at : ORDER BY created_at DESC
ALTER TABLE events ADD INDEX IF NOT EXISTS idx_events_created_at (created_at);

-- challenges.event_id : toutes les routes challenges filtrent par event_id
ALTER TABLE challenges ADD INDEX IF NOT EXISTS idx_challenges_event_id (event_id);

-- submissions.event_id : galerie, leaderboard, exports
ALTER TABLE submissions ADD INDEX IF NOT EXISTS idx_submissions_event_id (event_id);

-- submissions.challenge_id : GET /challenges/:id/submissions, DELETE challenge
ALTER TABLE submissions ADD INDEX IF NOT EXISTS idx_submissions_challenge_id (challenge_id);

-- submissions.participant_id : DELETE participant -> ses soumissions
ALTER TABLE submissions ADD INDEX IF NOT EXISTS idx_submissions_participant_id (participant_id);

-- participants.event_id : JOIN event, COUNT participants, expulsion
ALTER TABLE participants ADD INDEX IF NOT EXISTS idx_participants_event_id (event_id);

-- participants.(event_id, name) : recherche de participant existant a la jointure
ALTER TABLE participants ADD INDEX IF NOT EXISTS idx_participants_event_name (event_id, name);

-- participants.team_id : DELETE team -> SET NULL sur les membres
ALTER TABLE participants ADD INDEX IF NOT EXISTS idx_participants_team_id (team_id);

-- refresh_tokens.token_hash : lookup central du /auth/refresh (tres frequent)
ALTER TABLE refresh_tokens ADD INDEX IF NOT EXISTS idx_refresh_tokens_hash (token_hash);

-- refresh_tokens.user_id : DELETE sur logout/reset
ALTER TABLE refresh_tokens ADD INDEX IF NOT EXISTS idx_refresh_tokens_user_id (user_id);

-- gallery_access.event_id : SELECT ... ORDER BY created_at LIMIT 1
ALTER TABLE gallery_access ADD INDEX IF NOT EXISTS idx_gallery_access_event_id (event_id);

-- teams.event_id : GET teams par event
ALTER TABLE teams ADD INDEX IF NOT EXISTS idx_teams_event_id (event_id);

-- audit_logs.created_at : ORDER BY et purge par date
-- (idx_audit_created existe peut-etre deja via MIGRATION_FEATURES.sql)
ALTER TABLE audit_logs ADD INDEX IF NOT EXISTS idx_audit_created_at (created_at);

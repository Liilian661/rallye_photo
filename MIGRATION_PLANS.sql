-- ============================================================
--  Migration : refonte des plans tarifaires
--  À exécuter UNE SEULE FOIS en production
--  Date : 2026-06-15
-- ============================================================

-- 1. Ajouter la colonne tier sur les événements
ALTER TABLE events
  ADD COLUMN tier ENUM('free', 'premium', 'pro') NOT NULL DEFAULT 'free'
  AFTER status;

-- 2. Ajouter les crédits événement sur les utilisateurs
ALTER TABLE users
  ADD COLUMN event_credits INT NOT NULL DEFAULT 0
  AFTER plan;

-- 3. Migrer les anciens plans :
--    starter → pro  (grandfathering)
--    pro     → pro  (inchangé)
--    free    → free (inchangé)
UPDATE users SET plan = 'pro' WHERE plan IN ('starter', 'pro');

-- 4. Modifier l'enum plan pour supprimer 'starter'
--    (attention: MariaDB reconstruit la table)
ALTER TABLE users
  MODIFY COLUMN plan ENUM('free', 'pro') NOT NULL DEFAULT 'free';

-- 5. Mettre à jour le tier des événements existants
--    selon le plan de l'organisateur au moment de la migration
UPDATE events e
JOIN users u ON u.id = e.user_id
SET e.tier = CASE
  WHEN u.plan = 'pro' THEN 'pro'
  ELSE 'free'
END;

-- 6. Vérification rapide
SELECT
  plan,
  COUNT(*) AS nb_users,
  SUM(event_credits) AS total_credits
FROM users
GROUP BY plan;

SELECT
  tier,
  COUNT(*) AS nb_events
FROM events
GROUP BY tier;

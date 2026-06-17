# Migrations SQL — Rallye Photo

> Document de reference pour l'execution des migrations SQL (MariaDB en production).
> Cree en reponse a l'audit (findings LOW-092, LOW-086, LOW-087, INFO-035, INFO-036
> et directive infra : documenter l'ordre PLANS -> FEATURES -> SECURITY -> nouveaux).

Les migrations sont des fichiers `MIGRATION_*.sql` a la racine du depot. Elles **ne sont
pas** versionnees par un outil de migration : leur application est **manuelle** (ou via
`deploy.sh`, etape « Application des migrations SQL », avant le restart PM2).

## Ordre d'execution OBLIGATOIRE

L'ordre ci-dessous est **imperatif** : certaines migrations referencent des colonnes
creees par une migration anterieure (dependances inter-fichiers).

| # | Fichier | Cree / modifie | Depend de |
|---|---------|----------------|-----------|
| 1 | `MIGRATION_PLANS.sql` | `events.tier`, `users.event_credits`, enum `users.plan` | base initiale |
| 2 | `MIGRATION_FEATURES.sql` | `audit_logs`, `users.referral_code/referred_by/stripe_customer_id/pro_expires_at`, table `referrals`, `events.gallery_locked_until` | **1** (`referral_code AFTER event_credits`) |
| 3 | `MIGRATION_SECURITY.sql` | `refresh_tokens.family_id`, `refresh_tokens.used_at`, index `idx_rt_family` | base (`refresh_tokens`) |
| 4 | `MIGRATION_WEBHOOK_IDEMPOTENCY.sql` | table `processed_webhook_events` | base |
| 5 | `MIGRATION_EVENT_CODE_UNIQUE.sql` | contrainte `uk_events_code` sur `events.code` | base (`events`) |
| 6 | `MIGRATION_AUTH_TOKEN_HARDENING.sql` | `users.email_verify_token_expires`, elargit `email_verify_token`/`reset_token` a VARCHAR(64) | **2** (colonnes tokens existantes) |
| 7 | `MIGRATION_VOTES_UNIQUE.sql` | contrainte `uniq_vote_per_challenge_participant` sur `votes` | base (`votes`) |
| 8 | `MIGRATION_IMPERSONATION.sql` | `refresh_tokens.impersonated_by`, index `idx_rt_impersonated_by` | **3** (`AFTER family_id`) |

Resume de l'ordre : **PLANS -> FEATURES -> SECURITY -> WEBHOOK_IDEMPOTENCY ->
EVENT_CODE_UNIQUE -> AUTH_TOKEN_HARDENING -> VOTES_UNIQUE -> IMPERSONATION**.

### Pourquoi cet ordre (dependances clefs)

- `MIGRATION_FEATURES` fait `ADD COLUMN referral_code ... AFTER event_credits` :
  `event_credits` n'existe **que** apres `MIGRATION_PLANS`. Inverser l'ordre fait echouer
  l'ALTER avec « Unknown column 'event_credits' in AFTER ». (audit: LOW-092)
- `MIGRATION_IMPERSONATION` fait `ADD COLUMN impersonated_by ... AFTER family_id` :
  `family_id` est cree par `MIGRATION_SECURITY`.
- `MIGRATION_AUTH_TOKEN_HARDENING` part du principe que les colonnes
  `email_verify_token` / `reset_token` existent deja dans le schema de base `users`.

## Idempotence

| Fichier | Idempotent ? | Remarque |
|---------|--------------|----------|
| `MIGRATION_PLANS.sql` | **NON** | `ADD COLUMN tier` / `event_credits` ne sont pas gardes par `IF NOT EXISTS`, et `UPDATE`/`MODIFY enum` ne sont pas rejouables sans effet. Re-run = erreur « Duplicate column ». A n'executer **qu'une seule fois** (base neuve). Voir INFO-036. |
| `MIGRATION_FEATURES.sql` | Partiel | `CREATE TABLE IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS` sont idempotents. L'`UPDATE referral_code` final n'est pas reproductible (UUID) et peut, en theorie, violer l'unique sur collision (LOW-086) — re-execution sure car gardee par `WHERE referral_code IS NULL`. |
| `MIGRATION_SECURITY.sql` | Oui | `ADD COLUMN IF NOT EXISTS` + `ADD INDEX IF NOT EXISTS` (extensions MariaDB, cf LOW-087). |
| `MIGRATION_WEBHOOK_IDEMPOTENCY.sql` | Oui | `CREATE TABLE IF NOT EXISTS`. |
| `MIGRATION_EVENT_CODE_UNIQUE.sql` | Oui | Teste `information_schema.STATISTICS` avant l'ALTER (compatible MySQL/MariaDB). |
| `MIGRATION_AUTH_TOKEN_HARDENING.sql` | Oui | `ADD COLUMN IF NOT EXISTS` + `MODIFY` (re-appliquer le meme type est sans effet). |
| `MIGRATION_VOTES_UNIQUE.sql` | **NON** (re-run) | `ADD CONSTRAINT UNIQUE` sans garde ; un second run echoue (« Duplicate key name »). Inoffensif car l'erreur stoppe sans corrompre. |
| `MIGRATION_IMPERSONATION.sql` | Oui | `ADD COLUMN IF NOT EXISTS` + `ADD INDEX IF NOT EXISTS` (MariaDB). |

### Portabilite MySQL vs MariaDB (audit: LOW-087)

Plusieurs migrations utilisent `ADD COLUMN IF NOT EXISTS` / `ADD INDEX IF NOT EXISTS`,
qui sont des **extensions MariaDB**. La cible de production est MariaDB : ces fichiers
fonctionnent en prod. **MySQL 8 ne supporte pas** `ADD INDEX IF NOT EXISTS` ; une
execution sur un environnement MySQL (CI/dev local) echouera. `MIGRATION_EVENT_CODE_UNIQUE`
est, lui, ecrit de facon portable (test via `information_schema`).

## Procedure recommandee

1. **Sauvegarder** la base (`mysqldump`) avant toute migration.
2. Verifier l'environnement cible : **MariaDB** (cf portabilite ci-dessus).
3. Sur une base **deja partiellement migree**, ne PAS rejouer `MIGRATION_PLANS.sql`
   ni `MIGRATION_VOTES_UNIQUE.sql` (non idempotents). `deploy.sh` saute
   `MIGRATION_PLANS.sql` par defaut (variable `RUN_PLANS_MIGRATION` a positionner a `1`
   uniquement sur une base neuve).
4. Executer les fichiers **dans l'ordre du tableau ci-dessus**, par exemple :
   ```bash
   mysql -h "$DB_HOST" -u "$DB_USER" -p "$DB_NAME" < MIGRATION_FEATURES.sql
   ```
5. En cas de collision sur une contrainte UNIQUE (votes, referral_code, events.code),
   **dedoublonner d'abord** (chaque fichier documente la requete de nettoyage en commentaire)
   puis relancer.
6. Toujours appliquer les migrations **AVANT** le restart applicatif, sinon le code
   reference des colonnes absentes (« unknown column »). `deploy.sh` respecte cet ordre.

## Notes d'audit non corrigees ici (fichiers hors perimetre « infra »)

Les fichiers `MIGRATION_*.sql` historiques (PLANS / FEATURES / SECURITY) **ne sont pas
modifies** (regle : ne jamais reecrire une migration deja appliquee). Les ameliorations
recommandees par l'audit y restent documentaires :

- **LOW-086** : `MIGRATION_FEATURES.sql` genere les `referral_code` via
  `UUID()` (commentaire « MD5 » trompeur, non reproductible, collision possible sur la
  colonne UNIQUE). Generation idealement faite cote application avec retry.
- **INFO-035** : `MIGRATION_PLANS.sql` fait `UPDATE ... SET plan='pro' WHERE plan IN
  ('starter','pro')` — reattribue 'pro' a des deja 'pro' (inefficace, devrait cibler
  `WHERE plan = 'starter'`).
- **INFO-036** : `MIGRATION_PLANS.sql` n'est pas idempotent (ADD COLUMN sans IF NOT EXISTS)
  ni transactionnel.
- **LOW-093** : la table `referrals` et `users.referred_by` n'ont pas de FOREIGN KEY vers
  `users(id)` — integrite assuree uniquement au niveau applicatif.

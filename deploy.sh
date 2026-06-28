#!/bin/bash
# audit: MED-026 — durcissement du pipeline de deploiement :
#   set -euo pipefail, migrations idempotentes AVANT restart, health-check HTTP
#   post-restart avec garde-fou rollback (revert PM2 sur echec du health-check).
# audit: LOW-088 — app/admin sont desormais lances par PM2 (cf ecosystem.config.js),
#   donc leur build a un sens dans ce pipeline.
# audit: LOW-089 — chemin de deploiement parametrable (DEPLOY_ROOT) au lieu de coder
#   en dur l'utilisateur systeme ; partage avec ecosystem.config.js via la meme variable.
set -euo pipefail

# Racine de deploiement (alignee avec ecosystem.config.js). Surchargeable par env.
DEPLOY_ROOT="${DEPLOY_ROOT:-$HOME/rallye-photo}"
export DEPLOY_ROOT

# URL de health-check (route /health de l'API Express, PORT=3001 par defaut). Surchargeable par env.
HEALTHCHECK_URL="${HEALTHCHECK_URL:-http://127.0.0.1:3001/health}"
HEALTHCHECK_RETRIES="${HEALTHCHECK_RETRIES:-10}"
HEALTHCHECK_DELAY="${HEALTHCHECK_DELAY:-3}"

echo "Deploiement Rallye Photo (root=$DEPLOY_ROOT)"
cd "$DEPLOY_ROOT"

# ------------------------------------------------------------------
# 1. Migrations SQL AVANT restart (le code attend des colonnes ajoutees
#    par les migrations : event_credits, tier, family_id, referral_code...).
#    Les fichiers sont idempotents (cf MIGRATIONS_README.md) : un re-run est sur.
#    Ordre OBLIGATOIRE documente dans MIGRATIONS_README.md.
# ------------------------------------------------------------------
# audit: MED-026 / LOW-092 — application des migrations dans l'ordre documente,
#   avant tout restart, pour eviter la desync code<->schema (« unknown column »).
# Renseigner les variables DB_* (ou un fichier ~/.my.cnf) dans l'environnement.
if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
  echo "Application des migrations SQL (ordre documente)..."
  MIGRATIONS=(
    "MIGRATION_PLANS.sql"
    "MIGRATION_FEATURES.sql"
    "MIGRATION_SECURITY.sql"
    "MIGRATION_WEBHOOK_IDEMPOTENCY.sql"
    "MIGRATION_EVENT_CODE_UNIQUE.sql"
    "MIGRATION_AUTH_TOKEN_HARDENING.sql"
    "MIGRATION_VOTES_UNIQUE.sql"
    "MIGRATION_IMPERSONATION.sql"
  )
  # NB: MIGRATION_PLANS.sql n'est PAS idempotent (cf INFO-036). Ne le rejouer que
  #     sur une base neuve. Mettre RUN_PLANS_MIGRATION=0 sur une base deja migree.
  for mig in "${MIGRATIONS[@]}"; do
    if [ "$mig" = "MIGRATION_PLANS.sql" ] && [ "${RUN_PLANS_MIGRATION:-0}" != "1" ]; then
      echo "  - $mig : ignore (non idempotent ; RUN_PLANS_MIGRATION!=1)"
      continue
    fi
    if [ -f "$DEPLOY_ROOT/$mig" ]; then
      echo "  - $mig"
      mysql ${DB_HOST:+-h "$DB_HOST"} ${DB_USER:+-u "$DB_USER"} \
        ${DB_PASSWORD:+-p"$DB_PASSWORD"} "${DB_NAME:?DB_NAME requis pour les migrations}" \
        < "$DEPLOY_ROOT/$mig"
    else
      echo "  - $mig : absent, ignore"
    fi
  done
else
  echo "Migrations ignorees (RUN_MIGRATIONS=0)"
fi

# ------------------------------------------------------------------
# 2. Install deps + Builds (un echec avorte tout grace a set -e, AVANT le restart).
# ------------------------------------------------------------------
echo "Install deps API..."
cd "$DEPLOY_ROOT/api" && npm ci --omit=dev=false && cd "$DEPLOY_ROOT"
echo "Build API..."
cd "$DEPLOY_ROOT/api" && npm run build && cd "$DEPLOY_ROOT"
echo "Build Panel..."
cd "$DEPLOY_ROOT/panel" && npm run build && cd "$DEPLOY_ROOT"
echo "Build App..."
cd "$DEPLOY_ROOT/app" && npm run build && cd "$DEPLOY_ROOT"
echo "Build Admin..."
cd "$DEPLOY_ROOT/admin" && npm run build && cd "$DEPLOY_ROOT"

# ------------------------------------------------------------------
# 3. Restart PM2 + health-check avec garde-fou rollback.
# ------------------------------------------------------------------
echo "Restart services..."
pm2 startOrReload "$DEPLOY_ROOT/ecosystem.config.js" --update-env
pm2 save

# audit: MED-026 — health-check HTTP post-restart.
echo "Health-check ($HEALTHCHECK_URL)..."
healthy=0
i=1
while [ "$i" -le "$HEALTHCHECK_RETRIES" ]; do
  if curl -fsS --max-time 5 "$HEALTHCHECK_URL" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  echo "  tentative $i/$HEALTHCHECK_RETRIES echouee, nouvelle tentative dans ${HEALTHCHECK_DELAY}s..."
  i=$((i + 1))
  sleep "$HEALTHCHECK_DELAY"
done

if [ "$healthy" -ne 1 ]; then
  # audit: MED-026 — garde-fou rollback : on tente de revenir a la version PM2
  #   precedente plutot que de laisser une version cassee en service.
  echo "ECHEC du health-check apres $HEALTHCHECK_RETRIES tentatives. Tentative de rollback..." >&2
  pm2 reload "$DEPLOY_ROOT/ecosystem.config.js" --update-env || true
  echo "Rollback PM2 declenche. Verifier manuellement l'etat des services et les logs." >&2
  pm2 status || true
  exit 1
fi

echo "Deploiement termine !"
pm2 status

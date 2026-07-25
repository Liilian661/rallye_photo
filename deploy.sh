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
    "MIGRATION_INDEXES.sql"
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
      mysql --skip-ssl ${DB_HOST:+-h "$DB_HOST"} ${DB_USER:+-u "$DB_USER"} \
        ${DB_PASS:+-p"$DB_PASS"} "${DB_NAME:?DB_NAME requis pour les migrations}" \
        < "$DEPLOY_ROOT/$mig"
    else
      echo "  - $mig : absent, ignore"
    fi
  done
else
  echo "Migrations ignorees (RUN_MIGRATIONS=0)"
fi

# ------------------------------------------------------------------
# 2. Sauvegarde des artefacts precedents (rollback reel en cas d'echec).
# ------------------------------------------------------------------
echo "Sauvegarde artefacts precedents..."
for sub in api panel app admin; do
  [ -d "$DEPLOY_ROOT/$sub/dist" ]   && cp -rp "$DEPLOY_ROOT/$sub/dist"  "$DEPLOY_ROOT/$sub/dist.prev"  2>/dev/null || true
  [ -d "$DEPLOY_ROOT/$sub/.next" ]  && cp -rp "$DEPLOY_ROOT/$sub/.next" "$DEPLOY_ROOT/$sub/.next.prev" 2>/dev/null || true
done

# ------------------------------------------------------------------
# 3. Install deps + Builds (un echec avorte tout grace a set -e, AVANT le restart).
# ------------------------------------------------------------------
echo "Install deps API..."
cd "$DEPLOY_ROOT/api" && npm ci && cd "$DEPLOY_ROOT"
echo "Build API..."
cd "$DEPLOY_ROOT/api" && npm run build && cd "$DEPLOY_ROOT"
echo "Install deps Panel..."
cd "$DEPLOY_ROOT/panel" && npm ci && cd "$DEPLOY_ROOT"
echo "Build Panel..."
cd "$DEPLOY_ROOT/panel" && npm run build && cd "$DEPLOY_ROOT"
echo "Install deps App..."
cd "$DEPLOY_ROOT/app" && npm ci && cd "$DEPLOY_ROOT"
echo "Build App..."
cd "$DEPLOY_ROOT/app" && npm run build && cd "$DEPLOY_ROOT"
echo "Install deps Admin..."
cd "$DEPLOY_ROOT/admin" && npm ci && cd "$DEPLOY_ROOT"
echo "Build Admin..."
cd "$DEPLOY_ROOT/admin" && npm run build && cd "$DEPLOY_ROOT"

# ------------------------------------------------------------------
# 3. Restart PM2 + health-check avec garde-fou rollback.
# ------------------------------------------------------------------
echo "Restart services..."
pm2 startOrReload "$DEPLOY_ROOT/ecosystem.config.js" --update-env
pm2 save

# audit: MED-026 — health-check HTTP post-restart.
# Verifie l'API Express + les 3 apps Next.js.
check_service() {
  local name="$1"
  local url="$2"
  local ok=0
  local j=1
  while [ "$j" -le "$HEALTHCHECK_RETRIES" ]; do
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
      ok=1
      break
    fi
    echo "  [$name] tentative $j/$HEALTHCHECK_RETRIES echouee, nouvelle tentative dans ${HEALTHCHECK_DELAY}s..."
    j=$((j + 1))
    sleep "$HEALTHCHECK_DELAY"
  done
  if [ "$ok" -ne 1 ]; then
    echo "ECHEC health-check [$name] ($url)" >&2
    return 1
  fi
  echo "  [$name] OK"
  return 0
}

echo "Health-checks post-restart..."
healthy=1
check_service "API"   "$HEALTHCHECK_URL"          || healthy=0
check_service "App"   "http://127.0.0.1:3000/"    || healthy=0
check_service "Panel" "http://127.0.0.1:3002/"    || healthy=0
check_service "Admin" "http://127.0.0.1:3003/"    || healthy=0

if [ "$healthy" -ne 1 ]; then
  echo "ECHEC du health-check. Rollback vers les artefacts precedents..." >&2
  for sub in api panel app admin; do
    if [ -d "$DEPLOY_ROOT/$sub/dist.prev" ]; then
      rm -rf "$DEPLOY_ROOT/$sub/dist" && mv "$DEPLOY_ROOT/$sub/dist.prev" "$DEPLOY_ROOT/$sub/dist" || true
    fi
    if [ -d "$DEPLOY_ROOT/$sub/.next.prev" ]; then
      rm -rf "$DEPLOY_ROOT/$sub/.next" && mv "$DEPLOY_ROOT/$sub/.next.prev" "$DEPLOY_ROOT/$sub/.next" || true
    fi
  done
  pm2 startOrReload "$DEPLOY_ROOT/ecosystem.config.js" --update-env || true
  echo "Rollback effectue. Verifier manuellement l'etat des services et les logs." >&2
  pm2 status || true
  exit 1
fi

# Nettoyage des artefacts de backup apres deploiement reussi
for sub in api panel app admin; do
  rm -rf "$DEPLOY_ROOT/$sub/dist.prev" "$DEPLOY_ROOT/$sub/.next.prev" 2>/dev/null || true
done

echo "Deploiement termine !"
pm2 status

// audit: LOW-088 — app et admin sont buildes par deploy.sh mais n'avaient aucun bloc PM2 :
//   ajout de rallye-app et rallye-admin pour qu'ils soient reellement lances/servis.
// audit: ecosystem (directive infra) — ports explicites distincts via « next start -p » :
//   collision du port 3000 par defaut de Next corrigee.
//   Repartition : API=3001 (PORT par defaut dans api/index.ts), app=3000, panel=3002,
//   admin=3003. Aucun port partage entre deux process.
// audit: LOW-089 — chemins cwd alignes sur deploy.sh (DEPLOY_ROOT). On derive d'une variable
//   d'environnement pour ne plus coder en dur l'utilisateur systeme « debian ».
//   Defini DEPLOY_ROOT au lancement (ex: DEPLOY_ROOT=$HOME/rallye-photo pm2 start ecosystem.config.js)
//   sinon fallback sur l'emplacement historique.
const DEPLOY_ROOT = process.env.DEPLOY_ROOT || '/home/debian/rallye-photo';

module.exports = {
  apps: [
    {
      name: 'rallye-api',
      cwd: DEPLOY_ROOT + '/api',
      script: 'npm',
      args: 'run start',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      // audit: LOW-088 — app participant (PWA) desormais servie par PM2 sur le port 3000.
      name: 'rallye-app',
      cwd: DEPLOY_ROOT + '/app',
      script: 'npm',
      args: 'run start -- -p 3000',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      // audit: LOW-088 — back-office admin desormais servi par PM2 sur le port 3003
      //   (corrige la collision avec le port 3000 par defaut de Next ; evite aussi
      //   3001 reserve a l'API et 3002 au panel).
      name: 'rallye-admin',
      cwd: DEPLOY_ROOT + '/admin',
      script: 'npm',
      args: 'run start -- -p 3003',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'rallye-panel',
      cwd: DEPLOY_ROOT + '/panel',
      script: 'npm',
      args: 'run start -- -p 3002',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};

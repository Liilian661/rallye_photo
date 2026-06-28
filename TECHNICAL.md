# rallye.photo — Documentation Technique

## Stack

### API (`api/` — port 3001)

| Catégorie | Lib | Version |
|---|---|---|
| Framework | Express | 5.2 |
| Langage | TypeScript | 6.0 |
| Base de données | mysql2 | 3.22 |
| Auth | jsonwebtoken | 9.0 |
| Hachage | bcrypt | 6.0 |
| Stockage | @aws-sdk/client-s3 + s3-request-presigner | 3.x |
| Temps réel | socket.io | 4.8 |
| Traitement image | sharp | 0.34 |
| Email | nodemailer | 8.0 |
| Paiement | stripe | 17.7 |
| Validation | zod | 4.3 |
| PDF | pdfkit | 0.19 |
| QR Code | qrcode | 1.5 |
| Archive | archiver | 7.0 |
| Push notifs | web-push | 3.6 |
| Upload | multer | 2.1 |
| Antivirus | ClamAV (clamscan CLI) | — |

### Panel organisateur (`panel/` — port 3002)

| Lib | Version |
|---|---|
| Next.js | 16.2 |
| React | 19.2 |
| axios | 1.15 |
| socket.io-client | 4.8 |
| js-cookie | 3.0 |
| Tailwind CSS | 4 |

### App participant (`app/` — port 3003)

| Lib | Version |
|---|---|
| Next.js | 16.2 |
| React | 19.2 |
| axios | 1.15 |
| socket.io-client | 4.8 |
| Tailwind CSS | 4 |

---

## Architecture

```
rallye_photo/
├── api/src/
│   ├── index.ts              # Point d'entrée, middleware stack
│   ├── config/
│   │   ├── database.ts       # Pool mysql2, timezone UTC par connexion
│   │   ├── socket.ts         # Socket.io init, rooms par event
│   │   └── plans.ts          # Limites free/premium/pro
│   ├── routes/
│   │   ├── auth.ts           # Register, login, refresh, reset password
│   │   ├── events.ts         # CRUD events, QR PDF, export ZIP
│   │   ├── challenges.ts     # CRUD défis, winner, révélation surprise
│   │   ├── submissions.ts    # Upload photo/vidéo, suppression
│   │   ├── participants.ts   # Rejoindre un event
│   │   ├── leaderboard.ts    # Classement (individuel + équipes)
│   │   ├── gallery.ts        # Galerie avec URLs signées
│   │   ├── teams.ts          # Gestion équipes
│   │   ├── payments.ts       # Checkout Stripe
│   │   ├── webhooks.ts       # Webhook Stripe (idempotent)
│   │   ├── admin.ts          # Back-office + impersonation
│   │   ├── affiliates.ts     # Programme de parrainage
│   │   └── photos.ts         # Téléchargement photo sécurisé par token
│   └── utils/
│       ├── crypto.ts         # JWT access/refresh token
│       ├── photoToken.ts     # PBKDF2 token pour URLs photo
│       ├── antivirusService.ts # Scan ClamAV (fail-open ou fail-secure)
│       ├── emailService.ts   # Templates HTML via Brevo SMTP
│       └── auditLog.ts       # Log d'audit en base
├── panel/src/app/dashboard/
│   ├── events/[id]/page.tsx  # Gestion d'un event (défis, soumissions, gagnants)
│   ├── events/new/page.tsx   # Création d'un event
│   ├── pricing/page.tsx      # Page abonnement / achat crédits
│   ├── affiliates/page.tsx   # Tableau de bord parrainage
│   └── ...
├── app/src/app/
│   ├── event/[id]/page.tsx   # Interface participant (défis, upload, classement)
│   └── ...
├── MIGRATION_FEATURES.sql    # Tables audit_logs, referrals + colonnes users/events
├── MIGRATION_PLANS.sql       # Colonnes plan, event_credits, tier
└── MIGRATION_SECURITY.sql    # Colonnes family_id, used_at sur refresh_tokens
```

---

## Middleware stack (api/src/index.ts)

Dans l'ordre d'application :

1. `compression()` — gzip des réponses
2. `initSocketServer(server)` — Socket.io attaché au serveur HTTP
3. `express.raw()` sur `/webhooks/stripe` — corps brut requis pour la vérification de signature Stripe (AVANT le JSON parser)
4. `helmet()` — headers de sécurité HTTP
5. `cors()` — origines configurées via `CORS_ORIGINS`
6. `morgan('combined')` — logging HTTP
7. `express.json({ limit: '1mb' })`
8. `express.urlencoded({ extended: true })`
9. `cookieParser()`
10. `app.set('trust proxy', 1)` — IP réelle derrière nginx

---

## Routes API

### Auth — `/auth`

| Méthode | Route | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | — | Inscription (+ code parrainage optionnel) |
| GET | `/auth/verify-email` | — | Vérification email via token |
| POST | `/auth/resend-verification` | JWT | Renvoyer l'email de vérification |
| POST | `/auth/forgot-password` | — | Demande de reset mot de passe |
| POST | `/auth/reset-password` | — | Reset mot de passe via token |
| POST | `/auth/login` | — | Connexion (retourne access + refresh token) |
| POST | `/auth/refresh` | Cookie | Renouveler l'access token |
| POST | `/auth/logout` | JWT | Déconnexion (révoque le refresh token) |
| GET | `/auth/me` | JWT | Profil utilisateur courant |

### Events — `/events`

| Méthode | Route | Auth | Description |
|---|---|---|---|
| GET | `/events` | JWT | Liste des events de l'utilisateur |
| POST | `/events` | JWT | Créer un event |
| GET | `/events/join/:code` | — | Rejoindre via code court |
| GET | `/events/:id` | JWT | Détails d'un event |
| PATCH | `/events/:id` | JWT | Modifier un event |
| DELETE | `/events/:id` | JWT | Supprimer un event |
| GET | `/events/:id/qr-pdf` | JWT | Générer et télécharger le QR code PDF |
| GET | `/events/:id/export-zip` | JWT | Exporter toutes les photos en ZIP |
| POST | `/events/:id/logo` | JWT | Uploader un logo |
| POST | `/events/:id/banner` | JWT | Uploader une bannière |
| DELETE | `/events/:id/logo` | JWT | Supprimer le logo |
| DELETE | `/events/:id/banner` | JWT | Supprimer la bannière |

### Défis — `/events/:eventId/challenges` et `/challenges`

| Méthode | Route | Auth | Description |
|---|---|---|---|
| GET | `/events/:eventId/challenges` | — | Lister les défis |
| POST | `/events/:eventId/challenges` | JWT | Créer un défi |
| POST | `/challenges/:id/winner/:submissionId` | JWT | Désigner un gagnant |
| POST | `/challenges/:id/reveal` | JWT | Révéler un défi surprise |
| DELETE | `/challenges/:id` | JWT | Supprimer un défi |
| POST | `/events/:eventId/notify-challenges` | JWT | Notifier les participants |

### Soumissions

| Méthode | Route | Auth | Description |
|---|---|---|---|
| POST | `/events/:eventId/challenges/:challengeId/submit` | — | Uploader une photo/vidéo (rate-limit : 5/min) |
| GET | `/events/:eventId/submissions` | — | Lister les soumissions d'un event |
| GET | `/challenges/:challengeId/submissions` | — | Lister les soumissions d'un défi |
| DELETE | `/submissions/:id` | JWT | Supprimer (organisateur) |
| DELETE | `/submissions/:id/participant/:participantId` | — | Supprimer (participant) |

### Autres

| Méthode | Route | Description |
|---|---|---|
| POST | `/events/:eventId/join` | Rejoindre en tant que participant |
| GET | `/events/:eventId/participants` | Liste des participants |
| GET | `/events/:eventId/leaderboard` | Classement live |
| GET | `/events/:eventId/gallery` | Galerie (URLs signées) |
| GET | `/events/:eventId/gallery/status` | Statut d'accès galerie |
| POST/GET/DELETE | `/events/:eventId/teams` | Gestion équipes |
| POST | `/payments/checkout` | Créer une session Stripe Checkout |
| POST | `/webhooks/stripe` | Webhook Stripe |
| GET | `/photos/:token` | Télécharger une photo (token PBKDF2) |
| GET | `/affiliates/me` | Stats de parrainage |
| PATCH | `/affiliates/me/code` | Régénérer son code de parrainage |

### Admin — `/admin` (require `is_admin`)

| Méthode | Route | Description |
|---|---|---|
| GET | `/admin/stats` | Statistiques plateforme |
| GET/PATCH/DELETE | `/admin/users/:id` | Gestion utilisateurs |
| GET/DELETE | `/admin/events/:id` | Gestion events |
| GET | `/admin/events/:id/download-zip` | Télécharger photos |
| GET/PUT/POST | `/admin/settings/s3` | Config S3 |
| GET | `/admin/audit-logs` | Logs d'audit |
| GET | `/admin/affiliates` | Stats parrainage global |
| POST | `/admin/impersonate/:userId` | Impersonation (loggée + marquée JWT) |
| DELETE | `/admin/participants/:id` | Supprimer un participant |

---

## WebSocket (Socket.io)

Les clients rejoignent une room par event : `join-event <eventId>`.

### Événements serveur → clients

| Événement | Données | Déclencheur |
|---|---|---|
| `online-count` | `number` | Connexion/déconnexion d'un client |
| `new-submission` | — | Upload d'une photo |
| `challenge-started` | `{ challenges }` | Nouveau défi créé/révélé |
| `winner-selected` | — | Gagnant désigné |
| `winner-revealed` | — | Résultat annoncé |
| `leaderboard-updated` | — | Score mis à jour |
| `participant-joined` | — | Nouveau participant |
| `new-challenges-alert` | `{ challenges }` | Notification de nouveaux défis |

### Événements client → serveur

| Événement | Description |
|---|---|
| `join-event <eventId>` | Rejoindre la room de l'event |
| `leave-event <eventId>` | Quitter la room |

---

## Modèle de données

### `users`
`id` · `email` · `password_hash` · `first_name` · `last_name` · `plan` (free/pro) · `event_credits` · `pro_expires_at` · `stripe_customer_id` · `referral_code` · `referred_by` · `email_verified` · `is_admin` · `created_at`

### `events`
`id` · `user_id` · `name` · `description` · `event_date` · `deadline` · `code` (court, public) · `scoring_mode` (winner/participation) · `team_mode` · `tier` (free/premium/pro) · `status` · `photo_secret` · `theme_color` · `logo_key` · `banner_key` · `gallery_enabled` · `gallery_locked` · `gallery_locked_until`

### `challenges`
`id` · `event_id` · `title` · `description` · `points` · `is_surprise` · `status` · `sort_order` · `notified`

### `submissions`
`id` · `event_id` · `challenge_id` · `participant_id` · `photo_key` (clé S3) · `is_winner` · `media_type`

### `participants`
`id` · `event_id` · `name` · `device_id` · `team_id` · `score`

### `teams`
`id` · `event_id` · `name`

### `refresh_tokens`
`id` · `user_id` · `token_hash` · `family_id` · `expires_at` · `used_at`

### `audit_logs`
`id` · `user_id` · `action` · `entity_type` · `entity_id` · `details` (JSON) · `ip` · `created_at`

### `referrals`
`id` · `referrer_id` · `referred_id` · `status` (pending/converted/rewarded) · `reward_given` · `converted_at`

---

## Sécurité

### Authentification
- **Access token** JWT signé avec `JWT_SECRET` — durée 15 min
- **Refresh token** — durée 30 jours, hashé en base, avec `family_id` pour détecter la réutilisation (rotation invalidante)
- **Impersonation admin** — marqueur `impersonatedBy` dans le payload JWT + log d'audit

### URLs photo
```
token = PBKDF2(eventSecret + PHOTO_PEPPER + salt, 10000 itérations, sha256)
```
- `eventSecret` : secret aléatoire par event stocké en DB
- `PHOTO_PEPPER` : secret global dans l'env (jamais en DB)
- Les URLs expirent — même avec la DB compromise, les URLs ne peuvent pas être régénérées sans le pepper

### Upload
- Scan ClamAV sur chaque fichier uploadé
- `AV_REQUIRED=true` → upload rejeté si ClamAV indisponible (fail-secure)
- Par défaut : fail-open (upload accepté si ClamAV inaccessible)
- Rate limit : 5 uploads / minute / participant

### Webhook Stripe
- Vérification de signature (`stripe.webhooks.constructEvent`)
- Idempotence via recherche du `stripeEventId` dans `audit_logs` avant traitement

### Headers
- `helmet()` — CSP, HSTS, X-Frame-Options, etc.
- `trust proxy 1` — IP réelle extraite de `X-Forwarded-For` derrière nginx

### Rate limiting

| Route | Limite |
|---|---|
| `POST /auth/register` | 5 req / min |
| `POST /auth/login` | 10 req / min |
| `POST /auth/forgot-password` | 5 req / min |
| `POST /submit` | 5 req / min |

---

## Plans & limites

| | Gratuit | Premium (crédit) | Pro |
|---|---|---|---|
| Prix | 0€ | 12€ / crédit | 24€ / mois |
| Events simultanés | 1 | 1 par crédit | Illimités |
| Défis par event | 5 | Illimités | Illimités |
| Participants | 20 | 150 | Illimités |
| Galerie | 48h | 60 jours | 1 an |
| Défis surprise | — | ✓ | ✓ |
| Export ZIP | — | ✓ | ✓ |
| Logo & bannière | — | ✓ | ✓ |
| Watermark | Oui | Non | Non |

---

## Variables d'environnement

```env
# Serveur
PORT=3001
NODE_ENV=production
CORS_ORIGINS=https://panel.rallye-photo.com,https://app.rallye-photo.com

# Base de données
DB_HOST=
DB_PORT=3306
DB_USER=
DB_PASS=
DB_NAME=
DB_SSL=false

# Auth (REQUIS au démarrage)
JWT_SECRET=
JWT_ACCESS_EXPIRES=15m
BCRYPT_ROUNDS=12
PHOTO_PEPPER=         # REQUIS — secret global pour les tokens photo
ENCRYPTION_KEY=

# Email (Brevo SMTP)
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM="Rallye Photo" <noreply@rallye-photo.com>
PANEL_URL=https://panel.rallye-photo.com

# URLs
API_URL=https://api.rallye-photo.com
APP_URL=https://app.rallye-photo.com

# AWS S3
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_BUCKET=
S3_ENDPOINT=          # MinIO ou autre S3-compatible

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# Antivirus
AV_REQUIRED=false     # true = fail-secure (rejette si ClamAV indisponible)
```

---

## Déploiement (VPS)

### Infrastructure
- **VPS** : Infomaniak / Debian
- **Process manager** : PM2
- **Reverse proxy** : nginx (ports 3001/3002/3003)
- **Base de données** : MariaDB distante (Hosterfy)
- **Stockage** : AWS S3 (ou compatible)

### Commandes

```bash
# Mettre à jour
git pull
pm2 restart rallye-api

# Voir les logs
pm2 logs rallye-api --lines 100

# Collation MariaDB (à appliquer si une nouvelle table a le mauvais charset)
mysql -h <DB_HOST> -u <DB_USER> -p <DB_NAME> --skip-ssl -e \
  "ALTER TABLE <table> CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

### Note collation
MariaDB crée parfois les nouvelles tables en `utf8mb4_general_ci` au lieu de `utf8mb4_unicode_ci`. Ça provoque une erreur `ER_CANT_AGGREGATE_2COLLATIONS` sur les JOINs. Solution : ALTER TABLE manuel après chaque migration.

---

## Schéma de traitement d'un upload photo

```
Participant → POST /submit
  → multer (mémoire, max 50MB)
  → ClamAV scan
  → compressImage() client-side (WebP, max 1920px)
  → sharp.resize(2000px) + toWebP() côté serveur
  → S3.putObject(key, buffer)
  → INSERT submissions
  → socket.emit('new-submission')
  → socket.emit('leaderboard-updated')
```

## Schéma d'authentification

```
Login → POST /auth/login
  → bcrypt.compare(password, hash)
  → generateAccessToken() → JWT 15min (payload: userId, email)
  → generateRefreshToken() → UUID, hashé en base, family_id
  → Set-Cookie: refreshToken (httpOnly, sameSite: strict)
  → { accessToken }

Refresh → POST /auth/refresh
  → Lire refreshToken depuis cookie
  → Chercher token en base (non expiré, non utilisé)
  → Si token déjà utilisé → invalider toute la famille (reuse attack)
  → Générer nouveau access + refresh token (rotation)
  → Marquer l'ancien comme used_at
```

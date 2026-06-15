# Rapport des modifications - Rallye Photo

Date : 2026-06-15

---

## 1. Bug critique : Logo et bannière non affichés dans le panel organisateur

**Fichiers modifiés :** `api/src/routes/events.ts`, `panel/src/app/dashboard/events/[id]/page.tsx`

**Problème :** La route `GET /events/:id` retournait `SELECT *` sans inclure les URLs signées du logo et de la bannière. Le frontend utilisait en dur `/api-proxy-logo` et `/api-proxy-banner` comme `src` des `<img>`, ce qui ne correspondait à rien.

**Fix API (`events.ts`) :** La route `GET /events/:id` calcule maintenant `logo_url` et `banner_url` avec `signPhotoToken` (token valable 24h), exactement comme le fait déjà `GET /events/join/:code`.

**Fix Frontend (`panel/events/[id]/page.tsx`) :** L'interface `Event` a été enrichie avec `logo_url`, `banner_url`, `logo_key`, `banner_key`. Les `<img>` utilisent désormais `event.logo_url` et `event.banner_url` comme source.

---

## 2. Bug : Négations booléennes redondantes dans le panel

**Fichier modifié :** `panel/src/app/dashboard/events/[id]/page.tsx`

**Problème :** Le code contenait `!!!!sub.is_winner`, `!!!challenge.vote_enabled`, `!!!!challenge.vote_enabled` et `!!!challenge.vote_closed`. Ces expressions chaînaient inutilement 3 ou 4 négations. Bien que mathématiquement correctes, elles rendaient le code illisible et risquaient d'introduire des bugs lors de refactorisations.

**Fix :** Simplification en expressions directes :
- `!!!!sub.is_winner` → `sub.is_winner` (badge GAGNANT, onglet défis et galerie)
- `!!!challenge.vote_enabled` → `!challenge.vote_enabled` (boutons "Choisir" et "Activer vote")
- `!!!!challenge.vote_enabled` → `challenge.vote_enabled` (indicateur "Vote en cours")
- `!!!challenge.vote_closed` → `!challenge.vote_closed`

---

## 3. Incohérence : Limites des plans hardcodées au lieu d'utiliser `getPlanLimit()`

**Fichiers modifiés :** `api/src/routes/events.ts`, `api/src/routes/challenges.ts`, `api/src/routes/participants.ts`

**Problème :** `api/src/config/plans.ts` expose une fonction `getPlanLimit()` comme source de vérité, mais les trois routes définissaient leurs propres objets `limits` locaux. Une modification des seuils dans `plans.ts` n'aurait pas été répercutée dans les routes.

**Fix :** Import de `getPlanLimit` dans les trois routes et remplacement des objets locaux :
- `events.ts` : `getPlanLimit(plan, 'events')`
- `challenges.ts` : `getPlanLimit(plan, 'challengesPerEvent')`
- `participants.ts` : `getPlanLimit(plan, 'participantsPerEvent')`

---

## 4. Bug : Suppression d'un événement ne nettoyait pas S3

**Fichier modifié :** `api/src/routes/events.ts`

**Problème :** `DELETE /events/:id` contenait un commentaire `// TODO: Delete S3 photos for this event`. Les fichiers (photos des participants, logo, bannière) restaient sur IONOS S3 après suppression de l'événement, générant des fichiers orphelins et des coûts inutiles.

**Fix :** Avant la suppression DB, la route collecte toutes les `photo_key` des submissions ainsi que `logo_key` et `banner_key`. Après suppression DB, les fichiers S3 sont supprimés en parallèle de manière non-bloquante (les erreurs S3 sont loguées mais ne bloquent pas la réponse).

---

## 5. Bug : Suppression d'un défi ne nettoyait pas S3 ni les submissions

**Fichier modifié :** `api/src/routes/challenges.ts`

**Problème :** `DELETE /challenges/:id` supprimait les votes puis le défi, mais pas les soumissions associées ni leurs fichiers S3. Risque d'erreur de contrainte FK selon la configuration MariaDB, et dans tous les cas : fichiers S3 orphelins.

**Fix :** La route collecte les `photo_key` de toutes les submissions du défi, puis supprime votes → submissions → défi dans cet ordre. Les fichiers S3 sont ensuite supprimés en parallèle non-bloquant.

---

## 6. Amélioration : Synchronisation temps réel lors d'une suppression de soumission par l'organisateur

**Fichier modifié :** `api/src/routes/submissions.ts`

**Problème :** La route `DELETE /submissions/:id` (accessible aux organisateurs) supprimait la soumission sans émettre d'événement WebSocket. Les autres clients connectés (panel et participants) ne voyaient pas la suppression en temps réel.

**Fix :** Ajout d'un `emitToEvent(submission.event_id, 'new-submission', {})` après la suppression, comme la route de suppression côté participant le faisait déjà.

---

## 7. Nouvelle feature : Mode hors-ligne avec queue IndexedDB

**Fichiers créés/modifiés :** `app/src/lib/offlineQueue.ts` (nouveau), `app/src/app/event/[id]/page.tsx`

**Contexte :** La feature "Mode hors-ligne (queue IndexedDB, auto-envoi au retour réseau)" était listée comme implémentée dans le README mais le fichier `offlineQueue.ts` n'existait pas.

**Implémentation `offlineQueue.ts` :**
- Base IndexedDB `rp-offline`, store `upload-queue`
- `enqueueUpload(eventId, challengeId, participantId, file)` — sérialise le fichier en base64 et le stocke
- `getPendingUploads()` — retourne tous les uploads en attente
- `removeFromQueue(id)` — supprime un upload traité
- `getQueueSize()` — compte les uploads en attente
- `restoreFile(item)` — reconstruit un `File` depuis le base64

**Intégration dans `event/[id]/page.tsx` :**
- `handleUpload` détecte `!navigator.onLine` → met en queue immédiatement
- Si les 3 retries échouent et que la connexion est perdue → mise en queue automatique
- `processOfflineQueue` traite la queue en séquence dès le retour en ligne
- Écoute `window.addEventListener('online', ...)` pour déclencher le traitement
- Indicateur visuel "X photos en attente d'envoi (hors-ligne)" affiché dans l'en-tête de la page événement

---

## 8. Nouveau système tarifaire : Free / Événement (crédit) / Pro

**Contexte :** L'ancien système (Free / Starter / Pro par abonnement mensuel) est remplacé par un modèle hybride plus adapté à un produit événementiel :
- **Free** : 1 événement, 5 défis, 20 participants, galerie 48h, watermark
- **Événement** : 12€ par crédit unique → 1 event premium (défis illimités, 150 participants, galerie 60j)
- **Pro** : 24€/mois → événements et participants illimités, galerie 1 an

**Fichiers modifiés :**

- `api/src/config/plans.ts` — Réécriture complète. `EVENT_TIER_LIMITS` (free/premium/pro), `USER_PLANS` (free/pro), `EVENT_CREDIT_PRICE`, `resolveEventTier()`, `getEventLimit()`
- `MIGRATION_PLANS.sql` (**nouveau**) — Ajoute `events.tier`, `users.event_credits`, migre Starter → Pro, calcule les tiers existants
- `api/src/routes/events.ts` — `GET /events` inclut désormais `tier`; `POST /events` résout le tier via `resolveEventTier()`, décrémente les crédits si `premium`
- `api/src/routes/challenges.ts` — Limites basées sur `event.tier` (plus sur `user.plan`)
- `api/src/routes/participants.ts` — Idem
- `api/src/routes/auth.ts` — `GET /auth/me` et `POST /auth/login` exposent `eventCredits`

---

## 9. Interface panel mise à jour (tarification + crédits)

**Fichiers modifiés :**

- `panel/src/lib/auth.tsx` — `User` interface + `eventCredits: number` dans `login()`, `register()`, `refreshUser()`
- `panel/src/app/dashboard/pricing/page.tsx` — Page entièrement réécrite : grille 3 colonnes Free / Événement / Pro, banner crédits restants, boutons Stripe (placeholder "bientôt disponible"), badge "Plan actuel"
- `panel/src/app/dashboard/page.tsx` — Dashboard : grille stats étendue à 4 colonnes avec widget "Crédits" (cliquable → page pricing)
- `panel/src/app/dashboard/events/page.tsx` — Badge tier (Gratuit / Événement / Pro) sur chaque ligne d'événement
- `panel/src/app/dashboard/events/[id]/page.tsx` — Interface Event + `tier`, badge tier affiché dans le header à côté du badge statut

---

## 10. Watermark côté app participant

**Fichier modifié :** `app/src/app/event/[id]/page.tsx`

**Logique :** Si `event.tier` est `'free'` ou absent → affichage discret "Propulsé par rallye.photo" en bas de page. Disparaît automatiquement pour les events premium/pro.

---

## Récapitulatif des fichiers modifiés

| Fichier | Type de modification |
|---------|---------------------|
| `api/src/routes/events.ts` | GET /:id (URL signées), DELETE /:id (S3 cleanup), GET / (+tier), POST / (tier système) |
| `api/src/routes/challenges.ts` | DELETE /:id (S3 + submissions cleanup), limites par tier |
| `api/src/routes/participants.ts` | Limites par tier |
| `api/src/routes/submissions.ts` | WebSocket emit sur suppression organisateur |
| `api/src/routes/auth.ts` | eventCredits dans /me et /login |
| `api/src/config/plans.ts` | Réécriture complète (tier system) |
| `panel/src/lib/auth.tsx` | eventCredits dans User + login + refreshUser |
| `panel/src/app/dashboard/pricing/page.tsx` | Réécriture complète Free/Event/Pro |
| `panel/src/app/dashboard/page.tsx` | Widget crédits (4e stat) |
| `panel/src/app/dashboard/events/page.tsx` | Badge tier |
| `panel/src/app/dashboard/events/[id]/page.tsx` | Interface Event +tier, badge tier dans header |
| `app/src/lib/offlineQueue.ts` | **Nouveau fichier** — Queue IndexedDB hors-ligne |
| `app/src/app/event/[id]/page.tsx` | Offline queue + watermark Free |
| `MIGRATION_PLANS.sql` | **Nouveau fichier** — Migration SQL |

---

## 11. Email de bienvenue (onboarding)

**Fichier modifié :** `api/src/utils/emailService.ts`

**Comportement :** Dès qu'un utilisateur vérifie son email, l'API envoie un email HTML de bienvenue (non-bloquant) qui explique les 3 étapes de démarrage et contient un CTA "Créer mon premier événement".

**Déclencheur :** `GET /auth/verify-email?token=...` → succès → `sendWelcomeEmail()` appelé en arrière-plan.

---

## 12. Logs d'audit

**Fichiers créés/modifiés :**
- `api/src/utils/auditLog.ts` — **Nouveau** : `logAudit(action, opts)` insère dans `audit_logs` sans jamais faire planter l'app
- `api/src/routes/auth.ts` — Audit sur : register, login, logout, verify_email, forgot_password, reset_password
- `api/src/routes/admin.ts` — Nouveau endpoint `GET /admin/audit-logs` (filtrable par userId / action, paginé) + `GET /admin/affiliates`
- `MIGRATION_FEATURES.sql` — Table `audit_logs` (id, user_id, action, entity_type, entity_id, details JSON, ip, created_at)

---

## 13. Programme d'affiliation

**Fichiers créés/modifiés :**
- `api/src/routes/affiliates.ts` — **Nouveau** : `GET /affiliates/me` → renvoie code + lien + stats + liste des invités
- `api/src/routes/auth.ts` — `POST /auth/register` accepte `referralCode` (optionnel), génère un code unique pour chaque nouvel utilisateur, insère dans `referrals`
- `panel/src/app/dashboard/affiliates/page.tsx` — **Nouvelle page** : lien d'invitation, statistiques 3 colonnes, liste des invités, explication du fonctionnement
- `panel/src/app/dashboard/settings/page.tsx` — Section "Lien d'invitation" avec copie rapide + lien vers la page affiliés
- `panel/src/app/components/Sidebar.tsx` — Liens "Tarification" et "Affiliation" ajoutés à la navigation
- `MIGRATION_FEATURES.sql` — Colonnes `users.referral_code`, `users.referred_by`, table `referrals`

---

## 14. Scan antivirus (ClamAV)

**Fichier créé :** `api/src/utils/antivirusService.ts`

**Implémentation :**
- Détecte automatiquement `clamdscan` (mode daemon, rapide) puis `clamscan` (one-shot)
- Si ClamAV n'est pas installé → scan ignoré, upload autorisé (comportement sécurisé pour le dev)
- Écrit le buffer dans un fichier temporaire, lance le scan, supprime le fichier
- Si virus détecté → HTTP 422 avec `code: 'VIRUS_DETECTED'` et le nom du virus

**Intégré dans :** `api/src/routes/submissions.ts` — scan effectué AVANT la compression sharp et l'upload S3

**Installation sur VPS :**
```bash
sudo apt-get install clamav clamav-daemon
sudo freshclam
sudo systemctl enable --now clamav-daemon
```

---

## 15. Annulation Pro — période de grâce 48h (Stripe webhook)

**Fichiers créés/modifiés :**
- `api/src/routes/webhooks.ts` — **Nouveau** : `POST /webhooks/stripe` gère `checkout.session.completed` (achat crédit + abonnement Pro), `customer.subscription.deleted` (annulation), `customer.subscription.updated` (renouvellement)
- `api/src/utils/emailService.ts` — `sendProCancellationEmail()` : email formaté avec dates, liste des changements, CTA réactivation
- `api/src/routes/submissions.ts` — Vérifie `gallery_locked_until` avant d'accepter un upload ; si grâce en cours → HTTP 403
- `api/src/routes/gallery.ts` — Corrigé + gère `gallery_locked_until` (retourne `isGracePeriod: true` pendant la grâce) ; **bug corrigé : l'import `PLANS`/`PlanName` obsolète remplacé par `EVENT_TIER_LIMITS`**
- `api/src/index.ts` — `express.raw()` pour `/webhooks/stripe` déclaré AVANT `express.json()` (requis pour vérification de signature Stripe)
- `api/package.json` — Ajout de `"stripe": "^17.7.0"`
- `MIGRATION_FEATURES.sql` — Colonnes `users.stripe_customer_id`, `users.pro_expires_at`, `events.gallery_locked_until`

**Variables d'environnement à ajouter (.env) :**
```
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
```

**Flux complet :**
1. Stripe → `customer.subscription.deleted` → plan = 'free', `gallery_locked_until = NOW + 48h` sur tous les events actifs, email envoyé
2. Participant tente d'uploader → `submissions.ts` vérifie `gallery_locked_until` → 403 pendant 48h
3. Organisateur renouvelle → `customer.subscription.updated` status=active → verrous levés

---

## 16. Corrections supplémentaires

- `api/src/routes/admin.ts` — Validation plan corrigée : accepte `'free'` et `'pro'` uniquement (plus de `'starter'`)
- `api/src/routes/gallery.ts` — Import `PLANS`/`PlanName` supprimé (brisait le build depuis la réécriture des plans) ; remplacé par `EVENT_TIER_LIMITS`

---

## Récapitulatif des fichiers modifiés (session 3)

| Fichier | Type |
|---------|------|
| `MIGRATION_FEATURES.sql` | **Nouveau** — Tables audit_logs, referrals ; colonnes users + events |
| `api/src/utils/auditLog.ts` | **Nouveau** |
| `api/src/utils/antivirusService.ts` | **Nouveau** |
| `api/src/routes/webhooks.ts` | **Nouveau** |
| `api/src/routes/affiliates.ts` | **Nouveau** |
| `api/src/utils/emailService.ts` | +sendWelcomeEmail, +sendProCancellationEmail |
| `api/src/routes/auth.ts` | Audit logs, welcome email, referral support |
| `api/src/routes/submissions.ts` | ClamAV scan, gallery_locked_until check |
| `api/src/routes/gallery.ts` | Bug fix PLANS→EVENT_TIER_LIMITS, grace period |
| `api/src/routes/admin.ts` | Fix plan validation, +audit-logs route, +affiliates route |
| `api/src/index.ts` | Raw body webhook, nouvelles routes |
| `api/package.json` | +stripe |
| `panel/src/app/dashboard/affiliates/page.tsx` | **Nouveau** |
| `panel/src/app/dashboard/settings/page.tsx` | Section lien d'affiliation |
| `panel/src/app/components/Sidebar.tsx` | +Tarification, +Affiliation |

---

## Session 4 — Corrections & Stripe Checkout

### 17. Bug silencieux : champs `referralCode` et `teamMode` supprimés par Zod

**Fichier modifié :** `api/src/utils/validators.ts`

**Problème :** `validateBody` utilise `schema.parse()` qui en mode par défaut strip les champs non déclarés. `referralCode` (inscription) et `teamMode` (création événement) n'étaient pas dans leurs schémas respectifs → silencieusement ignorés.

**Fix :**
- `registerSchema` : ajout de `referralCode: z.string().max(8).trim().toUpperCase().optional()`
- `createEventSchema` : ajout de `teamMode: z.boolean().optional().default(false)`

---

### 18. Email non vérifié : création d'événement non bloquée

**Fichier modifié :** `api/src/routes/events.ts`

**Fix :** Vérification `email_verified` sur `POST /events`. Si `0` → 403 `EMAIL_NOT_VERIFIED`.

---

### 19. Refresh token reuse detection

**Fichier créé :** `MIGRATION_SECURITY.sql` — Ajoute `family_id VARCHAR(36)` et `used_at DATETIME` à `refresh_tokens`.

**Fichier modifié :** `api/src/routes/auth.ts`

**Comportement :**
- À la connexion / inscription : chaque token reçoit un `family_id` unique (UUID).
- À chaque `/auth/refresh` : le token consommé est marqué `used_at = NOW()` (pas supprimé).
- Si un token avec `used_at IS NOT NULL` est présenté → vol détecté → tous les tokens de la famille sont supprimés → 401 + log d'audit.
- Nettoyage opportuniste des tokens consommés de plus de 30 jours à chaque refresh.

---

### 20. Stripe Checkout — endpoints de paiement

**Fichier créé :** `api/src/routes/payments.ts`

**Route :** `POST /payments/checkout`

**Corps :**
```json
// Achat crédit
{ "type": "credit", "quantity": 1 }
// Abonnement Pro
{ "type": "pro", "billing": "monthly" | "yearly" }
```

**Réponse :** `{ "url": "https://checkout.stripe.com/..." }` → le frontend redirige.

**Prix :**
- Crédit : 12 € (one-time, `quantity` param pour packs)
- Pro mensuel : 24 €/mois
- Pro annuel : 199 €/an (−31 %)

Si `STRIPE_SECRET_KEY` absent → 503 `STRIPE_NOT_CONFIGURED` (pas de crash).

---

### 21. Page Pricing — boutons Stripe fonctionnels

**Fichier modifié :** `panel/src/app/dashboard/pricing/page.tsx`

- Toggle mensuel / annuel pour le plan Pro (met à jour les prix affichés + paramètre `billing`)
- Boutons "Acheter 1 crédit" et "Pack 3 crédits" appellent `POST /payments/checkout` → redirect Stripe
- État de chargement (`Redirection…`) pendant l'appel API
- Bannière verte succès si `?success=credit` ou `?success=pro` dans l'URL (retour Stripe)
- Bannière jaune si `?cancelled=1`
- Bannière rouge si erreur API
- `refreshUser()` déclenché automatiquement au retour d'un paiement réussi

---

## Récapitulatif des fichiers modifiés (session 4)

| Fichier | Type |
|---------|------|
| `MIGRATION_SECURITY.sql` | **Nouveau** — Colonnes `family_id` + `used_at` sur `refresh_tokens` |
| `api/src/utils/validators.ts` | +referralCode, +teamMode |
| `api/src/routes/events.ts` | +vérification email_verified |
| `api/src/routes/auth.ts` | Refresh token reuse detection + family rotation |
| `api/src/routes/payments.ts` | **Nouveau** — Stripe Checkout (credit + pro mensuel/annuel) |
| `api/src/index.ts` | +route /payments |
| `panel/src/app/dashboard/pricing/page.tsx` | Boutons Stripe réels, toggle annuel/mensuel, banners |

---

## Deploy complet

```bash
cd ~/rallye-photo
git pull

# Installer stripe sur l'API
cd api && npm install && cd ..

# Migrations SQL (dans l'ordre)
mysql -u USER -p rallye_photo < MIGRATION_PLANS.sql
mysql -u USER -p rallye_photo < MIGRATION_FEATURES.sql
mysql -u USER -p rallye_photo < MIGRATION_SECURITY.sql

# Installer ClamAV (si pas déjà fait)
sudo apt-get install -y clamav clamav-daemon
sudo freshclam
sudo systemctl enable --now clamav-daemon

# Redémarrer
./deploy.sh
```

**Variables d'environnement à ajouter :**
```
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
```

**Configurer le webhook Stripe :** Endpoint → `https://api.rallye-photo.com/webhooks/stripe`
Événements à écouter : `checkout.session.completed`, `customer.subscription.deleted`, `customer.subscription.updated`

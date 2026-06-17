# Audit de code complet — rallye_photo

> Revue multi-agents (11 unites, couverture 100% du code source) — find -> verification adversariale -> synthese.  
> Date : 2026-06-16. Findings retenus apres elimination des faux positifs : 176.

## Synthese executive

La base de code Rallye Photo (API Node/Express + 3 frontends Next.js : participant PWA, panel organisateur, back-office admin, sur MariaDB + S3 IONOS + Stripe) presente un niveau de risque global ELEVE, dominee par deux familles de defauts systemiques majeurs. (1) Un modele d'authentification participant absent : l'identite repose sur un participantId non secret, devinable et expose par des endpoints publics, ce qui rend usurpables la soumission, le vote et la suppression de photos (IDOR generalise, finding critique). En parallele, les frontends panel/admin stockent les tokens JWT et refresh tokens 30j dans des cookies non-httpOnly sans flag Secure, et les transmettent en clair dans des query strings lors de l'impersonation, exfiltrables au moindre XSS. (2) Une absence quasi totale de transactions et de garanties d'idempotence : les webhooks Stripe peuvent double-crediter/double-upgrader (garde d'idempotence par LIKE non fiable, reponse 200 avant traitement, handlers subscription non idempotents), la creation d'event decremente les credits de facon non atomique (paiement contournable), et les suppressions multi-tables (admin, events, challenges) laissent des etats incoherents et des fichiers S3 orphelins. Themes recurrents transverses : (a) controles d'acces incoherents (de nombreuses routes de lecture sont publiques sans requireAuth, tandis que les controles de tier branding/exportZip/vote/surprise sont contournables) ; (b) generation d'aleatoire non cryptographique (Math.random) pour codes d'event, referral et tokens ; (c) tokens reset/verify stockes en clair sans hash ni expiration ; (d) interceptor de refresh sans single-flight provoquant des deconnexions par fausse detection de reutilisation (duplique a l'identique dans panel et admin) ; (e) rate limiter en memoire process-locale (contournable en multi-instance) ; (f) AV ClamAV en fail-open par defaut ; (g) duplication massive de code non factorise (config CORS, URLs API en dur, options de cookie, script anti-flash theme, casts 'any' systematiques) et migrations SQL fragiles/non idempotentes avec dependances d'ordre non documentees. Le pipeline de deploiement est incomplet : app et admin sont buildes mais jamais lances par PM2 et leur 'next start' n'a pas de port fixe. Enfin .gitignore ne couvre pas .env.production, risquant la fuite de tous les secrets de prod.

## Statistiques

| Severite | Nombre |
|---|---|
| 🔴 Critical | 1 |
| 🟠 High | 18 |
| 🟡 Medium | 26 |
| 🔵 Low | 93 |
| ⚪ Info | 38 |
| **Total** | **176** |

## Top priorites

1. Introduire une authentification participant reelle : emettre au join un token signe cote serveur (HMAC/JWT lie au participant + event), le renvoyer en header Authorization, et deriver participantId du token verifie pour TOUTES les routes submit/vote/delete/listes. Ne plus jamais utiliser un id de ressource comme preuve d'autorisation. (resout CRIT-001 et la chaine d'IDOR HIGH submit/vote/delete/listes)
2. Securiser les webhooks Stripe : table processed_webhook_events(stripe_event_id PRIMARY KEY) avec INSERT-first capturant ER_DUP_ENTRY, garde d'idempotence appliquee a TOUS les handlers (checkout/deleted/updated), traitement AVANT la reponse HTTP avec 500 sur echec pour declencher la relivraison, et englobement des mutations metier liees dans une transaction unique.
3. Refondre le stockage des tokens cote frontends : faire poser accessToken/refreshToken par l'API en cookies httpOnly + Secure + SameSite=Strict, supprimer le refreshToken du body JSON et des query strings d'impersonation (one-time token echange via POST), et centraliser les options de cookie partagees entre login et interceptor de refresh (panel + admin).
4. Encapsuler dans des transactions toutes les sequences multi-ecritures : register (users+refresh_tokens), creation d'event + decrement de credit conditionnel (affectedRows===1 avant tag premium), selection de gagnant, suppressions admin/events/challenges, et y associer la suppression S3 fiable (file de retry) pour eliminer etats partiels et fichiers orphelins.
5. Hasher (SHA-256) les tokens email_verify_token et reset_token avant stockage, ajouter une expiration au token de verification, et ne renvoyer le token en clair que par email, par symetrie avec les refresh tokens.
6. Corriger le modele d'autorisation des routes : ajouter requireAuth + verification d'ownership sur les GET publics (challenges, participants, teams, submissions, votes), exclure photo_secret des reponses (jamais de SELECT *), et faire respecter les controles de tier (branding, exportZip, publicVote, surpriseChallenges) cote serveur sur event.tier.
7. Implementer un interceptor de refresh single-flight (une seule promesse de refresh partagee, les 401 concurrents s'y abonnent et rejouent) ET un UPDATE conditionnel atomique sur la rotation des refresh tokens (SET used_at=NOW() WHERE id=? AND used_at IS NULL, verifier affectedRows) pour clore la race de detection de reutilisation. Factoriser la lib api entre panel et admin.
8. Remplacer Math.random par crypto.randomInt/randomBytes pour les codes d'event, referral_code et tout token, et s'appuyer sur des contraintes UNIQUE en base avec gestion ER_DUP_ENTRY/retry plutot que des pre-checks TOCTOU (codes event, referral, participants, votes, submissions).
9. Durcir l'infra de deploiement et de secrets : corriger .gitignore en '.env*' + '!.env.example' (et roter les secrets si deja commis), ajouter les blocs PM2 rallye-app/rallye-admin avec ports explicites, fixer 'next start -p' pour app/admin (collision port 3000), passer deploy.sh en 'set -euo pipefail' avec migrations idempotentes + health-check + rollback, et documenter l'ordre des migrations (PLANS -> FEATURES -> SECURITY).
10. Passer le rate limiter sur un store partage (Redis) et l'appliquer aux routes manquantes (refresh, verify-email, resend-verification, payments/checkout, photos/:token) ; rendre ClamAV fail-closed en prod (AV_REQUIRED derive de NODE_ENV) avec detection robuste de 'FOUND' ; et echapper firstName (escapeHtml) dans les emails.

## Findings detailles

### 🔴 Critiques ()

#### CRIT-001 — Identite participant sans secret : IDOR generalise (submit/vote/delete) via participantId spoofable, cote serveur ET client

- **Categorie** : security  
- **Zone** : Transverse â€” App participant (PWA) & API Submissions/Challenges  
- **Fichier** : `app/src/app/event/[id]/page.tsx` (lignes 310, 377, 402 (+ api/src/routes/submissions.ts:91-160,337-369 ; challenges.ts:204-282))  
- **Probleme** : L'identite du participant repose uniquement sur un participantId stocke en localStorage et envoye en clair : formData.append('participantId', ...) a l'upload (l.310), { participantId, submissionId } au vote (l.377), /submissions/{id}/participant/{participantId} a la suppression (l.402). Aucun header Authorization n'est ajoute par api.ts. Cote serveur, submit (submissions.ts l.91-160), vote (challenges.ts l.204-282) et delete (submissions.ts l.337-369) ne verifient que l'existence du couple participantId/event, jamais que le requeteur EST ce participant. Le participantId transite dans les GET publics /events/{id}/submissions, donc exfiltrable.  
- **Impact** : Usurpation d'identite complete entre participants : soumettre, voter ou supprimer des photos au nom d'autrui, bourrer les urnes, saboter le slot unique d'une victime (ER_DUP_ENTRY), polluer galerie et classement. C'est la faille structurelle centrale du modele participant.  
- **Recommandation** : Emettre cote serveur un token signe lie au participant au moment du join, le renvoyer en header Authorization, et deriver participantId du token verifie pour submit/vote/delete et le filtrage des listes. Ne jamais utiliser un id de ressource comme preuve d'autorisation. Comparaison constant-time de tout secret participant.

### 🟠 High (18)

#### HIGH-001 — Race condition non atomique sur la rotation des refresh tokens (reuse-detection contournable)

- **Categorie** : security  
- **Zone** : API â€” Auth & crypto (sensible)  
- **Fichier** : `api/src/routes/auth.ts` (lignes 325-378)  
- **Probleme** : Le SELECT (l.325-331) lit used_at puis un UPDATE separe non conditionnel marque le token consomme (l.368), sans transaction ni verrou. Deux POST /auth/refresh concurrents avec le meme token lisent tous deux used_at NULL, passent le test l.344 et emettent chacun un nouveau token, contournant la detection de reutilisation.  
- **Impact** : Un refresh token vole peut etre rejoue en concurrence avec l'usage legitime sans declencher l'invalidation de famille, defaisant la garantie centrale de detection de vol.  
- **Recommandation** : UPDATE conditionnel atomique 'SET used_at = NOW() WHERE id = ? AND used_at IS NULL' + verifier affectedRows === 1, sinon traiter comme reuse et invalider la famille ; ou SELECT...FOR UPDATE en transaction dediee.

#### HIGH-002 — Tokens de reset et de verification email stockes en clair en base

- **Categorie** : security  
- **Zone** : API â€” Auth & crypto (sensible)  
- **Fichier** : `api/src/routes/auth.ts` (lignes 105-107, 159-161, 198-200, 229-231)  
- **Probleme** : email_verify_token et reset_token sont generes (32 bytes hex) et inseres/compares EN CLAIR dans users, contrairement aux refresh tokens hashes en SHA-256. Une fuite read-only de la base permet d'utiliser directement reset_token pour prendre le controle d'un compte. reset-password ne verifie que le token + expiration.  
- **Impact** : Dump/fuite base = prise de controle de tout compte avec reset/verify token actif. Asymetrie injustifiee avec les refresh tokens.  
- **Recommandation** : Hasher ces tokens (hashToken) avant stockage, envoyer le token clair par email, comparer hashToken(input) a la verification.

#### HIGH-003 — Garde d'idempotence du webhook non fiable (LIKE sur details) + race condition

- **Categorie** : data-integrity  
- **Zone** : API â€” Paiements, webhooks, plans, affiliation (sensible)  
- **Fichier** : `api/src/routes/webhooks.ts` (lignes 68-89)  
- **Probleme** : L'unicite d'un evenement Stripe est verifiee via SELECT ... WHERE details LIKE CONCAT('%', ?, '%'). Recherche sous-chaine non indexable (full scan), faux positif possible, et surtout TOCTOU : deux livraisons du meme event passent le SELECT avant insertion de l'audit_log puis executent toutes deux event_credits + ? => double credit. Aucune contrainte d'unicite reelle.  
- **Impact** : Double credit ou double upgrade lors d'une relivraison/replay du webhook. Perte financiere directe.  
- **Recommandation** : Table processed_webhook_events(stripe_event_id VARCHAR PRIMARY KEY). INSERT en premier dans une transaction, capturer ER_DUP_ENTRY pour ignorer, et englober marqueur + mutation metier dans une seule transaction.

#### HIGH-004 — Handlers d'abonnement (deleted/updated) totalement non idempotents

- **Categorie** : data-integrity  
- **Zone** : API â€” Paiements, webhooks, plans, affiliation (sensible)  
- **Fichier** : `api/src/routes/webhooks.ts` (lignes 110-186)  
- **Probleme** : La garde d'idempotence n'est appelee QUE dans handleCheckoutCompleted. handleSubscriptionDeleted et handleSubscriptionUpdated ne verifient jamais stripeEventId. Stripe relivre ces events : handleSubscriptionDeleted reapplique a chaque relivraison downgrade plan='free', nouveau gracePeriodEnd, re-verrouillage galeries, email d'annulation.  
- **Impact** : Emails d'annulation en double/triple ; galeries re-verrouillees alors que l'utilisateur a peut-etre re-souscrit ; pro_expires_at ecrase. Etat incoherent et spam client.  
- **Recommandation** : Appliquer la garde d'idempotence basee sur stripe_event_id a TOUS les handlers, et n'envoyer l'email de cancellation qu'une fois.

#### HIGH-005 — Webhook : reponse 200 avant traitement -> erreurs DB silencieusement perdues, pas de retry Stripe

- **Categorie** : data-integrity  
- **Zone** : API â€” Paiements, webhooks, plans, affiliation (sensible)  
- **Fichier** : `api/src/routes/webhooks.ts` (lignes 34-54)  
- **Probleme** : res.status(200) (l.35) est envoye AVANT l'execution des handlers ; toute erreur est seulement loggee (catch l.52-54). Si un UPDATE echoue (DB indisponible, deadlock), Stripe a deja recu 200 et ne relivrera jamais. Le client a paye mais ne recoit ni credits ni upgrade.  
- **Impact** : Perte definitive et silencieuse d'un achat paye, sans relivraison possible. Litige client.  
- **Recommandation** : Traiter l'event AVANT de repondre et retourner 500 en cas d'echec pour declencher la relivraison Stripe (l'idempotence protege des doublons), ou utiliser une outbox fiable avec retry.

#### HIGH-006 — IDOR : liste des challenges accessible sans authentification ni filtrage par owner

- **Categorie** : security  
- **Zone** : API â€” Events, challenges, teams, participants  
- **Fichier** : `api/src/routes/challenges.ts` (lignes 14-25)  
- **Probleme** : GET /events/:eventId/challenges n'a aucun middleware requireAuth ni verification d'appartenance. Le SELECT retourne tous les defis incluant is_surprise, status, notified, sans filtrer les defis surprise non reveles.  
- **Impact** : Fuite des defis surprise censes rester caches, exposition de la structure de l'evenement a tout tiers connaissant l'eventId.  
- **Recommandation** : Ajouter requireAuth + verif owner pour la vue admin, et une vue participant excluant les surprise non reveles (WHERE is_surprise=0 OR status='revealed').

#### HIGH-007 — IDOR : liste des participants exposee sans authentification (fuite de donnees personnelles)

- **Categorie** : security  
- **Zone** : API â€” Events, challenges, teams, participants  
- **Fichier** : `api/src/routes/participants.ts` (lignes 93-105)  
- **Probleme** : GET /events/:eventId/participants n'a aucun middleware d'auth ni controle d'appartenance. Le SELECT renvoie id, name, team_id, team_name, joined_at de tous les participants.  
- **Impact** : Fuite des prenoms des participants vers tout tiers connaissant l'eventId, enumeration possible, et exposition des id servant de credential (cf CRIT-001).  
- **Recommandation** : Exiger requireAuth + verif ownership de l'event, OU restreindre via token participant du meme event.

#### HIGH-008 — Vote falsifiable : participantId fourni dans le body sans authentification du votant

- **Categorie** : security  
- **Zone** : API â€” Events, challenges, teams, participants  
- **Fichier** : `api/src/routes/challenges.ts` (lignes 204-282)  
- **Probleme** : POST /challenges/:challengeId/vote n'a aucun middleware d'auth et fait confiance a participantId du body. La verif participant confirme seulement que l'id existe dans l'event, pas que le requeteur EST ce participant. L'anti-double-vote est contournable en changeant participantId.  
- **Impact** : Bourrage d'urnes : un attaquant vote au nom de n'importe quel participant (ids obtenus via /participants non protegee), faussant le gagnant auto-designe au close-vote.  
- **Recommandation** : Authentifier le participant (token/session) et deriver participantId du token. Contrainte UNIQUE(challenge_id, participant_id) en base.

#### HIGH-009 — GET /events/:id renvoie tout l'event (SELECT *) incluant photo_secret

- **Categorie** : security  
- **Zone** : API â€” Events, challenges, teams, participants  
- **Fichier** : `api/src/routes/events.ts` (lignes 154-180)  
- **Probleme** : GET /events/:id fait SELECT * puis renvoie ...event, incluant photo_secret qui sert a signer les tokens photo (signPhotoToken). L'exposer permet de forger des tokens photo valides pour n'importe quelle cle/expiration de l'event.  
- **Impact** : Fuite du secret de signature des photos : generation de tokens d'acces arbitraires, contournement de l'expiration/scope des URLs signees.  
- **Recommandation** : Selectionner explicitement les colonnes necessaires et exclure photo_secret de la reponse ; ne jamais SELECT * vers le client.

#### HIGH-010 — DELETE submission par participant sans authentification ni preuve d'identite (IDOR)

- **Categorie** : security  
- **Zone** : API â€” Submissions, gallery, leaderboard, photos  
- **Fichier** : `api/src/routes/submissions.ts` (lignes 337-369)  
- **Probleme** : DELETE /submissions/:id/participant/:participantId n'a aucun middleware d'auth. Elle verifie seulement que la soumission appartient au participantId fourni dans l'URL. Le participantId est non secret et expose par les GET publics. N'importe qui connaissant un couple submission_id + participant_id peut supprimer la soumission d'autrui (DB + S3).  
- **Impact** : Suppression non autorisee de soumissions (DELETE + deleteFromS3), perte de donnees irreversible.  
- **Recommandation** : Exiger une preuve d'identite du participant (token signe / session) au lieu d'un participantId devinable. Comparer en constant-time.

#### HIGH-011 — POST submit accepte un participantId arbitraire (usurpation de participant)

- **Categorie** : security  
- **Zone** : API â€” Submissions, gallery, leaderboard, photos  
- **Fichier** : `api/src/routes/submissions.ts` (lignes 91-160)  
- **Probleme** : La route de soumission n'a pas d'auth participant : participantId vient du body et la seule verif est SELECT id FROM participants WHERE id=? AND event_id=?. Tout appelant peut soumettre au nom de n'importe quel participant de l'evenement.  
- **Impact** : Usurpation : soumettre des photos au nom d'autrui, declencher is_winner (mode participation), ou saboter en consommant le slot unique d'un participant via ER_DUP_ENTRY.  
- **Recommandation** : Authentifier le participant (token emis a l'inscription) et deriver participantId du token verifie plutot que du body.

#### HIGH-012 — Impersonation admin sans restriction : token persistant 30j vers tout compte y compris autre admin

- **Categorie** : security  
- **Zone** : API â€” Admin, bootstrap, middleware, validation  
- **Fichier** : `api/src/routes/admin.ts` (lignes 502-551)  
- **Probleme** : POST /admin/impersonate/:userId genere accessToken + refreshToken valide 30j pour N'IMPORTE quel userId, y compris un autre admin (le SELECT ne filtre pas is_admin). Le refresh token est insere sans marqueur d'impersonation ni lien avec l'admin, survit 30j independamment de la session admin.  
- **Impact** : Un admin (ou attaquant ayant compromis un admin) obtient un acces durable (30j) a tout compte, sans revocation liee a la session d'origine. Escalade laterale vers d'autres admins.  
- **Recommandation** : Interdire l'impersonation d'un is_admin. Emettre un refresh token a TTL court ou aucun, marquer la ligne refresh_tokens comme impersonation avec adminId pour audit/revocation.

#### HIGH-013 — Suppressions multi-tables sans transaction (admin) â€” etats incoherents en cas d'echec partiel

- **Categorie** : data-integrity  
- **Zone** : API â€” Admin, bootstrap, middleware, validation  
- **Fichier** : `api/src/routes/admin.ts` (lignes 142-150, 250-253, 565-566)  
- **Probleme** : DELETE /admin/users/:id execute une sequence de DELETE (submissions, participants, challenges en boucle, events, refresh_tokens, users) via pool.execute() sans transaction. Un echec au milieu laisse la base incoherente. Idem DELETE /admin/events/:id et DELETE /admin/participants/:id.  
- **Impact** : Corruption referentielle, comptes/evenements partiellement supprimes.  
- **Recommandation** : Encapsuler dans une transaction (getConnection + beginTransaction/commit/rollback) ou utiliser FK ON DELETE CASCADE.

#### HIGH-014 — File d'attente hors-ligne : chaque retry cree une nouvelle entree -> doublons de soumission

- **Categorie** : data-integrity  
- **Zone** : Frontend â€” App participant (PWA)  
- **Fichier** : `app/src/lib/offlineQueue.ts` (lignes 53)  
- **Probleme** : L'id de file est `${eventId}-${challengeId}-${Date.now()}`. Plusieurs tentatives enfilent la meme photo avec des id differents (handleUpload ajoute aussi a la file apres echec). Au retour en ligne, processOfflineQueue envoie chaque entree.  
- **Impact** : Doublons pour un meme defi, double comptage potentiel si le backend n'impose pas l'unicite (defi, participant).  
- **Recommandation** : Cle deterministe `${eventId}-${challengeId}-${participantId}` (put ecrase) et/ou idempotence + unicite serveur.

#### HIGH-015 — Tokens JWT/refresh stockes dans des cookies non-httpOnly sans flag Secure (panel) â€” vol par XSS / MITM

- **Categorie** : security  
- **Zone** : Frontend â€” Panel organisateur (dashboard) & libs auth  
- **Fichier** : `panel/src/lib/auth.tsx` (lignes 35, 57-58, 70, 81-83, 99, 107-113)  
- **Probleme** : accessToken et refreshToken (30j) sont poses via js-cookie (non-httpOnly) et COOKIE_OPTS ne contient que sameSite:'strict' sans secure. L'objet user complet est serialise en clair. refreshToken provient du body de /auth/login et /auth/refresh. Toute XSS sur le panel exfiltre le refreshToken longue duree via document.cookie ; absence de Secure expose au MITM sur HTTP.  
- **Impact** : Vol de session complet et persistant (30j) via n'importe quel XSS ou interception non-TLS. L'objet user cote client est falsifiable.  
- **Recommandation** : Servir les tokens en cookies httpOnly + Secure + SameSite=Strict poses par l'API, ne plus exposer refreshToken dans le body JSON. A minima ajouter secure a COOKIE_OPTS.

#### HIGH-016 — Tokens d'impersonation transmis en clair dans l'URL (query string) â€” panel & admin

- **Categorie** : security  
- **Zone** : Frontend â€” Panel & Back-office admin  
- **Fichier** : `admin/src/app/dashboard/users/page.tsx` (lignes 74-89 (+ panel/src/app/dashboard/layout.tsx:15-35))  
- **Probleme** : impersonateUser construit des URLSearchParams contenant accessToken, refreshToken et user, et ouvre window.open(panelUrl + '?impersonate=...'). Cote panel, layout.tsx lit ces tokens depuis searchParams puis les pose en cookies sans history.replaceState prealable. Les tokens transitent dans l'URL : historique, logs proxy/serveur, header Referer, jusqu'a la redirection.  
- **Impact** : Fuite du refreshToken 30j via Referer/historique/logs -> prise de controle du compte impersonne.  
- **Recommandation** : Ne jamais passer de tokens en query string : one-time token cote API echange via POST contre des cookies httpOnly, ou fragment (#) consomme puis efface via history.replaceState avant tout chargement.

#### HIGH-017 — Tokens admin (JWT access + refresh 30j) stockes en cookies JS non-httpOnly, lisibles par tout XSS

- **Categorie** : security  
- **Zone** : Frontend â€” Back-office admin  
- **Fichier** : `admin/src/app/auth/login/page.tsx` (lignes 23-24, 36)  
- **Probleme** : adminAccessToken (1j), adminRefreshToken (30j) et adminUser sont poses via js-cookie sans secure ni sameSite, donc non-httpOnly. Meme lecture dans api.ts et layout.tsx.  
- **Impact** : Une XSS sur le back-office exfiltre le refresh token 30j et le profil admin via document.cookie -> controle total de la plateforme. Absence de secure/sameSite expose au vol sur transport non chiffre et au CSRF.  
- **Recommandation** : Faire poser les tokens par l'API via Set-Cookie httpOnly + Secure + SameSite=Strict. A defaut forcer { secure:true, sameSite:'strict' } et ne pas serialiser adminUser en clair sur 30j.

#### HIGH-018 — Controle d'acces admin uniquement cote client â€” contournable, UI rendue avant verification

- **Categorie** : security  
- **Zone** : Frontend â€” Back-office admin  
- **Fichier** : `admin/src/app/dashboard/layout.tsx` (lignes 21-24, 35-110)  
- **Probleme** : La protection de /dashboard repose sur un useEffect testant seulement la presence du cookie adminAccessToken ; isAdmin n'est verifie qu'une fois au login et jamais reverifie. Le layout retourne immediatement tout le JSX (aucun etat de garde), donc les pages enfants se montent et lancent leurs appels API avant/pendant la redirection. Meme logique en page.tsx racine.  
- **Impact** : Autorisation dependant entierement de l'API ; un admin dont les droits ont ete retires conserve l'acces UI jusqu'a expiration. Redirection bypassable, flash de contenu admin et appels /admin/* pour visiteur non authentifie.  
- **Recommandation** : Bloquer le rendu des enfants tant que l'auth n'est pas confirmee (loader), re-valider isAdmin via /auth/me au montage, et garantir que chaque route /admin/* exige isAdmin cote serveur.

### 🟡 Medium (26)

#### MED-001 — Codes d'evenement generes avec Math.random (predictibles) + race TOCTOU sur l'unicite

- **Categorie** : security  
- **Zone** : API â€” Auth & crypto (sensible)  
- **Fichier** : `api/src/utils/codeGenerator.ts` (lignes 5-24)  
- **Probleme** : randomCode utilise Math.floor(Math.random()*CHARS.length) â€” PRNG non cryptographique. Codes 6 chars sur alphabet 32 = ~30 bits, brute-forcables. La boucle do/while fait un SELECT d'unicite puis l'appelant (events.ts l.86) fait l'INSERT separement : TOCTOU.  
- **Impact** : Acces non autorise a un event par devinette/enumeration du code (le code = cle de jointure de l'URL join). Risque de collision sur creation concurrente.  
- **Recommandation** : crypto.randomInt(0, CHARS.length). Contrainte UNIQUE sur events.code + retry sur ER_DUP_ENTRY plutot que pre-check.

#### MED-002 — Enumeration d'utilisateurs par timing sur /auth/login (pas de hash factice)

- **Categorie** : security  
- **Zone** : API â€” Auth & crypto (sensible)  
- **Fichier** : `api/src/routes/auth.ts` (lignes 263-280)  
- **Probleme** : Si users.length === 0 la fonction retourne immediatement sans comparePassword. Si l'utilisateur existe, bcrypt.compare (12 rounds) s'execute. L'ecart de temps distingue email inexistant d'email existant malgre le message generique.  
- **Impact** : Enumeration des emails enregistres, utile pour credential stuffing/phishing.  
- **Recommandation** : Toujours executer comparePassword contre un hash bcrypt factice precalcule quand l'utilisateur n'existe pas.

#### MED-003 — Absence de rate limiting sur /auth/refresh, /auth/resend-verification et /auth/verify-email

- **Categorie** : security  
- **Zone** : API â€” Auth & crypto (sensible)  
- **Fichier** : `api/src/routes/auth.ts` (lignes 96, 138, 314)  
- **Probleme** : register, login, forgot-password, reset-password ont rateLimiter, mais verify-email, resend-verification et refresh n'en ont pas. verify-email permet d'eprouver des tokens en clair sans limite ; resend permet l'abus d'envoi d'emails ; refresh non limite facilite le bruteforce de la table.  
- **Impact** : Brute-force des tokens de verification, abus d'envoi d'emails, pression sur la rotation.  
- **Recommandation** : Appliquer rateLimiter sur ces trois routes.

#### MED-004 — endsAt potentiellement NaN : current_period_end deplace hors de l'objet subscription (Stripe Basil 2025)

- **Categorie** : bug  
- **Zone** : API â€” Paiements, webhooks, plans, affiliation (sensible)  
- **Fichier** : `api/src/routes/webhooks.ts` (lignes 110-132)  
- **Probleme** : const endsAt = new Date((subscription.current_period_end as number) * 1000). Sur les versions recentes de l'API Stripe, current_period_end est porte par chaque item (subscription.items.data[0].current_period_end) => undefined*1000=NaN => Invalid Date ecrite dans pro_expires_at et utilisee pour gracePeriodEnd.  
- **Impact** : pro_expires_at et gallery_locked_until ecrits a une date invalide ; periode de grace cassee.  
- **Recommandation** : Lire defensivement periodEnd = current_period_end ?? items.data[0].current_period_end, valider Number.isFinite avant new Date, epingler apiVersion.

#### MED-005 — Operations multiples d'un handler webhook non transactionnelles (etat partiel possible)

- **Categorie** : data-integrity  
- **Zone** : API â€” Paiements, webhooks, plans, affiliation (sensible)  
- **Fichier** : `api/src/routes/webhooks.ts` (lignes 91-107, 126-144)  
- **Probleme** : handleCheckoutCompleted (branche pro) et handleSubscriptionDeleted executent plusieurs pool.execute independants (users + events + audit) sans transaction. Si une requete echoue apres la premiere, etat partiellement applique (plan='pro' mais galeries non deverrouillees, etc.).  
- **Impact** : Desynchronisation entre users et events (plan/tier/verrou), difficile a detecter.  
- **Recommandation** : Encapsuler les ecritures liees d'un meme event dans une transaction, idealement avec le marqueur d'idempotence.

#### MED-006 — Race condition TOCTOU sur l'unicite du code de parrainage (affiliates)

- **Categorie** : data-integrity  
- **Zone** : API â€” Paiements, webhooks, plans, affiliation (sensible)  
- **Fichier** : `api/src/routes/affiliates.ts` (lignes 80-90)  
- **Probleme** : Verification d'unicite via SELECT puis UPDATE en deux requetes non atomiques. Des referral_code dupliques sont possibles si la colonne n'a pas de contrainte UNIQUE effective.  
- **Impact** : Codes de parrainage en doublon => attribution ambigue.  
- **Recommandation** : S'appuyer sur la contrainte UNIQUE : tenter l'UPDATE et capturer ER_DUP_ENTRY pour renvoyer 409.

#### MED-007 — Decrement de credit non atomique avec la creation d'event (paiement contournable)

- **Categorie** : data-integrity  
- **Zone** : API â€” Events, challenges, teams, participants  
- **Fichier** : `api/src/routes/events.ts` (lignes 42-97)  
- **Probleme** : resolveEventTier calcule le tier a partir d'un credits lu l.42-46. L'INSERT event (l.86) et le UPDATE event_credits-1 WHERE >0 (l.93-94) ne sont pas dans une transaction. Deux creations concurrentes avec 1 credit peuvent toutes deux etre taggees 'premium' (tier fige avant decrement), un seul UPDATE decremente : 2 events premium pour 1 credit.  
- **Impact** : Contournement du paiement : plusieurs events premium pour un seul credit, ou crash entre INSERT et UPDATE = event premium gratuit.  
- **Recommandation** : Transaction englobant lecture credit + INSERT + decrement conditionnel ; n'inserer en premium que si affectedRows===1.

#### MED-008 — Race condition sur le double-vote (TOCTOU) sans contrainte d'unicite

- **Categorie** : data-integrity  
- **Zone** : API â€” Events, challenges, teams, participants  
- **Fichier** : `api/src/routes/challenges.ts` (lignes 258-272)  
- **Probleme** : SELECT 'deja vote' puis INSERT non atomiques. Deux requetes concurrentes du meme participant passent toutes deux le SELECT avant l'INSERT.  
- **Impact** : Double vote possible par envoi concurrent.  
- **Recommandation** : Contrainte UNIQUE(challenge_id, participant_id) + gestion ER_DUP_ENTRY.

#### MED-009 — Selection de gagnant non transactionnelle (etat incoherent possible)

- **Categorie** : data-integrity  
- **Zone** : API â€” Events, challenges, teams, participants  
- **Fichier** : `api/src/routes/challenges.ts` (lignes 94-96, 188-190)  
- **Probleme** : Les trois UPDATE (reset is_winner FALSE, set TRUE, status='judged') sont hors transaction. Meme schema en close-vote.  
- **Impact** : Challenge marque judged sans gagnant valide en cas d'echec entre requetes.  
- **Recommandation** : Regrouper dans une transaction unique sur meme connexion.

#### MED-010 — join : reconnexion basee sur (event_id, name) â€” usurpation d'identite d'un participant existant

- **Categorie** : security  
- **Zone** : API â€” Events, challenges, teams, participants  
- **Fichier** : `api/src/routes/participants.ts` (lignes 62-75)  
- **Probleme** : La reconnexion identifie un participant existant uniquement par event_id + name, sans comparer deviceId. Un tiers rejoignant avec le meme prenom recupere l'id du participant existant (reconnected:true) et peut agir en son nom.  
- **Impact** : Usurpation d'un participant en devinant son prenom (controle de ses soumissions/votes via participantId).  
- **Recommandation** : Identifier la reconnexion par device_id (ou secret participant) ; refuser/suffixer si name existe avec un device_id different.

#### MED-011 — Fichier video uploade sans validation reelle du contenu (seul le mimetype client est verifie)

- **Categorie** : security  
- **Zone** : API â€” Submissions, gallery, leaderboard, photos  
- **Fichier** : `api/src/routes/submissions.ts` (lignes 55-62, 181-194)  
- **Probleme** : Pour les images, sharp re-encode et valide implicitement. Pour les videos, le buffer est uploade tel quel vers S3 sans validation de contenu : seul file.mimetype, declaratif cote client, est verifie. ClamAV attrape les malwares connus mais ne garantit pas un conteneur video valide.  
- **Impact** : Stockage de fichiers arbitraires (jusqu'a 50MB) servis via l'URL photo signee ; filtrage de type contournable.  
- **Recommandation** : Valider le contenu video par magic bytes (file-type) et idealement re-transcoder (ffmpeg). Ne pas se fier au mimetype multer seul.

#### MED-012 — Rate limiter en memoire global (Map) â€” DoS, fuite memoire, contournement multi-instance

- **Categorie** : security  
- **Zone** : Transverse â€” API middleware  
- **Fichier** : `api/src/middleware/rateLimiter.ts` (lignes 3-34)  
- **Probleme** : Les compteurs sont stockes dans une Map process-locale indexee par IP. En multi-instance (PM2 cluster) ou apres redemarrage, les limites sont incoherentes/contournables (multiplication par instance). Le nettoyage ne tourne que toutes les 5 min sans cap de taille, donc beaucoup d'IP uniques font grossir la Map. Le spoof XFF direct est partiellement mitige par trust proxy=1.  
- **Impact** : Limites inefficaces en multi-instance et croissance memoire non bornee.  
- **Recommandation** : Store partage (Redis). A defaut borner la taille de la Map et nettoyer lazily. Verifier que 'trust proxy' correspond au nombre reel de proxies IONOS.

#### MED-013 — WebSocket socket.io sans authentification ni autorisation de room (API + 3 frontends)

- **Categorie** : security  
- **Zone** : Transverse â€” Temps reel socket.io  
- **Fichier** : `api/src/config/socket.ts` (lignes 24-44 (+ app/panel/admin event pages))  
- **Probleme** : Le serveur socket.io n'a aucun io.use() d'authentification. Tout client peut emettre 'join-event' avec un eventId arbitraire, rejoindre la room et recevoir tous les broadcasts (nouvelles soumissions, leaderboard, online-count). Cote frontends, io(...) se connecte sans token (app page.tsx l.212-216, leaderboard, results ; panel events/[id] l.125-153).  
- **Impact** : Fuite d'evenements temps reel (soumissions, noms, gagnants) vers des tiers, pollution du online-count, enumeration d'eventId.  
- **Recommandation** : Ajouter io.use() verifiant un token au handshake (auth:{token}) et valider le droit d'acces a l'event sur join-event.

#### MED-014 — validateBody non applique aux routes admin â€” SSRF potentielle via endpoint S3

- **Categorie** : security  
- **Zone** : API â€” Admin, bootstrap, middleware, validation  
- **Fichier** : `api/src/routes/admin.ts` (lignes 109, 300-305)  
- **Probleme** : PATCH /users/:id et PUT /settings/s3 lisent req.body directement sans validateBody/Zod. endpoint n'est teste que non-vide puis .trim() ; il n'est pas valide comme URL https avec allowlist â€” un admin peut pointer vers un service interne, declenchant une SSRF lors de POST /settings/s3/test (testS3Connection).  
- **Impact** : endpoint S3 arbitraire => SSRF vers metadonnees cloud / services internes. Risque limite aux admins mais reel.  
- **Recommandation** : Appliquer un schema Zod ; valider endpoint comme URL https avec allowlist d'hotes IONOS ; rejeter hotes prives/loopback.

#### MED-015 — Suppression user/event/participant sans nettoyage S3 â€” fichiers orphelins (RGPD)

- **Categorie** : data-integrity  
- **Zone** : API â€” Admin, bootstrap, middleware, validation  
- **Fichier** : `api/src/routes/admin.ts` (lignes 142-150, 250-253, 564-566)  
- **Probleme** : Les routes DELETE suppriment les lignes submissions en base mais n'appellent jamais de suppression S3 sur photo_key. Aucune iteration sur les photo_key avant DELETE.  
- **Impact** : Accumulation indefinie de photos orphelines sur le bucket IONOS (cout, RGPD : donnees d'un user supprime non effacees, acces residuel via URL presignee).  
- **Recommandation** : Avant suppression en base, collecter les photo_key et appeler une suppression S3 par batch (DeleteObjects) en tolerant les erreurs.

#### MED-016 — Webhook Stripe : ordre des middlewares express.raw / express.json a verifier

- **Categorie** : bug  
- **Zone** : API â€” Admin, bootstrap, middleware, validation  
- **Fichier** : `api/src/index.ts` (lignes 42, 51, 62)  
- **Probleme** : express.raw({type:'application/json'}) est monte sur /webhooks/stripe AVANT express.json global, mais webhookRoutes est monte sur /webhooks. express.json risque de tenter aussi de parser /webhooks/stripe (body deja consomme en raw -> req.body devient {} ou reste Buffer selon timing), cassant potentiellement la verification de signature Stripe.  
- **Impact** : Verification de signature Stripe potentiellement cassee si le body raw est re-parse, entrainant des webhooks rejetes ou acceptes a tort.  
- **Recommandation** : Monter le handler stripe avec express.raw au niveau de la route exacte et exclure /webhooks/stripe de express.json, ou placer le webhook sur un prefixe distinct hors du parser JSON global.

#### MED-017 — Parsing fragile de la sortie ClamAV (FOUND) â€” faux negatifs possibles

- **Categorie** : correctness  
- **Zone** : API â€” Services externes (S3, email, antivirus)  
- **Fichier** : `api/src/utils/antivirusService.ts` (lignes 57-62, 64-70)  
- **Probleme** : La detection repose sur err.code === 1 && stdout.includes('FOUND') et regex /: (.+) FOUND/. Si clamdscan retourne un code/format different lors d'une detection, la branche FOUND est ratee et on tombe dans le bloc generique ; avec AV_REQUIRED=false, retour {clean:true,skipped:true} â€” faux negatif.  
- **Impact** : Faux negatif : fichier infecte accepte si la detection ne matche pas le pattern.  
- **Recommandation** : Detecter 'FOUND' robustement (independamment du code), ne pas marquer clean en cas d'ambiguite si AV actif, ou utiliser INSTREAM.

#### MED-018 — AV_REQUIRED=false par defaut : erreurs de scan transformees en clean=true (fail-open)

- **Categorie** : security  
- **Zone** : API â€” Services externes (S3, email, antivirus)  
- **Fichier** : `api/src/utils/antivirusService.ts` (lignes 38-43, 65-70)  
- **Probleme** : Quand AV_REQUIRED n'est pas 'true' (defaut), l'absence de ClamAV et toute erreur de scan renvoient clean:true. Politique fail-open par defaut : si ClamAV tombe/absent en prod, tous les uploads passent sans scan.  
- **Impact** : En prod mal configure, fichiers malveillants stockes/redistribues sans scan.  
- **Recommandation** : Defaut AV_REQUIRED=true en prod (deriver de NODE_ENV) ou alerte critique/metrique a chaque skip.

#### MED-019 — Injection HTML/XSS dans les emails via firstName non echappe

- **Categorie** : security  
- **Zone** : API â€” Services externes (S3, email, antivirus)  
- **Fichier** : `api/src/utils/emailService.ts` (lignes 45, 98, 149, 167)  
- **Probleme** : firstName est interpole directement dans le HTML des templates sans echappement. firstName est controle par l'utilisateur a l'inscription ; du HTML/liens injectes passent tels quels dans l'email transactionnel (et dans le subject l.149).  
- **Impact** : Injection de contenu HTML/liens trompeurs (phishing), defacement du template au nom de la plateforme.  
- **Recommandation** : Echapper firstName via escapeHtml avant interpolation dans les 4 fonctions ; valider firstName a l'inscription.

#### MED-020 — uploadToS3/deleteFromS3/getSignedDownloadUrl n'imposent aucune contrainte sur la cle (path traversal / overwrite)

- **Categorie** : security  
- **Zone** : API â€” Services externes (S3, email, antivirus)  
- **Fichier** : `api/src/utils/s3Service.ts` (lignes 85-105, 110-122, 127-144)  
- **Probleme** : Les fonctions acceptent une cle arbitraire sans validation/normalisation. Si la cle derive d'une entree client non sanitizee en amont, ecrasement/suppression croisee possible.  
- **Impact** : Ecrasement ou suppression de fichiers d'autres organisateurs si la cle derive d'une entree client non controlee.  
- **Recommandation** : Imposer un prefixe derive cote serveur (events/<eventId>/...) et rejeter les composants suspects.

#### MED-021 — Refresh interceptor sans single-flight : tempete de /auth/refresh et rotation cassee (panel & admin)

- **Categorie** : bug  
- **Zone** : Transverse â€” Panel & Admin libs api  
- **Fichier** : `panel/src/lib/api.ts` (lignes 21-57 (+ admin/src/lib/api.ts:19-41))  
- **Probleme** : Le flag _retry est porte par originalRequest, donc chaque reponse 401 TOKEN_EXPIRED concurrente declenche son propre POST /auth/refresh. Avec rotation a detection de reutilisation, le 1er refresh invalide le token ; les refresh suivants reutilisent un token deja tourne -> detection de reuse -> revocation de session -> deconnexion. Aucun single-flight/mutex. Code duplique a l'identique entre panel et admin.  
- **Impact** : Deconnexions intempestives / invalidation de session a chaque expiration d'access token sur pages multi-requetes (frequent au chargement d'un dashboard). Charge inutile sur /auth/refresh.  
- **Recommandation** : Single-flight : une seule promesse de refresh partagee, les autres 401 attendent puis rejouent avec le nouveau token. Factoriser la lib entre panel et admin.

#### MED-022 — Le refresh automatique ne se declenche que si code === 'TOKEN_EXPIRED' (panel & admin)

- **Categorie** : bug  
- **Zone** : Transverse â€” Panel & Admin libs api  
- **Fichier** : `panel/src/lib/api.ts` (lignes 26 (+ admin/src/lib/api.ts:21))  
- **Probleme** : La condition exige status 401 ET data.code === 'TOKEN_EXPIRED'. Tout 401 sans ce code exact (token revoque/invalide) ne tente jamais le refresh ni la redirection : la promesse est rejetee, l'UI reste affichee avec des appels qui echouent silencieusement, sans deconnexion. Couplage fort a une chaine magique backend.  
- **Impact** : UX cassee sur certains 401 (utilisateur bloque sans redirection) ; si le backend change le code, le refresh cesse silencieusement.  
- **Recommandation** : Tenter le refresh sur tout 401 non deja retente, puis purger les cookies et rediriger vers /auth/login si le refresh echoue. Garder TOKEN_EXPIRED comme optimisation.

#### MED-023 — theme.tsx (panel) : branche !mounted retourne un <script> nu sans children, page SSR vide

- **Categorie** : bug  
- **Zone** : Frontend â€” Panel (auth flows & libs)  
- **Fichier** : `panel/src/lib/theme.tsx` (lignes 38-58)  
- **Probleme** : ThemeProvider initialise mounted=false et, tant que mounted est false (SSR + tout premier rendu client), retourne uniquement un <script> sans rendre {children}. Comme toute l'app est enfant de ThemeProvider, le HTML initial SSR ne contient aucun contenu applicatif : page vide jusqu'a l'hydratation, mismatch d'hydratation potentiel.  
- **Impact** : Aucun contenu utile dans le HTML SSR (mauvais SEO/perf, page blanche si JS lent/desactive) ; flash de contenu vide.  
- **Recommandation** : Toujours rendre {children} ; gerer l'anti-flash uniquement via le script inline du <head>. Idealement adopter next-themes.

#### MED-024 — Creation de defis de template en boucle await â€” lent, non atomique, defis partiels silencieux

- **Categorie** : data-integrity  
- **Zone** : Frontend â€” Panel organisateur (dashboard)  
- **Fichier** : `panel/src/app/dashboard/events/new/page.tsx` (lignes 42-58)  
- **Probleme** : Apres POST /events, les defis du template sont crees un par un avec await dans un for, chaque erreur avalee par console.error. Si des POST .../challenges echouent, l'event est cree avec un sous-ensemble arbitraire de defis sans avertir, puis router.push comme si tout avait reussi.  
- **Impact** : Etat incoherent (defis partiels) silencieux pour l'organisateur ; UX degradee sur gros templates (N requetes sequentielles).  
- **Recommandation** : Creer event+defis en une requete transactionnelle cote API, ou agreger les erreurs (Promise.allSettled) et avertir l'utilisateur.

#### MED-025 — Upload logo/banniere : validation uniquement cote client via attribut accept (taille/type non verifies)

- **Categorie** : security  
- **Zone** : Frontend â€” Panel organisateur (dashboard)  
- **Fichier** : `panel/src/app/dashboard/events/[id]/page.tsx` (lignes 966-985, 1004-1023)  
- **Probleme** : Les inputs file logo/banniere s'appuient uniquement sur accept="image/..." (filtre UI contournable) et un texte 'max 5MB'. Aucune verification de file.size/file.type/extension avant envoi : le fichier est poste tel quel.  
- **Impact** : Un client peut envoyer un fichier arbitraire (enorme -> DoS, ou non-image). La securite depend entierement du serveur.  
- **Recommandation** : Valider file.size (<=5MB) et file.type contre une allowlist avant envoi ; confirmer la validation serveur (taille/type/magic-bytes).

#### MED-026 — deploy.sh sans migration DB, sans pipefail, sans rollback ni health-check

- **Categorie** : devops  
- **Zone** : Infra â€” Migrations SQL, deploy, config, deps  
- **Fichier** : `deploy.sh` (lignes 1-17)  
- **Probleme** : set -e mais pas set -uo pipefail. Aucune migration SQL executee, donc le code peut attendre des colonnes (event_credits, tier, family_id, referral_code...) absentes. Les builds s'enchainent puis pm2 restart all ; si un build echoue, les precedents sont deja ecrits. Aucun rollback ni health-check.  
- **Impact** : Risque de desync code<->schema ('unknown column'), deploiement partiel sur echec de build intermediaire, downtime non maitrise.  
- **Recommandation** : set -euo pipefail, migration idempotente avant restart, build atomique + swap, health-check HTTP post-restart avec rollback.

### 🔵 Low (93)

#### LOW-001 — Timing/observabilite differente sur /auth/forgot-password selon l'existence du compte

- **Categorie** : security  
- **Zone** : API â€” Auth & crypto (sensible)  
- **Fichier** : `api/src/routes/auth.ts` (lignes 183-207)  
- **Probleme** : Message generique correct, mais la branche 'compte inexistant' retourne immediatement alors que la branche existante fait UPDATE + await sendResetPasswordEmail synchrone. Latence nettement superieure pour un email existant => enumeration par timing.  
- **Impact** : Enumeration d'emails via temps de reponse, annulant le benefice du message uniforme.  
- **Recommandation** : Fire-and-forget l'envoi d'email (.catch) et/ou repondre avant l'await, pour egaliser le cout des deux branches.

#### LOW-002 — Reset de mot de passe revoque les refresh tokens mais pas les access tokens en cours

- **Categorie** : security  
- **Zone** : API â€” Auth & crypto (sensible)  
- **Fichier** : `api/src/routes/auth.ts` (lignes 242-247)  
- **Probleme** : reset-password supprime tous les refresh_tokens mais les access tokens JWT deja emis (TTL 15m) restent valides jusqu'a expiration car stateless. Un access token vole fonctionne jusqu'a 15 min apres un reset.  
- **Impact** : Fenetre residuelle <=15 min d'acces pour un attaquant apres reset.  
- **Recommandation** : Acceptable avec TTL court ; sinon token_version/password_changed_at dans le JWT verifie cote middleware.

#### LOW-003 — verifyPhotoToken ne lie pas le token a l'event attendu (defense en profondeur manquante)

- **Categorie** : security  
- **Zone** : Transverse â€” API photoToken & photos  
- **Fichier** : `api/src/utils/photoToken.ts` (lignes 67-90 (+ photos.ts:40-55))  
- **Probleme** : verifyPhotoToken retourne eventId depuis le payload sans verifier qu'il correspond a l'event dont eventSecret est fourni ; l'appelant photos.ts resout le secret a partir de decoded.e (eventId issu DU TOKEN), pas d'un contexte serveur independant. jwt.verify final valide l'integrite donc pas d'IDOR inter-events directement exploitable (chaque event a son photo_secret de 64 bytes), mais surface fragile et auto-referentielle.  
- **Impact** : Absence de defense en profondeur ; pas d'exploitation directe car la signature lie le secret. Surface fragile.  
- **Recommandation** : Ajouter expectedEventId a verifyPhotoToken et rejeter si verified.e !== expectedEventId ; resoudre eventSecret depuis le contexte de requete, jamais du token.

#### LOW-004 — generateReferralCode : Math.random + absence de garantie d'unicite (register)

- **Categorie** : data-integrity  
- **Zone** : API â€” Auth & crypto (sensible)  
- **Fichier** : `api/src/routes/auth.ts` (lignes 18-20, 50-53)  
- **Probleme** : myReferralCode genere via Math.random().toString(36).substring(2,10) puis insere directement sans verification d'unicite. referral_code est VARCHAR(8) UNIQUE, donc une collision fait echouer tout l'INSERT register et renvoie une 500.  
- **Impact** : Echec sporadique non gracieux de l'inscription en cas de collision ; codes faiblement aleatoires.  
- **Recommandation** : Generer via crypto et/ou gerer ER_DUP_ENTRY avec retry.

#### LOW-005 — Ecritures multiples non transactionnelles lors du register

- **Categorie** : data-integrity  
- **Zone** : API â€” Auth & crypto (sensible)  
- **Fichier** : `api/src/routes/auth.ts` (lignes 50-72)  
- **Probleme** : register fait INSERT users, INSERT referrals avec .catch silencieux, INSERT refresh_tokens en pool.execute separes sans transaction. Si l'INSERT refresh_tokens echoue apres users reussi, l'utilisateur est cree mais la reponse est 500 : etat incoherent (email pris mais creation 'echouee').  
- **Impact** : Comptes partiellement crees ; incoherence referred_by vs table referrals ; UX degradee.  
- **Recommandation** : Encapsuler users + refresh_tokens dans une transaction. Decider explicitement du sort de l'INSERT referrals.

#### LOW-006 — Logout : nettoyage incomplet et incoherent des refresh tokens

- **Categorie** : bug  
- **Zone** : API â€” Auth & crypto (sensible)  
- **Fichier** : `api/src/routes/auth.ts` (lignes 394-410)  
- **Probleme** : logout supprime le token presente par token_hash si fourni, puis 'DELETE ... WHERE user_id=? AND expires_at < NOW()' qui ne supprime que les tokens DEJA expires (GC opportuniste). Si le client n'envoie pas refreshToken, aucune session active n'est revoquee : le refresh token reste valide jusqu'a 30 jours.  
- **Impact** : Deconnexion non fiable : un refresh token peut rester actif apres logout cote client (fenetre 30 jours).  
- **Recommandation** : Logout global optionnel : supprimer tous les refresh_tokens du user/famille ; au minimum invalider la famille du token presente.

#### LOW-007 — verify-email : token de verification compare en clair sans expiration

- **Categorie** : security  
- **Zone** : API â€” Auth & crypto (sensible)  
- **Fichier** : `api/src/routes/auth.ts` (lignes 105-121)  
- **Probleme** : email_verify_token est compare par egalite SQL en clair sans aucune borne d'expiration (contrairement a reset_token). Un token de verification fuite/capture reste valide indefiniment tant que l'email n'est pas verifie. Combine au stockage en clair et a l'absence de rate limit, la surface de brute-force/replay est large.  
- **Impact** : Token de verification email a duree de vie illimitee, stocke/compare en clair ; verification usurpable en cas de fuite.  
- **Recommandation** : Ajouter une expiration, hasher le token (cf HIGH-002), limiter le taux sur /auth/verify-email.

#### LOW-008 — getIp() lit X-Forwarded-For sans validation pour l'audit log (spoof des logs de securite)

- **Categorie** : security  
- **Zone** : API â€” Auth & crypto (sensible)  
- **Fichier** : `api/src/routes/auth.ts` (lignes 14-16)  
- **Probleme** : getIp() lit directement req.headers['x-forwarded-for'].split(',')[0] sans s'appuyer sur la resolution Express 'trust proxy' (req.ip). Un client peut injecter une IP arbitraire dans le premier segment, enregistree telle quelle dans tous les logAudit.  
- **Impact** : Falsification de l'IP dans la piste d'audit ; attribution erronee lors d'incidents ; incrimination d'une IP tierce.  
- **Recommandation** : Utiliser req.ip (resolu par trust proxy=1) ; ou logguer req.ip ET le XFF brut etiquete non fiable.

#### LOW-009 — refresh : nouvelle famille cassee si family_id est NULL (sessions orphelines, reuse-detection affaiblie)

- **Categorie** : security  
- **Zone** : API â€” Auth & crypto (sensible)  
- **Fichier** : `api/src/routes/auth.ts` (lignes 376-378)  
- **Probleme** : Le nouveau token reutilise record.family_id ?? uuidv4(). Si family_id est NULL en base, chaque rotation cree une NOUVELLE famille au lieu de chainer, rompant la continuite de detection de reutilisation. Le fallback DELETE par user_id en cas de reuse signale une incoherence de modele non garantie par une contrainte NOT NULL.  
- **Impact** : Detection de reutilisation potentiellement contournee pour des tokens dont family_id serait NULL ; invalidation incoherente (famille vs user).  
- **Recommandation** : Rendre family_id NOT NULL en base et toujours le propager ; supprimer les branches de fallback ou les logger comme anomalie.

#### LOW-010 — Quantite de credits issue des metadata sans borne ni verification de coherence (webhook)

- **Categorie** : data-integrity  
- **Zone** : API â€” Paiements, webhooks, plans, affiliation (sensible)  
- **Fichier** : `api/src/routes/webhooks.ts` (lignes 78-83)  
- **Probleme** : const quantity = parseInt(session.metadata?.quantity || '1', 10) puis event_credits + ? sans reborner [1,10] ni verifier amount_total. Cote payments.ts la creation rebornne deja, donc risque externe faible, mais aucune coherence amount_total <-> quantity*CREDIT_PRICE_CENTS n'est verifiee cote webhook.  
- **Impact** : Si la logique amont change ou si une session est creee ailleurs, montant paye incoherent non detecte ; NaN possible.  
- **Recommandation** : Reborner quantity cote webhook, gerer NaN, et verifier session.amount_total === quantity * CREDIT_PRICE_CENTS avant credit.

#### LOW-011 — client_reference_id absent + stripe_customer_id requis : activation potentiellement manquee selon l'ordonnancement Stripe

- **Categorie** : data-integrity  
- **Zone** : API â€” Paiements, webhooks, plans, affiliation (sensible)  
- **Fichier** : `api/src/routes/payments.ts` (lignes 36-83 (+ webhooks.ts:168-178))  
- **Probleme** : Le lien session<->user repose uniquement sur metadata.user_id. Les handlers subscription.* filtrent par stripe_customer_id (ecrit uniquement par checkout.completed). Un subscription.updated 'active' arrivant avant checkout.completed ne trouve aucun user (return silencieux l.173) et l'activation peut etre manquee.  
- **Impact** : Ordonnancement Stripe non garanti : reactivation/activation Pro manquee silencieusement.  
- **Recommandation** : Definir client_reference_id et propager metadata.user_id via subscription_data.metadata ; logger un warning au lieu d'un return silencieux quand aucun user n'est trouve.

#### LOW-012 — Absence de rate limiting sur la creation de session de paiement

- **Categorie** : performance  
- **Zone** : API â€” Paiements, webhooks, plans, affiliation (sensible)  
- **Fichier** : `api/src/routes/payments.ts` (lignes 13-100)  
- **Probleme** : POST /payments/checkout n'a aucun rate limiting. Chaque appel cree une session Stripe (appel reseau sortant). Un utilisateur authentifie peut spammer.  
- **Impact** : Abus de l'API Stripe (cout/latence), pollution dashboards, DoS leger via dependance externe.  
- **Recommandation** : Ajouter express-rate-limit sur cette route.

#### LOW-013 — Conversion d'affiliation jamais declenchee a l'upgrade Pro paye

- **Categorie** : data-integrity  
- **Zone** : API â€” Paiements, webhooks, plans, affiliation (sensible)  
- **Fichier** : `api/src/routes/webhooks.ts` (lignes 91-107)  
- **Probleme** : Le type d'action 'affiliate.convert' existe et la table referrals a un statut 'converted'/'rewarded', mais handleCheckoutCompleted (branche pro) ne met jamais a jour referrals ni le statut de parrainage lors d'un upgrade Pro paye.  
- **Impact** : Les parrainages restent 'pending' meme apres conversion payante ; recompenses non attribuees (a confirmer selon l'emplacement attendu).  
- **Recommandation** : Verifier ou la conversion referrals.status='converted' doit se produire ; si c'est au paiement, l'ajouter dans handleCheckoutCompleted (transaction idempotente).

#### LOW-014 — handleSubscriptionUpdated ne reagit qu'a status==='active' : past_due/unpaid/canceled non geres

- **Categorie** : correctness  
- **Zone** : API â€” Paiements, webhooks, plans, affiliation (sensible)  
- **Fichier** : `api/src/routes/webhooks.ts` (lignes 163-186)  
- **Probleme** : handleSubscriptionUpdated ne traite QUE status==='active'. Les transitions vers past_due/unpaid/incomplete_expired (echec de renouvellement) ne declenchent aucun downgrade ni verrouillage. Un abonnement en echec persistant reste plan='pro' jusqu'a suppression definitive.  
- **Impact** : Un utilisateur dont les paiements echouent garde l'acces Pro plusieurs semaines.  
- **Recommandation** : Gerer explicitement past_due/unpaid/incomplete_expired (verrou/downgrade ou notification).

#### LOW-015 — Suppression de challenge sans transaction : cles S3 orphelines/perdues

- **Categorie** : data-integrity  
- **Zone** : API â€” Events, challenges, teams, participants  
- **Fichier** : `api/src/routes/challenges.ts` (lignes 358-373)  
- **Probleme** : DELETE votes/submissions/challenges hors transaction, et suppression S3 en fire-and-forget avec erreurs seulement loguees. Meme schema pour DELETE /events/:id (events.ts:239-252).  
- **Impact** : Fichiers S3 orphelins en cas d'echec S3 sans trace en base ; suppression DB partielle possible.  
- **Recommandation** : Transaction pour les DELETE DB ; file de retry persistee pour S3 plutot que fire-and-forget.

#### LOW-016 — PATCH /events/:id : status et scoring_mode acceptes sans validation

- **Categorie** : data-integrity  
- **Zone** : API â€” Events, challenges, teams, participants  
- **Fichier** : `api/src/routes/events.ts` (lignes 188-214)  
- **Probleme** : La route PATCH n'utilise aucun validateBody. status, scoringMode, themeColor, galleryEnabled/teamMode sont ecrits tels quels. status peut prendre une valeur arbitraire non geree ailleurs ; theme_color non valide potentiellement reinjecte en CSS front.  
- **Impact** : Etats incoherents (status invalide accepte), risque CSS sur theme_color.  
- **Recommandation** : Schema de validation PATCH : enum status/scoringMode, regex hex themeColor, bool pour flags.

#### LOW-017 — enable-vote ne verifie pas le tier de l'evenement (seulement le plan user)

- **Categorie** : correctness  
- **Zone** : API â€” Events, challenges, teams, participants  
- **Fichier** : `api/src/routes/challenges.ts` (lignes 124-130)  
- **Probleme** : L'activation du vote n'autorise que plan==='pro' au niveau user. Or EVENT_TIER_LIMITS.premium.publicVote=true. Un user free ayant un event tier='premium' (credit consomme) est bloque a tort.  
- **Impact** : Fonctionnalite payee (event premium via credit) refusee au user free, incoherence avec la grille de tiers.  
- **Recommandation** : Baser le controle sur EVENT_TIER_LIMITS[event.tier].publicVote au lieu de user.plan.

#### LOW-018 — Vote autorise sur evenement archive (pas de controle d'etat de l'event)

- **Categorie** : correctness  
- **Zone** : API â€” Events, challenges, teams, participants  
- **Fichier** : `api/src/routes/challenges.ts` (lignes 214-229)  
- **Probleme** : Le cast de vote verifie vote_enabled/vote_closed du challenge mais ne joint pas events ni ne verifie event.status. Un event archive avec un challenge vote_enabled=1 accepterait encore des votes.  
- **Impact** : Votes enregistres sur des evenements archives/termines.  
- **Recommandation** : Joindre events et rejeter si status==='archived' (410).

#### LOW-019 — close-vote : departage des ex aequo non gere (gagnant non deterministe)

- **Categorie** : correctness  
- **Zone** : API â€” Events, challenges, teams, participants  
- **Fichier** : `api/src/routes/challenges.ts` (lignes 171-189)  
- **Probleme** : La selection du gagnant fait ORDER BY vote_count DESC LIMIT 1 sans critere de departage stable. En cas d'egalite, le gagnant depend de l'ordre arbitraire MySQL.  
- **Impact** : Resultat non deterministe en cas d'egalite.  
- **Recommandation** : Ajouter ORDER BY vote_count DESC, MIN(submitted_at) ASC ou gerer fonctionnellement.

#### LOW-020 — POST /challenges/:id/winner/:submissionId : challenge marque judged meme si submissionId invalide

- **Categorie** : correctness  
- **Zone** : API â€” Events, challenges, teams, participants  
- **Fichier** : `api/src/routes/challenges.ts` (lignes 94-96)  
- **Probleme** : L'UPDATE is_winner conditionne WHERE id=? AND challenge_id=?, donc un submissionId invalide ne marque personne, MAIS l'UPDATE suivant passe quand meme status='judged' (affectedRows non verifie). Resultat : challenge 'judged' sans aucun gagnant.  
- **Impact** : Challenge marque juge sans gagnant valide si submissionId errone, sans retour d'erreur.  
- **Recommandation** : Verifier affectedRows===1 sur l'UPDATE is_winner avant de marquer 'judged', sinon 404.

#### LOW-021 — Limite de participants/challenges/events free contournable par condition de course (TOCTOU)

- **Categorie** : data-integrity  
- **Zone** : API â€” Events, challenges, teams, participants  
- **Fichier** : `api/src/routes/participants.ts` (lignes 39-82)  
- **Probleme** : COUNT(*) puis INSERT non atomiques. Joins concurrents depassent participantLimit. Meme schema pour challenges (challenges.ts:44-63) et events free (events.ts:66-89).  
- **Impact** : Depassement des quotas de tier, contournement marginal de la monetisation.  
- **Recommandation** : Transaction + verrou ou compteur atomique, ou accepter un leger depassement documente.

#### LOW-022 — join : doublons de nom possibles (race) et absence de contrainte d'unicite

- **Categorie** : data-integrity  
- **Zone** : API â€” Events, challenges, teams, participants  
- **Fichier** : `api/src/routes/participants.ts` (lignes 62-82)  
- **Probleme** : SELECT existing puis INSERT non atomique : deux joins concurrents du meme name creent deux participants. Pas de contrainte UNIQUE(event_id, name) visible.  
- **Impact** : Participants en double, incoherences d'affichage/score.  
- **Recommandation** : Contrainte UNIQUE(event_id, name) + gestion ER_DUP_ENTRY, ou INSERT ON DUPLICATE KEY.

#### LOW-023 — Validation d'equipe ignoree quand team_mode desactive mais teamId fourni

- **Categorie** : correctness  
- **Zone** : API â€” Events, challenges, teams, participants  
- **Fichier** : `api/src/routes/participants.ts` (lignes 51-82)  
- **Probleme** : La validation d'appartenance d'equipe ne s'execute que si event.team_mode ET teamId. Si team_mode est faux mais teamId fourni, il n'est pas valide mais est insere (teamId || null) â€” rattachement a une equipe arbitraire d'un autre event possible.  
- **Impact** : Participant rattache a une equipe non validee / d'un autre event, faussant les scores d'equipe.  
- **Recommandation** : Valider teamId (existence + appartenance event) des qu'il est fourni, ou rejeter teamId si team_mode est faux.

#### LOW-024 — Creation d'equipe sans controle du tier / team_mode et sans limite

- **Categorie** : correctness  
- **Zone** : API â€” Events, challenges, teams, participants  
- **Fichier** : `api/src/routes/teams.ts` (lignes 10-41)  
- **Probleme** : POST /events/:eventId/teams verifie l'ownership mais n'exige pas team_mode active ni aucune limite de nombre d'equipes. name seulement trim non vide, color non valide (hex).  
- **Impact** : Creation illimitee d'equipes meme hors team_mode ; name/color arbitraires.  
- **Recommandation** : Valider name (longueur/caracteres) et color (hex), verifier team_mode et appliquer une limite.

#### LOW-025 — GET /challenges/:challengeId/votes expose le decompte des votes sans auth (fuite avant cloture)

- **Categorie** : security  
- **Zone** : API â€” Events, challenges, teams, participants  
- **Fichier** : `api/src/routes/challenges.ts` (lignes 284-307)  
- **Probleme** : GET /challenges/:challengeId/votes n'a aucun middleware d'auth et revele, par submission et participant_name, le decompte de votes en temps reel pendant que le vote est ouvert.  
- **Impact** : Tout tiers connaissant un challengeId voit les resultats partiels en direct (effet bandwagon) et les noms des soumissionnaires.  
- **Recommandation** : Restreindre l'acces aux resultats detailles (organisateur authentifie) ou ne reveler les totaux qu'apres vote_closed.

#### LOW-026 — GET /events/:eventId/teams expose composition et scores des equipes sans auth (IDOR)

- **Categorie** : security  
- **Zone** : API â€” Events, challenges, teams, participants  
- **Fichier** : `api/src/routes/teams.ts` (lignes 43-66)  
- **Probleme** : GET /events/:eventId/teams n'a aucun middleware d'auth ni verification d'appartenance. Renvoie noms d'equipes, member_count et scores pour tout eventId.  
- **Impact** : Fuite de la structure d'equipes et des scores d'un event vers tout tiers connaissant l'eventId.  
- **Recommandation** : Exiger requireAuth/ownership ou un token participant du meme event si ces donnees ne sont pas publiques.

#### LOW-027 — POST /events/:id/logo et /banner ne verifient pas le tier branding (premium/pro)

- **Categorie** : correctness  
- **Zone** : API â€” Events, challenges, teams, participants  
- **Fichier** : `api/src/routes/events.ts` (lignes 497-540)  
- **Probleme** : Les uploads de branding verifient l'ownership mais pas que EVENT_TIER_LIMITS[tier].branding est true. Un event tier='free' peut quand meme uploader logo/banniere, affiches aussi via /join/:code.  
- **Impact** : Contournement de la limite de monetisation 'branding' reservee aux events premium/pro.  
- **Recommandation** : Charger event.tier et rejeter si EVENT_TIER_LIMITS[tier].branding est false.

#### LOW-028 — GET /events/:id/export-zip ne verifie pas le tier exportZip (premium/pro)

- **Categorie** : correctness  
- **Zone** : API â€” Events, challenges, teams, participants  
- **Fichier** : `api/src/routes/events.ts` (lignes 398-410)  
- **Probleme** : L'export ZIP verifie l'ownership mais pas EVENT_TIER_LIMITS[tier].exportZip (false pour free). Un organisateur d'un event free peut exporter le ZIP malgre la restriction.  
- **Impact** : Contournement de la fonctionnalite payante d'export reservee aux tiers premium/pro.  
- **Recommandation** : Charger event.tier et rejeter (403) si EVENT_TIER_LIMITS[tier].exportZip est false.

#### LOW-029 — POST challenges : creation de defis surprise sans controle du tier surpriseChallenges

- **Categorie** : correctness  
- **Zone** : API â€” Events, challenges, teams, participants  
- **Fichier** : `api/src/routes/challenges.ts` (lignes 28-63)  
- **Probleme** : La creation de challenge accepte isSurprise du body et l'insere sans verifier EVENT_TIER_LIMITS[tier].surpriseChallenges (false pour free). Un event free peut creer des defis surprise.  
- **Impact** : Contournement de la fonctionnalite 'defis surprise' reservee aux tiers premium/pro.  
- **Recommandation** : Si isSurprise et EVENT_TIER_LIMITS[tier].surpriseChallenges est false, rejeter ou forcer isSurprise=false.

#### LOW-030 — DELETE /events/:id/logo et /banner ne suppriment pas l'objet S3 (orphelins)

- **Categorie** : data-integrity  
- **Zone** : API â€” Events, challenges, teams, participants  
- **Fichier** : `api/src/routes/events.ts` (lignes 543-560)  
- **Probleme** : Les routes DELETE logo et banner ne font qu'un UPDATE events SET logo_key/banner_key = NULL. Le fichier S3 (<code>/branding/logo.webp) n'est jamais supprime, et la cle est perdue (NULL) donc irrecuperable.  
- **Impact** : Fichiers de branding orphelins accumules dans S3 (cout) et toujours accessibles via cle connue + photo_secret.  
- **Recommandation** : Recuperer la cle avant le UPDATE et appeler deleteFromS3, comme dans DELETE /events/:id.

#### LOW-031 — export-zip : pas de protection contre les tres gros volumes (DoS memoire/temps)

- **Categorie** : performance  
- **Zone** : API â€” Events, challenges, teams, participants  
- **Fichier** : `api/src/routes/events.ts` (lignes 398-481)  
- **Probleme** : L'export streame sequentiellement chaque objet S3 (GetObjectCommand un par un, await dans la boucle). Aucune limite/pagination sur le nombre de soumissions.  
- **Impact** : Reponse lente pour gros events, longue connexion HTTP, latence S3 cumulee.  
- **Recommandation** : Limiter/paginer, paralleliser de facon controlee, ou generer l'archive en tache de fond.

#### LOW-032 — join/:code public : seul status==='archived' est filtre, autres status 'inactifs' exposes

- **Categorie** : correctness  
- **Zone** : API â€” Events, challenges, teams, participants  
- **Fichier** : `api/src/routes/events.ts` (lignes 110-151)  
- **Probleme** : La route publique /join/:code ne rejette que status==='archived'. D'autres status (brouillon/suspendu) seraient traites comme actifs et exposeraient les infos/branding signe de l'event.  
- **Impact** : Exposition potentielle d'evenements non publics selon les status reellement employes.  
- **Recommandation** : Filtrer explicitement sur les status autorises (ex: WHERE status='active').

#### LOW-033 — Galerie auto-creee : INSERT gallery_access non transactionnel (race -> lignes dupliquees)

- **Categorie** : data-integrity  
- **Zone** : API â€” Submissions, gallery, leaderboard, photos  
- **Fichier** : `api/src/routes/gallery.ts` (lignes 47-66)  
- **Probleme** : Le SELECT ... LIMIT 1 puis INSERT gallery_access n'est pas atomique. Deux requetes concurrentes au moment ou la deadline passe peuvent toutes deux constater accessRows.length===0 et inserer. Aucune contrainte UNIQUE sur event_id (PK = UUID()).  
- **Impact** : Lignes gallery_access dupliquees, expiresAt potentiellement incoherent (paid/permanent divergent). Fenetre etroite.  
- **Recommandation** : Contrainte UNIQUE sur event_id + INSERT ... ON DUPLICATE KEY, ou SELECT ... FOR UPDATE en transaction.

#### LOW-034 — INSERT gallery_access utilise startDate=maintenant pour les events sans deadline

- **Categorie** : correctness  
- **Zone** : API â€” Submissions, gallery, leaderboard, photos  
- **Fichier** : `api/src/routes/gallery.ts` (lignes 33-66)  
- **Probleme** : Pour un event 'ended'/'archived' SANS deadline, startDate = new Date(), donc expiresAt depend du moment du premier visiteur au lieu d'etre ancre sur la fin de l'event.  
- **Impact** : Duree de galerie incoherente selon la date du premier acces pour les events sans deadline. Impact commercial mineur.  
- **Recommandation** : Ancrer expiresAt sur un champ deterministe (deadline OU ended_at), pas sur 'maintenant'.

#### LOW-035 — gallery.ts : effet de bord d'ecriture (UPDATE gallery_locked) declenche par un GET non authentifie

- **Categorie** : security  
- **Zone** : API â€” Submissions, gallery, leaderboard, photos  
- **Fichier** : `api/src/routes/gallery.ts` (lignes 73-84)  
- **Probleme** : Le GET /:eventId/gallery (non authentifie) execute UPDATE events SET gallery_locked=TRUE des que expiresAt est passe. Un GET cense etre idempotent modifie l'etat, declenchable par n'importe quel visiteur anonyme connaissant l'eventId. Couple a l'auto-INSERT gallery_access.  
- **Impact** : Un visiteur anonyme peut declencher le verrouillage persistant de la galerie d'un event expire.  
- **Recommandation** : Deplacer la transition d'etat vers un job/cron ou une action authentifiee ; garder le GET en lecture seule.

#### LOW-036 — jwt.decode non valide utilise pour router vers le secret (eventId non compare a decoded.e)

- **Categorie** : security  
- **Zone** : API â€” Submissions, gallery, leaderboard, photos  
- **Fichier** : `api/src/routes/photos.ts` (lignes 40-55)  
- **Probleme** : Le handler decode le token sans verification pour extraire decoded.e et choisir le secret, puis verifie via verifyPhotoToken. Acceptable car la signature lie le secret, mais result.eventId n'est pas compare a decoded.e (cf LOW-003, dependance a des champs non verifies).  
- **Impact** : Pas d'exploitation directe ; fragile : dependance a des champs non verifies pour selectionner le secret.  
- **Recommandation** : Apres verifyPhotoToken, verifier result.eventId === decoded.e ; documenter le routage.

#### LOW-037 — Stream S3 pipe sans gestion d'erreur ni support Range -> connexions pendantes et UX video degradee

- **Categorie** : bug  
- **Zone** : API â€” Submissions, gallery, leaderboard, photos  
- **Fichier** : `api/src/routes/photos.ts` (lignes 75-92)  
- **Probleme** : stream.pipe(res) sans handler 'error' sur le stream S3 : si le flux echoue apres l'envoi des headers, la reponse reste pendante (headersSent). Aucune prise en charge des requetes Range : videos jusqu'a 50MB servies sans seek.  
- **Impact** : Requetes suspendues / sockets non liberees en cas d'erreur reseau S3 ; mauvaise UX video.  
- **Recommandation** : Ajouter stream.on('error', ...) ; propager le Range vers GetObjectCommand et renvoyer 206 + Accept-Ranges pour les videos.

#### LOW-038 — Scan antivirus execute AVANT l'acquisition du slot d'upload (memoire/CPU non bornes)

- **Categorie** : performance  
- **Zone** : API â€” Submissions, gallery, leaderboard, photos  
- **Fichier** : `api/src/routes/submissions.ts` (lignes 14-31, 163-194)  
- **Probleme** : Le semaphore borne a 2 les traitements sharp/upload, mais scanBuffer s'execute AVANT acquireUploadSlot. Un afflux lance de nombreux scans en parallele sans borne, chacun bufferisant jusqu'a 50MB (memoryStorage) avant la file.  
- **Impact** : Pic memoire/CPU non borne sous charge avant l'effet du semaphore -> risque OOM / saturation event loop.  
- **Recommandation** : Borner aussi l'entree (concurrency au niveau requete) et/ou acquerir le slot avant les operations couteuses ; disque temporaire pour gros videos.

#### LOW-039 — submit : INSERT submission + UPDATE is_winner non transactionnels et cleanup S3 partiel

- **Categorie** : data-integrity  
- **Zone** : API â€” Submissions, gallery, leaderboard, photos  
- **Fichier** : `api/src/routes/submissions.ts` (lignes 215-232)  
- **Probleme** : En mode 'participation', INSERT submission puis UPDATE separe is_winner=TRUE. Si l'UPDATE echoue, la soumission existe sans is_winner, faussant le leaderboard. De plus, hors ER_DUP_ENTRY, un echec apres l'upload S3 laisse le fichier orphelin (deleteFromS3 n'est appele que dans la branche ER_DUP_ENTRY).  
- **Impact** : Etat incoherent (submission sans is_winner) et fichiers S3 orphelins en cas d'echec partiel.  
- **Recommandation** : Inserer is_winner directement selon scoring_mode dans l'INSERT. Encadrer en transaction et nettoyer S3 dans le catch general.

#### LOW-040 — DELETE submission (organisateur) : suppression DB meme si S3 echoue, sans transaction

- **Categorie** : data-integrity  
- **Zone** : API â€” Submissions, gallery, leaderboard, photos  
- **Fichier** : `api/src/routes/submissions.ts` (lignes 313-334)  
- **Probleme** : deleteFromS3 est best-effort (try/catch qui log et continue), puis DELETE FROM submissions. Si la suppression S3 echoue, la ligne DB est tout de meme supprimee, laissant un fichier orphelin sans trace en base.  
- **Impact** : Accumulation de fichiers orphelins sur S3 (cout), sans mecanisme de reconciliation.  
- **Recommandation** : Logguer les echecs S3 dans une table de nettoyage differe, ou supprimer la DB seulement apres succes S3.

#### LOW-041 — Cache de secrets event jamais invalide en cas de rotation/expiration (photos.ts)

- **Categorie** : security  
- **Zone** : API â€” Submissions, gallery, leaderboard, photos  
- **Fichier** : `api/src/routes/photos.ts` (lignes 10-32)  
- **Probleme** : getEventSecret met en cache photo_secret par eventId pendant 5min sans invalidation. Si un event fait tourner son photo_secret (revocation/compromission), les anciens tokens restent verifiables jusqu'a 5 min, et de nouveaux tokens ne sont pas servables si le cache contient l'ancien secret.  
- **Impact** : Fenetre de 5 min ou la revocation d'un secret event n'a pas d'effet. Affaiblit le modele de revocation par event.  
- **Recommandation** : Invalider l'entree de cache lors de toute mise a jour de events.photo_secret, ou reduire le TTL.

#### LOW-042 — Endpoint /photos/:token sans rate limiting -> amplification de cout S3

- **Categorie** : security  
- **Zone** : API â€” Submissions, gallery, leaderboard, photos  
- **Fichier** : `api/src/routes/photos.ts` (lignes 35-99)  
- **Probleme** : GET /photos/:token n'a aucun rateLimiter. Chaque requete declenche jwt.decode + potentiellement un GetObjectCommand S3. Avec un token valide capture, un attaquant peut reextraire en boucle des objets S3 (cout egress) jusqu'a expiration.  
- **Impact** : Amplification de cout egress S3 via replay d'un token valide non expire et charge non bornee.  
- **Recommandation** : Appliquer un rateLimiter par IP, reduire la duree de vie des tokens galerie, envisager un cache/CDN.

#### LOW-043 — signPhotoToken appele avec event.photo_secret potentiellement NULL -> photo definitivement inaccessible

- **Categorie** : bug  
- **Zone** : API â€” Submissions, gallery, leaderboard, photos  
- **Fichier** : `api/src/routes/submissions.ts` (lignes 211)  
- **Probleme** : A la soumission, signPhotoToken utilise event.photo_secret lu en BDD. Si photo_secret est NULL (event legacy/migration incomplete), deriveSigningKey signe avec une cle degeneree ; cote photos.ts getEventSecret retourne null et renvoie 403 -> l'image devient definitivement inaccessible alors que la soumission a reussi.  
- **Impact** : Soumissions dont l'URL photo est irrecuperablement cassee (403 permanent) pour les events sans photo_secret.  
- **Recommandation** : Valider la presence de event.photo_secret avant signPhotoToken (erreur de config explicite), ou garantir par migration que tout event a un photo_secret non NULL.

#### LOW-044 — leaderboard SUM(c.points) double-compte les points via jointures multiples / 'wins' ambigu

- **Categorie** : correctness  
- **Zone** : API â€” Submissions, gallery, leaderboard, photos  
- **Fichier** : `api/src/routes/leaderboard.ts` (lignes 17-32)  
- **Probleme** : En mode participation, total_points = COALESCE(SUM(c.points),0) avec LEFT JOIN submissions puis challenges. COUNT(s.id) sert a la fois de total_submissions ET de wins. Si la contrainte d'unicite de submission n'est pas (participant_id, challenge_id), points et wins sont sur-comptes.  
- **Impact** : Risque de points/wins sur-comptes ; en mode participation wins == total_submissions par construction (affichage trompeur).  
- **Recommandation** : Confirmer UNIQUE(participant_id, challenge_id) ; sinon COUNT(DISTINCT s.challenge_id). Clarifier la semantique de 'wins'.

#### LOW-045 — PATCH /admin/users/:id : promotion admin sans audit ni verification d'existence

- **Categorie** : correctness  
- **Zone** : API â€” Admin, bootstrap, middleware, validation  
- **Fichier** : `api/src/routes/admin.ts` (lignes 106-128)  
- **Probleme** : La route met a jour plan et is_admin sans verifier affectedRows (UPDATE sur id inexistant renvoie 200). is_admin modifiable par tout admin sans logAudit. Une requete sans plan ni is_admin renvoie aussi 200 sans rien faire.  
- **Impact** : Reponses 200 trompeuses sur ressource inexistante, elevation de privileges non auditee, tracabilite incoherente.  
- **Recommandation** : Verifier affectedRows -> 404 ; logAudit toute modif is_admin/plan ; rejeter requete sans champ (400).

#### LOW-046 — DELETE /admin/events/:id ne verifie pas l'existence (200 sur id inexistant)

- **Categorie** : correctness  
- **Zone** : API â€” Admin, bootstrap, middleware, validation  
- **Fichier** : `api/src/routes/admin.ts` (lignes 247-259)  
- **Probleme** : Contrairement a DELETE /participants/:id (404 si absent), DELETE /admin/events/:id execute directement les DELETE et renvoie toujours 200 meme si aucun event n'existe. Meme incoherence que PATCH /users/:id.  
- **Impact** : Reponse HTTP trompeuse (200 sur ressource inexistante), incoherence d'API entre handlers.  
- **Recommandation** : Verifier affectedRows sur le DELETE FROM events et renvoyer 404 sinon.

#### LOW-047 — Telechargement ZIP admin : headers envoyes avant streaming, erreurs S3 silencieuses -> ZIP vide en 200

- **Categorie** : bug  
- **Zone** : API â€” Admin, bootstrap, middleware, validation  
- **Fichier** : `api/src/routes/admin.ts` (lignes 407-443)  
- **Probleme** : Content-Type/Disposition et archive.pipe(res) sont poses avant les GetObjectCommand. Si chaque recuperation echoue (catch logge seulement), le ZIP est finalise vide et renvoye en 200. Le catch global ne peut renvoyer 500 (headersSent). Pas de archive.on('error').  
- **Impact** : L'admin telecharge un ZIP vide/partiel sans indication d'erreur en cas de panne S3.  
- **Recommandation** : Compter les succes ; si zero et headers non envoyes -> 502. Ecouter archive.on('error'). Logger un resume.

#### LOW-048 — CORS : origin vide par defaut, pas de trim â€” config silencieusement erronee (index.ts & socket.ts)

- **Categorie** : security  
- **Zone** : Transverse â€” API bootstrap CORS  
- **Fichier** : `api/src/index.ts` (lignes 47 (+ api/src/config/socket.ts:16))  
- **Probleme** : origin: process.env.CORS_ORIGINS?.split(',') || []. Aucun trim ni filtre des valeurs vides : une virgule finale ou des espaces produisent des entrees erronees. Meme bug duplique dans socket.ts l.16 (transports polling + credentials:true, handshake non authentifie).  
- **Impact** : Mauvaise configuration CORS silencieuse (blocage total ou entree vide imprevisible).  
- **Recommandation** : (process.env.CORS_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean), centralise dans un util partage importe par index.ts et socket.ts.

#### LOW-049 — audit-logs : LIMIT/OFFSET passes en parametres lies peuvent echouer selon mysql2

- **Categorie** : bug  
- **Zone** : API â€” Admin, bootstrap, middleware, validation  
- **Fichier** : `api/src/routes/admin.ts` (lignes 469-472)  
- **Probleme** : La requete ajoute 'LIMIT ? OFFSET ?' et push limit/offset en params puis pool.execute. mysql2 en prepared statement envoie LIMIT/OFFSET comme strings liees, ce qui peut provoquer une erreur ('Incorrect arguments to mysqld_stmt_execute'). Les valeurs sont deja bornees (parseInt + clamp).  
- **Impact** : La route audit-logs peut renvoyer 500 selon la version mysql2/MySQL.  
- **Recommandation** : Interpoler directement les entiers deja valides (LIMIT ${limit} OFFSET ${offset}), ou utiliser pool.query.

#### LOW-050 — express.urlencoded sans limite de taille explicite + extended:true (prototype pollution)

- **Categorie** : security  
- **Zone** : API â€” Admin, bootstrap, middleware, validation  
- **Fichier** : `api/src/index.ts` (lignes 52)  
- **Probleme** : express.json a limit 1mb mais express.urlencoded({extended:true}) n'a pas de limit (defaut 100kb). extended:true (qs) ouvre une surface de prototype pollution sur cles profondes.  
- **Impact** : Surface mineure de pollution de prototype / incoherence de limites.  
- **Recommandation** : Ajouter limit explicite et envisager extended:false (API JSON-only).

#### LOW-051 — Validators : schemas de date acceptent toute chaine (pas de validation de format)

- **Categorie** : data-integrity  
- **Zone** : API â€” Admin, bootstrap, middleware, validation  
- **Fichier** : `api/src/utils/validators.ts` (lignes 20-21, 35-37)  
- **Probleme** : createEventSchema.eventDate/deadline sont z.string().optional().nullable() sans controle de format. joinEventSchema.teamId est max(36) sans validation UUID. Des chaines arbitraires passent.  
- **Impact** : Insertion de dates malformees (deadline non parsable), dependance a la couche d'appel.  
- **Recommandation** : z.string().datetime() pour les dates, z.string().uuid() pour teamId/deviceId si UUID.

#### LOW-052 — Cle/secret S3 dechiffres conserves en cache memoire indefiniment et error.message brut expose

- **Categorie** : security  
- **Zone** : API â€” Services externes (S3, email, antivirus)  
- **Fichier** : `api/src/utils/s3Service.ts` (lignes 14, 41-42, 162-169)  
- **Probleme** : secretAccessKey est dechiffre puis stocke en clair dans cachedConfig (module-level) sans TTL. testS3Connection retourne error.message brut en fallback au client. Cache invalide uniquement via invalidateS3Cache.  
- **Impact** : Fuite potentielle de details d'infra dans le message du bouton Tester ; credentials dechiffres residents en memoire.  
- **Recommandation** : Ne pas renvoyer error.message brut (message generique). Garantir invalidateS3Cache a chaque update ou TTL.

#### LOW-053 — getS3Config retourne null silencieusement si decrypt echoue ou settings incomplets

- **Categorie** : bug  
- **Zone** : API â€” Services externes (S3, email, antivirus)  
- **Fichier** : `api/src/utils/s3Service.ts` (lignes 29, 41-42, 46-49)  
- **Probleme** : Si decrypt() leve (cle changee/valeur corrompue), le catch avale l'exception et retourne null, faisant croire 'S3 non configure'. settings.length < 5 verifie le count mais pas la presence de chaque cle.  
- **Impact** : Diagnostic difficile : une erreur de dechiffrement est masquee en 'non configure'.  
- **Recommandation** : Distinguer 'non configure' de 'erreur dechiffrement' (log specifique) ; verifier chaque cle individuellement.

#### LOW-054 — token de verification/reset injecte dans l'URL sans encodeURIComponent (emailService + panel verify)

- **Categorie** : bug  
- **Zone** : Transverse â€” emailService & panel verify  
- **Fichier** : `api/src/utils/emailService.ts` (lignes 42, 69 (+ panel/src/app/auth/verify/page.tsx:23))  
- **Probleme** : verifyUrl et resetUrl construisent l'URL via ?token=${token} sans encodeURIComponent. Cote panel, api.get(`/auth/verify-email?token=${token}`) place aussi le token non encode en query string (fuite via Referer/historique/logs). Si le token contient +,/,= l'URL est mal formee.  
- **Impact** : Liens de verification/reset casses pour certains tokens ; fuite possible du token via Referer/logs.  
- **Recommandation** : encodeURIComponent(token) partout, ou garantir des tokens url-safe ; idealement passer le token en POST dans le body cote panel.

#### LOW-055 — scanBuffer ecrit le buffer non scanne sur disque (nom previsible, unlink fire-and-forget)

- **Categorie** : security  
- **Zone** : API â€” Services externes (S3, email, antivirus)  
- **Fichier** : `api/src/utils/antivirusService.ts` (lignes 46-50, 71-73)  
- **Probleme** : Le buffer est ecrit dans os.tmpdir() avec un nom base sur Date.now()+safeFilename. L'unlink est en finally mais fire-and-forget. Crash entre ecriture et unlink => fichier potentiellement infecte residuel ; nom partiellement previsible.  
- **Impact** : Fichiers temporaires potentiellement infectes laisses sur le FS ; predictibilite partielle du nom.  
- **Recommandation** : Nom imprevisible (crypto.randomUUID), sous-repertoire mode 0600, nettoyage des orphelins, ou scan via INSTREAM.

#### LOW-056 — Cache clamBin permanent : ClamAV detecte indisponible reste desactive jusqu'au redemarrage

- **Categorie** : bug  
- **Zone** : API â€” Services externes (S3, email, antivirus)  
- **Fichier** : `api/src/utils/antivirusService.ts` (lignes 19-33)  
- **Probleme** : detectClamBin met clamBin=null definitivement si le binaire n'est pas trouve au 1er appel. Si ClamAV demarre apres l'API, jamais re-detecte sans redemarrage.  
- **Impact** : Scan durablement desactive si l'API demarre avant ClamAV (fail-open silencieux).  
- **Recommandation** : TTL/re-check periodique sur la detection negative, ou healthcheck au demarrage avec retry.

#### LOW-057 — Aucune gestion d'erreur autour de transporter.sendMail (rejet non gere chez l'appelant)

- **Categorie** : maintainability  
- **Zone** : API â€” Services externes (S3, email, antivirus)  
- **Fichier** : `api/src/utils/emailService.ts` (lignes 60-65, 87-92, 146-151, 197-202)  
- **Probleme** : sendMail peut rejeter (SMTP down, quota). Les fonctions propagent le rejet sans try/catch. Risque d'echec d'inscription bloquante ou d'unhandled rejection selon l'appelant.  
- **Impact** : Inscription/reset echouant sur probleme email transitoire, ou unhandled rejection.  
- **Recommandation** : Documenter le contrat et garantir cote appelant try/catch + degradation gracieuse/queue.

#### LOW-058 — SMTP secure=false fige et credentials par defaut vides acceptes silencieusement

- **Categorie** : security  
- **Zone** : API â€” Services externes (S3, email, antivirus)  
- **Fichier** : `api/src/utils/emailService.ts` (lignes 3-11)  
- **Probleme** : secure est code en dur a false. Si SMTP_PORT=465, le transport resterait en mauvais mode TLS. user/pass defaultent a '', creant un transport a auth vide au lieu d'echouer.  
- **Impact** : Mauvaise config TLS si port 465 ; echecs d'envoi confus si credentials absents.  
- **Recommandation** : Deriver secure de (port===465) ou variable dediee ; fail-fast si SMTP_USER/SMTP_PASS absents.

#### LOW-059 — Votes deja emis non recharges au montage : l'UI propose de revoter

- **Categorie** : bug  
- **Zone** : Frontend â€” App participant (PWA)  
- **Fichier** : `app/src/app/event/[id]/page.tsx` (lignes 105, 735-781)  
- **Probleme** : votedChallenges n'est alimente que par castVote durant la session. Apres reload, l'etat est vide donc myVote undefined et les boutons 'Voter' reapparaissent. loadVotes ne lit que les compteurs, pas my_vote.  
- **Impact** : UX confuse et tentatives de double vote ; le marqueur 'Votre vote' disparait apres reload.  
- **Recommandation** : Au chargement, recuperer le vote du participant courant et initialiser votedChallenges.

#### LOW-060 — loadVotes effectue N requetes HTTP (N+1) sur le rendu et a chaque vote-cast

- **Categorie** : performance  
- **Zone** : Frontend â€” App participant (PWA)  
- **Fichier** : `app/src/app/event/[id]/page.tsx` (lignes 166-181, 226)  
- **Probleme** : loadVotes boucle sur tous les challenges vote_enabled et fait un api.get('/challenges/{id}/votes') par defi. Declenche au changement de challenges et a chaque event socket vote-cast.  
- **Impact** : Rafales de requetes en temps reel (chaque vote declenche N GET chez tous les clients).  
- **Recommandation** : Endpoint agrege + debounce sur vote-cast.

#### LOW-061 — getUserMedia exige audio:true meme en mode photo -> refus micro bloque la prise de photo

- **Categorie** : bug  
- **Zone** : Frontend â€” App participant (PWA)  
- **Fichier** : `app/src/components/CameraModal.tsx` (lignes 87-90, 99-101)  
- **Probleme** : startCamera demande toujours audio:true, y compris en mode photo. Si le micro est refuse, getUserMedia leve NotAllowedError et tout l'acces camera echoue.  
- **Impact** : Des participants ne peuvent pas prendre de photo car ils ont refuse le micro.  
- **Recommandation** : Demander audio uniquement en mode video ; renegocier le stream au passage en video.

#### LOW-062 — Aucune validation de taille/type fichier cote client avant upload (app)

- **Categorie** : security  
- **Zone** : Frontend â€” App participant (PWA)  
- **Fichier** : `app/src/app/event/[id]/page.tsx` (lignes 301-309, 363-372)  
- **Probleme** : openFilePicker n'accepte que image/* mais handleUpload accepte aussi les videos sans borne de taille. compressImage ne compresse que les images >500Ko et peut resoudre le fichier original si toBlob echoue. (cf MED-025 pour le panel.)  
- **Impact** : Upload de payloads volumineux (timeouts, conso data, charge serveur).  
- **Recommandation** : Valider taille max et type MIME cote client, garder l'antivirus/limites serveur comme verite.

#### LOW-063 — Token/identite participant en localStorage (expose au XSS, pas de CSP)

- **Categorie** : security  
- **Zone** : Frontend â€” App participant (PWA)  
- **Fichier** : `app/src/lib/participant.ts` (lignes 11-24)  
- **Probleme** : L'id servant de credential est en localStorage (accessible a tout JS). layout.tsx charge Google Fonts en <head> sans CSP visible. Une XSS exfiltre l'identite (aggrave par l'absence de secret signe, cf CRIT-001).  
- **Impact** : En cas de XSS, vol de l'identite participant et usurpation.  
- **Recommandation** : Si un vrai token est introduit, preferer un cookie httpOnly/SameSite ; sinon CSP stricte.

#### LOW-064 — Zoom desactive (userScalable:false, maximumScale:1) â€” accessibilite (app & admin)

- **Categorie** : ux  
- **Zone** : Transverse â€” viewport app & admin  
- **Fichier** : `app/src/app/layout.tsx` (lignes 9-15 (+ admin/src/app/layout.tsx:9-14))  
- **Probleme** : Le viewport interdit le zoom (userScalable:false, maximumScale:1), violant WCAG 1.4.4. Meme defaut dans le back-office admin (desktop).  
- **Impact** : Inaccessibilite pour utilisateurs malvoyants ; non-conformite.  
- **Recommandation** : Retirer userScalable:false/maximumScale:1 ou autoriser jusqu'a 5x.

#### LOW-065 — Le bouton 'Reprendre' supprime la photo avant de re-uploader : perte de donnees si abandon

- **Categorie** : data-integrity  
- **Zone** : Frontend â€” App participant (PWA)  
- **Fichier** : `app/src/app/event/[id]/page.tsx` (lignes 671-676)  
- **Probleme** : Le bouton 'Reprendre' appelle deleteSubmission(mySub.id) PUIS ouvre le formulaire. La suppression est immediate et irreversible cote serveur ; si l'utilisateur abandonne avant de reprendre la photo, sa soumission est definitivement perdue.  
- **Impact** : Perte de la soumission existante en cas d'abandon du remplacement, sans filet de securite.  
- **Recommandation** : Ne supprimer l'ancienne soumission qu'apres l'upload reussi de la nouvelle (remplacement atomique), ou brouillon restaurable.

#### LOW-066 — Reconnexion socket frequente (deps loadData/loadVotes) detruit/recree la connexion

- **Categorie** : performance  
- **Zone** : Frontend â€” App participant (PWA)  
- **Fichier** : `app/src/app/event/[id]/page.tsx` (lignes 209-241)  
- **Probleme** : Le useEffect socket depend de [eventId, loadData, loadVotes]. loadVotes depend de [challenges] qui change a chaque loadData (setChallenges). Donc a chaque rafraichissement de challenges, le useEffect socket se re-execute -> disconnect() puis nouvelle io() et nouveau join-event. Voir aussi le timer du compte a rebours dependant de [event] (l.183-207).  
- **Impact** : Deconnexions/reconnexions WebSocket repetees, doublons d'events online-count, charge serveur, conso batterie.  
- **Recommandation** : Retirer loadVotes/loadData des deps (utiliser des refs) pour maintenir une connexion stable ; dependre de [event?.deadline] pour le timer.

#### LOW-067 — results : double fetch / reconnexion WebSocket au montage (loadResults depend de participantId)

- **Categorie** : performance  
- **Zone** : Frontend â€” App participant (PWA)  
- **Fichier** : `app/src/app/event/[id]/results/page.tsx` (lignes 48-85)  
- **Probleme** : loadResults memoize sur [eventId, participantId] ; participantId passe de '' a la vraie valeur, recreant loadResults, dont depend le useEffect socket -> connexion detruite/recreee a chaque changement de participantId.  
- **Impact** : Reconnexion WebSocket inutile et re-souscription des handlers au montage ; join-event redondant.  
- **Recommandation** : Stabiliser l'identite (ref) ou separer la logique socket de loadResults.

#### LOW-068 — Cle React basee sur l'index dans les listes de gagnants/alertes/referrals/stat cards

- **Categorie** : maintainability  
- **Zone** : Transverse â€” Cles React par index  
- **Fichier** : `app/src/app/event/[id]/results/page.tsx` (lignes 199-201 (+ app page.tsx:497-498, panel affiliates:251-254, admin page.tsx:53-54))  
- **Probleme** : Plusieurs listes utilisent key={i} (index) alors qu'elles se reconstruisent lors des reveals/rechargements en direct ou changements d'ordre (referral converti remontant).  
- **Impact** : Reconciliations incorrectes possibles (animations de reveal sur le mauvais item, etat residuel).  
- **Recommandation** : Utiliser une cle stable (id/title/label). Pour les referrals sans id, combiner created_at + nom.

#### LOW-069 — Gate emailVerified/plan du layout panel base sur un cookie 'user' modifiable cote client

- **Categorie** : security  
- **Zone** : Frontend â€” Panel organisateur (dashboard)  
- **Fichier** : `panel/src/app/dashboard/layout.tsx` (lignes 44-48)  
- **Probleme** : Le blocage des comptes non verifies repose sur user.emailVerified issu du cookie 'user' non-httpOnly. Un utilisateur peut editer ce cookie (emailVerified:true) pour contourner la redirection client. Idem pour user.plan/eventCredits utilises pour activer/desactiver des actions.  
- **Impact** : Contournement cosmetique de la garde de verification et affichage falsifie du plan/credits. Exploitation reelle depend de l'enforcement serveur.  
- **Recommandation** : Ne pas deriver de decisions d'un cookie client en clair. Recuperer emailVerified/plan via /auth/me et s'appuyer sur l'enforcement serveur.

#### LOW-070 — Cookies poses par l'interceptor de refresh sans sameSite ni secure (panel & admin)

- **Categorie** : security  
- **Zone** : Transverse â€” Panel & Admin libs api  
- **Fichier** : `panel/src/lib/api.ts` (lignes 41-42 (+ admin/src/lib/api.ts))  
- **Probleme** : Apres un refresh reussi, Cookies.set('accessToken'/'refreshToken') est appele avec uniquement {expires} sans reutiliser COOKIE_OPTS (sameSite:'strict'), et sans secure. Les attributs divergent entre login et refresh.  
- **Impact** : Cookies de session sans SameSite apres le premier refresh (CSRF accru) et sans Secure (envoi en clair possible).  
- **Recommandation** : Centraliser les options de cookie (sameSite:'strict', secure:true) et les reutiliser au login ET au refresh. Mieux : deleguer au backend en httpOnly.

#### LOW-071 — Flag Secure absent sur tous les cookies du panel (transmissibles en clair / sur HTTP)

- **Categorie** : security  
- **Zone** : Frontend â€” Panel (auth flows & libs)  
- **Fichier** : `panel/src/lib/auth.tsx` (lignes 35, 57-58, 70, 81-83, 99)  
- **Probleme** : COOKIE_OPTS = { sameSite: 'strict' } ne contient pas secure:true. Les cookies accessToken/refreshToken/user peuvent etre poses et envoyes sur HTTP non chiffre. (Recoupe HIGH-015 sur le volet httpOnly ; ici le sous-point Secure.)  
- **Impact** : Interception des tokens en clair sur un canal non-TLS (MITM, AP hostile).  
- **Recommandation** : Ajouter secure: true dans COOKIE_OPTS et l'interceptor de refresh. Idealement deleguer au backend en httpOnly.

#### LOW-072 — logout panel n'attend pas la revocation backend (refreshToken potentiellement jamais revoque)

- **Categorie** : security  
- **Zone** : Frontend â€” Panel (auth flows & libs)  
- **Fichier** : `panel/src/lib/auth.tsx` (lignes 106-116)  
- **Probleme** : logout() lance api.post('/auth/logout', { refreshToken }).catch(()=>{}) sans await, puis supprime les cookies et fait window.location.href. La navigation full-page peut interrompre la requete XHR avant qu'elle aboutisse, laissant le refreshToken valide cote serveur 30j.  
- **Impact** : Le refreshToken peut rester actif cote serveur apres logout ; combine au stockage non-httpOnly, un token exfiltre reste utilisable.  
- **Recommandation** : await l'appel de logout (timeout) avant de purger/naviguer, ou navigator.sendBeacon/keepalive ; remonter les echecs.

#### LOW-073 — useEffect de verify : double-execution StrictMode consomme le token a usage unique (faux negatif)

- **Categorie** : bug  
- **Zone** : Frontend â€” Panel (auth flows & libs)  
- **Fichier** : `panel/src/app/auth/verify/page.tsx` (lignes 16-32)  
- **Probleme** : Le useEffect appelle api.get('/auth/verify-email') avec deps [token]. En dev StrictMode l'effet s'execute deux fois ; le token etant a usage unique, le 2e appel echoue et affiche 'Token invalide ou expire' apres une 1ere verification reussie.  
- **Impact** : Affichage trompeur d'echec de verification ; non deterministe selon double-montage.  
- **Recommandation** : Guarder l'appel avec un useRef 'hasRun', ou rendre l'endpoint idempotent cote backend (succes si deja verifie).

#### LOW-074 — verify-pending : polling sans arret apres redirection / si /auth/me echoue silencieusement

- **Categorie** : bug  
- **Zone** : Frontend â€” Panel (auth flows & libs)  
- **Fichier** : `panel/src/app/auth/verify-pending/page.tsx` (lignes 17-29)  
- **Probleme** : L'intervalle de 5s appelle refreshUser sans condition d'arret sur emailVerified. refreshUser a un catch vide : si /auth/me echoue, emailVerified reste false indefiniment et l'utilisateur n'est jamais redirige.  
- **Impact** : Boucle de polling indefinie si /auth/me echoue ; pas de feedback d'erreur ; charge reseau toutes les 5s.  
- **Recommandation** : Arreter l'intervalle des que emailVerified devient true ; surfacer les erreurs ; backoff.

#### LOW-075 — Page racine panel : decision d'auth basee sur la simple presence du cookie accessToken

- **Categorie** : security  
- **Zone** : Frontend â€” Panel (auth flows & libs)  
- **Fichier** : `panel/src/app/page.tsx` (lignes 10-17)  
- **Probleme** : La redirection vers /dashboard se fait uniquement si un cookie accessToken existe, sans verifier sa validite/expiration. Un token expire/falsifie envoie l'utilisateur sur /dashboard qui devra gerer le 401.  
- **Impact** : Redirections incoherentes (dashboard avec token mort) ; reliance sur du client-side guard.  
- **Recommandation** : Valider l'expiration du JWT (ou cote serveur) avant de rediriger ; guard reel sur chaque page protegee.

#### LOW-076 — Fuite de messages d'erreur backend bruts affiches a l'utilisateur (panel & app)

- **Categorie** : security  
- **Zone** : Transverse â€” Affichage erreurs frontend  
- **Fichier** : `panel/src/app/auth/login/page.tsx` (lignes 24-25 (+ register, forgot, reset, verify, app page.tsx:355-357/381/405))  
- **Probleme** : err.response?.data?.error est affiche tel quel (alert/UI) sur login, register, forgot-password, reset-password, verify, et cote app sur vote/suppression/upload. Si le backend renvoie des messages granulaires, enumeration de comptes possible et fuite de details internes.  
- **Impact** : Enumeration d'utilisateurs selon la granularite des messages ; fuite de details d'implementation ; UX degradee (alert natives).  
- **Recommandation** : Garantir des messages d'auth generiques cote backend ; cote front mapper vers des messages controles et eviter alert() au profit de toasts.

#### LOW-077 — Telechargement blob (PDF/ZIP) : revokeObjectURL immediat + anchor detache du DOM (panel & admin)

- **Categorie** : performance  
- **Zone** : Transverse â€” Telechargement blob  
- **Fichier** : `panel/src/app/dashboard/events/[id]/page.tsx` (lignes 902-940 (+ admin events/[id]:78-99))  
- **Probleme** : Les handlers export PDF/ZIP font URL.createObjectURL, creent un <a> non insere au DOM, a.click() puis revokeObjectURL immediatement. Revoquer juste apres click() peut faire echouer le telechargement sur certains navigateurs ; en cas d'exception, l'objectURL n'est pas revoque (pas de finally dedie).  
- **Impact** : Telechargements potentiellement non declenches ; pic memoire sur gros ZIP ; fuite memoire mineure d'objectURL.  
- **Recommandation** : Inserer l'anchor au DOM, click(), puis revoquer dans un setTimeout/finally dedie. Pour gros exports, URL signee S3 directe.

#### LOW-078 — Stats dashboard panel incoherentes avec les badges (status vs deadline)

- **Categorie** : correctness  
- **Zone** : Frontend â€” Panel organisateur (dashboard)  
- **Fichier** : `panel/src/app/dashboard/page.tsx` (lignes 29-30, 191-193)  
- **Probleme** : activeEvents/endedEvents filtrent sur e.status uniquement, alors que le badge considere un event 'Expire' si deadline depassee meme si status==='active'. Un event 'active' a deadline passee est compte 'Actif' dans la stat mais affiche 'Expire'.  
- **Impact** : Chiffres du tableau de bord trompeurs vs liste affichee.  
- **Recommandation** : Deriver actif/termine d'une fonction utilitaire unique (status ET deadline) reutilisee pour stats et badges.

#### LOW-079 — Saisie des points d'un defi non bornee malgre min/max (parseInt sans clamp)

- **Categorie** : correctness  
- **Zone** : Frontend â€” Panel organisateur (dashboard)  
- **Fichier** : `panel/src/app/dashboard/events/[id]/page.tsx` (lignes 727)  
- **Probleme** : L'input number des points utilise setNewPoints(parseInt(e.target.value)||10) avec min/max non appliques a la saisie clavier/collage. La valeur est postee telle quelle.  
- **Impact** : Valeur de points incoherente envoyee a l'API si la validation serveur est laxiste. Impact faible.  
- **Recommandation** : Clamp cote client (Math.min(1000,Math.max(1,n))) et confirmer la validation serveur.

#### LOW-080 — Refresh admin sans verification de presence du refreshToken (aller-retour reseau superflu)

- **Categorie** : bug  
- **Zone** : Frontend â€” Back-office admin  
- **Fichier** : `admin/src/lib/api.ts` (lignes 24-28)  
- **Probleme** : const refreshToken = Cookies.get('adminRefreshToken') est passe directement a axios.post('/auth/refresh', { refreshToken }) sans verifier qu'il existe. Si absent/desync, on envoie { refreshToken: undefined }, le serveur repond 4xx, on tombe dans le catch (purge+redirect) â€” acceptable mais aller-retour inutile.  
- **Impact** : Aller-retour reseau superflu et log d'erreur backend bruite. Pas de crash dur.  
- **Recommandation** : Tester if (!refreshToken) { purge + redirect } avant de tenter le POST.

#### LOW-081 — Interceptor admin ne purge/redirige pas sur 401 sans code TOKEN_EXPIRED

- **Categorie** : bug  
- **Zone** : Frontend â€” Back-office admin  
- **Fichier** : `admin/src/lib/api.ts` (lignes 21)  
- **Probleme** : Le bloc de refresh n'est atteint que si status 401 && code === 'TOKEN_EXPIRED'. Un 401 pour token revoque (autre code) saute le bloc et l'erreur est rejetee : ni refresh, ni purge, ni redirection. (Variante admin de MED-022.)  
- **Impact** : Si le token est revoque sans TOKEN_EXPIRED, l'UI reste affichee avec des appels qui echouent silencieusement, sans redirection.  
- **Recommandation** : Sur tout 401 non recuperable, purger les cookies admin et rediriger vers /auth/login.

#### LOW-082 — Page racine/layout admin : UI protegee rendue avant verification d'auth (flash de contenu)

- **Categorie** : security  
- **Zone** : Frontend â€” Back-office admin  
- **Fichier** : `admin/src/app/dashboard/layout.tsx` (lignes 21-24, 35-110)  
- **Probleme** : Le layout retourne immediatement tout le JSX du dashboard ; la verification d'auth est dans un useEffect post-rendu, sans etat de garde. Les pages enfants se montent et lancent leurs appels API avant/pendant la redirection. (Sous-point de HIGH-018, conserve pour le volet flash/appels precoces.)  
- **Impact** : Flash bref du contenu admin et declenchement d'appels /admin/* pour un visiteur non authentifie.  
- **Recommandation** : Bloquer le rendu des enfants tant que la presence (et idealement isAdmin via /auth/me) n'est pas confirmee : loader.

#### LOW-083 — Cle secrete S3 declaree dans le type S3Config cote front (jamais consommee)

- **Categorie** : security  
- **Zone** : Frontend â€” Back-office admin  
- **Fichier** : `admin/src/app/dashboard/settings/page.tsx` (lignes 6-13, 33-41)  
- **Probleme** : L'interface S3Config declare accessKey/secretKey mais loadConfig ne les lit jamais (force setAccessKey('')/setSecretKey('')). Aucune fuite materialisee cote front ; le risque reel dependrait du backend.  
- **Impact** : Risque purement potentiel/cote backend ; type trop large.  
- **Recommandation** : Retirer accessKey/secretKey du type S3Config cote front et verifier cote backend que GET /admin/settings/s3 ne renvoie jamais les secrets (au plus un booleen configured).

#### LOW-084 — Refresh admin sans single-flight (variante de MED-021)

- **Categorie** : bug  
- **Zone** : Frontend â€” Back-office admin  
- **Fichier** : `admin/src/lib/api.ts` (lignes 19-41)  
- **Probleme** : L'interceptor admin ne mutualise pas le refresh : chaque 401 TOKEN_EXPIRED declenche son propre axios.post('/auth/refresh'). Avec rotation a detection de reuse, refresh concurrents -> revocation de famille et deconnexion. (Meme cause que MED-021, instance admin.)  
- **Impact** : Deconnexions intempestives lors de chargements multi-requetes apres expiration ; fausses alertes de reuse.  
- **Recommandation** : Verrou single-flight partage ; idealement factoriser la lib api entre panel et admin.

#### LOW-085 — Images S3 admin rendues sans referrerPolicy ni validation de domaine

- **Categorie** : security  
- **Zone** : Frontend â€” Back-office admin  
- **Fichier** : `admin/src/app/dashboard/events/[id]/page.tsx` (lignes 138-148, 321-333)  
- **Probleme** : sub.photo_url provient de l'API et est injecte dans <img src>. React echappe donc pas de XSS, mais aucune validation que l'URL pointe vers le domaine S3 attendu, ni referrerPolicy=no-referrer.  
- **Impact** : Faible : pas de XSS. Risque residuel de fuite Referer / chargement externe si l'API laissait passer des URL arbitraires.  
- **Recommandation** : Garantir cote backend que photo_url est une URL signee du bucket attendu ; ajouter referrerPolicy="no-referrer".

#### LOW-086 — Generation des referral_code via UUID -> collisions sur colonne UNIQUE et commentaire faux (migration)

- **Categorie** : data-integrity  
- **Zone** : Infra â€” Migrations SQL, deploy, config, deps  
- **Fichier** : `MIGRATION_FEATURES.sql` (lignes 45-48)  
- **Probleme** : Le commentaire dit 'MD5 pour reproductibilite' mais la requete utilise UPPER(SUBSTRING(REPLACE(UUID(),'-',''),1,8)) â€” ni MD5 ni reproductible. La colonne referral_code VARCHAR(8) UNIQUE impose l'unicite ; 8 hex = ~4.3e9 valeurs, paradoxe des anniversaires -> collision possible faisant echouer tout l'UPDATE.  
- **Impact** : La migration peut planter (duplicate entry) et s'arreter a mi-chemin : certains users ont un code, d'autres NULL. Commentaire trompeur.  
- **Recommandation** : Corriger le commentaire ; generer avec retry sur collision ou plus d'entropie, idealement cote application.

#### LOW-087 — ADD INDEX/COLUMN IF NOT EXISTS non portables (MySQL vs MariaDB)

- **Categorie** : data-integrity  
- **Zone** : Infra â€” Migrations SQL, deploy, config, deps  
- **Fichier** : `MIGRATION_SECURITY.sql` (lignes 8-14)  
- **Probleme** : ADD COLUMN IF NOT EXISTS et ADD INDEX IF NOT EXISTS sont des extensions MariaDB ; MySQL 8 ne supporte pas ADD INDEX IF NOT EXISTS. OK en prod MariaDB mais echec sur MySQL (CI/dev local).  
- **Impact** : Echec de migration si executee sur MySQL -> divergence d'environnements.  
- **Recommandation** : Documenter la dependance MariaDB, ou rendre compatible via procedure information_schema.

#### LOW-088 — deploy.sh build app et admin mais leur next start ne fixe aucun port (build inutile, downtime restart all)

- **Categorie** : devops  
- **Zone** : Infra â€” Migrations SQL, deploy, config, deps  
- **Fichier** : `deploy.sh` (lignes 9-14)  
- **Probleme** : deploy.sh build app et admin puis pm2 restart all. app/admin n'ont pas de bloc PM2 ni de port fixe, donc le build est inutile dans ce pipeline (artefacts jamais servis).  
- **Impact** : Temps de deploiement allonge sans benefice ; faux sentiment que app/admin sont deployes.  
- **Recommandation** : Retirer ces builds tant que les apps ne sont pas dans PM2, ou (preferable) ajouter les blocs PM2 avec ports.

#### LOW-089 — Incoherence du chemin de deploiement (~/rallye-photo vs cwd PM2 /home/debian/rallye-photo)

- **Categorie** : devops  
- **Zone** : Infra â€” Migrations SQL, deploy, config, deps  
- **Fichier** : `ecosystem.config.js` (lignes 5)  
- **Probleme** : deploy.sh fait cd ~/rallye-photo tandis que ecosystem.config.js code en dur cwd /home/debian/rallye-photo/... Alignement valide seulement si l'utilisateur est debian.  
- **Impact** : Couplage fragile a l'utilisateur systeme ; un deploiement sous un autre compte builderait un repertoire et PM2 servirait un autre.  
- **Recommandation** : Utiliser un chemin coherent (variable d'env) ou documenter que le deploiement DOIT s'executer sous debian.

#### LOW-090 — Frontends sur Next 16 / React 19.2.4 et versions futures non verifiees

- **Categorie** : dependency  
- **Zone** : Infra â€” Migrations SQL, deploy, config, deps  
- **Fichier** : `app/package.json` (lignes 12-27)  
- **Probleme** : Les trois frontends epinglent next 16.2.4, react/react-dom 19.2.4, axios ^1.15.2. Versions a verifier contre le registre. panel et admin partagent les memes.  
- **Impact** : Risque d'install impossible si versions inexistantes, ou breaking changes ; incoherence si divergence entre apps.  
- **Recommandation** : Verifier l'existence reelle des versions, aligner Next/React entre app/panel/admin, epingler et tester un build propre.

#### LOW-091 — Marqueur de heredoc EOF accidentellement ecrit dans .gitignore

- **Categorie** : devops  
- **Zone** : Infra â€” Migrations SQL, deploy, config, deps  
- **Fichier** : `.gitignore` (lignes 8)  
- **Probleme** : La ligne 8 contient EOF (delimiteur de heredoc capture). Devient un pattern d'ignore parasite.  
- **Impact** : Pattern parasite (ignorerait un fichier nomme EOF) ; symptome d'un bootstrap fragile.  
- **Recommandation** : Supprimer la ligne EOF. Verifier les autres fichiers de config pour le meme defaut.

#### LOW-092 — MIGRATION_FEATURES referral_code AFTER event_credits : dependance d'ordre inter-fichiers non documentee

- **Categorie** : data-integrity  
- **Zone** : Infra â€” Migrations SQL, deploy, config, deps  
- **Fichier** : `MIGRATION_FEATURES.sql` (lignes 23)  
- **Probleme** : MIGRATION_FEATURES fait ADD COLUMN referral_code AFTER event_credits, or event_credits n'est cree que par MIGRATION_PLANS. Si FEATURES est executee avant PLANS, l'ALTER echoue ('Unknown column event_credits in AFTER'). Aucun ordre documente.  
- **Impact** : Echec de migration selon l'ordre ; dependance inter-fichiers non explicitee.  
- **Recommandation** : Documenter l'ordre obligatoire (PLANS -> FEATURES -> SECURITY) en tete de chaque fichier, ou retirer la clause AFTER.

#### LOW-093 — referrals sans FOREIGN KEY vers users : donnees d'affiliation orphelines possibles

- **Categorie** : data-integrity  
- **Zone** : Infra â€” Migrations SQL, deploy, config, deps  
- **Fichier** : `MIGRATION_FEATURES.sql` (lignes 24-39)  
- **Probleme** : Les colonnes referred_by et la table referrals (referrer_id/referred_id) n'ont aucune FK vers users(id). Rien n'empeche un referred_by orphelin ou un referral pointant vers un user supprime ; pas de cascade.  
- **Impact** : Donnees d'affiliation orphelines/incoherentes (recompenses sur users inexistants).  
- **Recommandation** : Ajouter des FOREIGN KEY (ON DELETE SET NULL/CASCADE) sur referred_by, referrer_id, referred_id, ou documenter le choix d'integrite applicative.

### ⚪ Info (38)

#### INFO-001 — Comparaison non constante (egalite SQL) des tokens reset/verify => oracle de timing theorique

- **Categorie** : security  
- **Zone** : API â€” Auth & crypto (sensible)  
- **Fichier** : `api/src/routes/auth.ts` (lignes 105-107, 229-231)  
- **Probleme** : reset_token et email_verify_token sont compares via egalite SQL directe. La comparaison d'index/string en base n'est pas a temps constant. Impact reel faible (token 32 bytes = 256 bits non brute-forcable) ; le hashage prealable (HIGH-002) clot le sujet.  
- **Impact** : Surface theorique de side-channel ; faible car entropie 256 bits.  
- **Recommandation** : Hasher les tokens avant stockage (cf HIGH-002) rend la comparaison sur un digest et clot le sujet.

#### INFO-002 — reset-password : verification independante â€” flux globalement correct (note de verification)

- **Categorie** : correctness  
- **Zone** : API â€” Auth & crypto (sensible)  
- **Fichier** : `api/src/routes/auth.ts` (lignes 229-247)  
- **Probleme** : reset-password compare correctement reset_token + reset_token_expires, hash le nouveau mot de passe, efface le token et supprime les refresh_tokens. Seul point residuel deja couvert : l'access token JWT reste valide 15 min (LOW-002). Aucun defaut additionnel exploitable.  
- **Impact** : Aucun nouveau (confirmation d'absence de faille additionnelle dans ce chemin).  
- **Recommandation** : RAS au-dela des findings existants.

#### INFO-003 — Type 'any' generalise sur les payloads Stripe et resultats SQL (webhooks/payments)

- **Categorie** : maintainability  
- **Zone** : API â€” Paiements, webhooks, plans, affiliation (sensible)  
- **Fichier** : `api/src/routes/webhooks.ts` (lignes 23, 59, 110, 163)  
- **Probleme** : event, session, subscription et les resultats de pool.execute sont types any / castes as any[]. Aucune validation de structure ni de presence des champs Stripe (masque MED-004).  
- **Impact** : Perte de securite de typage, bugs runtime non detectes a la compilation.  
- **Recommandation** : Typer avec Stripe.Checkout.Session/Stripe.Subscription, valider defensivement.

#### INFO-004 — Instanciation du client Stripe via require() a chaque requete, sans apiVersion epinglee

- **Categorie** : performance  
- **Zone** : API â€” Paiements, webhooks, plans, affiliation (sensible)  
- **Fichier** : `api/src/routes/payments.ts` (lignes 21)  
- **Probleme** : const stripe = require('stripe')(stripeKey) est execute a chaque requete (idem webhooks.ts l.25). Le client est recree a chaque appel et aucune apiVersion n'est epinglee (lie a MED-004).  
- **Impact** : Surcout mineur par requete et schema d'objets Stripe non fige.  
- **Recommandation** : Instancier new Stripe(key, { apiVersion: '...' }) une fois au niveau module.

#### INFO-005 — invoice.payment_failed / invoice.paid non traites : pro_expires_at non mis a jour au renouvellement

- **Categorie** : correctness  
- **Zone** : API â€” Paiements, webhooks, plans, affiliation (sensible)  
- **Fichier** : `api/src/routes/webhooks.ts` (lignes 39-51)  
- **Probleme** : Le switch ne gere que checkout.session.completed, customer.subscription.deleted/updated. Au renouvellement mensuel reussi (invoice.paid), subscription.updated 'active' remet pro_expires_at=NULL sans poser la nouvelle echeance ; la logique de grace period repose sur pro_expires_at jamais positionne.  
- **Impact** : pro_expires_at reste NULL pendant un abonnement actif ; toute logique time-boxed serait incorrecte.  
- **Recommandation** : Clarifier la semantique de pro_expires_at ; maintenir l'echeance via invoice.paid/subscription.updated si attendu.

#### INFO-006 — Construction dynamique de SQL via concatenation (UPDATE PATCH et IN(...)) â€” whitelist a maintenir

- **Categorie** : security  
- **Zone** : API â€” Events, challenges, teams, participants  
- **Fichier** : `api/src/routes/events.ts` (lignes 211-213)  
- **Probleme** : L'UPDATE events est construit par fields.join(', '). Les noms de colonnes sont des litteraux controles par le code, valeurs parametrees. Idem IN(...) de notify-challenges (challenges.ts:410) avec placeholders generes. Pas d'injection exploitable mais pattern fragile.  
- **Impact** : Pas d'injection en l'etat, mais pattern fragile.  
- **Recommandation** : Conserver une whitelist explicite ; ne jamais interpoler de cle issue de req.body.

#### INFO-007 — Usage massif de 'any' et casts (rows as any[]) â€” perte de securite de type (API entiere)

- **Categorie** : maintainability  
- **Zone** : Transverse â€” Typage API  
- **Fichier** : `api/src/routes/auth.ts` (lignes 28,46,109,144,187,233,267,332,424 (+ events/submissions/gallery/leaderboard/photos/admin))  
- **Probleme** : Tous les resultats mysql2 sont systematiquement castes en any[] et les entites en 'any' dans l'ensemble des routes (auth, events, challenges, participants, submissions, gallery, leaderboard, photos, admin), avec des require() dynamiques dans admin.ts. Desactive la verification de type sur les colonnes (is_admin, event_credits, tier...) et masque les erreurs de schema.  
- **Impact** : Bugs runtime silencieux (propriete inexistante => undefined, NULL non gere) non detectes a la compilation ; maintenance fragile.  
- **Recommandation** : Definir des interfaces RowDataPacket + typage generique mysql2 ; imports types en tete (eviter require() runtime). Centraliser le cast.

#### INFO-008 — URLs presignees S3 generees sans verification d'ownership (IDOR depend des appelants)

- **Categorie** : security  
- **Zone** : API â€” Services externes (S3, email, antivirus)  
- **Fichier** : `api/src/utils/s3Service.ts` (lignes 127-144)  
- **Probleme** : getSignedDownloadUrl genere une URL presignee pour n'importe quelle cle S3 fournie, sans controle d'appartenance. Le risque IDOR depend entierement des routes appelantes.  
- **Impact** : Acces non autorise possible si l'appelant ne filtre pas la cle par owner.  
- **Recommandation** : S'assurer que la cle provient d'une ressource deja filtree par user_id/event owner dans chaque route appelante.

#### INFO-009 — testS3Connection ne reset pas le cache : diagnostic non representatif apres rotation de credentials

- **Categorie** : correctness  
- **Zone** : API â€” Services externes (S3, email, antivirus)  
- **Fichier** : `api/src/utils/s3Service.ts` (lignes 149-159)  
- **Probleme** : Le bouton Tester utilise getS3Client/getS3Config en cache. Apres une mise a jour des settings S3, si invalidateS3Cache n'a pas ete appele, testS3Connection teste l'ANCIENNE config et affiche un resultat trompeur.  
- **Impact** : L'admin recoit un diagnostic non representatif de la config qu'il vient d'enregistrer.  
- **Recommandation** : Invalider le cache au debut de testS3Connection et garantir invalidateS3Cache sur chaque save.

#### INFO-010 — Buffer image ecrit sur disque avec permissions par defaut (umask) avant scan

- **Categorie** : security  
- **Zone** : API â€” Services externes (S3, email, antivirus)  
- **Fichier** : `api/src/utils/antivirusService.ts` (lignes 50)  
- **Probleme** : writeFile cree le fichier temporaire avec le mode par defaut (typiquement 0644), lisible par les autres utilisateurs dans un tmpdir partage. Sur hote multi-tenant, le contenu de l'upload est exposable durant le scan.  
- **Impact** : Lecture du contenu d'upload par d'autres utilisateurs locaux durant la fenetre de scan sur hote partage.  
- **Recommandation** : Passer { mode: 0o600 } a writeFile, ou ecrire dans un sous-repertoire mkdtemp() a permissions restreintes.

#### INFO-011 — Aucune limite de taille sur le buffer scanne (timeout fail-open sur gros fichier)

- **Categorie** : performance  
- **Zone** : API â€” Services externes (S3, email, antivirus)  
- **Fichier** : `api/src/utils/antivirusService.ts` (lignes 36-52)  
- **Probleme** : scanBuffer ecrit l'integralite du buffer sur disque sans verifier sa taille. Un upload volumineux remplit le tmpdir et peut declencher le timeout 30s ; combine au fail-open (MED-018), un timeout renvoie clean:true.  
- **Impact** : Pression disque/CPU et contournement du scan par fichier volumineux declenchant un timeout fail-open.  
- **Recommandation** : Imposer une limite de taille en amont et la verifier dans scanBuffer ; en cas de timeout, ne pas marquer clean si AV actif.

#### INFO-012 — Caractere d'encodage casse dans les messages testS3Connection (mojibake)

- **Categorie** : ux  
- **Zone** : API â€” Services externes (S3, email, antivirus)  
- **Fichier** : `api/src/utils/s3Service.ts` (lignes 161, 166)  
- **Probleme** : Les messages contiennent un caractere de remplacement corrompu, signe d'un probleme d'encodage de fichier (non-UTF8), visible dans le panel admin.  
- **Impact** : Affichage de caracteres parasites dans les messages de test de connexion S3.  
- **Recommandation** : Re-encoder le fichier source en UTF-8 et remplacer les separateurs par des caracteres corrects.

#### INFO-013 — socket.io expose 'polling' avec CORS credentials sans origine valide (bug CORS duplique)

- **Categorie** : correctness  
- **Zone** : API â€” Admin, bootstrap, middleware, validation  
- **Fichier** : `api/src/config/socket.ts` (lignes 15-22)  
- **Probleme** : socket.io active transports ['websocket','polling'] avec cors.credentials:true et origin issu de CORS_ORIGINS sans trim/filter (meme bug que index.ts, cf LOW-048). Combine a l'absence d'auth (MED-013), le transport polling expose des handshakes HTTP non authentifies consommant des connexions pool.  
- **Impact** : Config CORS socket erronee silencieuse + surface de handshake non authentifie.  
- **Recommandation** : Factoriser la resolution des origines CORS (trim+filter) dans un util partage importe par index.ts et socket.ts.

#### INFO-014 — logAudit('admin.impersonate') absent du type AuditAction + actions admin mutatrices non auditees

- **Categorie** : correctness  
- **Zone** : API â€” Admin, bootstrap, middleware, validation  
- **Fichier** : `api/src/utils/auditLog.ts` (lignes 4-20)  
- **Probleme** : admin.ts appelle logAudit('admin.impersonate', ...) mais le type union AuditAction ne contient pas cette action (erreur TS selon la config). Cela revele que la liste d'actions auditables est desynchronisee : delete user/event, patch is_admin ne sont pas du tout audites.  
- **Impact** : Incoherence de tracabilite des actions admin sensibles ; build potentiellement casse selon la rigueur TS.  
- **Recommandation** : Ajouter admin.impersonate/delete_user/delete_event/update_user au type et appeler logAudit dans tous les handlers admin mutateurs.

#### INFO-015 — Agregat SUM(status='converted') depend du mode SQL et renvoie des types ambigus

- **Categorie** : correctness  
- **Zone** : API â€” Admin, bootstrap, middleware, validation  
- **Fichier** : `api/src/routes/admin.ts` (lignes 483-485)  
- **Probleme** : SUM(status='converted') s'appuie sur l'evaluation booleenne MySQL (1/0). Renvoie NULL si aucune ligne, type string/decimal selon le driver.  
- **Impact** : Valeurs NULL non gerees cote client, fragilite si sql_mode change.  
- **Recommandation** : COALESCE(SUM(CASE WHEN status='converted' THEN 1 ELSE 0 END),0) AS converted.

#### INFO-016 — Recherche LIKE non echappee â€” wildcards % et _ interpretes (users/audit-logs)

- **Categorie** : correctness  
- **Zone** : API â€” Admin, bootstrap, middleware, validation  
- **Fichier** : `api/src/routes/admin.ts` (lignes 70-73, 465-467)  
- **Probleme** : GET /admin/users insere '%'+search+'%' en parametre lie (pas d'injection) ; idem audit-logs avec action. Les metacaracteres LIKE (%,_,backslash) ne sont pas echappes : un '%' matche tout, '_' agit comme joker.  
- **Impact** : Sur-correspondance inattendue, leger DoS possible sur grosses tables. Pas une injection.  
- **Recommandation** : Echapper backslash, % et _ avant les wildcards, ou utiliser ESCAPE.

#### INFO-017 — Masquage S3 secret_key : booleens de configuration manquants (frontend potentiellement trompeur)

- **Categorie** : correctness  
- **Zone** : API â€” Admin, bootstrap, middleware, validation  
- **Fichier** : `api/src/routes/admin.ts` (lignes 266-295)  
- **Probleme** : GET /admin/settings/s3 renvoie un masque correct (pas de fuite), mais 'configured: settings.length===5' ne precise pas quelle cle manque, et accessKey/secretKey renvoient toujours une chaine non vide meme non configuree.  
- **Impact** : Affichage frontend potentiellement trompeur. Pas de fuite de secret.  
- **Recommandation** : Renvoyer des booleens accessKeyConfigured/secretKeyConfigured et baser configured sur la presence effective.

#### INFO-018 — results : justRevealed code mort + fallback winnerName '???' incoherent

- **Categorie** : maintainability  
- **Zone** : Frontend â€” App participant (PWA)  
- **Fichier** : `app/src/app/event/[id]/results/page.tsx` (lignes 31, 98-104)  
- **Probleme** : justRevealed est positionne mais jamais lu (code mort). Le filtre w.winnerName!=='???' protege loadResults mais l'overlay socket affiche winnerName fallback '???' sans ce filtre.  
- **Impact** : Code mort et incoherence d'affichage si un event winner-revealed arrive sans winnerName.  
- **Recommandation** : Supprimer justRevealed ; harmoniser le fallback.

#### INFO-019 — api.ts (app) : pas d'intercepteur d'erreur/retry, baseURL prod en dur par defaut

- **Categorie** : maintainability  
- **Zone** : Frontend â€” App participant (PWA)  
- **Fichier** : `app/src/lib/api.ts` (lignes 3-8)  
- **Probleme** : Instance axios sans intercepteurs et avec URL prod en dur en fallback. Gestion d'erreur dupliquee par page (cf INFO-024 pour la duplication transverse des URLs).  
- **Impact** : Duplication ; si NEXT_PUBLIC_API_URL manque au build, l'app tape silencieusement la prod.  
- **Recommandation** : Centraliser auth/erreurs en intercepteurs ; faire echouer/logger si la var d'env manque en prod.

#### INFO-020 — compressImage : nom de fichier fixe (collision potentielle), duree video non validee hors camera

- **Categorie** : correctness  
- **Zone** : Frontend â€” App participant (PWA)  
- **Fichier** : `app/src/app/event/[id]/page.tsx` (lignes 67-77, 309)  
- **Probleme** : compressImage renomme toujours la sortie 'photo.webp'/'photo.jpg' ; a l'upload, formData.append('photo', fileToUpload, fileToUpload.name) envoie un nom non unique. Si le backend derive la cle S3 du nom client, collisions possibles. MAX_VIDEO_DURATION n'est impose que dans CameraModal.  
- **Impact** : Risque de collision/ecrasement si le stockage serveur utilise le nom client ; pas de borne de duree pour videos hors camera.  
- **Recommandation** : Generer la cle de stockage cote serveur (uuid), ne jamais se fier au nom client ; valider duree/taille video serveur.

#### INFO-021 — Aucune garde cote client sur soumissions multiples au meme defi (race UI / offline)

- **Categorie** : data-integrity  
- **Zone** : Frontend â€” App participant (PWA)  
- **Fichier** : `app/src/app/event/[id]/page.tsx` (lignes 281-332)  
- **Probleme** : handleUpload ne verifie pas hasSubmitted(challengeId) avant d'envoyer. Via le flux offline ou un double-clic rapide, plusieurs POST submit peuvent partir pour le meme defi (lie a HIGH-014).  
- **Impact** : Soumissions multiples pour un meme defi si le backend n'impose pas l'unicite (defi, participant).  
- **Recommandation** : Garde cote client (refuser si hasSubmitted) ET contrainte d'unicite serveur idempotente.

#### INFO-022 — Navigation imperative via window.location.href au lieu du routeur Next.js (carte credits)

- **Categorie** : maintainability  
- **Zone** : Frontend â€” Panel organisateur (dashboard)  
- **Fichier** : `panel/src/app/dashboard/page.tsx` (lignes 91)  
- **Probleme** : La carte credits navigue via onClick={()=>window.location.href='/dashboard/pricing'} -> rechargement complet de l'app au lieu d'une navigation SPA. La div n'est pas focusable/activable au clavier.  
- **Impact** : Rechargement complet inutile (perte d'etat, plus lent) et carte non activable au clavier.  
- **Recommandation** : <Link href="/dashboard/pricing"> ou router.push, et rendre l'element focusable/activable au clavier.

#### INFO-023 — Lightbox/modales sans role=dialog ni piege de focus + autoplay videos miniatures (accessibilite/perf panel)

- **Categorie** : ux  
- **Zone** : Frontend â€” Panel organisateur (dashboard)  
- **Fichier** : `panel/src/app/dashboard/events/[id]/page.tsx` (lignes 330-422, 429-552, 362-368, 785-789, 1130-1132)  
- **Probleme** : Le lightbox et la modale d'edition sont des div overlay sans role=dialog/aria-modal, sans piege/restauration de focus ni aria-label sur les boutons ; les vignettes onClick sont des <img>/<video> non focusables. Par ailleurs toutes les miniatures defis/galerie sont <video autoPlay muted loop> (decodage parallele) et le lightbox <video autoPlay controls loop> SANS muted (autoplay bloque).  
- **Impact** : Inaccessible au clavier/lecteurs d'ecran ; conso reseau/CPU sur galeries video ; autoplay lightbox potentiellement bloque.  
- **Recommandation** : role=dialog aria-modal, pieger/restaurer le focus, aria-label, vignettes activables ; ne pas autoPlay toutes les miniatures (poster/lecture au clic) ; muted par defaut dans le lightbox.

#### INFO-024 — URLs d'API/hotes par defaut codees en dur et dupliquees (app, panel, admin, libs)

- **Categorie** : maintainability  
- **Zone** : Transverse â€” Config URLs en dur  
- **Fichier** : `app/src/lib/api.ts` (lignes 3-8 (+ panel events/[id]:128/878/889, panel api.ts:5/37, admin api.ts:5/37, submissions.ts:210/263/296, gallery.ts:98))  
- **Probleme** : Les fallbacks 'https://api.rallye-photo.com' et 'https://app.rallye-photo.com' sont dupliques dans les composants et les libs api des trois frontends, ainsi que API_URL || 'https://api.rallye-photo.com' cote backend (submissions/gallery). En l'absence de NEXT_PUBLIC_*/API_URL, l'app tape silencieusement la prod.  
- **Impact** : Un environnement test/preview/dev peut viser la prod si la variable d'env manque ; tokens generes pointant vers le mauvais host ; maintenance dispersee.  
- **Recommandation** : Centraliser ces URLs dans un module de config unique par projet et faire echouer le boot/build si la variable d'env est absente (comme PHOTO_PEPPER) plutot que fallback en dur sur la prod.

#### INFO-025 — useEffect du paiement reussi : eslint-disable exhaustive-deps avec seul [successType]

- **Categorie** : bug  
- **Zone** : Frontend â€” Panel organisateur (dashboard)  
- **Fichier** : `panel/src/app/dashboard/pricing/page.tsx` (lignes 89-91)  
- **Probleme** : useEffect(()=>{ if(successType) refreshUser?.(); },[successType]) avec eslint-disable. Acceptable ici car refreshUser est stable, mais le pattern masque le risque de closure perimee si le provider recreait refreshUser.  
- **Impact** : Risque faible de rafraichissement avec closure perimee si l'implementation du contexte change.  
- **Recommandation** : Memoiser refreshUser (useCallback) dans le provider et l'inclure dans les deps.

#### INFO-026 — useEffect detail event admin : dependance manquante (loadData non memoise)

- **Categorie** : bug  
- **Zone** : Frontend â€” Back-office admin  
- **Fichier** : `admin/src/app/dashboard/events/[id]/page.tsx` (lignes 60-76)  
- **Probleme** : useEffect(() => { loadData(); }, [eventId]) appelle loadData non memoise via useCallback et absent des deps. loadData ne capture que des setters stables (bug nul en l'etat) mais viole react-hooks/exhaustive-deps et est incoherent avec events/page.tsx et users/page.tsx.  
- **Impact** : Faible en l'etat ; risque latent si loadData se met a dependre d'un state non liste.  
- **Recommandation** : Envelopper loadData dans useCallback([eventId]) et l'inclure dans les deps, comme les autres pages.

#### INFO-027 — Calcul O(n*m) des stats participants (filter dans la boucle de rendu) â€” admin

- **Categorie** : performance  
- **Zone** : Frontend â€” Back-office admin  
- **Fichier** : `admin/src/app/dashboard/events/[id]/page.tsx` (lignes 385-387)  
- **Probleme** : Dans le rendu de l'onglet participants, participants.map appelle pour chaque p submissions.filter(...) puis un .filter sur is_winner. Complexite O(participants*submissions) recalculee a chaque render sans memoisation, alors que submissionsByChallenge est deja pre-indexe.  
- **Impact** : Recalcul couteux a chaque re-render pour un gros event (centaines de participants x milliers de photos).  
- **Recommandation** : Pre-calculer un index Map<participant_id,{count,wins}> via useMemo.

#### INFO-028 — Telechargement ZIP admin : objectURL non revoque en cas d'exception

- **Categorie** : maintainability  
- **Zone** : Frontend â€” Back-office admin  
- **Fichier** : `admin/src/app/dashboard/events/[id]/page.tsx` (lignes 78-99)  
- **Probleme** : downloadZip cree un blob URL et le revoque uniquement dans le chemin nominal ; si a.click() levait, la revocation reste dans le try sans finally dedie a l'URL. (Recoupe LOW-077 pour le volet timing/anchor.)  
- **Impact** : Fuite memoire mineure d'un object URL en cas d'exception entre createObjectURL et revokeObjectURL.  
- **Recommandation** : Revoquer l'object URL dans un finally dedie ou immediatement apres a.click().

#### INFO-029 — Validation client de la coherence accessKey/secretKey absente (un seul des deux champs soumissible)

- **Categorie** : correctness  
- **Zone** : Frontend â€” Back-office admin  
- **Fichier** : `admin/src/app/dashboard/settings/page.tsx` (lignes 49-72, 258-262)  
- **Probleme** : Le hint indique 'Remplissez les deux pour les remplacer', mais handleSave envoie systematiquement accessKey et secretKey sans valider qu'ils sont soit tous deux vides soit tous deux remplis. Un admin peut remplir seulement accessKey et soumettre.  
- **Impact** : Risque d'incoherence des credentials S3 (access remplace, secret conserve -> auth S3 cassee) si le backend ne valide pas le couplage.  
- **Recommandation** : Cote front, refuser la soumission si exactement un des deux champs est rempli, avec un message explicite.

#### INFO-030 — Statut event 'archived' propose au filtre mais badge non gere (admin & panel)

- **Categorie** : ux  
- **Zone** : Frontend â€” Back-office admin  
- **Fichier** : `admin/src/app/dashboard/events/page.tsx` (lignes 74, 119-125)  
- **Probleme** : Le select propose l'option archived mais la map de badges ne gere que active/ended/draft et retombe sur badge-muted (identique a 'ended') sans libelle distinct. La page detail ne distingue qu'active vs le reste.  
- **Impact** : Cosmetique : un event archive s'affiche comme un event 'ended' muet.  
- **Recommandation** : Ajouter un cas explicite pour 'archived' dans la map de badges, ou retirer l'option si non supporte.

#### INFO-031 — Gestion d'erreur reseau incoherente : erreurs avalees en console.error sans feedback (app/panel/admin)

- **Categorie** : ux  
- **Zone** : Transverse â€” Gestion d'erreur frontend  
- **Fichier** : `admin/src/app/dashboard/events/page.tsx` (lignes 35-39 (+ panel events/page.tsx:39-44, panel/admin dashboard, panel settings affiliates:16-23))  
- **Probleme** : Les chargements de liste attrapent l'erreur avec .catch(console.error) puis affichent la liste vide ('Aucun evenement') comme un etat vide legitime, indiscernable d'un echec reseau. Certaines sections (affiliates settings) restent en 'Chargement...' permanent (catch vide). Les mutations utilisent alert(). Pattern duplique entre app, panel et admin.  
- **Impact** : L'utilisateur croit la base vide alors que l'API a echoue ; pas de reessai ; presentation incoherente.  
- **Recommandation** : Distinguer etat 'erreur' / 'vide' / 'chargement' avec message + bouton Reessayer, uniformiser via toasts plutot qu'alert(), factoriser un wrapper de fetch.

#### INFO-032 — Injection HTML inline via dangerouslySetInnerHTML pour le theme (duplique layout/theme)

- **Categorie** : maintainability  
- **Zone** : Frontend â€” Panel (auth flows & libs)  
- **Fichier** : `panel/src/app/layout.tsx` (lignes 26-35 (+ panel/src/lib/theme.tsx:40-50))  
- **Probleme** : Le script anti-flash de theme est injecte via dangerouslySetInnerHTML dans layout.tsx ET duplique dans theme.tsx. Contenu statique (pas de XSS) mais duplication et pattern a risque si une variable est interpolee.  
- **Impact** : Pas d'impact securite actuel (chaine constante). Dette : duplication + pattern a risque.  
- **Recommandation** : Factoriser le snippet en une seule source statique. Envisager next-themes (cf MED-023).

#### INFO-033 — register (panel) force emailVerified:false et stocke data.user non normalise

- **Categorie** : correctness  
- **Zone** : Frontend â€” Panel (auth flows & libs)  
- **Fichier** : `panel/src/lib/auth.tsx` (lignes 78-84)  
- **Probleme** : register construit newUser = { ...data.user, emailVerified: false } sans appeler /auth/me ni normaliser les autres champs (eventCredits, plan) comme login. Si data.user n'a pas la forme attendue, l'objet user en cookie diverge de celui de login/refreshUser.  
- **Impact** : Forme de l'objet user incoherente entre register et login/refreshUser ; champs potentiellement undefined.  
- **Recommandation** : Normaliser l'objet user via une fonction unique partagee et deriver emailVerified de la reponse.

#### INFO-034 — Usage generalise de 'catch (err: any)' et catch silencieux (panel & admin)

- **Categorie** : maintainability  
- **Zone** : Transverse â€” Typage erreurs frontend  
- **Fichier** : `panel/src/lib/auth.tsx` (lignes 72-75, 101-103 (+ admin pages, recentUsers/recentEvents any))  
- **Probleme** : De nombreux catch typent l'erreur en 'any' et certains sont totalement silencieux (refreshUser, login fallback). Cote admin, recentUsers/recentEvents/params sont 'any'. Le fallback de login ecrit data.user sans normaliser emailVerified.  
- **Impact** : Etats utilisateur incoherents (emailVerified non normalise) et erreurs avalees sans trace ; aucune verification de type sur les donnees serveur.  
- **Recommandation** : Typer les erreurs (unknown + narrowing), normaliser l'objet user via une fonction unique, typer recentUsers/recentEvents/params.

#### INFO-035 — UPDATE plan redondant : WHERE plan IN ('starter','pro') reattribue 'pro' a des deja 'pro'

- **Categorie** : maintainability  
- **Zone** : Infra â€” Migrations SQL, deploy, config, deps  
- **Fichier** : `MIGRATION_PLANS.sql` (lignes 21)  
- **Probleme** : Le commentaire decrit starter->pro, pro inchange ; la requete UPDATE users SET plan='pro' WHERE plan IN ('starter','pro') ecrit 'pro' sur des lignes deja 'pro', operation inutile.  
- **Impact** : Aucun impact correctif ; legere inefficacite et confusion de lecture.  
- **Recommandation** : Restreindre a WHERE plan = 'starter'.

#### INFO-036 — Migrations SQL PLANS non transactionnelles et non idempotentes (ADD COLUMN sans IF NOT EXISTS)

- **Categorie** : data-integrity  
- **Zone** : Infra â€” Migrations SQL, deploy, config, deps  
- **Fichier** : `MIGRATION_PLANS.sql` (lignes 8-35)  
- **Probleme** : Les ADD COLUMN (tier, event_credits) ne sont pas gardes par IF NOT EXISTS (contrairement a FEATURES/SECURITY) : re-execution echoue (Duplicate column). Les UPDATE ne sont pas en transaction ; les ALTER auto-commitent en MariaDB, donc echec partiel non rollbackable.  
- **Impact** : Migration fragile : re-run impossible sans edition, echec partiel laisse plans/credits/tiers incoherents.  
- **Recommandation** : Ajouter IF NOT EXISTS sur les ADD COLUMN, grouper les UPDATE en transaction, idealement outil de migration versionne.

#### INFO-037 — Versions de dependances API suspectes/inexistantes (echec d'installation probable)

- **Categorie** : dependency  
- **Zone** : Infra â€” Migrations SQL, deploy, config, deps  
- **Fichier** : `api/package.json` (lignes 14-56)  
- **Probleme** : Ranges potentiellement vers des versions inexistantes : bcrypt ^6.0.0, cors ^2.8.6 (latest connu 2.8.5), nodemailer ^8.0.7, uuid ^14.0.0 avec @types/uuid ^10 (conflit, uuid>=9 fournit ses types), typescript ^6.0.3, pdfkit ^0.19.0. uuid>=7 est ESM-only (risque build CJS via tsc).  
- **Impact** : Build/install cassable ou montee silencieuse vers des majeures avec breaking changes ; @types/uuid superflu/conflictuel.  
- **Recommandation** : Verifier chaque version contre le registre, epingler des versions publiees, npm ci + npm audit, retirer @types/uuid si uuid>=9, confirmer compat CJS/ESM.

#### INFO-038 — Vitrine : page HTML sans doctype, charset ni meta (placeholder brut)

- **Categorie** : ux  
- **Zone** : Infra â€” Migrations SQL, deploy, config, deps  
- **Fichier** : `vitrine/index.html` (lignes 1)  
- **Probleme** : Le fichier ne contient qu'un <h1>Rallye Photo - Coming Soon</h1> sans <!doctype html>, <html lang>, <meta charset> ni viewport. Sans charset les accents s'affichent mal.  
- **Impact** : Page non conforme (encodage, mobile viewport, SEO). Impact mineur tant que c'est un placeholder.  
- **Recommandation** : Ajouter doctype, html lang=fr, meta charset utf-8 et viewport quand la vitrine devient publique ; CSP au niveau serveur.


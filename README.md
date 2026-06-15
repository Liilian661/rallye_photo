# rallye.photo

**Transformez n'importe quel événement en rallye photo compétitif.**

Mariage, soirée d'entreprise, anniversaire, festival — les participants scannent un QR code, rejoignent l'événement en quelques secondes, et s'affrontent sur des défis photo en temps réel. L'organisateur pilote tout depuis un tableau de bord : lancement des défis, sélection des gagnants, classement live.

---

## Ce que ça fait

**Pour les participants (via leur téléphone)**
- Rejoindre un événement instantanément avec un QR code, sans inscription ni app à télécharger
- Recevoir les défis photo en direct
- Soumettre une photo ou une vidéo depuis la galerie ou la caméra
- Suivre son score dans le classement en temps réel

**Pour l'organisateur (depuis le panel web)**
- Créer un événement en 30 secondes, générer un QR code PDF à imprimer
- Ajouter des défis à la volée pendant l'événement
- Désigner un gagnant par défi (les points s'attribuent automatiquement)
- Voir les soumissions en direct, modérer, exporter les photos en ZIP
- Personnaliser l'interface avec les couleurs, logo et bannière de l'événement

---

## Pourquoi c'est intéressant à contribuer

- **Projet réel, en production** — utilisé pour de vrais événements, pas un projet de démo
- **Stack moderne** — Next.js 16, Express 5, TypeScript partout, Socket.io pour le temps réel, Sharp pour le traitement image, S3 pour le stockage
- **Problèmes concrets** — gestion de la fiabilité d'upload sur mobile (retry, file d'attente hors-ligne), sécurité des URLs photo, performance temps réel avec des centaines de participants
- **Codebase propre et lisible** — trois services bien séparés (API, panel organisateur, app participant), chacun autonome

---

## Architecture en un coup d'oeil

```
rallye_photo/
├── api/        → API REST + WebSocket (Express 5 + Socket.io)
├── panel/      → Interface organisateur (Next.js)
└── app/        → Interface participant mobile-first (Next.js)
```

Les trois services communiquent via l'API. Les participants et l'organisateur reçoivent les mises à jour en temps réel via WebSocket.

---

## Les fonctionnalités principales

| Fonctionnalité | Détail |
|---|---|
| Temps réel | Socket.io — classement, nouvelles soumissions, alertes de défis |
| Upload media | Photos et vidéos, compression WebP côté client, retry automatique, file d'attente hors-ligne |
| Sécurité des URLs | Tokens PBKDF2 signés avec un secret par événement + secret global — les URLs photo expirent |
| Antivirus | Scan ClamAV des uploads (mode fail-open par défaut, fail-secure configurable) |
| Paiement | Stripe Checkout + webhooks idempotents (pas de double crédit) |
| Auth | JWT access token 15 min + refresh token 30 jours avec détection de réutilisation |
| Défis surprise | Révélation en direct pendant l'événement |
| Mode équipes | Classement par équipe plutôt qu'individuel |
| Personnalisation | Couleur de thème, logo, bannière par événement |
| Export ZIP | Téléchargement de toutes les photos d'un événement |

---

## Ce qu'on pourrait améliorer (idées de contributions)

- **Application mobile native** — l'app participant est une PWA, une vraie app React Native serait un upgrade
- **Galerie publique** — une page de galerie partageable après l'événement
- **Modération collaborative** — permettre à plusieurs co-organisateurs de gérer un même événement
- **Analytics** — statistiques post-événement (taux de participation, défis les plus populaires, etc.)
- **Templates de défis** — bibliothèque de défis prêts à l'emploi par type d'événement
- **Internationalisation** — l'app est en français, une version multilingue ouvrirait de nouveaux marchés

---

## Démarrage rapide

**Prérequis** : Node.js 20+, MariaDB, un bucket S3 (ou MinIO en local)

```bash
# Cloner le repo
git clone <repo-url>
cd rallye_photo

# Installer les dépendances des trois services
cd api && npm install
cd ../panel && npm install
cd ../app && npm install

# Configurer les variables d'environnement
cp api/.env.example api/.env
# Remplir : DATABASE_URL, JWT_SECRET, PHOTO_PEPPER, AWS_*, STRIPE_*

# Lancer en dev
cd api && npm run dev      # port 3001
cd panel && npm run dev    # port 3002
cd app && npm run dev      # port 3003
```

---

## Envie de contribuer ?

Le projet est ouvert aux contributions. Que ce soit pour corriger un bug, proposer une fonctionnalité ou améliorer l'UX mobile — ouvrez une issue ou contactez directement.

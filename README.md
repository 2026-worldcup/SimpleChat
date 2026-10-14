# Piaf — messagerie privée mobile

Messagerie privée à deux, installable (PWA), en français, pensée pour smartphone.
Frontend statique (HTML/CSS/JS, sans framework) sur **GitHub Pages** ; backend **Supabase** (auth, PostgreSQL + RLS, temps réel, stockage privé, Edge Functions). Offres gratuites.

## État honnête du projet

Le code de l'application, le schéma SQL, les politiques de sécurité et les Edge Functions sont écrits. **Rien de ce qui touche à Supabase n'a encore été testé de bout en bout** : voir « Tests » plus bas. Ne considérez une fonctionnalité comme opérationnelle qu'après avoir fait tourner la liste de tests.

### Fonctionnalités écrites (à valider par les tests)
- Création de compte : nom d'affichage + identifiant à 8 chiffres non séquentiel + code secret (8 caractères minimum), sans e-mail ; affichage et copie de l'identifiant.
- Connexion identifiant + code, verrouillage progressif après échecs, session persistante, pas de bouton de déconnexion, révocation des autres sessions, suppression du compte.
- Liste des discussions (récentes, favoris, archivées, non lus, silence, renommage local), recherche par identifiant ou nom.
- Messages en temps réel, groupés, liens cliquables, réponse, modification, réaction, transfert (texte), épinglage, recherche, copie, suppression pour moi / pour tous, brouillons, file d'envoi hors ligne sans doublon.
- Statuts : en cours, envoyé, distribué, lu (avec heure), échec + réessai ; confirmations de lecture désactivables (réciproque).
- Photos et vidéos : envoi groupé avec aperçu, progression, annulation, visionneuse, téléchargement, galerie avec quota, suppression pour moi / pour tous (suppression réelle du fichier).
- Blocage, signalement, thème clair/sombre, notifications locales (application ouverte ou en arrière-plan).

### Non terminé / limites connues
- **Pas de notifications push application fermée** (nécessiterait Web Push + clés VAPID + une fonction serveur). Les notifications actuelles fonctionnent tant que l'application est ouverte ou en arrière-plan. Sur iPhone, installer d'abord l'application sur l'écran d'accueil (iOS 16.4+).
- Pas de vignettes serveur : les galeries chargent les fichiers d'origine (la transformation d'images est une fonction payante de Supabase).
- Le transfert de médias n'est pas disponible (seuls les messages texte se transfèrent).
- Pas de groupes (le schéma est limité à deux personnes par conversation ; à faire évoluer pour les groupes).
- Pas de chiffrement de bout en bout. Pas d'export de données. Pas d'analyse antivirus ou de contenu des fichiers.
- La suppression d'une réaction est diffusée en temps réel sans filtrage par la RLS (limite de Supabase Realtime pour les suppressions) : seules deux clés techniques (id du message, id de l'utilisateur) sont concernées.
- Les réservations de médias abandonnées (téléphone coupé en plein envoi) sont nettoyées à l'ouverture de l'application, pas par une tâche planifiée.

## Architecture

```
index.html, style.css, app.js (noyau), views-home.js, views-chat.js   ← frontend
config.js            ← URL du projet + clé PUBLIQUE (publishable) uniquement
vendor/supabase.js   ← supabase-js 2.117.2 (publiée le 25/09/2026), copiée localement
sw.js, manifest.webmanifest, icons/                                    ← PWA
privacy.html         ← modèle de politique de confidentialité (à compléter)
supabase/migrations/001_schema.sql      tables, vues, déclencheurs d'inscription
supabase/migrations/002_functions.sql   logique serveur (RPC), quotas atomiques
supabase/migrations/003_security.sql    RLS, privilèges, bucket privé, temps réel
supabase/functions/auth/                inscription, connexion, suppression de compte
supabase/functions/media/               finalisation d'envoi, suppression réelle, nettoyage
```

### Authentification
Supabase Auth n'offre pas de mode « identifiant à 8 chiffres + code ». Solution retenue :
1. Chaque compte a un e-mail technique `<identifiant>@piaf.invalid` (aucune confirmation, aucun envoi).
2. L'Edge Function `auth` génère l'identifiant (aléatoire, collisions gérées), et ne transmet **jamais** le code brut à Supabase : le mot de passe réel est `HMAC-SHA256(PIAF_PEPPER, id + code)`. Sans le secret serveur `PIAF_PEPPER`, on ne peut pas deviner un code en attaquant directement l'API d'authentification : toutes les tentatives passent par la fonction, qui les limite (5 échecs → 15 min par identifiant + IP ; 30 échecs → 60 min par identifiant).
3. Un déclencheur SQL refuse toute création de compte qui ne vient pas de cette fonction (inscription directe désactivée).
4. **Conséquence** : perdre `PIAF_PEPPER` rend tous les comptes inaccessibles. Gardez-le dans un gestionnaire de mots de passe.

### Médias et quotas
- `reserve_media` (SQL) verrouille la conversation (`FOR UPDATE`), vérifie type, taille, nombre et quota, et réserve l'espace : deux envois simultanés ne peuvent pas dépasser le quota.
- Le navigateur envoie les fichiers dans le bucket privé `chat-media` (politique : seulement vers un chemin réservé). `media` (Edge Function) contrôle la **taille réelle**, crée le message et supprime l'objet en cas de non-conformité.
- Suppression pour tous : le média disparaît d'abord de l'application, le fichier est supprimé du stockage, **puis** l'espace est libéré. En cas d'échec, l'objet reste « en suppression » et sera retenté (nettoyage à l'ouverture de l'application).
- Limites (photo 10 Mo, vidéo 25 Mo, 100 Mo par conversation, 10 fichiers par envoi) : table `app_config`, modifiables sans toucher au code :
  `update public.app_config set value = 52428800 where key = 'video_max_bytes';`
  Le bucket impose en plus un plafond dur de 25 Mo par fichier (voir `003_security.sql`). Le plan gratuit de Supabase limite aussi le stockage total du projet et la taille d'un fichier : vérifiez vos quotas dans le tableau de bord.

### Statuts de message
- **Envoyé** : enregistré en base.
- **Distribué** : l'application du destinataire a chargé le message (ouverture ou réception en direct) ; ce n'est pas une garantie d'affichage.
- **Lu** : le destinataire a ouvert la conversation avec le message visible, et ses confirmations de lecture sont activées.

## Installation

### 1. Supabase
1. Créez un projet Supabase **vierge** dédié à Piaf (ne mélangez pas avec un autre projet).
2. Éditeur SQL : exécutez, dans l'ordre, `001_schema.sql`, `002_functions.sql`, `003_security.sql`.
3. Edge Functions : déployez `auth` **sans** vérification JWT (inscription et connexion se font avant d'avoir un jeton) et `media` **avec** vérification JWT. Avec la CLI :
   `supabase functions deploy auth --no-verify-jwt --project-ref <REF>` puis `supabase functions deploy media --project-ref <REF>`.
4. Secret : générez une valeur aléatoire de 32 caractères ou plus (ex. `openssl rand -base64 48`) et enregistrez-la :
   `supabase secrets set PIAF_PEPPER=<valeur> --project-ref <REF>`.
5. Authentification → réglages : laissez les inscriptions publiques activées (le déclencheur SQL les bloque de toute façon) et désactivez la confirmation par e-mail si l'option est présente.

### 2. Frontend
Dans `config.js`, renseignez l'URL du projet et la clé **publishable** (Réglages → API Keys). Jamais de clé `service_role` ici.

### 3. GitHub Pages
Dépôt → Settings → Pages → *Deploy from a branch* → `main` / racine. Le site sera à `https://<compte>.github.io/<dépôt>/`. Tous les chemins sont relatifs : la publication dans un sous-répertoire est prévue.

### 4. Local
`python3 -m http.server 8080` puis http://localhost:8080 (les service workers fonctionnent sur localhost).

## Tests

Liste de la mission et état. **Aucune case n'est cochée tant que le test n'a pas été exécuté.**
À exécuter avec deux comptes (A et B) et un troisième (C) pour les contrôles d'accès : création de comptes, persistance de session, recherche, temps réel, accusés de lecture, modification/suppressions, photo valide/trop grosse, vidéo, envoi groupé > 10, quota atteint, téléchargement sans effet sur le quota, suppression pour tous (libération réelle), échec de suppression, accès interdit pour C (messages et fichiers), tentatives de connexion abusives, coupure réseau, écran étroit avec clavier, chemin GitHub Pages en sous-répertoire, boutons et états vides.

Tests non exécutables sans un appareil réel : clavier virtuel iOS/Android, notifications, installation PWA, lecture vidéo HEIC/MOV selon le navigateur.

## Sécurité : rappels
- RLS activée sur toutes les tables ; les clients n'ont que des droits de lecture (et la mise à jour de quelques réglages personnels). Toute écriture passe par des fonctions qui vérifient membre/auteur/blocage.
- Aucun secret dans le dépôt : la clé `service_role` et `PIAF_PEPPER` ne vivent que dans Supabase.
- Les liens sont limités à http(s) avec `rel="noopener noreferrer nofollow"` ; aucun contenu utilisateur n'est injecté en HTML ; les SVG ne sont pas acceptés comme médias.
- Les URL de médias sont signées et expirent (10 min).

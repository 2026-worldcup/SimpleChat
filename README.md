# Piaf — messagerie privée mobile

Messagerie privée à deux, installable (PWA), en français, pensée pour smartphone. **Argument central : on l'utilise sans adresse e-mail et sans numéro de téléphone** (identifiant à 8 chiffres + code secret) ; toute évolution doit préserver ce principe.
Frontend statique (HTML/CSS/JS, sans framework) sur **GitHub Pages** ; backend **Supabase** (auth, PostgreSQL + RLS, temps réel, stockage privé, Edge Functions). Offres gratuites.

## État honnête du projet

Le code de l'application, le schéma SQL, les politiques de sécurité et les Edge Functions sont écrits. Le schéma, les politiques de sécurité et les fonctions serveur sont déployés sur Supabase et ont subi des tests ciblés côté base de données (voir « Tests »). **L'application complète (navigateur + Edge Functions) n'a pas encore été testée de bout en bout** : inscription/connexion réelles, envoi réel de fichiers, temps réel, installation sur téléphone restent à vérifier.

### Fonctionnalités écrites (à valider par les tests)
- Création de compte : nom d'affichage + identifiant à 8 chiffres non séquentiel + code secret (8 caractères minimum), sans e-mail ; affichage et copie de l'identifiant.
- Connexion identifiant + code, verrouillage progressif après échecs, session persistante, pas de bouton de déconnexion, révocation des autres sessions, suppression du compte.
- Liste des discussions (récentes, favoris, archivées, non lus, silence, renommage local), recherche par identifiant exact (8 chiffres).
- Messages en temps réel, groupés, liens cliquables, réponse, modification, réaction, transfert (texte), épinglage, recherche, copie, suppression pour moi / pour tous, brouillons, file d'envoi hors ligne sans doublon.
- Statuts : en cours, envoyé, distribué, lu (avec heure), échec + réessai ; confirmations de lecture désactivables (réciproque).
- Photos et vidéos : envoi groupé avec aperçu, progression, annulation, visionneuse, téléchargement, galerie avec quota, suppression pour moi / pour tous (suppression réelle du fichier).
- Photo de profil (recadrée en carré 176 px côté appareil, JPEG qualité réduite, bucket privé visible seulement par soi et ses contacts de conversation) ; supprimée avec le compte.
- Mentions : « @ » dans le champ de message propose les membres du groupe ; les noms mentionnés sont mis en valeur, et une mention passe outre le mode silence du groupe pour la notification.
- « @Talk2Piaf » (ou « @Talk2Piaf Actions ») dans n'importe quelle discussion, groupe ou privée : **la demande n'est pas envoyée** aux autres. Elle et la réponse s'affichent dans un **style à part** (bulles en pointillés, « visible par vous seul, sur cet appareil »), sont **enregistrées uniquement sur l'appareil** (par compte et par discussion, 40 éléments, 30 jours) et **s'effacent** une par une (appui sur la bulle), par discussion (menu ⋯) ou toutes d'un coup (Paramètres → Assistant Talk2Piaf). Plus aucune réponse de l'assistant n'est sauvegardée dans le cloud (migration 012).
- Mentions : le « @ » disparaît à l'affichage et le nom est coloré ; la personne mentionnée voit une bulle plus marquée (« Vous avez été mentionné(e) ») et un badge « @ » dans la liste ; l'expéditeur voit pour chaque personne mentionnée « lu » ou « pas encore lu ».
- Sélection multiple : appui long sur un message, puis touchez d'autres messages ; copier, transférer (texte), supprimer pour moi, supprimer pour tous.
- Sondages : question, 2 à 12 options, choix unique ou multiple, vote anonyme (les votes individuels ne sont jamais envoyés aux autres), ajout d'options par les membres, clôture manuelle ou automatique, modification (auteur ou administrateur).
- Listes de tâches collaboratives : éléments cochables, assignation à un membre (groupes), droits « les membres peuvent ajouter / cocher » réglables, effacement des éléments terminés.
- Audio : messages vocaux (enregistrement depuis le micro, 10 minutes maximum) et envoi de fichiers audio (10 Mo maximum), lecteur avec position et vitesse, comptés dans le quota de la conversation, listés dans la galerie.
- Assistant Talk2Piaf (version simple, locale) : boutons d'action réutilisables (seuls envoi de message, blocage/déblocage, révocation des sessions et effacement de l'historique sont à usage unique), boutons moins arrondis, « @contact » dans la saisie (« écris à @Marie : … », « ouvre @Marie », « bloque @Marie »), moteur de recherche au choix dans Paramètres → Assistant Talk2Piaf (réglage local), réponses sur sondages, listes de tâches, audio/vocaux, libération d'espace (bouton « espace utilisé par discussion »).
- **Connecteurs** (Talk2Piaf) : **calendrier sans compte** (« rappelle-moi demain à 14h : dentiste » → fichier .ics, lien Google Agenda ou Outlook, préparés sur l'appareil, rien n'est envoyé avant l'appui) et **suivi de fichiers GitHub publics** (« suis https://github.com/… » : vérification serveur toutes les 15 minutes, alerte à chaque modification, dans la discussion Talk2Piaf ; suivi personnel). Word, Excel, Google Docs et Drive sont reconnus mais **pas encore branchés** (liaison de compte requise). Mise en place et faisabilité : `docs/CONNECTEURS.md`.
- Coches : 1 coche = envoi en cours ; 2 coches grises = le message est bien arrivé sur le serveur ; 2 coches colorées = lu.
- Groupes (2 à 32 personnes) : création depuis ses discussions et groupes communs, rôles administrateur/membre, ajout/retrait, départ, photo carrée et nom du groupe, cadrage des photos (déplacer + zoomer), historique masqué aux nouveaux arrivants, accusés « lu par N/M », suppression par un administrateur, quota de médias par groupe. **Testés côté base de données ; interface et fonctions serveur non testées de bout en bout.**
- Blocage, signalement, thème clair/sombre, notifications locales (application ouverte ou en arrière-plan).

### Non terminé / limites connues
- **Pas de notifications push application fermée** (nécessiterait Web Push + clés VAPID + une fonction serveur). Les notifications actuelles fonctionnent tant que l'application est ouverte ou en arrière-plan. Sur iPhone, installer d'abord l'application sur l'écran d'accueil (iOS 16.4+).
- Pas de vignettes serveur : les galeries chargent les fichiers d'origine (la transformation d'images est une fonction payante de Supabase).
- Le transfert de médias n'est pas disponible (seuls les messages texte se transfèrent).
- Pas de chiffrement de bout en bout. Pas d'export de données. Pas d'analyse antivirus ou de contenu des fichiers.
- Groupes : un membre retiré garde l'accès à un fichier déjà ouvert pendant 10 minutes au plus (liens signés) ; les accusés « lu par N/M » se rafraîchissent toutes les 20 secondes (pas en temps réel) ; un événement de suppression d'appartenance est diffusé en temps réel sans filtrage (identifiants techniques seulement).
- La suppression d'une réaction est diffusée en temps réel sans filtrage par la RLS (limite de Supabase Realtime pour les suppressions) : seules deux clés techniques (id du message, id de l'utilisateur) sont concernées.
- Les réservations de médias abandonnées (téléphone coupé en plein envoi) sont nettoyées à l'ouverture de l'application, pas par une tâche planifiée.

## Architecture

```
index.html, style.css, app.js (noyau), views-home.js, views-chat.js   ← frontend
assistant-kb.js      ← Talk2Piaf : base de connaissances + moteur de réponse (sans dépendance, testable sous Node)
assistant.js         ← Talk2Piaf : fenêtre de discussion et boutons d'action (vraies opérations de l'application)
assistant-actions-kb.js ← Talk2Piaf Actions : moteur des actions (sondages, listes, recherche, infos du groupe), fusionné dans Talk2Piaf, sans dépendance, testable sous Node
assistant-actions.js ← Talk2Piaf Actions : exécution des actions (aperçu modifiable ou direct, modifier / annuler) + échanges locaux des discussions
assistant-calendar.js ← connecteur calendrier : dates en français → fichier .ics / liens Google Agenda et Outlook (sans dépendance)
assistant-watch.js   ← connecteur suivi de fichiers : reconnaissance des liens GitHub / Office / Google, préparation du bouton « Suivre »
config.js            ← URL du projet + clé PUBLIQUE (publishable) uniquement
vendor/supabase.js   ← supabase-js 2.117.2 (publiée le 25/09/2026), copiée localement
sw.js, manifest.webmanifest, icons/                                    ← PWA
privacy.html         ← modèle de politique de confidentialité (à compléter)
supabase/migrations/001_schema.sql      tables, vues, déclencheurs d'inscription
supabase/migrations/002_functions.sql   logique serveur (RPC), quotas atomiques
supabase/migrations/003_security.sql    RLS, privilèges, bucket privé, temps réel
supabase/migrations/004_signup_gate.sql  correctif : contrôle d'inscription par jeton secret
supabase/migrations/005_find_user_exact.sql  recherche par identifiant exact
supabase/migrations/006_avatars.sql      photos de profil
supabase/migrations/007_groups.sql       groupes (contrainte appliquée sous le nom conversations_shape_check)
supabase/migrations/009_collab.sql        historique des groupes masqué au niveau des tables, sondages, listes de tâches, audio, réponse publique de l'assistant, mentions non lues
supabase/migrations/010_watchers.sql   suivi de fichiers GitHub : tables, fonctions, alertes (avec l'Edge Function `watch`)
supabase/migrations/011_watch_cron.sql   secret d'appel généré dans le coffre Vault et tâche planifiée toutes les 15 minutes
PLAN_GROUPES.md      plan de la gestion des groupes
supabase/functions/auth/                inscription, connexion, suppression de compte
supabase/functions/media/               finalisation d'envoi, suppression réelle, nettoyage
```

### Assistant Talk2Piaf
Assistant intégré, qui s'exécute **entièrement sur l'appareil** (aucun appel réseau, aucun modèle distant) : `assistant-kb.js` contient une centaine de sujets (compte, discussions, messages, médias, groupes, sécurité, réglages, assistance) et quelques services (heure, calculs, tirages au sort, blagues, aide à la rédaction) ; il lit l'état réel de l'application (identifiant, discussions, non lus, réglages) pour répondre de façon personnalisée.
Les réponses peuvent contenir des **liens** et des **boutons d'action** qui ne s'exécutent qu'à l'appui : ouvrir un écran ou une discussion, démarrer une discussion avec un identifiant, envoyer un message préparé (« écris à Marie : j'arrive »), favori / archive / silence, thème, notifications, confirmations de lecture, nom et photo de profil, invitation, révocation des autres sessions, phrase secrète aléatoire.
Talk2Piaf figure **dans la liste des discussions** (avec l'étiquette « Assistant », badge de non lus, favori / archive / silence / renommage, recherche) et s'ouvre dans le même écran que les autres discussions (route `#/talk2piaf`). Cette discussion est **locale** : son état et son historique restent dans le navigateur (clé `piaf-t2p-v4-<compte>`), ils ne sont ni envoyés ni synchronisés ; elle peut être effacée depuis le menu ⋯.
### Talk2Piaf et Talk2Piaf Actions (partout, y compris dans les discussions et les groupes)
Il n'y a plus qu'**un assistant, Talk2Piaf**, qui comprend beaucoup de formulations (politesses, abréviations, fautes de frappe, infinitifs : « Bonjour, pourrais-tu s'il te plaît écrire à Marie que je suis en retard ? », « slt jpeu avoir un sondage pizza ou sushi stp ») et **demande de reformuler** quand il ne comprend pas. Son contexte est **le message précédent seulement** (`mem` : sujet, bouton proposé, brouillon) : « non, plutôt à Marc », « plutôt anonyme », « ajoute mercredi », « plutôt à 15h » retouchent le brouillon qui précède ; après un autre message, plus de contexte.
Quand une demande est une action, il la transmet à **Talk2Piaf Actions** (`assistant-actions-kb.js` : sondages, listes, recherche filtrée, groupe ; `assistant-actions.js` : exécution). Il peut être appelé **de partout** : l'écran Talk2Piaf (`#/talk2piaf`) ou « @Talk2Piaf … » dans n'importe quelle discussion, où il lit l'état réel de la discussion (membres et rôles, sondages et listes via `Piaf.ext.snapshot`) et respecte les règles de la migration 009 (sondage de 2 à 12 options, question 300 caractères, option 100 ; liste de 50 éléments à la création, 100 au total ; droits des membres ; suppression par `delete_message_for_all` après confirmation).
**Actions** : message (à une personne ou à un groupe), sondage, liste, ajout / cochage / attribution dans une liste, clôture d'un sondage, rendez-vous dans le calendrier (.ics, Google Agenda, Outlook), suivi d'un fichier GitHub, blocage / déblocage, thème, favori / archive / silence, confirmations de lecture, notifications, recherche dans la conversation, messages épinglés.
**Deux modes de validation** (Paramètres → Assistant Talk2Piaf → Actions) :
- *Aperçu modifiable* (par défaut) : le bouton ouvre un aperçu où tout se change avant de valider — texte du message, **destinataire et lieu d'envoi** (discussion ou groupe), question, options et paramètres d'un sondage (choix multiple, anonyme, options ouvertes, durée), titre, éléments et droits d'une liste, titre, dates et lieu d'un évènement, personne à bloquer. Rien n'est fait avant « Valider ».
- *Direct* : une demande claire est exécutée tout de suite (message, sondage, liste…), puis **« Modifier »** (message : édition en place ; sondage ou liste : aperçu prérempli qui remplace la version publiée) et **« Annuler »** (suppression pour tous, déblocage…) restent disponibles. Si la destination d'un sondage ou d'une liste est inconnue, l'aperçu s'ouvre quand même.
Les actions **réversibles** (thème, favori, archive, silence…) sont toujours exécutées tout de suite, avec « Annuler ». Aucune action ne s'exécute dans le moteur : il ne fait que préparer, l'interface exécute.
Tests : `node tests/assistant-kb.test.js` (sujets et puces), `node tests/assistant-actions-kb.test.js` (sondages, listes, recherche), `node tests/assistant-context.test.js` (compréhension et contexte), `node tests/actions-rpc.test.js` (chaque appel serveur de `assistant-actions.js` est comparé aux signatures des migrations ; aperçus, mode direct, annulation, modification, échanges locaux).

Tests des connecteurs : `node tests/assistant-calendar.test.js`, `node tests/connectors-kb.test.js` et `node --experimental-strip-types tests/watch-lib.test.mjs` (ce dernier accepte `LIVE=1 LIVE_REPO=… LIVE_PATH=…` pour un essai réel contre GitHub).

Tests du moteur Talk2Piaf : voir ci-dessus (sans dépendance). Toute modification de `TOPICS` doit les laisser au vert : en particulier, chaque question proposée en puce doit renvoyer à son propre sujet.

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

### Exécutés (16/10/2026, base de données Supabase, comptes fictifs, tout annulé ensuite)
Réussis : inscription directe refusée ; création automatique des profils ; recherche par identifiant ; création de conversation (idempotente) ; un tiers ne voit ni conversations, ni messages, ni ne peut écrire dans la conversation ; écriture directe dans les tables refusée ; modification et suppression « pour tous » refusées à qui n'est pas l'auteur, acceptées pour l'auteur ; réservation photo valide ; photo > 10 Mo, vidéo > 25 Mo, PDF, SVG, plus de 10 fichiers refusés ; réservation par un tiers refusée ; 3 vidéos de 25 Mo acceptées puis dépassement des 100 Mo refusé (quota exact) ; envoi refusé après blocage. Vérification de sécurité Supabase : aucun problème critique (les avertissements listés concernent les fonctions volontairement appelables par les utilisateurs connectés, qui vérifient elles-mêmes l'identité).

### Groupes (17/10/2026, base de données, comptes fictifs, tout annulé ensuite)
Réussis : création avec personnes issues de ses discussions ; candidat sans conversation commune refusé ; candidat bloqué refusé (création et ajout) ; non-membre : ni lecture, ni envoi, ni liste des membres ; ajout/renommage/promotion réservés aux administrateurs ; seul le créateur peut retirer ou rétrograder un administrateur ; suppression « pour tous » d'un message par un administrateur, refusée à un simple membre ; accusés de lecture visibles ; retiré ou parti : plus d'accès ni d'envoi ; transfert automatique du rôle d'administrateur au départ du dernier ; dernier membre ne peut pas quitter (il supprime le groupe). **Défaut trouvé** : l'historique antérieur à l'arrivée n'était masqué que dans la vue de l'application, pas au niveau des tables → correctif intégré à la migration 009. Aucune fonction n'est appelable sans connexion.

### Non exécutés
Tout ce qui passe par le navigateur ou les Edge Functions (l'environnement de développement ne pouvait pas les appeler) : inscription et connexion réelles, persistance de session, verrouillage après essais ratés, envoi réel de fichiers et contrôle de leur taille réelle, téléchargement sans effet sur le quota, suppression réelle d'un fichier et libération du quota, accès aux fichiers par un tiers, temps réel, accusés de lecture à l'écran, coupure réseau, écran étroit avec clavier, GitHub Pages en sous-répertoire. Non testables sans appareil réel : clavier virtuel iOS/Android, notifications, installation PWA, lecture HEIC/MOV.

## Sécurité : rappels
- RLS activée sur toutes les tables ; les clients n'ont que des droits de lecture (et la mise à jour de quelques réglages personnels). Toute écriture passe par des fonctions qui vérifient membre/auteur/blocage.
- Aucun secret dans le dépôt : la clé `service_role` et `PIAF_PEPPER` ne vivent que dans Supabase.
- Les liens sont limités à http(s) avec `rel="noopener noreferrer nofollow"` ; aucun contenu utilisateur n'est injecté en HTML ; les SVG ne sont pas acceptés comme médias.
- Les URL de médias sont signées et expirent (10 min).

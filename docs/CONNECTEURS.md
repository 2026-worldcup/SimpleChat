# Connecteurs de Piaf : agendas et suivi de fichiers

Document rédigé le 18/10/2026. Il explique ce qui est faisable, ce qui est livré, ce qu'il faut faire pour l'activer, et ce qui reste à décider. Piaf reste utilisable **sans e-mail et sans compte externe** : aucun connecteur n'est obligatoire.

## 1. Faisabilité en un coup d'œil

| Fonction | Verdict | Livré ? | Ce que ça demande |
|---|---|---|---|
| Ajouter un évènement au calendrier (Apple, Samsung, Outlook, Google…) en un appui | Faisable, simple | **Oui** | Rien : ni compte, ni serveur, ni clé. |
| Écrire directement dans l'agenda Google ou Outlook de la personne, sans validation | Faisable, mais lourd | Non | Une application déclarée chez Google et chez Microsoft, le stockage d'une autorisation par personne sur le serveur, et (Google) une validation de l'application. Détails au §5. |
| Suivre un dépôt, dossier ou fichier **GitHub public** | Faisable | **Oui** (mise en route au §3) | Une migration SQL, une fonction serveur, une tâche planifiée. |
| Suivre un fichier GitHub **privé** | Faisable | Non | Un jeton GitHub par personne, à stocker chiffré sur le serveur. |
| Suivre Google Docs, Sheets, Slides, Drive | Faisable | Non | Relier le compte Google de chaque personne (§5). |
| Suivre Word, Excel, PowerPoint sur OneDrive ou SharePoint | Faisable | Non | Relier le compte Microsoft de chaque personne (§5). Les fichiers Office qui restent sur un ordinateur ne peuvent pas être suivis. |

Pourquoi « ajouter un évènement » n'écrit pas tout seul dans l'agenda : pour écrire sans validation, Piaf devrait détenir une autorisation d'accès à votre compte Google ou Microsoft. Le fichier .ics et les liens préremplis font la même chose pour vous en un appui, sans que Piaf n'ait jamais accès à votre agenda.

## 2. Ce qui est livré

### Calendrier (Talk2Piaf)
Exemples à écrire :
- « ajoute au calendrier dentiste demain à 14h »
- « mets dans l'agenda dîner chez Marie samedi 20h »
- « rdv coiffeur jeudi de 17h à 18h30 »
- « rappelle-moi d'appeler Marie après-demain à 9h »
- si la date manque : « ajoute au calendrier dentiste », puis l'assistant demande le jour, et vous répondez « demain 14h ».

L'assistant prépare l'évènement (titre, jour, heure, durée 1 h par défaut, « toute la journée » sans heure) et propose trois boutons : **.ics** (téléchargement, à ouvrir pour l'ajouter), **Google Agenda**, **Outlook**. L'évènement n'est enregistré qu'après votre validation dans votre calendrier.
Depuis une discussion (« @Talk2Piaf … »), la demande et la réponse restent sur l'appareil, et **rien n'est publié** dans la discussion. Un aperçu modifiable (titre, début, fin, lieu) précède l'ouverture du fichier ou du lien. Les heures sont comprises dans le fuseau horaire de l'appareil ; le fichier .ics est écrit en heure universelle, donc juste partout.

### Suivi de fichiers GitHub (Talk2Piaf)
Exemples à écrire :
- « suis https://github.com/propriétaire/dépôt/blob/main/README.md » (un fichier)
- « suis https://github.com/propriétaire/dépôt/tree/main/docs » (un dossier)
- « suis https://github.com/propriétaire/dépôt » (tout le dépôt)
- « mes suivis » (liste, avec un bouton « Arrêter » par suivi)

Le serveur vérifie environ **toutes les 15 minutes**. La première vérification sert de point de départ et ne dit rien. Ensuite :
- Le suivi est **personnel** (même s'il est demandé depuis une discussion) : une alerte arrive dans la discussion Talk2Piaf (au démarrage de l'application, au retour au premier plan, ou toutes les 5 minutes quand elle est ouverte), avec une notification locale. La fonction serveur `watch_add` sait encore publier dans une discussion (paramètre `p_conv`) mais l'application ne l'utilise plus : les réponses de l'assistant ne sont plus publiées.

Limites : 10 suivis par personne, 5 par discussion ; dépôts publics seulement ; un suivi s'arrête tout seul après 3 vérifications ratées de suite (dépôt introuvable ou devenu privé) et la personne est prévenue ; les administrateurs d'un groupe peuvent arrêter tous les suivis du groupe.

### Word, Excel, Google Docs : ce que répondent les assistants
Ils expliquent honnêtement que ce n'est pas encore disponible, pourquoi, et rappellent deux solutions : les notifications propres à Google / OneDrive-SharePoint, et le suivi GitHub (un fichier Word ou Excel stocké dans un dépôt GitHub public peut déjà être suivi).

## 3. Mise en route du suivi GitHub

**État sur le projet SimpleChat (khnttjcatqafnrbarzdg) : en service depuis le 2026-10-19.** Migrations 010 et 011 appliquées, extensions `pg_cron` et `pg_net` activées, fonction `watch` déployée (sans vérification de jeton de personne), tâche `piaf-watch` toutes les 15 minutes. Contrôle fait : la fonction répond 200 avec le bon secret et 403 avec un mauvais.

Pour un autre projet Supabase :
1. Activez `pg_cron` et `pg_net` (Database → Extensions).
2. Exécutez `010_watchers.sql`, puis déployez la fonction : `supabase functions deploy watch --no-verify-jwt --project-ref <REF>`.
3. Exécutez `011_watch_cron.sql` (après avoir remplacé l'adresse du projet dans le fichier) : il génère au hasard le secret d'appel, le garde dans le coffre Vault (la fonction le relit par `watch_secret()`, réservée au rôle `service_role`) et programme la tâche. Personne n'a de secret à recopier.
4. Facultatif mais recommandé : `supabase secrets set GITHUB_TOKEN=<jeton> --project-ref <REF>` avec un jeton GitHub « fine-grained » en lecture seule des dépôts publics (aucune autre permission). Sans lui, GitHub limite à 60 requêtes par heure pour tout le serveur ; avec lui, 5 000.
5. Vérification : dans Talk2Piaf, « suis https://github.com/<un dépôt public> », puis modifiez ce dépôt : l'alerte arrive en 15 minutes au plus. Pour surveiller le serveur : `select * from cron.job_run_details order by start_time desc limit 5;`.

Ne jamais mettre `GITHUB_TOKEN` ni la clé `service_role` dans le dépôt ou dans `config.js`.

## 4. Limites connues
- Pas de notification quand l'application est fermée (voir le README : il faudrait Web Push) ; les alertes personnelles attendent l'ouverture de l'application, les messages de groupe arrivent comme n'importe quel message.
- Une branche dont le nom contient « / » (par exemple `feature/x`) dans une adresse GitHub est mal interprétée : la branche principale (main, master) est toujours bien gérée.
- Les messages de modification reprennent le titre du commit et le nom de l'auteur, nettoyés (liens remplacés par « [lien] »).
- Les suivis d'un groupe sont publiés au nom de leur créateur ; si cette personne quitte le groupe, le suivi continue sans rien publier (un administrateur peut l'arrêter).

## 5. Pour aller plus loin : relier un compte Google ou Microsoft (non livré)

Rien de ce qui suit n'est branché, et je n'ai pas pu le tester ici (il faut de vrais comptes et des applications déclarées). Voici ce que cela demanderait, vérifié dans la documentation officielle le 18/10/2026.

**Ce que vous auriez à créer vous-même**
- Chez **Google** : un projet Google Cloud, les API Calendar et/ou Drive activées, un « écran de consentement OAuth » et un identifiant OAuth.
- Chez **Microsoft** : une inscription d'application (Microsoft Entra) acceptant les comptes personnels et professionnels, avec les autorisations Calendars.ReadWrite (agenda) et Files.Read (fichiers). C'est gratuit.
- Côté Piaf : une fonction serveur qui reçoit le retour de connexion, et le stockage chiffré (Supabase Vault) d'une autorisation par personne.

**Contraintes à connaître**
- **Google, agenda** : l'autorisation d'écrire dans un agenda est classée « sensible » ; tant que l'application est en mode test (100 comptes maximum, ajoutés à la main), l'autorisation expire au bout de **7 jours** (reconnexion hebdomadaire) ; la publier suppose une validation par Google, qui prend plusieurs semaines.
- **Google, suivi de fichiers** : les notifications instantanées de Drive durent 1 jour par fichier et exigent de prouver la propriété du domaine qui les reçoit, ce qui est impossible sur une adresse `supabase.co`. La voie réaliste est de **vérifier régulièrement** (comme pour GitHub), avec une autorisation de lecture elle aussi soumise à validation.
- **Microsoft, suivi de fichiers** : les notifications existent (jusqu'à 30 jours, à renouveler ; sur un OneDrive personnel elles couvrent n'importe quel dossier, sur un compte professionnel seulement la racine) ; la vérification régulière par « delta » est aussi possible.
- **Confidentialité** : stocker des autorisations Google / Microsoft sur le serveur change la nature de Piaf (aujourd'hui, le serveur ne détient aucun accès à vos autres comptes) et obligerait à mettre à jour la page de confidentialité et à faire un choix clair d'activation par personne.

**Ordre que je recommande** (à vous de décider) : 1) Microsoft Graph pour l'agenda Outlook et le suivi OneDrive/SharePoint (gratuit, sans validation de l'application) ; 2) Google en mode test pour un petit groupe d'amis, en acceptant la reconnexion hebdomadaire ; 3) Google en production seulement si Piaf s'ouvre à un large public.

## 6. Notes pour les développeurs

| Élément | Où |
|---|---|
| Analyse des dates, .ics, liens Google / Outlook, réponse partagée | `assistant-calendar.js` (module commun, testé sous Node) |
| Adresses GitHub, réponses de suivi | `assistant-watch.js` (module commun) |
| Branchement dans les moteurs | `HANDLERS` (premières entrées) et sujets `cal_howto`, `connect_status`, `watch_howto`, `watch_office` dans `assistant-kb.js` |
| Actions de boutons | `cal_ics`, `cal_google`, `cal_outlook`, `watch_add`, `watch_list`, `watch_stop` : `assistant.js` (appareil, suivi) et `assistant-actions.js` (aperçus modifiables : agenda) ; fonctions partagées `Piaf.calOpen` et `Piaf.watchOps` |
| Alertes personnelles | `pullWatchEvents()` dans `assistant.js` (fonction serveur `my_watch_events`) |
| Serveur | `supabase/migrations/010_watchers.sql`, `supabase/functions/watch/` (`lib.ts` : logique pure ; `index.ts` : appel par pg_cron) |
| Erreurs lisibles | `too_many_watches` et `not_enabled` dans `app.js` (`not_enabled` = migration 010 pas encore appliquée) |

Tests : `node tests/assistant-calendar.test.js`, `node tests/connectors-kb.test.js`, `node --experimental-strip-types tests/watch-lib.test.mjs` (avec `LIVE=1 LIVE_REPO=propriétaire/dépôt LIVE_PATH=README.md` pour interroger le vrai GitHub), plus les tests existants. La migration 010 a été vérifiée sur une base PostgreSQL 16 locale (51 contrôles : droits, limites, groupes, blocage, arrêt après 3 échecs, alertes remises une seule fois).
Les connecteurs sont des entrées en tête de `HANDLERS` et des sujets de `assistant-kb.js`.

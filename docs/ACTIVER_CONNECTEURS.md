# Activer le suivi de fichiers GitHub (à copier-coller à l'IA qui a accès à Supabase)

Le code est déjà en ligne (branche `main`). Le calendrier fonctionne sans rien faire. Le **suivi GitHub** s'active avec les 5 actions ci-dessous, sur le projet Supabase **SimpleChat** (`khnttjcatqafnrbarzdg`). Tant que la migration n'est pas appliquée, le bouton « Suivre » affiche simplement « pas encore activé ».

## Message à donner à l'IA

> Sur le projet Supabase SimpleChat (khnttjcatqafnrbarzdg), dépôt 2026-worldcup/simplechat, branche main :
> 1. Applique la migration `supabase/migrations/010_watchers.sql` (nom : `010_watchers`). Les colonnes et fonctions utilisées ont déjà été vérifiées sur la vraie base.
> 2. Active les extensions `pg_cron` et `pg_net` (elles sont disponibles, pas encore installées).
> 3. Choisis une valeur aléatoire de 40 caractères, enregistre-la comme secret de fonction `WATCH_SECRET`.
> 4. Déploie la fonction `supabase/functions/watch` (fichiers `index.ts` et `lib.ts`) avec la vérification JWT désactivée (`--no-verify-jwt`).
> 5. Exécute la section « planification » en bas de `010_watchers.sql` : crée les deux secrets Vault `piaf_watch_url` (`https://khnttjcatqafnrbarzdg.supabase.co/functions/v1/watch`) et `piaf_watch_secret` (la même valeur que `WATCH_SECRET`), puis `cron.schedule('piaf-watch', '*/15 * * * *', …)`.
> Vérifie ensuite avec le `curl` de `docs/CONNECTEURS.md` (étape 6) que la fonction répond 401 sans secret et 200 avec.

## Vérifier que tout marche
Dans Talk2Piaf : « suis https://github.com/2026-worldcup/simplechat/blob/main/README.md » → bouton « Suivre » → la liste de vos suivis le montre. La première vérification ne dit rien (simple point de départ) ; une alerte arrive à la prochaine modification du fichier.

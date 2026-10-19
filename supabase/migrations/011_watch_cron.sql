-- Piaf — 011 : mise en route automatique du suivi de fichiers (aucune manipulation manuelle).
-- À appliquer APRÈS 010 et après le déploiement de l'Edge Function `watch`. Prérequis : extensions pg_cron et pg_net activées.
--  * le secret qui protège l'appel de la fonction est généré ici, au hasard, et gardé dans le coffre (Vault) : personne n'a à le connaître ni à le recopier ;
--  * l'Edge Function le relit par `watch_secret()` (réservée au rôle service_role) ;
--  * la tâche `piaf-watch` appelle la fonction toutes les 15 minutes (la relancer ne crée pas de doublon).
-- Si le projet n'est pas khnttjcatqafnrbarzdg, remplacer l'adresse ci-dessous.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'piaf_watch_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'piaf_watch_secret', 'Secret d''appel de la fonction watch');
  end if;
  if not exists (select 1 from vault.secrets where name = 'piaf_watch_url') then
    perform vault.create_secret('https://khnttjcatqafnrbarzdg.supabase.co/functions/v1/watch', 'piaf_watch_url', 'Adresse de la fonction watch');
  end if;
end $$;

create or replace function public.watch_secret() returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'piaf_watch_secret' limit 1
$$;
revoke all on function public.watch_secret() from public, anon, authenticated;
grant execute on function public.watch_secret() to service_role;

select cron.schedule('piaf-watch', '*/15 * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'piaf_watch_url'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-watch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'piaf_watch_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 55000)
$job$);

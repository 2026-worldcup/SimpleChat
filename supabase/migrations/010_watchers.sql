-- Piaf — 010 : suivi de fichiers (dépôts GitHub publics) pour Talk2Piaf et Talk2Piaf Cowork.
-- À appliquer APRÈS 009. Principes :
--  * un suivi est créé à l'appui d'un bouton de l'assistant ; il appartient à la personne qui l'a créé ;
--  * suivi personnel (conversation_id nul, Talk2Piaf) : le serveur dépose une « alerte » que l'application de la personne vient chercher ;
--  * suivi de discussion (Talk2Piaf Cowork) : le serveur publie un message de type « assistant » dans la discussion, au nom de la personne qui a créé le suivi ;
--  * le serveur ne lit que des informations publiques (dépôts publics GitHub) : aucun jeton de personne n'est stocké ;
--  * la vérification est faite par l'Edge Function `watch` (voir supabase/functions/watch), appelée toutes les 15 minutes par pg_cron.
-- Les tables ne sont accessibles qu'à travers les fonctions ci-dessous (RLS activée, aucune politique, aucun droit direct).

insert into public.app_config(key, value, description) values
  ('watch_max_per_user',         10, 'Nombre maximal de suivis de fichiers par personne'),
  ('watch_max_per_conversation',  5, 'Nombre maximal de suivis de fichiers par discussion ou groupe'),
  ('watch_interval_minutes',     15, 'Délai entre deux vérifications d''un même fichier suivi')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- 1. tables
create table public.file_watches (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,   -- nul : suivi personnel
  provider        text not null check (provider in ('github')),
  ref             jsonb not null,                                               -- github : { owner, repo, path?, branch? }
  label           text not null check (char_length(label) between 1 and 200),
  active          boolean not null default true,
  last_sha        text,                                                         -- dernière version vue (nul tant que la première vérification n'a pas eu lieu)
  last_etag       text,
  last_checked_at timestamptz,
  last_change_at  timestamptz,
  error_count     integer not null default 0,
  created_at      timestamptz not null default now()
);
create unique index file_watches_unique on public.file_watches (owner_id, coalesce(conversation_id, '00000000-0000-0000-0000-000000000000'::uuid), provider, (ref::text));
create index file_watches_due_idx on public.file_watches (last_checked_at nulls first) where active;
create index file_watches_conv_idx on public.file_watches (conversation_id) where conversation_id is not null;

create table public.file_watch_events (
  id           bigint generated always as identity primary key,
  watch_id     uuid references public.file_watches(id) on delete cascade,
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  body         text not null check (char_length(body) <= 1500),
  url          text check (url is null or (char_length(url) <= 500 and url ~ '^https://')),
  created_at   timestamptz not null default now(),
  delivered_at timestamptz
);
create index file_watch_events_owner_idx on public.file_watch_events (owner_id) where delivered_at is null;

alter table public.file_watches enable row level security;          -- aucune politique : accès par les fonctions seulement
alter table public.file_watch_events enable row level security;
revoke all on public.file_watches, public.file_watch_events from public, anon, authenticated;
grant select, insert, update, delete on public.file_watches, public.file_watch_events to service_role;

-- ---------------------------------------------------------------- 2. fonctions appelées par l'application (personne connectée)
create or replace function public.watch_add(p_conv uuid, p_provider text, p_ref jsonb, p_label text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid(); v_owner text; v_repo text; v_path text; v_branch text; v_ref jsonb; v_label text; v_id uuid;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;
  if p_provider is distinct from 'github' or p_ref is null or jsonb_typeof(p_ref) <> 'object' then raise exception 'invalid_input'; end if;
  v_owner := p_ref ->> 'owner'; v_repo := p_ref ->> 'repo'; v_path := nullif(btrim(coalesce(p_ref ->> 'path', ''), '/'), ''); v_branch := nullif(coalesce(p_ref ->> 'branch', ''), '');
  if v_owner is null or v_owner !~ '^[A-Za-z0-9]([A-Za-z0-9-]{0,38})$' then raise exception 'invalid_input'; end if;
  if v_repo is null or v_repo !~ '^[A-Za-z0-9._-]{1,100}$' or v_repo in ('.', '..') then raise exception 'invalid_input'; end if;
  if v_path is not null and (char_length(v_path) > 300 or v_path ~ '[[:cntrl:]]' or v_path ~ '(^|/)\.\.(/|$)') then raise exception 'invalid_input'; end if;
  if v_branch is not null and (v_branch !~ '^[A-Za-z0-9._/-]{1,100}$' or v_branch ~ '\.\.') then raise exception 'invalid_input'; end if;
  v_ref := jsonb_strip_nulls(jsonb_build_object('owner', v_owner, 'repo', v_repo, 'path', v_path, 'branch', v_branch));
  v_label := btrim(regexp_replace(coalesce(p_label, ''), '[[:cntrl:]]+', ' ', 'g'));
  if v_label = '' then v_label := v_owner || '/' || v_repo || coalesce('/' || v_path, ''); end if;
  v_label := left(v_label, 200);

  if p_conv is not null and not public.is_member(p_conv) then raise exception 'forbidden'; end if;
  select id into v_id from public.file_watches
   where owner_id = v_me and conversation_id is not distinct from p_conv and provider = 'github' and ref = v_ref;
  if v_id is not null then
    update public.file_watches set active = true, error_count = 0, label = v_label where id = v_id;
    return v_id;
  end if;
  if (select count(*) from public.file_watches where owner_id = v_me and active) >= public.cfg('watch_max_per_user') then raise exception 'too_many_watches'; end if;
  if p_conv is not null and (select count(*) from public.file_watches where conversation_id = p_conv and active) >= public.cfg('watch_max_per_conversation') then raise exception 'too_many_watches'; end if;
  insert into public.file_watches(owner_id, conversation_id, provider, ref, label) values (v_me, p_conv, 'github', v_ref, v_label) returning id into v_id;
  return v_id;
end $$;

create or replace function public.watch_list(p_conv uuid default null)
returns table(id uuid, provider text, ref jsonb, label text, active boolean, mine boolean, owner_name text, last_change_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_conv is not null and not public.is_member(p_conv) then raise exception 'forbidden'; end if;
  return query
    select w.id, w.provider, w.ref, w.label, w.active, (w.owner_id = auth.uid()), p.display_name, w.last_change_at, w.created_at
    from public.file_watches w join public.profiles p on p.id = w.owner_id
    where (p_conv is null and w.conversation_id is null and w.owner_id = auth.uid()) or (p_conv is not null and w.conversation_id = p_conv)
    order by w.created_at desc;
end $$;

create or replace function public.watch_remove(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare w public.file_watches%rowtype;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into w from public.file_watches where id = p_id;
  if not found then raise exception 'not_found'; end if;
  if w.owner_id <> auth.uid() and not (w.conversation_id is not null and public.is_group_admin(w.conversation_id)) then raise exception 'forbidden'; end if;
  delete from public.file_watches where id = p_id;
end $$;

-- Alertes des suivis personnels : remises une seule fois (marquées comme remises au moment de la lecture).
create or replace function public.my_watch_events() returns table(id bigint, body text, url text, created_at timestamptz)
language sql volatile security definer set search_path = '' as $$
  with picked as (
    select e.id from public.file_watch_events e where e.owner_id = auth.uid() and e.delivered_at is null order by e.created_at, e.id limit 50 for update skip locked
  ), done as (
    update public.file_watch_events e set delivered_at = now() from picked where e.id = picked.id returning e.id, e.body, e.url, e.created_at
  )
  select d.id, d.body, d.url, d.created_at from done d order by d.created_at, d.id;
$$;

-- ---------------------------------------------------------------- 3. fonctions réservées au serveur (Edge Function `watch`, rôle service_role)
-- Publie un message « assistant » au nom d'une personne, sans passer par auth.uid() (le serveur n'est personne).
create or replace function public._post_as(p_conv uuid, p_sender uuid, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_other uuid; v_id uuid;
begin
  if not exists (select 1 from public.conversation_members m where m.conversation_id = p_conv and m.user_id = p_sender) then return null; end if;
  if exists (select 1 from public.conversations c where c.id = p_conv and c.kind = 'direct') then
    select m.user_id into v_other from public.conversation_members m where m.conversation_id = p_conv and m.user_id <> p_sender limit 1;
    if v_other is not null and public.is_blocked(p_sender, v_other) then return null; end if;
  end if;
  insert into public.messages(conversation_id, sender_id, client_id, kind, body) values (p_conv, p_sender, gen_random_uuid(), 'assistant', left(btrim(p_body), 1500)) returning id into v_id;
  update public.conversations set last_message_at = now(), last_message_id = v_id where id = p_conv;
  update public.conversation_members set archived = false where conversation_id = p_conv and user_id <> p_sender;
  return v_id;
end $$;

-- Réserve (verrouille) les suivis à vérifier maintenant ; deux exécutions simultanées ne prennent jamais le même suivi.
create or replace function public.watch_due(p_limit integer default 20)
returns table(id uuid, provider text, ref jsonb, last_sha text, last_etag text)
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.file_watch_events e where e.created_at < now() - interval '30 days';
  return query
    with c as (
      select w.id from public.file_watches w
      where w.active and (w.last_checked_at is null or w.last_checked_at < now() - make_interval(mins => greatest(public.cfg('watch_interval_minutes')::int - 1, 1)))
      order by w.last_checked_at nulls first limit greatest(1, least(coalesce(p_limit, 20), 50)) for update skip locked
    )
    update public.file_watches w set last_checked_at = now() from c where w.id = c.id
    returning w.id, w.provider, w.ref, w.last_sha, w.last_etag;
end $$;

-- Résultat d'une vérification.
--  p_error non nul : la vérification a échoué pour une raison durable (dépôt introuvable ou privé…) ; après 3 échecs de suite le suivi s'arrête et la personne est prévenue.
--  p_sha nul sans erreur : rien de nouveau (réponse « non modifié »).
--  Première vérification (last_sha nul) : on note la version actuelle sans rien annoncer.
create or replace function public.watch_report(p_id uuid, p_sha text, p_etag text, p_body text, p_url text, p_error text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare w public.file_watches%rowtype; v_msg text;
begin
  select * into w from public.file_watches where id = p_id for update;
  if not found or not w.active then return; end if;
  if p_error is not null then
    if w.error_count + 1 >= 3 then
      update public.file_watches set active = false, error_count = error_count + 1 where id = p_id;
      v_msg := left('⏹️ Suivi arrêté : « ' || w.label || ' » est introuvable ou n’est pas public. Vous pouvez le relancer avec un lien valide.', 1500);
      if w.conversation_id is null then insert into public.file_watch_events(watch_id, owner_id, body) values (null, w.owner_id, v_msg);
      else perform public._post_as(w.conversation_id, w.owner_id, v_msg); end if;
    else
      update public.file_watches set error_count = error_count + 1 where id = p_id;
    end if;
    return;
  end if;
  update public.file_watches set error_count = 0, last_etag = coalesce(p_etag, last_etag) where id = p_id;
  if p_sha is null or p_sha = w.last_sha then return; end if;
  update public.file_watches set last_sha = p_sha, last_change_at = case when w.last_sha is null then last_change_at else now() end where id = p_id;
  if w.last_sha is null or p_body is null or btrim(p_body) = '' then return;     -- première vérification : simple point de départ
  end if;
  if w.conversation_id is null then
    insert into public.file_watch_events(watch_id, owner_id, body, url) values (p_id, w.owner_id, left(p_body, 1500), case when p_url ~ '^https://' then left(p_url, 500) end);
  else
    perform public._post_as(w.conversation_id, w.owner_id, p_body);
  end if;
end $$;

-- ---------------------------------------------------------------- 4. droits
revoke all on function public.watch_add(uuid, text, jsonb, text), public.watch_list(uuid), public.watch_remove(uuid), public.my_watch_events() from public, anon;
grant execute on function public.watch_add(uuid, text, jsonb, text), public.watch_list(uuid), public.watch_remove(uuid), public.my_watch_events() to authenticated;
revoke all on function public._post_as(uuid, uuid, text), public.watch_due(integer), public.watch_report(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public._post_as(uuid, uuid, text), public.watch_due(integer), public.watch_report(uuid, text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------- 5. planification (à exécuter UNE fois, après avoir déployé l'Edge Function `watch` ; voir docs/CONNECTEURS.md)
-- Prérequis : extensions pg_cron et pg_net activées (Database → Extensions), secret WATCH_SECRET défini sur la fonction.
--   select vault.create_secret('https://<REF>.supabase.co/functions/v1/watch', 'piaf_watch_url');
--   select vault.create_secret('<la même valeur que WATCH_SECRET>', 'piaf_watch_secret');
--   select cron.schedule('piaf-watch', '*/15 * * * *', $$
--     select net.http_post(
--       url := (select decrypted_secret from vault.decrypted_secrets where name = 'piaf_watch_url'),
--       headers := jsonb_build_object('Content-Type', 'application/json', 'x-watch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'piaf_watch_secret')),
--       body := '{}'::jsonb, timeout_milliseconds := 55000) $$);

-- Piaf — 002 : logique serveur (RPC). Toutes les écritures passent par ici : le navigateur n'écrit jamais
-- directement dans messages / media / conversations. Les erreurs sont des codes courts traduits par le client.

-- ---------------------------------------------------------------- helpers
create function public.cfg(p_key text) returns bigint
language sql stable security definer set search_path = '' as $$
  select value from public.app_config where key = p_key;
$$;

create function public.is_member(p_conv uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.conversations c where c.id = p_conv and auth.uid() in (c.user_a, c.user_b));
$$;

create function public.shares_conversation(p_other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.conversations c
                 where (c.user_a = auth.uid() and c.user_b = p_other) or (c.user_b = auth.uid() and c.user_a = p_other));
$$;

create function public.other_member(p_conv uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select case when c.user_a = auth.uid() then c.user_b else c.user_a end
  from public.conversations c where c.id = p_conv;
$$;

create function public.is_blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.blocks k
                 where (k.blocker_id = a and k.blocked_id = b) or (k.blocker_id = b and k.blocked_id = a));
$$;

-- ---------------------------------------------------------------- recherche / démarrage
create function public.find_user(p_query text)
returns table(id uuid, public_id text, display_name text)
language plpgsql stable security definer set search_path = '' as $$
declare q text := btrim(coalesce(p_query, ''));
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if q ~ '^[0-9]{8}$' then
    return query select p.id, p.public_id, p.display_name from public.profiles p
                 where p.public_id = q and p.id <> auth.uid();
  elsif char_length(q) >= 3 then
    return query select p.id, p.public_id, p.display_name from public.profiles p
                 where lower(p.display_name) LIKE
  '%' || replace(
    replace(
      replace(lower(q), E'\\', E'\\\\'),
      '%', E'\\%'
    ),
    '_', E'\\_'
  ) || '%'
  ESCAPE E'\\'
  AND p.id <> auth.uid()
                 order by p.display_name limit 20;
  end if;
end $$;

create function public.start_conversation(p_public_id text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := auth.uid(); v_other uuid; v_conv uuid;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;
  select p.id into v_other from public.profiles p where p.public_id = btrim(coalesce(p_public_id, ''));
  if v_other is null or v_other = v_me then raise exception 'not_found'; end if;
  if public.is_blocked(v_me, v_other) then raise exception 'blocked'; end if;
  insert into public.conversations(user_a, user_b, created_by)
  values (least(v_me, v_other), greatest(v_me, v_other), v_me)
  on conflict (user_a, user_b) do nothing;
  select c.id into v_conv from public.conversations c
   where c.user_a = least(v_me, v_other) and c.user_b = greatest(v_me, v_other);
  insert into public.conversation_members(conversation_id, user_id)
  values (v_conv, v_me), (v_conv, v_other) on conflict do nothing;
  return v_conv;
end $$;

create function public.list_conversations()
returns table(conversation_id uuid, other_id uuid, other_public_id text, other_name text, nickname text,
              archived boolean, favorite boolean, muted boolean,
              last_message_id uuid, last_at timestamptz, last_kind text, last_body text,
              last_sender uuid, last_deleted boolean, unread int, blocked_by_me boolean)
language sql stable security invoker set search_path = '' as $$
  select c.id, o.id, o.public_id, o.display_name, cm.nickname, cm.archived, cm.favorite, cm.muted,
         lm.id, coalesce(lm.created_at, c.created_at), lm.kind, lm.body, lm.sender_id, (lm.deleted_at is not null),
         coalesce(u.n, 0)::int,
         exists (select 1 from public.blocks b where b.blocker_id = auth.uid() and b.blocked_id = o.id)
  from public.conversation_members cm
  join public.conversations c on c.id = cm.conversation_id
  join public.profiles o on o.id = case when c.user_a = auth.uid() then c.user_b else c.user_a end
  left join lateral (
    select m.* from public.messages m
    where m.conversation_id = c.id
      and (cm.cleared_at is null or m.created_at > cm.cleared_at)
      and not exists (select 1 from public.message_hidden h where h.message_id = m.id and h.user_id = auth.uid())
    order by m.created_at desc, m.id desc limit 1) lm on true
  left join lateral (
    select count(*) n from public.messages m
    where m.conversation_id = c.id and m.sender_id <> auth.uid() and m.deleted_at is null
      and m.created_at > cm.last_read_at
      and (cm.cleared_at is null or m.created_at > cm.cleared_at)
      and not exists (select 1 from public.message_hidden h where h.message_id = m.id and h.user_id = auth.uid())) u on true
  where cm.user_id = auth.uid() and (lm.id is not null or c.created_by = auth.uid())
  order by coalesce(lm.created_at, c.created_at) desc;
$$;

-- ---------------------------------------------------------------- messages
create function public.send_message(p_conv uuid, p_client_id uuid, p_body text,
                                    p_reply_to uuid default null, p_forwarded boolean default false)
returns public.my_messages
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := auth.uid(); v_other uuid; v_id uuid; v_body text := btrim(coalesce(p_body, '')); v_row public.my_messages;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;
  if not public.is_member(p_conv) then raise exception 'forbidden'; end if;
  if p_client_id is null or v_body = '' or char_length(v_body) > public.cfg('message_max_chars') then
    raise exception 'invalid_input';
  end if;
  -- Idempotence : un réessai avec le même client_id renvoie le message déjà enregistré.
  select m.id into v_id from public.messages m
   where m.conversation_id = p_conv and m.sender_id = v_me and m.client_id = p_client_id;
  if v_id is null then
    v_other := public.other_member(p_conv);
    if public.is_blocked(v_me, v_other) then raise exception 'blocked'; end if;
    if (select count(*) from public.messages m where m.sender_id = v_me and m.created_at > now() - interval '10 seconds') >= 15 then
      raise exception 'rate_limited';
    end if;
    if p_reply_to is not null and not exists
       (select 1 from public.messages r where r.id = p_reply_to and r.conversation_id = p_conv) then
      raise exception 'invalid_input';
    end if;
    insert into public.messages(conversation_id, sender_id, client_id, kind, body, reply_to, forwarded)
    values (p_conv, v_me, p_client_id, 'text', v_body, p_reply_to, coalesce(p_forwarded, false))
    returning id into v_id;
    update public.conversations set last_message_at = now(), last_message_id = v_id where id = p_conv;
    update public.conversation_members set archived = false where conversation_id = p_conv and user_id = v_other;
  end if;
  select * into v_row from public.my_messages where id = v_id;
  return v_row;
end $$;

create function public.edit_message(p_id uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.messages%rowtype; v_body text := btrim(coalesce(p_body, ''));
begin
  select * into m from public.messages where id = p_id;
  if not found or m.sender_id is distinct from auth.uid() then raise exception 'forbidden'; end if;
  if m.kind <> 'text' or m.deleted_at is not null then raise exception 'forbidden'; end if;
  if v_body = '' or char_length(v_body) > public.cfg('message_max_chars') then raise exception 'invalid_input'; end if;
  if m.created_at < now() - make_interval(mins => public.cfg('edit_window_minutes')::int) then raise exception 'window_expired'; end if;
  if public.is_blocked(m.sender_id, public.other_member(m.conversation_id)) then raise exception 'blocked'; end if;
  update public.messages set body = v_body, edited_at = now() where id = p_id;
end $$;

create function public.delete_message_for_me(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.messages%rowtype;
begin
  select * into m from public.messages where id = p_id;
  if not found or not public.is_member(m.conversation_id) then raise exception 'forbidden'; end if;
  insert into public.message_hidden(message_id, user_id) values (p_id, auth.uid()) on conflict do nothing;
  insert into public.media_hidden(media_id, user_id)
    select d.id, auth.uid() from public.media d where d.message_id = p_id on conflict do nothing;
end $$;

-- Texte uniquement : la suppression d'un média pour tous passe par l'Edge Function `media` (suppression réelle du fichier).
create function public.delete_message_for_all(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.messages%rowtype;
begin
  select * into m from public.messages where id = p_id;
  if not found or m.sender_id is distinct from auth.uid() then raise exception 'forbidden'; end if;
  if m.kind <> 'text' then raise exception 'use_media_delete'; end if;
  if m.deleted_at is not null then return; end if;
  if m.created_at < now() - make_interval(mins => public.cfg('delete_all_window_minutes')::int) then raise exception 'window_expired'; end if;
  update public.messages set body = null, deleted_at = now(), pinned_at = null where id = p_id;
  delete from public.reactions where message_id = p_id;
end $$;

create function public.pin_message(p_id uuid, p_pin boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.messages%rowtype;
begin
  select * into m from public.messages where id = p_id;
  if not found or not public.is_member(m.conversation_id) or m.deleted_at is not null then raise exception 'forbidden'; end if;
  if p_pin and (select count(*) from public.messages x where x.conversation_id = m.conversation_id and x.pinned_at is not null) >= 5 then
    raise exception 'too_many_pins';
  end if;
  update public.messages set pinned_at = case when p_pin then now() else null end where id = p_id;
end $$;

create function public.react(p_msg uuid, p_emoji text) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.messages%rowtype; v_me uuid := auth.uid(); v_current text;
begin
  select * into m from public.messages where id = p_msg and deleted_at is null;
  if not found or not public.is_member(m.conversation_id) then raise exception 'forbidden'; end if;
  if public.is_blocked(v_me, public.other_member(m.conversation_id)) then raise exception 'blocked'; end if;
  select r.emoji into v_current from public.reactions r where r.message_id = p_msg and r.user_id = v_me;
  if p_emoji is null or p_emoji = v_current then
    delete from public.reactions where message_id = p_msg and user_id = v_me;
  else
    insert into public.reactions(message_id, user_id, conversation_id, emoji)
    values (p_msg, v_me, m.conversation_id, p_emoji)
    on conflict (message_id, user_id) do update set emoji = excluded.emoji, created_at = now();
  end if;
end $$;

-- ---------------------------------------------------------------- statuts : envoyé → distribué → lu
-- Envoyé    : la ligne existe en base (réponse du serveur).
-- Distribué : l'application du destinataire a reçu/chargé le message (mark_delivered_all) — pas une garantie d'affichage.
-- Lu        : le destinataire a ouvert la conversation, message visible (mark_read), ET ses accusés sont activés.
create function public.mark_delivered_all() returns void
language sql security definer set search_path = '' as $$
  update public.messages m set delivered_at = now()
  from public.conversations c
  where m.conversation_id = c.id and auth.uid() in (c.user_a, c.user_b)
    and m.sender_id <> auth.uid() and m.delivered_at is null;
$$;

create function public.mark_read(p_conv uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := auth.uid();
begin
  if not public.is_member(p_conv) then raise exception 'forbidden'; end if;
  update public.conversation_members set last_read_at = now() where conversation_id = p_conv and user_id = v_me;
  if coalesce((select s.read_receipts from public.user_settings s where s.user_id = v_me), true) then
    update public.messages set read_at = now(), delivered_at = coalesce(delivered_at, now())
     where conversation_id = p_conv and sender_id <> v_me and read_at is null;
  else
    update public.messages set delivered_at = now()
     where conversation_id = p_conv and sender_id <> v_me and delivered_at is null;
  end if;
end $$;

create function public.clear_history(p_conv uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member(p_conv) then raise exception 'forbidden'; end if;
  update public.conversation_members set cleared_at = now(), last_read_at = now()
   where conversation_id = p_conv and user_id = auth.uid();
end $$;

create function public.update_display_name(p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_name text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if char_length(v_name) not between 1 and 40 or v_name ~ '[[:cntrl:]]' then raise exception 'invalid_input'; end if;
  update public.profiles set display_name = v_name where id = auth.uid();
end $$;

-- ---------------------------------------------------------------- blocages et signalements
create function public.block_user(p_target uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_target is null or p_target = auth.uid() then raise exception 'invalid_input'; end if;
  if not public.shares_conversation(p_target) then raise exception 'forbidden'; end if;
  insert into public.blocks(blocker_id, blocked_id) values (auth.uid(), p_target) on conflict do nothing;
end $$;

create function public.unblock_user(p_target uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.blocks where blocker_id = auth.uid() and blocked_id = p_target;
$$;

create function public.list_blocked() returns table(user_id uuid, public_id text, display_name text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.public_id, p.display_name
  from public.blocks b join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = auth.uid() order by b.created_at desc;
$$;

create function public.report_content(p_target uuid, p_message uuid, p_reason text, p_details text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_snap text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_target is null or not public.shares_conversation(p_target) then raise exception 'forbidden'; end if;
  if (select count(*) from public.reports r where r.reporter_id = auth.uid() and r.created_at > now() - interval '1 day') >= 20 then
    raise exception 'rate_limited';
  end if;
  if p_message is not null then
    select m.body into v_snap from public.messages m
     where m.id = p_message and m.sender_id = p_target and public.is_member(m.conversation_id);
  end if;
  insert into public.reports(reporter_id, reported_id, message_id, message_snapshot, reason, details)
  values (auth.uid(), p_target, case when v_snap is not null or p_message is null then p_message end,
          v_snap, p_reason, left(p_details, 500));
end $$;

-- ---------------------------------------------------------------- médias : réservation de quota (atomique)
-- Le verrou FOR UPDATE sur la conversation sérialise les envois simultanés des deux personnes.
create function public.reserve_media(p_conv uuid, p_files jsonb)
returns table(o_id uuid, o_path text, o_name text)
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid(); v_conv public.conversations%rowtype; v_other uuid;
  v_n int; v_total bigint := 0; f jsonb; v_mime text; v_kind text; v_size bigint; v_name text; v_id uuid;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;
  if jsonb_typeof(p_files) is distinct from 'array' then raise exception 'invalid_input'; end if;
  v_n := jsonb_array_length(p_files);
  if v_n < 1 then raise exception 'invalid_input'; end if;
  if v_n > public.cfg('max_files_per_batch') then raise exception 'too_many_files'; end if;

  select * into v_conv from public.conversations c where c.id = p_conv and v_me in (c.user_a, c.user_b) for update;
  if not found then raise exception 'forbidden'; end if;
  v_other := case when v_conv.user_a = v_me then v_conv.user_b else v_conv.user_a end;
  if public.is_blocked(v_me, v_other) then raise exception 'blocked'; end if;

  for f in select * from jsonb_array_elements(p_files) loop
    v_mime := lower(coalesce(f ->> 'mime', ''));
    v_size := case when (f ->> 'size') ~ '^[0-9]{1,12}$' then (f ->> 'size')::bigint end;
    v_kind := case when v_mime in ('image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif') then 'photo'
                   when v_mime in ('video/mp4','video/webm','video/quicktime') then 'video' end;
    if v_kind is null then raise exception 'bad_type'; end if;
    if v_size is null or v_size <= 0 then raise exception 'invalid_input'; end if;
    if v_size > public.cfg(case v_kind when 'photo' then 'photo_max_bytes' else 'video_max_bytes' end) then
      raise exception 'file_too_large';
    end if;
    v_total := v_total + v_size;
  end loop;

  if v_conv.media_bytes + v_total > public.cfg('conversation_quota_bytes') then
    raise exception 'quota_exceeded' using detail = v_conv.media_bytes::text;
  end if;

  for f in select * from jsonb_array_elements(p_files) loop
    v_mime := lower(f ->> 'mime');
    v_kind := case when v_mime like 'image/%' then 'photo' else 'video' end;
    v_name := left(btrim(regexp_replace(coalesce(f ->> 'name', ''), '[/\\[:cntrl:]]', '_', 'g')), 120);
    if v_name = '' then v_name := 'fichier'; end if;
    v_id := gen_random_uuid();
    insert into public.media(id, conversation_id, uploader_id, path, name, mime, kind, size_bytes)
    values (v_id, p_conv, v_me, p_conv::text || '/' || v_id::text, v_name, v_mime, v_kind, (f ->> 'size')::bigint);
    o_id := v_id; o_path := p_conv::text || '/' || v_id::text; o_name := v_name;
    return next;
  end loop;
  update public.conversations set media_bytes = media_bytes + v_total where id = p_conv;
end $$;

-- ---------------------------------------------------------------- médias : fonctions réservées à l'Edge Function `media` (service_role)
create function public.media_object_size(p_path text) returns bigint
language sql stable security definer set search_path = '' as $$
  select (o.metadata ->> 'size')::bigint from storage.objects o where o.bucket_id = 'chat-media' and o.name = p_path;
$$;

create function public.media_finalize(p_user uuid, p_id uuid, p_actual bigint) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_m public.media%rowtype; v_other uuid; v_msg uuid;
begin
  select * into v_m from public.media where id = p_id and uploader_id = p_user for update;
  if not found or v_m.status <> 'pending' then raise exception 'not_found'; end if;
  perform 1 from public.conversations c where c.id = v_m.conversation_id for update;
  if p_actual is null or p_actual <= 0 or p_actual > v_m.size_bytes then raise exception 'file_too_large'; end if;
  select case when c.user_a = p_user then c.user_b else c.user_a end into v_other
    from public.conversations c where c.id = v_m.conversation_id;
  if public.is_blocked(p_user, v_other) then raise exception 'blocked'; end if;

  insert into public.messages(conversation_id, sender_id, client_id, kind) values (v_m.conversation_id, p_user, p_id, 'media')
  returning id into v_msg;
  update public.media set status = 'ready', size_bytes = p_actual, ready_at = now(), message_id = v_msg where id = p_id;
  update public.conversations
     set media_bytes = media_bytes - (v_m.size_bytes - p_actual), last_message_at = now(), last_message_id = v_msg
   where id = v_m.conversation_id;
  update public.conversation_members set archived = false where conversation_id = v_m.conversation_id and user_id = v_other;
  return v_msg;
end $$;

-- Début de suppression pour tous : le média disparaît immédiatement de l'appli pour les deux personnes.
-- L'espace n'est libéré qu'APRÈS suppression effective du fichier (media_mark_removed).
create function public.media_begin_delete(p_user uuid, p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_path text;
begin
  update public.media set status = 'deleting'
   where id = p_id and uploader_id = p_user and status in ('ready','deleting')
   returning path into v_path;
  if v_path is null then raise exception 'forbidden'; end if;
  return v_path;
end $$;

create function public.media_mark_removed(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_m public.media%rowtype;
begin
  select * into v_m from public.media where id = p_id and status in ('pending','deleting') for update;
  if not found then return; end if;
  perform 1 from public.conversations c where c.id = v_m.conversation_id for update;
  update public.media set status = 'deleted', deleted_at = now() where id = p_id;
  update public.conversations set media_bytes = greatest(0, media_bytes - v_m.size_bytes) where id = v_m.conversation_id;
  if v_m.message_id is not null then
    update public.messages set body = null, deleted_at = now(), pinned_at = null where id = v_m.message_id and deleted_at is null;
    delete from public.reactions where message_id = v_m.message_id;
  end if;
end $$;

-- Réservations expirées et suppressions échouées à reprendre, pour les conversations d'un utilisateur.
create function public.media_stale(p_user uuid) returns table(id uuid, path text)
language sql stable security definer set search_path = '' as $$
  select d.id, d.path from public.media d
  join public.conversations c on c.id = d.conversation_id and p_user in (c.user_a, c.user_b)
  where d.status = 'deleting'
     or (d.status = 'pending' and d.created_at < now() - make_interval(mins => public.cfg('reservation_ttl_minutes')::int));
$$;

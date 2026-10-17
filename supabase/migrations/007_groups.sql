-- Piaf — 007 : groupes (2 à 32 membres). Les conversations à deux existantes restent inchangées (kind = 'direct').
-- Principes : on n'ajoute à un groupe que des personnes avec qui on partage déjà une conversation (discussion ou groupe) ;
-- un nouvel arrivant ne voit pas l'historique antérieur (réutilise cleared_at) ; rôles administrateur / membre.

alter table public.conversations
  add column kind text not null default 'direct' check (kind in ('direct','group')),
  add column title text check (title is null or char_length(btrim(title)) between 1 and 40),
  add column avatar_path text;
alter table public.conversations alter column user_a drop not null, alter column user_b drop not null;
alter table public.conversations add constraint conversations_kind_check check (
  (kind = 'direct' and user_a is not null and user_b is not null)
  or (kind = 'group' and user_a is null and user_b is null and title is not null));

alter table public.conversation_members
  add column role text not null default 'member' check (role in ('admin','member')),
  add column joined_at timestamptz not null default now(),
  add column last_delivered_at timestamptz;

alter table public.messages drop constraint messages_kind_check;
alter table public.messages add constraint messages_kind_check check (kind in ('text','media','system'));

insert into public.app_config(key, value, description) values
  ('group_max_members', 32, 'Nombre maximal de membres d''un groupe'),
  ('group_create_per_day', 10, 'Nombre maximal de groupes créés par personne et par jour')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- helpers basés sur l'appartenance
create or replace function public.is_member(p_conv uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.conversation_members m where m.conversation_id = p_conv and m.user_id = auth.uid());
$$;
create or replace function public.is_group_admin(p_conv uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.conversation_members m
                 where m.conversation_id = p_conv and m.user_id = auth.uid() and m.role = 'admin');
$$;
create or replace function public.shares_conversation(p_other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.conversation_members a
                 join public.conversation_members b on b.conversation_id = a.conversation_id
                 where a.user_id = auth.uid() and b.user_id = p_other and p_other <> auth.uid());
$$;

drop policy conv_read on public.conversations;
create policy conv_read on public.conversations for select to authenticated using (public.is_member(id));

-- Message d'événement (« X a ajouté Y »), interne.
create or replace function public._sys(p_conv uuid, p_actor uuid, p_text text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.messages(conversation_id, sender_id, client_id, kind, body)
  values (p_conv, p_actor, gen_random_uuid(), 'system', left(p_text, 4000)) returning id into v_id;
  update public.conversations set last_message_at = now(), last_message_id = v_id where id = p_conv;
end $$;

-- Un groupe ne reste jamais sans administrateur (départ, exclusion, suppression de compte).
create or replace function public.ensure_group_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'admin'
     and exists (select 1 from public.conversation_members m where m.conversation_id = old.conversation_id)
     and not exists (select 1 from public.conversation_members m where m.conversation_id = old.conversation_id and m.role = 'admin') then
    update public.conversation_members set role = 'admin'
     where (conversation_id, user_id) = (select m.conversation_id, m.user_id from public.conversation_members m
                                         where m.conversation_id = old.conversation_id order by m.joined_at, m.user_id limit 1);
  end if;
  return null;
end $$;
create trigger ensure_group_admin after delete on public.conversation_members
  for each row execute function public.ensure_group_admin();

-- ---------------------------------------------------------------- vue des messages : les membres bloqués sont masqués dans les groupes
create or replace view public.my_messages with (security_invoker = true) as
select m.id, m.conversation_id, m.sender_id, m.client_id, m.kind, m.body, m.reply_to, m.forwarded,
       m.created_at, m.edited_at, m.deleted_at, m.pinned_at, m.delivered_at,
       case when coalesce((select s.read_receipts from public.user_settings s where s.user_id = auth.uid()), true)
            then m.read_at end as read_at
from public.messages m
where not exists (select 1 from public.message_hidden h where h.message_id = m.id and h.user_id = auth.uid())
  and m.created_at > coalesce((select cm.cleared_at from public.conversation_members cm
                               where cm.conversation_id = m.conversation_id and cm.user_id = auth.uid()),
                              '-infinity'::timestamptz)
  and not exists (select 1 from public.blocks b join public.conversations c on c.id = m.conversation_id
                  where c.kind = 'group' and b.blocker_id = auth.uid() and b.blocked_id = m.sender_id);

-- ---------------------------------------------------------------- liste des conversations (discussions + groupes)
drop function public.list_conversations();
create function public.list_conversations()
returns table(conversation_id uuid, other_id uuid, other_public_id text, other_name text, nickname text,
              archived boolean, favorite boolean, muted boolean,
              last_message_id uuid, last_at timestamptz, last_kind text, last_body text,
              last_sender uuid, last_deleted boolean, unread int, blocked_by_me boolean,
              kind text, avatar_path text, members int, last_sender_name text, my_role text, created_by uuid)
language sql stable security definer set search_path = '' as $$
  select c.id, o.id, o.public_id, coalesce(o.display_name, c.title), cm.nickname, cm.archived, cm.favorite, cm.muted,
         lm.id, coalesce(lm.created_at, c.created_at), lm.kind, lm.body, lm.sender_id, (lm.deleted_at is not null),
         coalesce(u.n, 0)::int,
         (o.id is not null and exists (select 1 from public.blocks b where b.blocker_id = auth.uid() and b.blocked_id = o.id)),
         c.kind, c.avatar_path,
         (select count(*) from public.conversation_members x where x.conversation_id = c.id)::int,
         case when c.kind = 'group' then (select p.display_name from public.profiles p where p.id = lm.sender_id) end,
         cm.role, c.created_by
  from public.conversation_members cm
  join public.conversations c on c.id = cm.conversation_id
  left join public.profiles o on c.kind = 'direct' and o.id = case when c.user_a = auth.uid() then c.user_b else c.user_a end
  left join lateral (
    select m.* from public.messages m
    where m.conversation_id = c.id
      and (cm.cleared_at is null or m.created_at > cm.cleared_at)
      and not exists (select 1 from public.message_hidden h where h.message_id = m.id and h.user_id = auth.uid())
      and (c.kind = 'direct' or not exists (select 1 from public.blocks b where b.blocker_id = auth.uid() and b.blocked_id = m.sender_id))
    order by m.created_at desc, m.id desc limit 1) lm on true
  left join lateral (
    select count(*) n from public.messages m
    where m.conversation_id = c.id and m.sender_id <> auth.uid() and m.deleted_at is null and m.kind <> 'system'
      and m.created_at > cm.last_read_at
      and (cm.cleared_at is null or m.created_at > cm.cleared_at)
      and not exists (select 1 from public.message_hidden h where h.message_id = m.id and h.user_id = auth.uid())
      and (c.kind = 'direct' or not exists (select 1 from public.blocks b where b.blocker_id = auth.uid() and b.blocked_id = m.sender_id))) u on true
  where cm.user_id = auth.uid() and (lm.id is not null or c.created_by = auth.uid())
  order by coalesce(lm.created_at, c.created_at) desc;
$$;

-- ---------------------------------------------------------------- messages : adaptation aux groupes
create or replace function public.send_message(p_conv uuid, p_client_id uuid, p_body text,
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
  select m.id into v_id from public.messages m
   where m.conversation_id = p_conv and m.sender_id = v_me and m.client_id = p_client_id;
  if v_id is null then
    v_other := public.other_member(p_conv);   -- null dans un groupe
    if v_other is not null and public.is_blocked(v_me, v_other) then raise exception 'blocked'; end if;
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
    update public.conversation_members set archived = false where conversation_id = p_conv and user_id <> v_me;
  end if;
  select * into v_row from public.my_messages where id = v_id;
  return v_row;
end $$;

create or replace function public.edit_message(p_id uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.messages%rowtype; v_body text := btrim(coalesce(p_body, ''));
begin
  select * into m from public.messages where id = p_id;
  if not found or m.sender_id is distinct from auth.uid() or not public.is_member(m.conversation_id) then raise exception 'forbidden'; end if;
  if m.kind <> 'text' or m.deleted_at is not null then raise exception 'forbidden'; end if;
  if v_body = '' or char_length(v_body) > public.cfg('message_max_chars') then raise exception 'invalid_input'; end if;
  if m.created_at < now() - make_interval(mins => public.cfg('edit_window_minutes')::int) then raise exception 'window_expired'; end if;
  if public.other_member(m.conversation_id) is not null and public.is_blocked(m.sender_id, public.other_member(m.conversation_id)) then raise exception 'blocked'; end if;
  update public.messages set body = v_body, edited_at = now() where id = p_id;
end $$;

-- Texte : l'auteur (dans le délai) ou un administrateur du groupe (sans délai). Les médias passent par l'Edge Function `media`.
create or replace function public.delete_message_for_all(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.messages%rowtype; v_admin boolean;
begin
  select * into m from public.messages where id = p_id;
  if not found or not public.is_member(m.conversation_id) then raise exception 'forbidden'; end if;
  v_admin := public.is_group_admin(m.conversation_id);
  if m.sender_id is distinct from auth.uid() and not v_admin then raise exception 'forbidden'; end if;
  if m.kind = 'system' then raise exception 'forbidden'; end if;
  if m.kind <> 'text' then raise exception 'use_media_delete'; end if;
  if m.deleted_at is not null then return; end if;
  if not v_admin and m.created_at < now() - make_interval(mins => public.cfg('delete_all_window_minutes')::int) then raise exception 'window_expired'; end if;
  update public.messages set body = null, deleted_at = now(), pinned_at = null where id = p_id;
  delete from public.reactions where message_id = p_id;
end $$;

create or replace function public.mark_delivered_all() returns void
language sql security definer set search_path = '' as $$
  update public.messages m set delivered_at = now()
  from public.conversations c
  where m.conversation_id = c.id and c.kind = 'direct' and auth.uid() in (c.user_a, c.user_b)
    and m.sender_id <> auth.uid() and m.delivered_at is null;
  update public.conversation_members cm set last_delivered_at = now()
  from public.conversations c
  where cm.user_id = auth.uid() and c.id = cm.conversation_id and c.kind = 'group'
    and c.last_message_at > coalesce(cm.last_delivered_at, '-infinity'::timestamptz);
$$;

-- Groupes : l'état « distribué / lu » est porté par chaque membre (last_delivered_at / last_read_at), pas par le message.
create or replace function public.mark_read(p_conv uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := auth.uid(); v_kind text;
begin
  if not public.is_member(p_conv) then raise exception 'forbidden'; end if;
  select c.kind into v_kind from public.conversations c where c.id = p_conv;
  update public.conversation_members set last_read_at = now(), last_delivered_at = now() where conversation_id = p_conv and user_id = v_me;
  if v_kind <> 'direct' then return; end if;
  if coalesce((select s.read_receipts from public.user_settings s where s.user_id = v_me), true) then
    update public.messages set read_at = now(), delivered_at = coalesce(delivered_at, now())
     where conversation_id = p_conv and sender_id <> v_me and read_at is null;
  else
    update public.messages set delivered_at = now()
     where conversation_id = p_conv and sender_id <> v_me and delivered_at is null;
  end if;
end $$;

-- ---------------------------------------------------------------- médias : adaptation aux groupes
create or replace function public.reserve_media(p_conv uuid, p_files jsonb)
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

  select * into v_conv from public.conversations c where c.id = p_conv for update;
  if not found or not public.is_member(p_conv) then raise exception 'forbidden'; end if;
  if v_conv.kind = 'direct' then
    v_other := case when v_conv.user_a = v_me then v_conv.user_b else v_conv.user_a end;
    if public.is_blocked(v_me, v_other) then raise exception 'blocked'; end if;
  end if;

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

create or replace function public.media_finalize(p_user uuid, p_id uuid, p_actual bigint) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_m public.media%rowtype; v_other uuid; v_msg uuid; v_kind text;
begin
  select * into v_m from public.media where id = p_id and uploader_id = p_user for update;
  if not found or v_m.status <> 'pending' then raise exception 'not_found'; end if;
  perform 1 from public.conversations c where c.id = v_m.conversation_id for update;
  if not exists (select 1 from public.conversation_members x where x.conversation_id = v_m.conversation_id and x.user_id = p_user) then
    raise exception 'forbidden';
  end if;
  if p_actual is null or p_actual <= 0 or p_actual > v_m.size_bytes then raise exception 'file_too_large'; end if;
  select c.kind, case when c.user_a = p_user then c.user_b else c.user_a end into v_kind, v_other
    from public.conversations c where c.id = v_m.conversation_id;
  if v_kind = 'direct' and public.is_blocked(p_user, v_other) then raise exception 'blocked'; end if;

  insert into public.messages(conversation_id, sender_id, client_id, kind) values (v_m.conversation_id, p_user, p_id, 'media')
  returning id into v_msg;
  update public.media set status = 'ready', size_bytes = p_actual, ready_at = now(), message_id = v_msg where id = p_id;
  update public.conversations
     set media_bytes = media_bytes - (v_m.size_bytes - p_actual), last_message_at = now(), last_message_id = v_msg
   where id = v_m.conversation_id;
  update public.conversation_members set archived = false where conversation_id = v_m.conversation_id and user_id <> p_user;
  return v_msg;
end $$;

-- Suppression pour tous : l'envoyeur, ou un administrateur du groupe.
create or replace function public.media_begin_delete(p_user uuid, p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_path text;
begin
  update public.media d set status = 'deleting'
   where d.id = p_id and d.status in ('ready','deleting')
     and (d.uploader_id = p_user
          or exists (select 1 from public.conversation_members x
                     where x.conversation_id = d.conversation_id and x.user_id = p_user and x.role = 'admin'))
   returning d.path into v_path;
  if v_path is null then raise exception 'forbidden'; end if;
  return v_path;
end $$;

create or replace function public.media_stale(p_user uuid) returns table(id uuid, path text)
language sql stable security definer set search_path = '' as $$
  select d.id, d.path from public.media d
  join public.conversation_members x on x.conversation_id = d.conversation_id and x.user_id = p_user
  where d.status = 'deleting'
     or (d.status = 'pending' and d.created_at < now() - make_interval(mins => public.cfg('reservation_ttl_minutes')::int));
$$;

-- ---------------------------------------------------------------- groupes : fonctions
create function public.my_contacts()
returns table(user_id uuid, public_id text, display_name text, avatar_path text, direct boolean, groups text[])
language sql stable security definer set search_path = '' as $$
  select p.id, p.public_id, p.display_name, p.avatar_path,
         exists (select 1 from public.conversation_members a
                 join public.conversation_members b on b.conversation_id = a.conversation_id
                 join public.conversations c on c.id = a.conversation_id
                 where a.user_id = auth.uid() and b.user_id = p.id and c.kind = 'direct'),
         coalesce((select array_agg(c.title order by c.title) from public.conversation_members a
                   join public.conversation_members b on b.conversation_id = a.conversation_id
                   join public.conversations c on c.id = a.conversation_id
                   where a.user_id = auth.uid() and b.user_id = p.id and c.kind = 'group'), '{}')
  from public.profiles p
  where auth.uid() is not null and p.id <> auth.uid() and public.shares_conversation(p.id)
    and not public.is_blocked(auth.uid(), p.id)
  order by lower(p.display_name);
$$;

create function public.group_members(p_conv uuid)
returns table(user_id uuid, public_id text, display_name text, avatar_path text, role text,
              joined_at timestamptz, last_read_at timestamptz, last_delivered_at timestamptz, is_me boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := auth.uid(); v_mine boolean;
begin
  if not public.is_member(p_conv) then raise exception 'forbidden'; end if;
  v_mine := coalesce((select s.read_receipts from public.user_settings s where s.user_id = v_me), true);
  return query
    select p.id, p.public_id, p.display_name, p.avatar_path, m.role, m.joined_at,
           case when m.user_id = v_me or (v_mine and coalesce(s.read_receipts, true)) then m.last_read_at end,
           m.last_delivered_at, (m.user_id = v_me)
    from public.conversation_members m
    join public.profiles p on p.id = m.user_id
    left join public.user_settings s on s.user_id = m.user_id
    where m.conversation_id = p_conv
    order by (m.role = 'admin') desc, lower(p.display_name);
end $$;

create function public.create_group(p_title text, p_members uuid[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := auth.uid(); v_title text := btrim(coalesce(p_title, '')); v_id uuid; v_ids uuid[]; v_names text;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;
  if char_length(v_title) not between 1 and 40 or v_title ~ '[[:cntrl:]]' then raise exception 'invalid_input'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_members, '{}')) x where x is not null and x <> v_me;
  if cardinality(v_ids) < 1 then raise exception 'invalid_input'; end if;
  if cardinality(v_ids) + 1 > public.cfg('group_max_members') then raise exception 'group_full'; end if;
  if exists (select 1 from unnest(v_ids) x where not public.shares_conversation(x) or public.is_blocked(v_me, x)) then
    raise exception 'forbidden';
  end if;
  if (select count(*) from public.conversations c where c.created_by = v_me and c.kind = 'group' and c.created_at > now() - interval '1 day')
       >= public.cfg('group_create_per_day') then
    raise exception 'rate_limited';
  end if;
  insert into public.conversations(kind, title, created_by) values ('group', v_title, v_me) returning id into v_id;
  insert into public.conversation_members(conversation_id, user_id, role) values (v_id, v_me, 'admin');
  insert into public.conversation_members(conversation_id, user_id) select v_id, x from unnest(v_ids) x;
  perform public._sys(v_id, v_me, (select p.display_name from public.profiles p where p.id = v_me) || ' a créé le groupe « ' || v_title || ' »');
  return v_id;
end $$;

create function public.group_add_members(p_conv uuid, p_members uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := auth.uid(); v_ids uuid[]; v_names text;
begin
  if v_me is null or not public.is_group_admin(p_conv) then raise exception 'forbidden'; end if;
  perform 1 from public.conversations c where c.id = p_conv for update;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_members, '{}')) x
   where x is not null and x <> v_me
     and not exists (select 1 from public.conversation_members m where m.conversation_id = p_conv and m.user_id = x);
  if cardinality(v_ids) < 1 then raise exception 'invalid_input'; end if;
  if (select count(*) from public.conversation_members m where m.conversation_id = p_conv) + cardinality(v_ids) > public.cfg('group_max_members') then
    raise exception 'group_full';
  end if;
  if exists (select 1 from unnest(v_ids) x where not public.shares_conversation(x) or public.is_blocked(v_me, x)) then
    raise exception 'forbidden';
  end if;
  insert into public.conversation_members(conversation_id, user_id, cleared_at)
    select p_conv, x, now() - interval '1 microsecond' from unnest(v_ids) x;   -- pas d'accès à l'historique antérieur
  select string_agg(p.display_name, ', ' order by p.display_name) into v_names from public.profiles p where p.id = any(v_ids);
  perform public._sys(p_conv, v_me, (select p.display_name from public.profiles p where p.id = v_me) || ' a ajouté ' || v_names);
end $$;

create function public.group_remove_member(p_conv uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := auth.uid(); v_role text; v_creator uuid;
begin
  if v_me is null or p_user = v_me or not public.is_group_admin(p_conv) then raise exception 'forbidden'; end if;
  select m.role into v_role from public.conversation_members m where m.conversation_id = p_conv and m.user_id = p_user;
  if v_role is null then raise exception 'not_found'; end if;
  select c.created_by into v_creator from public.conversations c where c.id = p_conv;
  if v_role = 'admin' and v_creator is distinct from v_me then raise exception 'forbidden'; end if;   -- seul le créateur retire un administrateur
  perform public._sys(p_conv, v_me, (select p.display_name from public.profiles p where p.id = v_me) || ' a retiré '
                                    || (select p.display_name from public.profiles p where p.id = p_user));
  delete from public.conversation_members where conversation_id = p_conv and user_id = p_user;
end $$;

create function public.leave_group(p_conv uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := auth.uid();
begin
  if not public.is_member(p_conv) or (select c.kind from public.conversations c where c.id = p_conv) <> 'group' then raise exception 'forbidden'; end if;
  if (select count(*) from public.conversation_members m where m.conversation_id = p_conv) <= 1 then raise exception 'last_member'; end if;
  perform public._sys(p_conv, v_me, (select p.display_name from public.profiles p where p.id = v_me) || ' a quitté le groupe');
  delete from public.conversation_members where conversation_id = p_conv and user_id = v_me;   -- le déclencheur désigne un nouvel administrateur si besoin
end $$;

create function public.group_set_admin(p_conv uuid, p_user uuid, p_admin boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := auth.uid(); v_creator uuid;
begin
  if v_me is null or not public.is_group_admin(p_conv) then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.conversation_members m where m.conversation_id = p_conv and m.user_id = p_user) then raise exception 'not_found'; end if;
  select c.created_by into v_creator from public.conversations c where c.id = p_conv;
  if not p_admin then
    if p_user <> v_me and v_creator is distinct from v_me then raise exception 'forbidden'; end if;   -- seul le créateur rétrograde un autre administrateur
    if (select count(*) from public.conversation_members m where m.conversation_id = p_conv and m.role = 'admin' and m.user_id <> p_user) < 1 then
      raise exception 'last_admin';
    end if;
  end if;
  update public.conversation_members set role = case when p_admin then 'admin' else 'member' end
   where conversation_id = p_conv and user_id = p_user;
  perform public._sys(p_conv, v_me, (select p.display_name from public.profiles p where p.id = p_user)
                                    || case when p_admin then ' est maintenant administrateur' else ' n''est plus administrateur' end);
end $$;

create function public.group_rename(p_conv uuid, p_title text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_title text := btrim(coalesce(p_title, ''));
begin
  if not public.is_group_admin(p_conv) then raise exception 'forbidden'; end if;
  if char_length(v_title) not between 1 and 40 or v_title ~ '[[:cntrl:]]' then raise exception 'invalid_input'; end if;
  update public.conversations set title = v_title where id = p_conv;
  perform public._sys(p_conv, auth.uid(), (select p.display_name from public.profiles p where p.id = auth.uid()) || ' a renommé le groupe « ' || v_title || ' »');
end $$;

create function public.group_set_avatar(p_conv uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_group_admin(p_conv) then raise exception 'forbidden'; end if;
  if p_path is not null and (p_path !~ ('^' || p_conv::text || '/[0-9a-f-]{36}\.jpg$')
     or not exists (select 1 from storage.objects o where o.bucket_id = 'avatars' and o.name = p_path)) then
    raise exception 'invalid_input';
  end if;
  update public.conversations set avatar_path = p_path where id = p_conv;
end $$;

-- ---------------------------------------------------------------- photos : dossier = identifiant de la personne OU du groupe
drop policy avatars_read on storage.objects;
drop policy avatars_insert on storage.objects;
drop policy avatars_delete on storage.objects;
create policy avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text
         or public.shares_conversation(((storage.foldername(name))[1])::uuid)
         or public.is_member(((storage.foldername(name))[1])::uuid)));
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'
              and ((storage.foldername(name))[1] = auth.uid()::text or public.is_group_admin(((storage.foldername(name))[1])::uuid)));
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text
         or public.is_group_admin(((storage.foldername(name))[1])::uuid)));

-- ---------------------------------------------------------------- privilèges
grant execute on function
  public.is_group_admin(uuid), public.list_conversations(), public.my_contacts(), public.group_members(uuid),
  public.create_group(text, uuid[]), public.group_add_members(uuid, uuid[]), public.group_remove_member(uuid, uuid),
  public.leave_group(uuid), public.group_set_admin(uuid, uuid, boolean), public.group_rename(uuid, text),
  public.group_set_avatar(uuid, text)
  to authenticated;

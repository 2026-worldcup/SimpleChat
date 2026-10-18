-- Piaf — 009 : sondages, listes de tâches collaboratives, audio, réponse publique de Talk2Piaf, mentions non lues.
-- Inclut aussi (008) le masquage de l'historique antérieur à l'arrivée d'un membre au niveau des tables.
-- À appliquer en une fois dans l'éditeur SQL de Supabase. Ne contient aucune donnée personnelle.

-- ---------------------------------------------------------------- 1. nouveaux types de messages et de médias
alter table public.messages drop constraint messages_kind_check;
alter table public.messages add constraint messages_kind_check check (kind in ('text', 'media', 'system', 'poll', 'todo', 'assistant'));
alter table public.media drop constraint media_kind_check;
alter table public.media add constraint media_kind_check check (kind in ('photo', 'video', 'audio'));
alter table public.media add column duration_ms integer check (duration_ms is null or duration_ms between 0 and 3600000);
create or replace view public.my_media with (security_invoker = true) as
select d.id, d.conversation_id, d.uploader_id, d.message_id, d.name, d.mime, d.kind, d.size_bytes, d.created_at, d.path, d.duration_ms
from public.media d
where d.status = 'ready'
  and not exists (select 1 from public.media_hidden h where h.media_id = d.id and h.user_id = auth.uid());
insert into public.app_config(key, value, description) values ('audio_max_bytes', 10485760, 'taille maximale d''un fichier audio ou message vocal (octets)') on conflict (key) do nothing;
update storage.buckets set allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','video/mp4','video/webm','video/quicktime',
                                                       'audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/aac','audio/wav'] where id = 'chat-media';

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
                   when v_mime in ('video/mp4','video/webm','video/quicktime') then 'video'
                   when v_mime in ('audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/aac','audio/wav') then 'audio' end;
    if v_kind is null then raise exception 'bad_type'; end if;
    if v_size is null or v_size <= 0 then raise exception 'invalid_input'; end if;
    if v_size > public.cfg(case v_kind when 'photo' then 'photo_max_bytes' when 'audio' then 'audio_max_bytes' else 'video_max_bytes' end) then
      raise exception 'file_too_large';
    end if;
    v_total := v_total + v_size;
  end loop;

  if v_conv.media_bytes + v_total > public.cfg('conversation_quota_bytes') then
    raise exception 'quota_exceeded' using detail = v_conv.media_bytes::text;
  end if;

  for f in select * from jsonb_array_elements(p_files) loop
    v_mime := lower(f ->> 'mime');
    v_kind := case when v_mime like 'image/%' then 'photo' when v_mime like 'audio/%' then 'audio' else 'video' end;
    v_name := left(btrim(regexp_replace(coalesce(f ->> 'name', ''), '[/\\[:cntrl:]]', '_', 'g')), 120);
    if v_name = '' then v_name := 'fichier'; end if;
    v_id := gen_random_uuid();
    insert into public.media(id, conversation_id, uploader_id, path, name, mime, kind, size_bytes, duration_ms)
    values (v_id, p_conv, v_me, p_conv::text || '/' || v_id::text, v_name, v_mime, v_kind, (f ->> 'size')::bigint,
            case when v_kind = 'audio' and (f ->> 'duration') ~ '^[0-9]{1,8}$' then least((f ->> 'duration')::int, 3600000) end);
    o_id := v_id; o_path := p_conv::text || '/' || v_id::text; o_name := v_name;
    return next;
  end loop;
  update public.conversations set media_bytes = media_bytes + v_total where id = p_conv;
end $$;

-- ---------------------------------------------------------------- 2. historique masqué aussi au niveau des tables (ex-008)
create or replace function public.can_read_msg(p_conv uuid, p_at timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.conversation_members m
                 where m.conversation_id = p_conv and m.user_id = auth.uid()
                   and (m.cleared_at is null or p_at > m.cleared_at));
$$;
revoke all on function public.can_read_msg(uuid, timestamptz) from public, anon;
grant execute on function public.can_read_msg(uuid, timestamptz) to authenticated;

drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages for select to authenticated using (public.can_read_msg(conversation_id, created_at));
drop policy if exists media_read on public.media;
create policy media_read on public.media for select to authenticated
  using (public.can_read_msg(conversation_id, created_at) and (status = 'ready' or (status = 'pending' and uploader_id = auth.uid())));
drop policy if exists reactions_read on public.reactions;
create policy reactions_read on public.reactions for select to authenticated using (public.can_read_msg(conversation_id, created_at));
drop policy if exists chat_media_read on storage.objects;
create policy chat_media_read on storage.objects for select to authenticated
  using (bucket_id = 'chat-media' and exists (select 1 from public.media m
         where m.path = objects.name and m.status = 'ready' and public.can_read_msg(m.conversation_id, m.created_at)));

-- ---------------------------------------------------------------- 3. publication d'un message d'un type nouveau (interne)
create or replace function public._post(p_conv uuid, p_client_id uuid, p_kind text, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := auth.uid(); v_other uuid; v_id uuid;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;
  if not public.is_member(p_conv) then raise exception 'forbidden'; end if;
  if p_client_id is null then raise exception 'invalid_input'; end if;
  v_other := public.other_member(p_conv);
  if v_other is not null and public.is_blocked(v_me, v_other) then raise exception 'blocked'; end if;
  if (select count(*) from public.messages m where m.sender_id = v_me and m.created_at > now() - interval '10 seconds') >= 15 then
    raise exception 'rate_limited';
  end if;
  insert into public.messages(conversation_id, sender_id, client_id, kind, body) values (p_conv, v_me, p_client_id, p_kind, p_body)
  returning id into v_id;
  update public.conversations set last_message_at = now(), last_message_id = v_id where id = p_conv;
  update public.conversation_members set archived = false where conversation_id = p_conv and user_id <> v_me;
  return v_id;
end $$;

-- ---------------------------------------------------------------- 4. sondages
create table public.polls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null unique references public.messages(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  question text not null check (char_length(question) between 1 and 300),
  multiple boolean not null default false,
  anonymous boolean not null default false,
  allow_add boolean not null default false,
  closes_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  conversation_id uuid not null,
  label text not null check (char_length(label) between 1 and 100),
  position integer not null,
  created_by uuid references public.profiles(id) on delete set null
);
create table public.poll_votes (
  poll_id uuid not null references public.polls(id) on delete cascade,
  option_id uuid not null references public.poll_options(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  voted_at timestamptz not null default now(),
  primary key (option_id, user_id)
);
create index poll_options_poll_idx on public.poll_options(poll_id);
create index poll_votes_poll_idx on public.poll_votes(poll_id, user_id);
create index polls_conv_idx on public.polls(conversation_id);
alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;   -- aucune politique : les votes ne se lisent que par poll_results()
create policy polls_read on public.polls for select to authenticated using (public.can_read_msg(conversation_id, created_at));
create policy poll_options_read on public.poll_options for select to authenticated using (public.is_member(conversation_id));

create or replace function public._poll_check(p_poll uuid, p_owner boolean, p_open boolean) returns public.polls
language plpgsql security definer set search_path = '' as $$
declare v public.polls;
begin
  select * into v from public.polls where id = p_poll;
  if not found or not public.is_member(v.conversation_id) then raise exception 'forbidden'; end if;
  if p_owner and v.creator_id <> auth.uid() and not public.is_group_admin(v.conversation_id) then raise exception 'forbidden'; end if;
  if p_open and (v.closed_at is not null or (v.closes_at is not null and v.closes_at <= now())) then raise exception 'poll_closed'; end if;
  return v;
end $$;

create or replace function public.create_poll(p_conv uuid, p_client_id uuid, p_question text, p_options text[],
  p_multiple boolean default false, p_anonymous boolean default false, p_allow_add boolean default false, p_closes_at timestamptz default null)
returns public.my_messages language plpgsql security definer set search_path = '' as $$
declare v_me uuid := auth.uid(); v_q text := btrim(coalesce(p_question, '')); v_id uuid; v_poll uuid; v_opts text[]; o text; i int := 0; v_row public.my_messages;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;
  select m.id into v_id from public.messages m where m.conversation_id = p_conv and m.sender_id = v_me and m.client_id = p_client_id;
  if v_id is null then
    if char_length(v_q) not between 1 and 300 or v_q ~ '[[:cntrl:]]' then raise exception 'invalid_input'; end if;
    v_opts := array(select btrim(x) from unnest(coalesce(p_options, '{}'::text[])) x where btrim(x) <> '');
    if cardinality(v_opts) not between 2 and 12 then raise exception 'invalid_input'; end if;
    if exists (select 1 from unnest(v_opts) x where char_length(x) > 100 or x ~ '[[:cntrl:]]') then raise exception 'invalid_input'; end if;
    if (select count(distinct lower(x)) from unnest(v_opts) x) <> cardinality(v_opts) then raise exception 'invalid_input'; end if;
    if p_closes_at is not null and (p_closes_at <= now() or p_closes_at > now() + interval '366 days') then raise exception 'invalid_input'; end if;
    v_id := public._post(p_conv, p_client_id, 'poll', v_q);
    insert into public.polls(conversation_id, message_id, creator_id, question, multiple, anonymous, allow_add, closes_at)
    values (p_conv, v_id, v_me, v_q, coalesce(p_multiple, false), coalesce(p_anonymous, false), coalesce(p_allow_add, false), p_closes_at) returning id into v_poll;
    foreach o in array v_opts loop
      i := i + 1;
      insert into public.poll_options(poll_id, conversation_id, label, position, created_by) values (v_poll, p_conv, o, i, v_me);
    end loop;
  end if;
  select * into v_row from public.my_messages where id = v_id;
  return v_row;
end $$;

create or replace function public.poll_vote(p_poll uuid, p_option uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.polls; v_me uuid := auth.uid();
begin
  v := public._poll_check(p_poll, false, true);
  if not exists (select 1 from public.poll_options where id = p_option and poll_id = p_poll) then raise exception 'invalid_input'; end if;
  if p_on then
    if not v.multiple then delete from public.poll_votes where poll_id = p_poll and user_id = v_me and option_id <> p_option; end if;
    insert into public.poll_votes(poll_id, option_id, user_id) values (p_poll, p_option, v_me) on conflict do nothing;
  else
    delete from public.poll_votes where option_id = p_option and user_id = v_me;
  end if;
  update public.polls set updated_at = now() where id = p_poll;
end $$;

create or replace function public.poll_option_add(p_poll uuid, p_label text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.polls; v_l text := btrim(coalesce(p_label, ''));
begin
  v := public._poll_check(p_poll, false, true);
  if not v.allow_add and v.creator_id <> auth.uid() and not public.is_group_admin(v.conversation_id) then raise exception 'forbidden'; end if;
  if char_length(v_l) not between 1 and 100 or v_l ~ '[[:cntrl:]]' then raise exception 'invalid_input'; end if;
  if (select count(*) from public.poll_options where poll_id = p_poll) >= 12 then raise exception 'too_many_options'; end if;
  if exists (select 1 from public.poll_options where poll_id = p_poll and lower(label) = lower(v_l)) then raise exception 'invalid_input'; end if;
  insert into public.poll_options(poll_id, conversation_id, label, position, created_by)
  values (p_poll, v.conversation_id, v_l, coalesce((select max(position) from public.poll_options where poll_id = p_poll), 0) + 1, auth.uid());
  update public.polls set updated_at = now() where id = p_poll;
end $$;

create or replace function public.poll_option_rename(p_option uuid, p_label text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_poll uuid; v public.polls; v_l text := btrim(coalesce(p_label, ''));
begin
  select poll_id into v_poll from public.poll_options where id = p_option;
  if v_poll is null then raise exception 'forbidden'; end if;
  v := public._poll_check(v_poll, true, true);
  if char_length(v_l) not between 1 and 100 or v_l ~ '[[:cntrl:]]' then raise exception 'invalid_input'; end if;
  if exists (select 1 from public.poll_options where poll_id = v_poll and id <> p_option and lower(label) = lower(v_l)) then raise exception 'invalid_input'; end if;
  update public.poll_options set label = v_l where id = p_option;
  update public.polls set updated_at = now() where id = v_poll;
  update public.messages set edited_at = now() where id = v.message_id;
end $$;

create or replace function public.poll_option_delete(p_option uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_poll uuid; v public.polls;
begin
  select poll_id into v_poll from public.poll_options where id = p_option;
  if v_poll is null then raise exception 'forbidden'; end if;
  v := public._poll_check(v_poll, true, true);
  if (select count(*) from public.poll_options where poll_id = v_poll) <= 2 then raise exception 'invalid_input'; end if;
  delete from public.poll_options where id = p_option;
  update public.polls set updated_at = now() where id = v_poll;
  update public.messages set edited_at = now() where id = v.message_id;
end $$;

create or replace function public.poll_update(p_poll uuid, p_question text, p_multiple boolean, p_anonymous boolean, p_allow_add boolean, p_closes_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.polls; v_q text := btrim(coalesce(p_question, ''));
begin
  v := public._poll_check(p_poll, true, true);
  if char_length(v_q) not between 1 and 300 or v_q ~ '[[:cntrl:]]' then raise exception 'invalid_input'; end if;
  if p_closes_at is not null and (p_closes_at <= now() or p_closes_at > now() + interval '366 days') then raise exception 'invalid_input'; end if;
  if coalesce(p_anonymous, false) <> v.anonymous and exists (select 1 from public.poll_votes where poll_id = p_poll) then raise exception 'poll_has_votes'; end if;
  if v.multiple and not coalesce(p_multiple, false)
     and exists (select 1 from public.poll_votes where poll_id = p_poll group by user_id having count(*) > 1) then raise exception 'poll_has_votes'; end if;
  update public.polls set question = v_q, multiple = coalesce(p_multiple, false), anonymous = coalesce(p_anonymous, false),
         allow_add = coalesce(p_allow_add, false), closes_at = p_closes_at, updated_at = now() where id = p_poll;
  if v_q <> v.question then update public.messages set body = v_q, edited_at = now() where id = v.message_id; end if;
end $$;

create or replace function public.poll_close(p_poll uuid, p_closed boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.polls;
begin
  v := public._poll_check(p_poll, true, false);
  if p_closed then update public.polls set closed_at = now(), updated_at = now() where id = p_poll;
  else update public.polls set closed_at = null, closes_at = null, updated_at = now() where id = p_poll; end if;
end $$;

create or replace function public.poll_results(p_conv uuid)
returns table(poll_id uuid, option_id uuid, votes integer, mine boolean, voters uuid[], poll_voters integer)
language sql stable security definer set search_path = '' as $$
  select o.poll_id, o.id, count(v.user_id)::int, coalesce(bool_or(v.user_id = auth.uid()), false),
         case when p.anonymous then null else coalesce(array_agg(v.user_id) filter (where v.user_id is not null), '{}'::uuid[]) end,
         (select count(distinct x.user_id)::int from public.poll_votes x where x.poll_id = o.poll_id)
  from public.poll_options o
  join public.polls p on p.id = o.poll_id
  left join public.poll_votes v on v.option_id = o.id
  where o.conversation_id = p_conv and public.can_read_msg(p_conv, p.created_at)
  group by o.poll_id, o.id, p.anonymous;
$$;

-- ---------------------------------------------------------------- 5. listes de tâches collaboratives
create table public.todo_lists (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null unique references public.messages(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  members_can_add boolean not null default true,
  members_can_check boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.todo_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.todo_lists(id) on delete cascade,
  conversation_id uuid not null,
  position integer not null,
  text text not null check (char_length(text) between 1 and 200),
  done boolean not null default false,
  done_by uuid references public.profiles(id) on delete set null,
  done_at timestamptz,
  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index todo_items_list_idx on public.todo_items(list_id, position);
create index todo_lists_conv_idx on public.todo_lists(conversation_id);
alter table public.todo_lists enable row level security;
alter table public.todo_items enable row level security;
create policy todo_lists_read on public.todo_lists for select to authenticated using (public.can_read_msg(conversation_id, created_at));
create policy todo_items_read on public.todo_items for select to authenticated
  using (exists (select 1 from public.todo_lists l where l.id = list_id and public.can_read_msg(l.conversation_id, l.created_at)));

create or replace function public._todo_check(p_list uuid, p_mode text) returns public.todo_lists
language plpgsql security definer set search_path = '' as $$
declare v public.todo_lists; v_owner boolean;
begin
  select * into v from public.todo_lists where id = p_list;
  if not found or not public.is_member(v.conversation_id) then raise exception 'forbidden'; end if;
  v_owner := v.creator_id = auth.uid() or public.is_group_admin(v.conversation_id);
  if p_mode = 'owner' and not v_owner then raise exception 'forbidden'; end if;
  if p_mode = 'add' and not v_owner and not v.members_can_add then raise exception 'forbidden'; end if;
  if p_mode = 'check' and not v_owner and not v.members_can_check then raise exception 'forbidden'; end if;
  return v;
end $$;

create or replace function public.create_todo(p_conv uuid, p_client_id uuid, p_title text, p_items text[],
  p_members_can_add boolean default true, p_members_can_check boolean default true)
returns public.my_messages language plpgsql security definer set search_path = '' as $$
declare v_me uuid := auth.uid(); v_t text := btrim(coalesce(p_title, '')); v_id uuid; v_list uuid; v_items text[]; o text; i int := 0; v_row public.my_messages;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;
  select m.id into v_id from public.messages m where m.conversation_id = p_conv and m.sender_id = v_me and m.client_id = p_client_id;
  if v_id is null then
    if char_length(v_t) not between 1 and 100 or v_t ~ '[[:cntrl:]]' then raise exception 'invalid_input'; end if;
    v_items := array(select btrim(x) from unnest(coalesce(p_items, '{}'::text[])) x where btrim(x) <> '');
    if cardinality(v_items) > 50 or exists (select 1 from unnest(v_items) x where char_length(x) > 200 or x ~ '[[:cntrl:]]') then raise exception 'invalid_input'; end if;
    v_id := public._post(p_conv, p_client_id, 'todo', v_t);
    insert into public.todo_lists(conversation_id, message_id, creator_id, title, members_can_add, members_can_check)
    values (p_conv, v_id, v_me, v_t, coalesce(p_members_can_add, true), coalesce(p_members_can_check, true)) returning id into v_list;
    foreach o in array v_items loop
      i := i + 1;
      insert into public.todo_items(list_id, conversation_id, position, text, created_by) values (v_list, p_conv, i, o, v_me);
    end loop;
  end if;
  select * into v_row from public.my_messages where id = v_id;
  return v_row;
end $$;

create or replace function public.todo_add_item(p_list uuid, p_text text, p_assigned uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v public.todo_lists; v_t text := btrim(coalesce(p_text, '')); v_id uuid;
begin
  v := public._todo_check(p_list, 'add');
  if char_length(v_t) not between 1 and 200 or v_t ~ '[[:cntrl:]]' then raise exception 'invalid_input'; end if;
  if (select count(*) from public.todo_items where list_id = p_list) >= 100 then raise exception 'too_many_items'; end if;
  if p_assigned is not null and not exists (select 1 from public.conversation_members where conversation_id = v.conversation_id and user_id = p_assigned) then raise exception 'invalid_input'; end if;
  insert into public.todo_items(list_id, conversation_id, position, text, assigned_to, created_by)
  values (p_list, v.conversation_id, coalesce((select max(position) from public.todo_items where list_id = p_list), 0) + 1, v_t, p_assigned, auth.uid())
  returning id into v_id;
  update public.todo_lists set updated_at = now() where id = p_list;
  return v_id;
end $$;

create or replace function public.todo_set_done(p_item uuid, p_done boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_list uuid;
begin
  select list_id into v_list from public.todo_items where id = p_item;
  if v_list is null then raise exception 'forbidden'; end if;
  perform public._todo_check(v_list, 'check');
  update public.todo_items set done = coalesce(p_done, false), done_by = case when p_done then auth.uid() end, done_at = case when p_done then now() end where id = p_item;
  update public.todo_lists set updated_at = now() where id = v_list;
end $$;

create or replace function public.todo_update_item(p_item uuid, p_text text, p_assigned uuid default null, p_set_assigned boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare v_list uuid; v public.todo_lists; v_t text := btrim(coalesce(p_text, ''));
begin
  select list_id into v_list from public.todo_items where id = p_item;
  if v_list is null then raise exception 'forbidden'; end if;
  v := public._todo_check(v_list, 'add');
  if char_length(v_t) not between 1 and 200 or v_t ~ '[[:cntrl:]]' then raise exception 'invalid_input'; end if;
  if p_set_assigned and p_assigned is not null and not exists (select 1 from public.conversation_members where conversation_id = v.conversation_id and user_id = p_assigned) then raise exception 'invalid_input'; end if;
  update public.todo_items set text = v_t, assigned_to = case when p_set_assigned then p_assigned else assigned_to end where id = p_item;
  update public.todo_lists set updated_at = now() where id = v_list;
end $$;

create or replace function public.todo_delete_item(p_item uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_list uuid;
begin
  select list_id into v_list from public.todo_items where id = p_item;
  if v_list is null then raise exception 'forbidden'; end if;
  perform public._todo_check(v_list, 'add');
  delete from public.todo_items where id = p_item;
  update public.todo_lists set updated_at = now() where id = v_list;
end $$;

create or replace function public.todo_clear_done(p_list uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._todo_check(p_list, 'add');
  delete from public.todo_items where list_id = p_list and done;
  update public.todo_lists set updated_at = now() where id = p_list;
end $$;

create or replace function public.todo_update_list(p_list uuid, p_title text, p_members_can_add boolean, p_members_can_check boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.todo_lists; v_t text := btrim(coalesce(p_title, ''));
begin
  v := public._todo_check(p_list, 'owner');
  if char_length(v_t) not between 1 and 100 or v_t ~ '[[:cntrl:]]' then raise exception 'invalid_input'; end if;
  update public.todo_lists set title = v_t, members_can_add = coalesce(p_members_can_add, true), members_can_check = coalesce(p_members_can_check, true), updated_at = now() where id = p_list;
  if v_t <> v.title then update public.messages set body = v_t, edited_at = now() where id = v.message_id; end if;
end $$;

-- ---------------------------------------------------------------- 6. réponse publique de Talk2Piaf (texte calculé sur l'appareil de la personne qui l'appelle)
create or replace function public.post_assistant_reply(p_conv uuid, p_client_id uuid, p_body text) returns public.my_messages
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := auth.uid(); v_b text := btrim(coalesce(p_body, '')); v_id uuid; v_row public.my_messages;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;
  select m.id into v_id from public.messages m where m.conversation_id = p_conv and m.sender_id = v_me and m.client_id = p_client_id;
  if v_id is null then
    if v_b = '' or char_length(v_b) > 1500 then raise exception 'invalid_input'; end if;
    if (select count(*) from public.messages m where m.sender_id = v_me and m.kind = 'assistant' and m.created_at > now() - interval '5 minutes') >= 6 then raise exception 'rate_limited'; end if;
    v_id := public._post(p_conv, p_client_id, 'assistant', v_b);
  end if;
  select * into v_row from public.my_messages where id = v_id;
  return v_row;
end $$;

-- ---------------------------------------------------------------- 7. suppression pour tous : sondages et listes comprises
create or replace function public.delete_message_for_all(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.messages%rowtype; v_admin boolean;
begin
  select * into m from public.messages where id = p_id;
  if not found or not public.is_member(m.conversation_id) then raise exception 'forbidden'; end if;
  v_admin := public.is_group_admin(m.conversation_id);
  if m.sender_id is distinct from auth.uid() and not v_admin then raise exception 'forbidden'; end if;
  if m.kind = 'system' then raise exception 'forbidden'; end if;
  if m.kind = 'media' then raise exception 'use_media_delete'; end if;
  if m.deleted_at is not null then return; end if;
  if not v_admin and m.created_at < now() - make_interval(mins => public.cfg('delete_all_window_minutes')::int) then raise exception 'window_expired'; end if;
  update public.messages set body = null, deleted_at = now(), pinned_at = null where id = p_id;
  delete from public.reactions where message_id = p_id;
  delete from public.polls where message_id = p_id;
  delete from public.todo_lists where message_id = p_id;
end $$;

-- ---------------------------------------------------------------- 8. mentions non lues (groupes)
create or replace function public.my_unread_mentions() returns table(conversation_id uuid, n integer)
language sql stable security definer set search_path = '' as $$
  select m.conversation_id, count(*)::int
  from public.messages m
  join public.conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = auth.uid()
  join public.conversations c on c.id = m.conversation_id and c.kind = 'group'
  join public.profiles p on p.id = auth.uid()
  where m.kind = 'text' and m.deleted_at is null and m.sender_id <> auth.uid()
    and m.created_at > cm.last_read_at and (cm.cleared_at is null or m.created_at > cm.cleared_at)
    and m.body ~* ('(^|[[:space:](«"''])@' || regexp_replace(p.display_name, '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '([^[:alnum:]_]|$)')
    and not exists (select 1 from public.message_hidden h where h.message_id = m.id and h.user_id = auth.uid())
    and not exists (select 1 from public.blocks b where b.blocker_id = auth.uid() and b.blocked_id = m.sender_id)
  group by m.conversation_id;
$$;

-- ---------------------------------------------------------------- 9. droits, temps réel
grant select on public.polls, public.poll_options, public.todo_lists, public.todo_items to authenticated;
alter publication supabase_realtime add table public.polls, public.poll_options, public.todo_lists, public.todo_items;

revoke all on function public._post(uuid, uuid, text, text), public._poll_check(uuid, boolean, boolean), public._todo_check(uuid, text) from public, anon, authenticated;
revoke all on function
  public.create_poll(uuid, uuid, text, text[], boolean, boolean, boolean, timestamptz), public.poll_vote(uuid, uuid, boolean),
  public.poll_option_add(uuid, text), public.poll_option_rename(uuid, text), public.poll_option_delete(uuid),
  public.poll_update(uuid, text, boolean, boolean, boolean, timestamptz), public.poll_close(uuid, boolean), public.poll_results(uuid),
  public.create_todo(uuid, uuid, text, text[], boolean, boolean), public.todo_add_item(uuid, text, uuid), public.todo_set_done(uuid, boolean),
  public.todo_update_item(uuid, text, uuid, boolean), public.todo_delete_item(uuid), public.todo_clear_done(uuid),
  public.todo_update_list(uuid, text, boolean, boolean), public.post_assistant_reply(uuid, uuid, text), public.my_unread_mentions(),
  public.reserve_media(uuid, jsonb), public.delete_message_for_all(uuid)
  from public, anon;
grant execute on function
  public.create_poll(uuid, uuid, text, text[], boolean, boolean, boolean, timestamptz), public.poll_vote(uuid, uuid, boolean),
  public.poll_option_add(uuid, text), public.poll_option_rename(uuid, text), public.poll_option_delete(uuid),
  public.poll_update(uuid, text, boolean, boolean, boolean, timestamptz), public.poll_close(uuid, boolean), public.poll_results(uuid),
  public.create_todo(uuid, uuid, text, text[], boolean, boolean), public.todo_add_item(uuid, text, uuid), public.todo_set_done(uuid, boolean),
  public.todo_update_item(uuid, text, uuid, boolean), public.todo_delete_item(uuid), public.todo_clear_done(uuid),
  public.todo_update_list(uuid, text, boolean, boolean), public.post_assistant_reply(uuid, uuid, text), public.my_unread_mentions(),
  public.reserve_media(uuid, jsonb), public.delete_message_for_all(uuid)
  to authenticated;

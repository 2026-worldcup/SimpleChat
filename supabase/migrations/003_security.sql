-- Piaf — 003 : RLS, privilèges, stockage privé, temps réel.
-- À appliquer APRÈS 001 et 002.

-- ---------------------------------------------------------------- RLS sur toutes les tables exposées
alter table public.app_config           enable row level security;
alter table public.profiles             enable row level security;
alter table public.user_settings        enable row level security;
alter table public.conversations        enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages             enable row level security;
alter table public.message_hidden       enable row level security;
alter table public.reactions            enable row level security;
alter table public.media                enable row level security;
alter table public.media_hidden         enable row level security;
alter table public.blocks               enable row level security;
alter table public.reports              enable row level security;   -- aucune politique : lecture impossible côté client
alter table public.login_attempts       enable row level security;   -- idem (service_role uniquement)
alter table public.signup_log           enable row level security;   -- idem

create policy app_config_read on public.app_config for select to authenticated using (true);

create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_conversation(id));

create policy settings_read   on public.user_settings for select to authenticated using (user_id = auth.uid());
create policy settings_update on public.user_settings for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy conv_read on public.conversations for select to authenticated
  using (auth.uid() in (user_a, user_b));

create policy members_read   on public.conversation_members for select to authenticated using (user_id = auth.uid());
create policy members_update on public.conversation_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy messages_read on public.messages for select to authenticated
  using (public.is_member(conversation_id));

create policy hidden_read on public.message_hidden for select to authenticated using (user_id = auth.uid());

create policy reactions_read on public.reactions for select to authenticated
  using (public.is_member(conversation_id));

create policy media_read on public.media for select to authenticated
  using (public.is_member(conversation_id)
         and (status = 'ready' or (status = 'pending' and uploader_id = auth.uid())));

create policy media_hidden_read on public.media_hidden for select to authenticated using (user_id = auth.uid());

create policy blocks_read on public.blocks for select to authenticated using (blocker_id = auth.uid());

-- ---------------------------------------------------------------- privilèges : lecture seule côté client
-- Toute écriture passe par les fonctions RPC (SECURITY DEFINER) qui vérifient droits et règles.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

grant select on public.app_config, public.profiles, public.user_settings, public.conversations,
                public.conversation_members, public.messages, public.message_hidden, public.reactions,
                public.media, public.media_hidden, public.blocks,
                public.my_messages, public.my_media
  to authenticated;
grant update (read_receipts, notifications)          on public.user_settings        to authenticated;
grant update (archived, favorite, muted, nickname)   on public.conversation_members to authenticated;

grant execute on function
  public.is_member(uuid), public.shares_conversation(uuid),
  public.find_user(text), public.start_conversation(text), public.list_conversations(),
  public.send_message(uuid, uuid, text, uuid, boolean), public.edit_message(uuid, text),
  public.delete_message_for_me(uuid), public.delete_message_for_all(uuid),
  public.pin_message(uuid, boolean), public.react(uuid, text),
  public.mark_delivered_all(), public.mark_read(uuid), public.clear_history(uuid),
  public.update_display_name(text), public.block_user(uuid), public.unblock_user(uuid), public.list_blocked(),
  public.report_content(uuid, uuid, text, text), public.reserve_media(uuid, jsonb)
  to authenticated;

-- Réservées à l'Edge Function `media` (clé service_role, jamais exposée au navigateur).
grant execute on function
  public.media_object_size(text), public.media_finalize(uuid, uuid, bigint),
  public.media_begin_delete(uuid, uuid), public.media_mark_removed(uuid), public.media_stale(uuid)
  to service_role;

-- ---------------------------------------------------------------- stockage privé
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-media', 'chat-media', false, 26214400,
        array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif',
              'video/mp4','video/webm','video/quicktime'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Lecture : seulement les membres de la conversation, pour un média « ready ».
create policy chat_media_read on storage.objects for select to authenticated
  using (bucket_id = 'chat-media' and exists (
    select 1 from public.media m
    where m.path = objects.name and m.status = 'ready' and public.is_member(m.conversation_id)));

-- Envoi : seulement vers un chemin réservé au préalable par l'utilisateur (reserve_media). Ni upsert, ni update, ni delete.
create policy chat_media_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-media' and exists (
    select 1 from public.media m
    where m.path = objects.name and m.status = 'pending' and m.uploader_id = auth.uid()));

-- ---------------------------------------------------------------- temps réel (la RLS s'applique aux événements)
alter publication supabase_realtime add table
  public.messages, public.reactions, public.media, public.conversations, public.conversation_members;

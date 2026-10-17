-- Piaf — 008 : l'historique antérieur à l'arrivée (ou à l'effacement) est aussi masqué au niveau des tables,
-- pas seulement dans la vue my_messages. Sans cela, un nouveau membre de groupe pourrait lire l'ancien historique
-- (messages, fichiers, réactions) en interrogeant directement l'API.
create or replace function public.can_read_msg(p_conv uuid, p_at timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.conversation_members m
                 where m.conversation_id = p_conv and m.user_id = auth.uid()
                   and (m.cleared_at is null or p_at > m.cleared_at));
$$;
revoke all on function public.can_read_msg(uuid, timestamptz) from public, anon;
grant execute on function public.can_read_msg(uuid, timestamptz) to authenticated;

drop policy messages_read on public.messages;
create policy messages_read on public.messages for select to authenticated
  using (public.can_read_msg(conversation_id, created_at));

drop policy media_read on public.media;
create policy media_read on public.media for select to authenticated
  using (public.can_read_msg(conversation_id, created_at)
         and (status = 'ready' or (status = 'pending' and uploader_id = auth.uid())));

drop policy reactions_read on public.reactions;
create policy reactions_read on public.reactions for select to authenticated
  using (public.can_read_msg(conversation_id, created_at));

drop policy chat_media_read on storage.objects;
create policy chat_media_read on storage.objects for select to authenticated
  using (bucket_id = 'chat-media' and exists (
    select 1 from public.media m
    where m.path = objects.name and m.status = 'ready' and public.can_read_msg(m.conversation_id, m.created_at)));

-- Photo de profil : bucket privé `avatars` (JPEG ≤ 256 Ko, un dossier par personne), lisible par soi-même et par les personnes avec qui on a une conversation.
alter table public.profiles add column if not exists avatar_path text;
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 262144, array['image/jpeg']) on conflict (id) do nothing;
create policy avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text
         or public.shares_conversation(((storage.foldername(name))[1])::uuid)));
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$');
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create or replace function public.set_avatar(p_path text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_path !~ ('^' || auth.uid()::text || '/[0-9a-f-]{36}\.jpg$')
     or not exists (select 1 from storage.objects o where o.bucket_id = 'avatars' and o.name = p_path) then
    raise exception 'invalid_input';
  end if;
  update public.profiles set avatar_path = p_path where id = auth.uid();
end $$;
create or replace function public.remove_avatar() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  update public.profiles set avatar_path = null where id = auth.uid();
end $$;
revoke all on function public.set_avatar(text), public.remove_avatar() from public, anon;
grant execute on function public.set_avatar(text), public.remove_avatar() to authenticated;

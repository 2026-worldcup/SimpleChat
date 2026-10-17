-- Correctif : l'API admin de GoTrue n'inscrit pas app_metadata avant l'insertion, l'ancien contrôle refusait tout.
-- Nouveau contrôle : un jeton secret (jamais exposé aux clients) transmis par l'Edge Function `auth` dans user_metadata,
-- retiré par le déclencheur avant l'enregistrement.
create table if not exists public.signup_gate(token text primary key);
alter table public.signup_gate enable row level security;
revoke all on public.signup_gate from anon, authenticated;
grant select on public.signup_gate to service_role;
insert into public.signup_gate(token) select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') where not exists (select 1 from public.signup_gate);
create or replace function public.guard_auth_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t text;
begin
  select g.token into t from public.signup_gate g limit 1;
  if t is null or coalesce(new.raw_user_meta_data ->> 'piaf_gate', '') <> t then
    raise exception 'Inscription directe désactivée';
  end if;
  new.raw_user_meta_data := new.raw_user_meta_data - 'piaf_gate';
  return new;
end $$;

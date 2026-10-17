-- Recherche : identifiant exact (8 chiffres) uniquement ; plus de recherche par nom.
create or replace function public.find_user(p_query text)
returns table(id uuid, public_id text, display_name text)
language plpgsql stable security definer set search_path = '' as $$
declare q text := btrim(coalesce(p_query, ''));
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if q ~ '^[0-9]{8}$' then
    return query select p.id, p.public_id, p.display_name from public.profiles p
                 where p.public_id = q and p.id <> auth.uid();
  end if;
end $$;

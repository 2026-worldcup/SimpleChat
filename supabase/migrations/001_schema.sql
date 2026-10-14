-- Piaf — 001 : tables, déclencheurs d'inscription, vues
-- Tout est écrit pour un projet Supabase VIERGE dédié à Piaf.

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------- configuration
-- Source unique des limites : modifiable sans toucher au code (UPDATE public.app_config ...).
create table public.app_config (
  key         text primary key,
  value       bigint not null check (value > 0),
  description text
);
insert into public.app_config(key, value, description) values
  ('photo_max_bytes',          10485760,  'Taille max par photo (octets)'),
  ('video_max_bytes',          26214400,  'Taille max par vidéo (octets)'),
  ('conversation_quota_bytes', 104857600, 'Quota de médias par conversation (octets), partagé entre les deux personnes'),
  ('max_files_per_batch',      10,        'Nombre max de fichiers par envoi groupé'),
  ('message_max_chars',        4000,      'Longueur max d''un message texte'),
  ('edit_window_minutes',      1440,      'Durée pendant laquelle un message peut être modifié'),
  ('delete_all_window_minutes',2880,      'Durée pendant laquelle un message texte peut être supprimé pour tous'),
  ('reservation_ttl_minutes',  60,        'Durée de validité d''une réservation d''envoi de média');

-- ---------------------------------------------------------------- profils
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  public_id    text not null unique check (public_id ~ '^[1-9][0-9]{7}$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  created_at   timestamptz not null default now()
);
create index profiles_name_trgm on public.profiles using gin (lower(display_name) extensions.gin_trgm_ops);

create table public.user_settings (
  user_id       uuid primary key references public.profiles(id) on delete cascade,
  read_receipts boolean not null default true,
  notifications boolean not null default true
);

-- ---------------------------------------------------------------- conversations
create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  user_a          uuid not null references public.profiles(id) on delete cascade,
  user_b          uuid not null references public.profiles(id) on delete cascade,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  last_message_id uuid,
  media_bytes     bigint not null default 0 check (media_bytes >= 0),  -- octets réservés + conservés
  check (user_a < user_b),
  unique (user_a, user_b)
);
create index conversations_user_a_idx on public.conversations(user_a);
create index conversations_user_b_idx on public.conversations(user_b);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  archived        boolean not null default false,
  favorite        boolean not null default false,
  muted           boolean not null default false,
  nickname        text check (nickname is null or char_length(nickname) <= 40),
  cleared_at      timestamptz,                         -- « supprimer l'historique pour moi »
  last_read_at    timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on public.conversation_members(user_id);

-- ---------------------------------------------------------------- messages
create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null references public.profiles(id) on delete cascade,
  client_id       uuid not null,                       -- idempotence (reconnexion / réessai)
  kind            text not null default 'text' check (kind in ('text','media')),
  body            text check (body is null or char_length(body) <= 4000),
  reply_to        uuid references public.messages(id) on delete set null,
  forwarded       boolean not null default false,
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  deleted_at      timestamptz,                         -- supprimé pour tous (tombstone)
  pinned_at       timestamptz,
  delivered_at    timestamptz,
  read_at         timestamptz,
  unique (conversation_id, sender_id, client_id)
);
create index messages_conv_created_idx   on public.messages (conversation_id, created_at desc, id desc);
create index messages_sender_created_idx on public.messages (sender_id, created_at desc);
create index messages_pinned_idx         on public.messages (conversation_id) where pinned_at is not null;
create index messages_undelivered_idx    on public.messages (conversation_id) where delivered_at is null;
create index messages_body_trgm          on public.messages using gin (body extensions.gin_trgm_ops) where deleted_at is null;

create table public.message_hidden (            -- « supprimer pour moi »
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  primary key (message_id, user_id)
);

create table public.reactions (
  message_id      uuid not null references public.messages(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  emoji           text not null check (emoji in ('👍','❤️','😂','😮','😢','🙏')),
  created_at      timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index reactions_conv_idx on public.reactions(conversation_id);

-- ---------------------------------------------------------------- médias
create table public.media (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  uploader_id     uuid not null references public.profiles(id) on delete cascade,
  message_id      uuid references public.messages(id) on delete set null,
  path            text not null unique,                -- <conversation_id>/<media_id> dans le bucket privé
  name            text not null check (char_length(name) between 1 and 120),
  mime            text not null,
  kind            text not null check (kind in ('photo','video')),
  size_bytes      bigint not null check (size_bytes > 0),
  status          text not null default 'pending'
                  check (status in ('pending','ready','deleting','deleted')),
  created_at      timestamptz not null default now(),
  ready_at        timestamptz,
  deleted_at      timestamptz
);
create index media_gallery_idx on public.media (conversation_id, created_at desc) where status = 'ready';
create index media_pending_idx on public.media (created_at) where status in ('pending','deleting');
create index media_name_trgm   on public.media using gin (lower(name) extensions.gin_trgm_ops) where status = 'ready';

create table public.media_hidden (
  media_id uuid not null references public.media(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  primary key (media_id, user_id)
);

-- ---------------------------------------------------------------- blocages / signalements
create table public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table public.reports (
  id               bigint generated always as identity primary key,
  reporter_id      uuid references public.profiles(id) on delete set null,
  reported_id      uuid references public.profiles(id) on delete set null,
  message_id       uuid references public.messages(id) on delete set null,
  message_snapshot text,
  reason           text not null check (reason in ('spam','harcelement','contenu_inapproprie','usurpation','autre')),
  details          text check (details is null or char_length(details) <= 500),
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------- anti-abus (tables privées : service_role uniquement)
create table public.login_attempts (
  key          text primary key,
  failures     int not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz
);
create table public.signup_log (
  id         bigint generated always as identity primary key,
  ip_hash    text not null,
  created_at timestamptz not null default now()
);
create index signup_log_idx on public.signup_log (ip_hash, created_at desc);

-- ---------------------------------------------------------------- vues (security_invoker : la RLS de l'appelant s'applique)
create view public.my_messages with (security_invoker = true) as
select m.id, m.conversation_id, m.sender_id, m.client_id, m.kind, m.body, m.reply_to, m.forwarded,
       m.created_at, m.edited_at, m.deleted_at, m.pinned_at, m.delivered_at,
       -- réciprocité : sans accusés de lecture activés chez soi, on ne voit pas ceux des autres
       case when coalesce((select s.read_receipts from public.user_settings s where s.user_id = auth.uid()), true)
            then m.read_at end as read_at
from public.messages m
where not exists (select 1 from public.message_hidden h where h.message_id = m.id and h.user_id = auth.uid())
  and m.created_at > coalesce((select cm.cleared_at from public.conversation_members cm
                               where cm.conversation_id = m.conversation_id and cm.user_id = auth.uid()),
                              '-infinity'::timestamptz);

create view public.my_media with (security_invoker = true) as
select d.id, d.conversation_id, d.uploader_id, d.message_id, d.name, d.mime, d.kind, d.size_bytes, d.created_at, d.path
from public.media d
where d.status = 'ready'
  and not exists (select 1 from public.media_hidden h where h.media_id = d.id and h.user_id = auth.uid());

-- ---------------------------------------------------------------- inscription : uniquement via l'Edge Function `auth`
-- Seule une création faite avec la clé service_role peut poser app_metadata.piaf = '1'.
-- Un appel direct à /auth/v1/signup avec la clé publique est donc refusé.
create function public.guard_auth_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.raw_app_meta_data ->> 'piaf', '') <> '1' then
    raise exception 'Inscription directe désactivée';
  end if;
  return new;
end $$;
create trigger guard_auth_signup before insert on auth.users
  for each row execute function public.guard_auth_signup();

-- L'identifiant public (8 chiffres) est la partie locale de l'e-mail technique <id>@piaf.invalid ;
-- l'unicité est garantie par GoTrue (e-mail unique) ET par la contrainte unique de profiles.public_id.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, public_id, display_name)
  values (new.id, split_part(new.email, '@', 1),
          left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 40));
  insert into public.user_settings(user_id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

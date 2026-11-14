-- Private server-side storage for the single owner-managed YouTube channel.
-- The refresh token is AES-256-GCM encrypted by the Node backend before insertion.
create table if not exists public.youtube_connections (
  id smallint primary key default 1 check (id = 1),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  channel_id text not null,
  channel_title text not null,
  thumbnail_url text,
  refresh_token_ciphertext text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.youtube_connections enable row level security;
revoke all on table public.youtube_connections from anon, authenticated;
grant all on table public.youtube_connections to service_role;

comment on table public.youtube_connections is
  'Encrypted OAuth refresh token for the single owner-managed YouTube channel. Accessible only to the backend service role.';

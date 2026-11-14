-- Multi-channel YouTube connections for the existing Master AI Bot.
-- Each row represents one owner + YouTube channel pair. OAuth refresh tokens
-- are encrypted by the Node backend before being stored here.
create table if not exists public.youtube_channel_connections (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  channel_id text not null,
  channel_title text not null,
  thumbnail_url text,
  refresh_token_ciphertext text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint youtube_channel_connections_owner_channel_unique
    unique (owner_user_id, channel_id)
);

create index if not exists youtube_channel_connections_owner_idx
  on public.youtube_channel_connections (owner_user_id, created_at);

alter table public.youtube_channel_connections enable row level security;
revoke all on table public.youtube_channel_connections from anon, authenticated;
grant all on table public.youtube_channel_connections to service_role;

comment on table public.youtube_channel_connections is
  'Owner-scoped YouTube channel connections. OAuth refresh tokens are AES-256-GCM encrypted by the backend; access is service-role only.';

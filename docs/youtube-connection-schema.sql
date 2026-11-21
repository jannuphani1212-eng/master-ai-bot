-- Private server-side storage for multiple owner-managed YouTube channels.
-- Each channel row stores its own AES-256-GCM encrypted OAuth refresh token.
create table if not exists public.youtube_connections (
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  channel_id text not null,
  channel_title text not null,
  thumbnail_url text,
  refresh_token_ciphertext text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_user_id, channel_id)
);

create index if not exists youtube_connections_owner_updated_idx
  on public.youtube_connections (owner_user_id, updated_at desc);

alter table public.youtube_connections enable row level security;
revoke all on table public.youtube_connections from anon, authenticated;
grant all on table public.youtube_connections to service_role;

comment on table public.youtube_connections is
  'Owner-scoped YouTube channel connections. Each channel has its own encrypted OAuth refresh token. Backend service role only.';

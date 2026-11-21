-- Upgrade the existing single-channel table without deleting stored channel tokens.
-- Run once in the existing Master AI Bot Supabase project's SQL Editor.
begin;

alter table public.youtube_connections
  drop constraint if exists youtube_connections_pkey;

alter table public.youtube_connections
  drop column if exists id;

alter table public.youtube_connections
  add constraint youtube_connections_pkey primary key (owner_user_id, channel_id);

create index if not exists youtube_connections_owner_updated_idx
  on public.youtube_connections (owner_user_id, updated_at desc);

alter table public.youtube_connections enable row level security;
revoke all on table public.youtube_connections from anon, authenticated;
grant all on table public.youtube_connections to service_role;

comment on table public.youtube_connections is
  'Owner-scoped YouTube channel connections. Each channel has its own encrypted OAuth refresh token; accessible only to the backend service role.';

commit;

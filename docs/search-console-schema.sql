-- Read-only Google Search Console OAuth connections.
create table if not exists public.search_console_connections (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  google_email text not null,
  refresh_token_ciphertext text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint search_console_connections_owner_email_unique
    unique (owner_user_id, google_email)
);

create index if not exists search_console_connections_owner_created_idx
  on public.search_console_connections (owner_user_id, created_at desc);

alter table public.search_console_connections enable row level security;
revoke all on table public.search_console_connections from anon, authenticated;
grant all on table public.search_console_connections to service_role;

comment on table public.search_console_connections is
  'Owner-scoped Google Search Console read-only OAuth refresh tokens. Tokens are AES-256-GCM encrypted by the backend; service-role only.';

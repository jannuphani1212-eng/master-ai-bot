-- Owner-scoped Instagram professional-account connections.
create table if not exists public.instagram_connections (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  ig_user_id text not null,
  username text,
  account_type text not null default 'UNKNOWN',
  access_token_ciphertext text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint instagram_connections_owner_account_unique
    unique (owner_user_id, ig_user_id)
);

create index if not exists instagram_connections_owner_created_idx
  on public.instagram_connections (owner_user_id, created_at desc);

alter table public.instagram_connections enable row level security;
revoke all on table public.instagram_connections from anon, authenticated;
grant all on table public.instagram_connections to service_role;

comment on table public.instagram_connections is
  'Owner-scoped Instagram professional-account OAuth tokens. Access tokens are AES-256-GCM encrypted by the backend; service-role only.';

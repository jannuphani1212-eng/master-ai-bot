-- Secure owner-only Blogger and WordPress.com connections and draft sync records.
create table if not exists public.blog_cms_connections (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('blogger', 'wordpress')),
  site_id text not null,
  site_name text not null,
  site_url text,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text,
  selected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blog_cms_connections_owner_provider_site_unique unique (owner_user_id, provider, site_id)
);

create index if not exists blog_cms_connections_owner_provider_idx
  on public.blog_cms_connections (owner_user_id, provider, selected);

create table if not exists public.blog_cms_publications (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  draft_id uuid not null references public.blog_drafts(id) on delete cascade,
  provider text not null check (provider in ('blogger', 'wordpress')),
  site_id text not null,
  remote_post_id text not null,
  remote_url text,
  status text not null default 'draft' check (status in ('draft', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blog_cms_publications_unique unique (owner_user_id, draft_id, provider)
);

create index if not exists blog_cms_publications_draft_id_idx\n  on public.blog_cms_publications (draft_id);\n\ncreate index if not exists blog_cms_publications_owner_created_idx
  on public.blog_cms_publications (owner_user_id, created_at desc);

alter table public.blog_cms_connections enable row level security;
alter table public.blog_cms_publications enable row level security;
revoke all on table public.blog_cms_connections from anon, authenticated;
revoke all on table public.blog_cms_publications from anon, authenticated;
grant all on table public.blog_cms_connections to service_role;
grant all on table public.blog_cms_publications to service_role;

comment on table public.blog_cms_connections is
  'Owner-scoped Blogger and WordPress.com OAuth credentials encrypted by the backend using AES-256-GCM; service-role only.';
comment on table public.blog_cms_publications is
  'Idempotency and remote draft references for owner-approved internal blog drafts; this integration only creates CMS drafts and never publishes.';

create table if not exists public.app_projects (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  project_type text not null default 'app' check (project_type in ('app','game_2d','game_3d')),
  description text not null default '',
  status text not null default 'planning' check (status in ('planning','in_progress','build_pending','build_passed','build_failed','archived')),
  repository_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists app_projects_owner_updated_idx on public.app_projects (owner_user_id, updated_at desc);
alter table public.app_projects enable row level security;
revoke all on public.app_projects from anon, authenticated;
grant select, insert, update, delete on public.app_projects to service_role;

create table if not exists public.app_project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.app_projects(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  file_path text not null check (char_length(file_path) between 1 and 240),
  language text not null default 'text',
  content text not null,
  content_sha256 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, file_path)
);
create index if not exists app_project_files_owner_project_idx on public.app_project_files (owner_user_id, project_id);
alter table public.app_project_files enable row level security;
revoke all on public.app_project_files from anon, authenticated;
grant select, insert, update, delete on public.app_project_files to service_role;
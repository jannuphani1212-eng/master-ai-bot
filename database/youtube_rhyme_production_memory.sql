-- Persistent owner-scoped production memory for YouTube rhyme/video projects.
-- Backend-only access: RLS enabled; no anon/authenticated policies.
create table if not exists public.youtube_rhyme_projects (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  channel_id text,
  rhyme_title text not null check (char_length(rhyme_title) between 1 and 180),
  script text not null default '',
  total_scenes integer not null default 0 check (total_scenes between 0 and 100),
  completed_scenes jsonb not null default '[]'::jsonb check (jsonb_typeof(completed_scenes) = 'array'),
  remaining_scenes jsonb not null default '[]'::jsonb check (jsonb_typeof(remaining_scenes) = 'array'),
  character_continuity jsonb not null default '{}'::jsonb check (jsonb_typeof(character_continuity) = 'object'),
  background_continuity jsonb not null default '{}'::jsonb check (jsonb_typeof(background_continuity) = 'object'),
  last_generated_clip jsonb not null default '{}'::jsonb check (jsonb_typeof(last_generated_clip) = 'object'),
  next_scene integer check (next_scene is null or next_scene between 1 and 100),
  cooldown_status text not null default 'not_waiting' check (cooldown_status in ('not_waiting','cooling_down','ready','unknown')),
  retry_at timestamptz,
  failed_clips jsonb not null default '[]'::jsonb check (jsonb_typeof(failed_clips) = 'array'),
  retry_attempts integer not null default 0 check (retry_attempts >= 0),
  production_status text not null default 'planning' check (production_status in ('planning','generating','cooldown','ready_for_review','complete','paused','needs_attention')),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists youtube_rhyme_projects_owner_updated_idx on public.youtube_rhyme_projects (owner_user_id, updated_at desc);
alter table public.youtube_rhyme_projects enable row level security;
revoke all on table public.youtube_rhyme_projects from anon, authenticated;
grant select, insert, update on table public.youtube_rhyme_projects to service_role;
comment on table public.youtube_rhyme_projects is 'Private server-written resumable production memory for YouTube rhyme projects; no public access or publishing permission.';

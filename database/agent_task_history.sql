-- Persistent, owner-scoped history for all six Master AI Bot agents.
-- Access is server-only: RLS is enabled and no anon/authenticated policies are created.
create table if not exists public.agent_task_history (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null check (agent_id in ('master','youtube','affiliate','blogging','app-development','seo')),
  task text not null check (char_length(task) between 1 and 10000),
  status text not null check (status in ('completed','needs_attention','failed')),
  provider text,
  quality_score smallint check (quality_score is null or quality_score between 0 and 100),
  report text,
  error text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

alter table public.agent_task_history enable row level security;
revoke all on table public.agent_task_history from anon, authenticated;
grant select, insert on table public.agent_task_history to service_role;

create index if not exists agent_task_history_owner_agent_created_idx
  on public.agent_task_history (owner_user_id, agent_id, created_at desc);

comment on table public.agent_task_history is
  'Private server-written task history for the six Master AI Bot agents. Backend validates owner identity before every read/write.';

-- Versioned copy of docs/autonomous-operations-schema.sql.
-- Apply through Supabase migrations; all objects are created idempotently.
create table if not exists public.master_ai_job_queue (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null check (agent_id in ('affiliate','youtube','blogging','app-development','seo')),
  task text not null check (char_length(task) between 1 and 10000),
  idempotency_key text not null,
  status text not null default 'pending' check (status in ('pending','running','completed','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 4 check (max_attempts between 1 and 8),
  next_run_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  last_error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique(owner_user_id, idempotency_key)
);
create index if not exists master_ai_job_queue_claim_idx on public.master_ai_job_queue(status, next_run_at, created_at);
create index if not exists master_ai_job_queue_owner_idx on public.master_ai_job_queue(owner_user_id, created_at desc);
alter table public.master_ai_job_queue enable row level security;
revoke all on public.master_ai_job_queue from anon, authenticated;
grant all on public.master_ai_job_queue to service_role;

create or replace function public.claim_master_ai_job(p_worker_id text)
returns setof public.master_ai_job_queue
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_worker_id is null or length(trim(p_worker_id)) < 3 then
    raise exception 'A worker ID is required';
  end if;
  return query
  with candidate as (
    select q.id from public.master_ai_job_queue q
    where q.attempts < q.max_attempts
      and q.next_run_at <= now()
      and (q.status = 'pending' or (q.status = 'running' and q.locked_at < now() - interval '10 minutes'))
    order by q.created_at asc
    for update skip locked
    limit 1
  )
  update public.master_ai_job_queue q
  set status = 'running', attempts = q.attempts + 1, locked_at = now(), locked_by = p_worker_id, last_error = null
  from candidate c where q.id = c.id
  returning q.*;
end;
$$;
revoke all on function public.claim_master_ai_job(text) from public, anon, authenticated;
grant execute on function public.claim_master_ai_job(text) to service_role;

create table if not exists public.master_ai_notifications (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text check (agent_id is null or agent_id in ('master','affiliate','youtube','blogging','app-development','seo')),
  notification_type text not null default 'agent_update',
  title text not null check (char_length(title) between 1 and 180),
  body text not null default '',
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists master_ai_notifications_owner_idx on public.master_ai_notifications(owner_user_id, created_at desc);
alter table public.master_ai_notifications enable row level security;
revoke all on public.master_ai_notifications from anon, authenticated;
grant all on public.master_ai_notifications to service_role;

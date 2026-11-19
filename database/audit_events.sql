-- Private, server-written audit trail for owner-authenticated API activity.
create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (char_length(event_type) between 1 and 120),
  http_method text not null check (char_length(http_method) between 1 and 12),
  route text not null check (char_length(route) between 1 and 240),
  status_code integer not null check (status_code between 0 and 599),
  duration_ms integer not null default 0 check (duration_ms >= 0),
  ip_hash text check (ip_hash is null or ip_hash ~ '^[a-f0-9]{64}$'),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  created_at timestamptz not null default now()
);

create index if not exists audit_events_actor_created_idx
  on public.audit_events (actor_user_id, created_at desc);

alter table public.audit_events enable row level security;
revoke all on table public.audit_events from anon, authenticated;
grant all on table public.audit_events to service_role;

comment on table public.audit_events is
  'Private server-written audit trail. No request bodies, access tokens, passwords, or API keys are stored.';

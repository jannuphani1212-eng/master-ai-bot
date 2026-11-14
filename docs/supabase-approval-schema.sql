-- Master AI Bot: owner-controlled approval records
-- Run this in the dedicated Supabase project connected to Master AI Bot.
-- This schema records proposals and decisions only. It never executes external actions.

create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id),
  title text not null check (char_length(title) between 1 and 200),
  action_type text not null check (
    action_type in (
      'publish', 'send', 'purchase', 'spend',
      'delete', 'account_change', 'deploy', 'other'
    )
  ),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id),
  decision_note text,
  constraint approval_decision_consistency check (
    (status = 'pending' and decided_at is null and decided_by is null)
    or
    (status in ('approved', 'rejected') and decided_at is not null and decided_by is not null)
  )
);

create index if not exists approval_requests_owner_status_created_idx
  on public.approval_requests (owner_id, status, created_at desc);

alter table public.approval_requests enable row level security;

drop policy if exists "Owner can read own approval requests" on public.approval_requests;
create policy "Owner can read own approval requests"
  on public.approval_requests for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Owner can create own approval requests" on public.approval_requests;
create policy "Owner can create own approval requests"
  on public.approval_requests for insert to authenticated
  with check ((select auth.uid()) = owner_id and (select auth.uid()) = created_by);

drop policy if exists "Owner can decide pending approval requests" on public.approval_requests;
create policy "Owner can decide pending approval requests"
  on public.approval_requests for update to authenticated
  using ((select auth.uid()) = owner_id and status = 'pending')
  with check (
    (select auth.uid()) = owner_id
    and status in ('approved', 'rejected')
    and decided_by = (select auth.uid())
    and decided_at is not null
  );

create or replace function public.guard_approval_request_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status <> 'pending' then
    raise exception 'Only pending requests can be decided';
  end if;

  if new.id is distinct from old.id
     or new.owner_id is distinct from old.owner_id
     or new.created_by is distinct from old.created_by
     or new.title is distinct from old.title
     or new.action_type is distinct from old.action_type
     or new.payload is distinct from old.payload
     or new.created_at is distinct from old.created_at then
    raise exception 'Approval request details are immutable';
  end if;

  if new.status not in ('approved', 'rejected') then
    raise exception 'A pending request can only be approved or rejected';
  end if;

  new.decided_at := now();
  new.decided_by := (select auth.uid());
  return new;
end;
$$;

drop trigger if exists approval_request_update_guard on public.approval_requests;
create trigger approval_request_update_guard
  before update on public.approval_requests
  for each row execute function public.guard_approval_request_update();

-- New public-schema tables are not automatically exposed through the Data API.
-- Grant only the authenticated role; RLS still limits rows to the owner.
grant usage on schema public to authenticated;
grant select, insert, update on table public.approval_requests to authenticated;

-- Deliberately no anon grant and no DELETE policy: requests remain private and auditable.

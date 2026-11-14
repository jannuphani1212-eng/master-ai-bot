-- Cover existing foreign keys reported by the Supabase performance advisor.
create index if not exists approval_requests_created_by_idx
  on public.approval_requests (created_by);

create index if not exists approval_requests_decided_by_idx
  on public.approval_requests (decided_by);

create index if not exists youtube_connections_owner_user_id_idx
  on public.youtube_connections (owner_user_id);

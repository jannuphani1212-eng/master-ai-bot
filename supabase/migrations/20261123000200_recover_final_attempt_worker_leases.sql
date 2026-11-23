-- Prevent a worker crash on the final attempt from leaving a job in running forever.
-- Expired jobs with retries remaining can still be reclaimed by the existing SKIP LOCKED claim query.
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

  update public.master_ai_job_queue
  set status = 'failed',
      finished_at = now(),
      locked_at = null,
      locked_by = null,
      last_error = coalesce(last_error, 'Worker lease expired after the final retry')
  where status = 'running'
    and attempts >= max_attempts
    and locked_at < now() - interval '10 minutes';

  return query
  with candidate as (
    select q.id
    from public.master_ai_job_queue q
    where q.attempts < q.max_attempts
      and q.next_run_at <= now()
      and (
        q.status = 'pending'
        or (q.status = 'running' and q.locked_at < now() - interval '10 minutes')
      )
    order by q.created_at asc
    for update skip locked
    limit 1
  )
  update public.master_ai_job_queue q
  set status = 'running',
      attempts = q.attempts + 1,
      locked_at = now(),
      locked_by = p_worker_id,
      last_error = null
  from candidate c
  where q.id = c.id
  returning q.*;
end;
$$;

revoke all on function public.claim_master_ai_job(text) from public, anon, authenticated;
grant execute on function public.claim_master_ai_job(text) to service_role;

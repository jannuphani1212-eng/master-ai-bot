-- Distinguish provider quota exhaustion from a completed failure.
-- A blocked job is durable and visible, but the claim function never executes it.
alter table public.master_ai_job_queue
  drop constraint if exists master_ai_job_queue_status_check;

alter table public.master_ai_job_queue
  add constraint master_ai_job_queue_status_check
  check (status in ('pending', 'running', 'completed', 'failed', 'blocked'));

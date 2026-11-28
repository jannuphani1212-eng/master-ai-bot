-- Give existing quota-blocked tasks a full 24-hour cooldown before automatic requeue.
update public.master_ai_job_queue
set next_run_at = greatest(created_at + interval '24 hours', now())
where status = 'blocked'
  and next_run_at < created_at + interval '24 hours';

-- Make daily blog and affiliate artifacts idempotent per queue job.
alter table public.affiliate_campaigns
  add column if not exists source_job_id uuid references public.master_ai_job_queue(id) on delete set null;

create unique index if not exists blog_drafts_source_job_id_unique
  on public.blog_drafts(source_job_id);

create unique index if not exists affiliate_campaigns_source_job_id_unique
  on public.affiliate_campaigns(source_job_id);

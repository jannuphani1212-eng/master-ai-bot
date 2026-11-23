-- Make daily affiliate and blog artifacts idempotent per persistent queue job.
alter table public.affiliate_campaigns
  add column if not exists source_job_id uuid references public.master_ai_job_queue(id) on delete set null;

-- PostgreSQL unique indexes allow multiple NULL values by default, while
-- ensuring one non-null artifact per source queue job.
drop index if exists public.blog_drafts_source_job_id_unique;
drop index if exists public.affiliate_campaigns_source_job_id_unique;
create unique index blog_drafts_source_job_id_unique on public.blog_drafts(source_job_id);
create unique index affiliate_campaigns_source_job_id_unique on public.affiliate_campaigns(source_job_id);

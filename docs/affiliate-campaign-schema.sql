-- Owner-only affiliate content drafts and first-party click attribution.
create table if not exists public.affiliate_campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  product_name text not null check (char_length(product_name) between 1 and 180),
  category text not null check (char_length(category) between 1 and 80),
  merchant text,
  product_url text,
  affiliate_url text,
  commission_rate numeric(5,2) check (commission_rate is null or (commission_rate >= 0 and commission_rate <= 100)),
  commission_status text not null default 'not_provided'
    check (commission_status in ('not_provided', 'owner_supplied_unverified', 'verified_from_official_source')),
  research_status text not null default 'needs_live_verification'
    check (research_status in ('needs_live_verification', 'owner_supplied', 'official_source_verified')),
  content_json jsonb not null check (jsonb_typeof(content_json) = 'object'),
  generation_provider text not null,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists affiliate_campaigns_owner_created_idx
  on public.affiliate_campaigns (owner_user_id, created_at desc);

create table if not exists public.affiliate_click_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.affiliate_campaigns(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'other'
    check (source in ('youtube_shorts', 'instagram_reels', 'blog', 'other')),
  clicked_at timestamptz not null default now()
);

create index if not exists affiliate_click_events_campaign_clicked_idx
  on public.affiliate_click_events (owner_user_id, campaign_id, clicked_at desc);

create index if not exists affiliate_click_events_campaign_id_idx
  on public.affiliate_click_events (campaign_id);

alter table public.affiliate_campaigns enable row level security;
alter table public.affiliate_click_events enable row level security;
revoke all on table public.affiliate_campaigns from anon, authenticated;
revoke all on table public.affiliate_click_events from anon, authenticated;
grant all on table public.affiliate_campaigns to service_role;
grant all on table public.affiliate_click_events to service_role;

comment on table public.affiliate_campaigns is
  'Owner-scoped affiliate campaign drafts. Product claims and commission terms remain unverified until supported by an official source.';
comment on table public.affiliate_click_events is
  'First-party click counts for owner-approved affiliate campaigns. No IP address or user-agent is stored.';

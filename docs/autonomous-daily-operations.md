# Autonomous daily operations

This feature adds a durable Supabase-backed queue, idempotent daily assignments for all five specialists, retry/lease recovery, and owner-scoped in-app notifications. The daily run creates drafts and reports only. It does not publish, send, spend, or modify connected accounts.

## 1. Database setup

Run `docs/autonomous-operations-schema.sql` in the Supabase SQL Editor for the existing Master AI Bot project. It creates:

- `master_ai_job_queue`: durable jobs, retry counts, lease ownership, idempotency keys, output and failure details.
- `claim_master_ai_job(text)`: atomic `FOR UPDATE SKIP LOCKED` claim function so two workers cannot claim the same job.
- `master_ai_notifications`: private owner-scoped in-app completion and failure notices.

RLS is enabled and direct access for `anon` and `authenticated` is revoked. Only the server service role can access these tables and claim jobs.

## 2. Web service environment

Keep existing variables and add a long random value as `SCHEDULER_SHARED_SECRET` to the existing Render web service. Do not put this value in GitHub or frontend code. The existing server also needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a valid `SUPABASE_OWNER_USER_ID` for the owner account. The service-role key must remain server-side.

## 3. Free daily schedule

The repository includes `.github/workflows/daily-autonomous-ops.yml`, which runs every day at 02:30 UTC (08:00 India Standard Time) and can also be started manually from GitHub Actions. It calls `node scripts/daily-scheduler.js`, which triggers the web service and polls until all five daily jobs reach a terminal state.

Add these two GitHub repository Actions secrets (Settings → Secrets and variables → Actions → New repository secret):

- `SCHEDULER_SHARED_SECRET` = the exact same value configured on the Render web service. The web-service URL is already set in the workflow and is not a secret.

Do not put the shared secret in the repository, source files, or workflow YAML. The Render web service needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_OWNER_USER_ID`, and `SCHEDULER_SHARED_SECRET`. The daily cron is intentionally implemented with GitHub Actions to avoid creating a paid Render Cron resource. If a Render Cron is ever used instead, it must only be created after its price is reviewed and approved.

The cron process calls the authenticated internal endpoint, then polls `/api/internal/daily-status` while the web service background worker drains the queue. It re-triggers the idempotent scheduler if the web service restarts and leaves pending jobs.

## 4. Daily production

The queue creates one idempotent task per day for Affiliate, YouTube, Blogging, App Development, and SEO. SEO runs after the other four and receives their completed reports as context. Re-running the same daily schedule does not create duplicate tasks for that owner/day/agent. Failed tasks are retried with exponential backoff, up to four attempts. A job with a lost worker lease can be reclaimed after ten minutes.

YouTube daily work produces original rhyme scripts, scene prompts, and consistency notes and reuses saved rhyme memory when available. It does not claim to have rendered clips. Actual video generation remains dependent on the separately configured and quota-limited video-generation integration.

## 5. Notifications and verification

Owner-only APIs:
- `GET /api/queue`
- `GET /api/notifications`
- `PATCH /api/notifications/:id/read`

The daily-run endpoint is internal and requires the bearer secret. It returns an accepted queue response; `/api/internal/daily-status` returns job states, counts and whether all five jobs have reached a terminal state. Confirm a full five-agent run from the cron logs and Supabase queue/history records.

## 6. Integrations and publishing

Existing OAuth and portfolio tables are not the same as connected accounts. Connect each service through its official OAuth flow and verify the connection status. Blog and Instagram integrations must be tested with the actual owner account. Draft creation and reporting can run automatically; publishing remains locked behind the existing explicit owner-approval policy. Commission and revenue figures must come from official platform reports or owner-verified imports; estimates are never counted as earnings.

## 7. Reliability checks

Run `npm test` and verify the Render deploy and cron run logs. A successful health/readiness check alone is not proof of daily production. Multi-day reliability requires observing several consecutive scheduled runs, including at least one forced retry and one server restart/reclaim test.

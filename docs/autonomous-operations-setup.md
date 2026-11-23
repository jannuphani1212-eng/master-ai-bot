# Autonomous operations setup

This extends the existing Master AI Bot with an owner-scoped persistent queue, daily specialist draft production, retries, lease recovery, in-app notifications, and a scheduled trigger.

## What runs

- Five daily specialist jobs: Affiliate, YouTube, Blogging, App Development, and SEO.
- The queue is stored in Supabase and deduplicated by owner + India-local date + specialist.
- The SEO job receives the status and outputs of the other four jobs.
- Failed jobs retry with bounded exponential backoff (30 seconds, 60 seconds, 120 seconds, then terminal failure).
- Worker leases are renewed while a job is running. A crashed worker's lease can be reclaimed after 10 minutes.
- Results are saved in the existing owner-scoped agent history and queue tables; completion, retry, and failure notifications are stored in Supabase.
- Daily outputs are drafts. This workflow does not publish, send, spend, delete, or deploy.

## Database

The migration is in `supabase/migrations/20261123000000_master_ai_autonomous_job_queue.sql`. It was applied to the connected Supabase project. The tables use RLS and deny direct anon/authenticated access; the server uses its service-role key.

## One-time scheduler secret

The scheduled GitHub Actions workflow calls the protected Render endpoint. It needs one dedicated random secret in both places:

1. Generate a long random secret (at least 32 random bytes). Do not reuse a password, Google token, or Supabase key.
2. In Render, open the existing `master-ai-bot` web service → Environment → add `SCHEDULER_SHARED_SECRET` with that secret → save changes. This restarts the web service.
3. In GitHub, open the repository → Settings → Secrets and variables → Actions → New repository secret. Name it `SCHEDULER_SHARED_SECRET` and paste the exact same value.
4. Keep the value private. Never paste it into chat, source files, issue comments, or logs.

The scheduled workflow is `.github/workflows/daily-autonomous.yml`. It runs every 30 minutes so it can both enqueue the day's idempotent work and recover pending jobs after a restart. GitHub scheduled workflows run only from the repository's default branch, so this file must be merged into `main` before the schedule becomes active. You can also run it manually from Actions after the secret is configured.

## Integration boundaries

- YouTube: existing Google OAuth integration reads channel details and analytics. Video generation uses the separate Gemini video workflow. Upload/publish is not enabled.
- Blogging: existing Blogger / WordPress connection stores credentials and draft records; CMS publication is not enabled.
- Instagram: existing professional-account connection and approval-linked publish-job tables exist; connect a professional account before any future publishing workflow.
- Affiliate: campaign drafts and first-party click events are supported. Commission rows are owner-imported and remain unverified until reviewed.
- SEO: Search Console connection is read-only and is used for measured search data when connected.

Account connections and platform permissions are still required. A table or integration module does not mean an account is connected or that a live publish action has been tested. Do not enable external publishing without an explicit owner approval flow and a successful platform-specific integration test.

## Verification

Run `npm test`, `node --check server.js`, and `node --check lib/persistent-queue.js`. GitHub Actions runs the repository test suite on feature branches and pull requests. Monitor `/api/internal/daily-status` with the scheduler bearer secret and the owner-only `/api/queue` and `/api/notifications` endpoints after enabling the schedule.

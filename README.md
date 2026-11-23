# Master AI Bot

A mobile-friendly AI command center with one Master AI Brain and five specialist agents.

## Agents

- **Master AI Brain** — plans work, delegates to specialists, compares their outputs, and produces a combined response.
- **Affiliate Marketing** — India-first affiliate research, ethical promotion, commission calculations, disclosures, and conversion planning.
- **YouTube** — original video concepts, scripts, titles, descriptions, audience and retention planning.
- **Blogging** — useful article outlines and drafts, search intent, structure, and fact-check reminders.
- **App Development** — beginner-friendly application planning, complete code files, troubleshooting, and testing guidance.
- **SEO** — keyword clusters, technical and on-page SEO, content briefs, and ethical optimisation.

## AI provider fallback

The backend tries providers in this order:

1. Groq
2. OpenRouter
3. Gemini

Configure keys only as server-side environment variables. Optional model overrides are GEMINI_MODEL, GROQ_MODEL, and OPENROUTER_MODEL.

The fallback layer skips providers without configured keys or providers currently in cooldown. A successful provider response is required; empty responses count as failures. Cooldowns are process-local and reset when the server restarts.

## Safety and approvals

This application currently generates plans and draft content. It does **not** publish content, send messages, spend money, delete data, change accounts, or deploy code automatically.

A person must review and explicitly approve any external action. API keys must never be placed in frontend files or committed to GitHub.

The task and brain endpoints have a basic per-IP request limit to reduce accidental overuse. This is an in-memory limit and is not a substitute for authentication or a production abuse-prevention service.

## Global Rhymes 4U YouTube connection\n\nThe YouTube Bot can connect to the dedicated channel through Google server-side OAuth. The first integration is read-only: channel profile, recent uploads, public channel statistics, and YouTube Analytics for the last 28 days. When the Master Brain delegates a task to the YouTube Bot, it can include the connected channel history and recent performance as live context. OAuth refresh tokens are encrypted on the server and stored in the existing Supabase project. Follow [the YouTube channel setup guide](docs/youtube-channel-setup.md) and run [the token-storage schema](docs/youtube-connection-schema.sql). Uploading and publishing are intentionally not enabled in this first release.\n\n## Supabase approval storage

The owner-only approval API uses the Supabase Auth user access token and the public anon key with Row Level Security. Configure SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_OWNER_USER_ID only in the server environment. Do not use a service-role key for this API and never expose private credentials to the browser. Run docs/supabase-approval-schema.sql in the Supabase SQL Editor first, then create the owner account and configure the server variables. Approval decisions are recorded only; they do not execute external actions. See docs/approval-queue-setup.md.

## Run locally

Requirements: Node.js 20 or newer.

```bash
npm install
npm test
npm start
```

Set the provider keys in a local .env file or your hosting provider's environment settings. Never commit .env.

## API

- GET /api/health — basic health check.
- GET /api/status — configured providers, cooldowns, models, and agent list. It does not return API keys.
- POST /api/task — run a selected agent or the Master Brain.
- POST /api/brain — run the Master Brain.
- GET /api/approvals/config — returns only the public Supabase URL and anon key needed for owner sign-in; it never returns the owner UUID or service-role key.
- GET /api/approvals — list the owner's approval proposals (requires a Supabase access token).
- POST /api/approvals — save a proposal (requires a Supabase access token).
- PATCH /api/approvals/:id/decision — approve or reject a pending proposal (requires a Supabase access token).\n- GET /api/youtube/oauth/callback — Google OAuth callback (validates signed, short-lived state).\n- GET /api/youtube/connect-url — create a Google authorization URL (owner token required).\n- GET /api/youtube/status — check whether the owner channel is connected (owner token required).\n- GET /api/youtube/channel — retrieve connected channel profile and statistics (owner token required).\n- GET /api/youtube/videos — retrieve up to 20 recent uploads (owner token required).\n- GET /api/youtube/analytics — retrieve channel analytics for the last 28 days (owner token required).

Example request:

```json
{
  "agentId": "master",
  "task": "Use all five specialists to create a practical launch plan."
}
```

For a Master request, the response includes each specialist's status and report, the combined response, provider information, and an approval notice. Partial results are returned with partialSuccess: true when at least one specialist succeeds and another fails.

The dashboard includes an owner sign-in and approval queue. The Supabase anon key is public by design; access is restricted by Auth verification, the server-side owner allowlist, and database RLS. The short-lived access token is kept in page memory. A rotating Supabase refresh token is stored in browser localStorage so the owner session can be restored after a page refresh; signing out clears it. Browser storage restrictions or an expired/revoked refresh token can still require the owner to sign in again.

See [the five specialist income workflows](docs/income-workflows.md) for the India-first planning steps and approval checkpoints.\n\n## Tests\n
Run npm test for routing and provider-fallback unit tests. GitHub Actions also checks JavaScript syntax, runs the tests, and validates package.json on the feature branch and pull requests to main.

These tests validate the routing and fallback orchestration logic. They do not prove that live Gemini, Groq, or OpenRouter credentials are valid or that all live provider APIs are available.

## Deployment status

Do not consider a change live until it has been merged and the hosting deployment has completed. Check /api/health and /api/status after deployment, then test real AI requests.

Earnings are not guaranteed. AI output can contain mistakes; verify facts, platform rules, legal requirements, prices, and commission rates before acting.


## Autonomous daily operations

The autonomous operations feature adds a Supabase-backed idempotent job queue, retry and worker-lease recovery, daily assignments for all five specialists, and owner-only in-app notifications. Daily work is draft-only; publishing, sending, spending, account changes and deployments remain behind explicit owner approval.

See [Autonomous Daily Operations setup](docs/autonomous-daily-operations.md) and run [the queue and notification schema](docs/autonomous-operations-schema.sql) in the existing Supabase project. The Render web service needs the existing Supabase server credentials and `SUPABASE_OWNER_USER_ID`, plus a strong `SCHEDULER_SHARED_SECRET`. The GitHub Actions workflow `.github/workflows/daily-autonomous-ops.yml` calls `scripts/daily-scheduler.js` at 08:00 India time (02:30 UTC). Add `MASTER_AI_BOT_URL` and `SCHEDULER_SHARED_SECRET` as GitHub repository Actions secrets; do not put the secret in source code. This avoids a paid Render Cron resource.

Owner-only endpoints: `GET /api/queue`, `GET /api/notifications`, and `PATCH /api/notifications/:id/read`. The internal daily-run endpoint is protected by the shared bearer secret.

The daily YouTube task creates rhyme scripts and scene prompts and resumes saved project context. It does not itself render video. Video generation depends on the separately configured video-generation provider and its quotas. Real account integrations must be connected and tested before any live metrics or CMS/social actions can be claimed.

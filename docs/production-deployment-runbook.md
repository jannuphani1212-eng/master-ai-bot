# Master AI Bot production deployment runbook

## Production target

- Render service: `master-ai-bot`
- Production URL: `https://master-ai-bot-iskj.onrender.com`
- Source repository: `jannuphani1212-eng/master-ai-bot`
- Production branch: `main`
- Current Render configuration: automatic deploy on commits is enabled.
- Health endpoint: `GET /api/health`
- Status endpoint: `GET /api/status`

**Important:** Merging PR #20 into `main` will trigger the connected Render service's automatic deployment. Do not merge until the owner has reviewed the PR and the release gates below are satisfied.

## Pre-deployment gates

1. PR #20 is open, targets `main`, has no merge conflicts and all required GitHub Actions checks are green.
2. Confirm the exact PR head SHA and the current live Render deploy SHA before merge.
3. Confirm the Render environment contains the required keys. Never print secret values in logs or expose them in the browser.
4. Confirm Supabase schema changes are applied to the intended project and owner authentication is configured.
5. Enable Supabase Auth leaked-password protection in the project's password-security settings.
6. Confirm OAuth callback URLs exactly match the production Render URL.
7. Confirm the Android debug AAB workflow passes; a debug AAB is not a Play Store release.
8. Do not enable any automatic external publishing. Instagram publishing still requires the explicit owner approval and publish action.

## Environment variable checklist

### Core AI and owner security

- `GEMINI_API_KEY`
- `GROQ_API_KEY`
- `OPENROUTER_API_KEY`
- `AI_PROVIDER_ORDER` (recommended: `groq,openrouter,gemini`)
- Optional model overrides: `GEMINI_MODEL`, `GROQ_MODEL`, `OPENROUTER_MODEL`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_OWNER_USER_ID`
- `SUPABASE_SERVICE_ROLE_KEY`

### YouTube

- `YOUTUBE_CLIENT_ID`
- `YOUTUBE_CLIENT_SECRET`
- `YOUTUBE_REDIRECT_URI=https://master-ai-bot-iskj.onrender.com/api/youtube/oauth/callback`
- `YOUTUBE_TOKEN_ENCRYPTION_KEY` (64 hexadecimal characters)

### Instagram

- `INSTAGRAM_APP_ID`
- `INSTAGRAM_APP_SECRET`
- `INSTAGRAM_REDIRECT_URI=https://master-ai-bot-iskj.onrender.com/api/instagram/oauth/callback`
- `INSTAGRAM_TOKEN_ENCRYPTION_KEY` (64 hexadecimal characters)

### Google Search Console

- `GOOGLE_SEARCH_CONSOLE_CLIENT_ID`
- `GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET`
- `GOOGLE_SEARCH_CONSOLE_REDIRECT_URI=https://master-ai-bot-iskj.onrender.com/api/seo/search-console/oauth/callback`
- `SEARCH_CONSOLE_TOKEN_ENCRYPTION_KEY` (64 hexadecimal characters; the YouTube key may be reused as documented)

### Blogger and WordPress.com

- `BLOG_CMS_TOKEN_ENCRYPTION_KEY` (64 hexadecimal characters; the YouTube key may be reused)
- `BLOGGER_CLIENT_ID`
- `BLOGGER_CLIENT_SECRET`
- `BLOGGER_REDIRECT_URI=https://master-ai-bot-iskj.onrender.com/api/blog/cms/blogger/callback`
- `WORDPRESS_CLIENT_ID`
- `WORDPRESS_CLIENT_SECRET`
- `WORDPRESS_REDIRECT_URI=https://master-ai-bot-iskj.onrender.com/api/blog/cms/wordpress/callback`

Only configure integrations the owner intends to connect. Missing optional provider keys should result in a clearly reported unconfigured integration, not a fabricated connection.

## Deployment sequence

1. Save the current live deploy ID and commit SHA.
2. Review PR #20's final diff and confirm all CI workflows have completed successfully.
3. Owner explicitly approves merging PR #20.
4. Merge PR #20; Render's configured auto-deploy will build the new `main` commit.
5. Monitor the Render deploy until its terminal state is `live`. A queued or started deploy is not a successful deploy.
6. Verify `GET /api/health` returns HTTP 200 and `GET /api/status` returns provider configuration state without exposing secrets.
7. Verify the dashboard loads, owner sign-in succeeds, and protected APIs reject unauthenticated requests.
8. Run the provider and specialist smoke tests below.
9. Review Render runtime logs for startup errors, unhandled rejections, provider errors and Supabase failures.
10. Keep the prior successful deploy available for rollback until the new release is stable.

## Smoke tests after deployment

- Public health and status endpoints return the expected response.
- Owner-only task, brain, YouTube, affiliate, Instagram, SEO and blog endpoints return 401 without a valid owner bearer token.
- The owner can sign in and load the approval centre.
- Test each configured AI provider individually, then force a temporary test-only provider failure and verify fallback order. Never change production keys to invalid values merely to test fallback.
- Run one harmless prompt through each of the five specialists: Affiliate Marketing, YouTube, Blogging, App Development and SEO. Confirm provider metadata and structural-quality audit are based on actual server results.
- Connect and read each external account only after the owner has configured OAuth credentials and granted access.
- Create Blogger/WordPress drafts only; verify they remain drafts.
- Instagram must remain proposal/approval gated; never publish a test Reel without the owner's separate explicit instruction.
- Verify affiliate click tracking with an owner-approved test link. Do not claim sales or commissions without official network evidence.
- Install and open the debug Android app on a real device; verify sign-in, navigation, back behavior, and external OAuth handoff.

## Rollback

If the new deployment fails health checks or causes a production regression:

1. Stop further merges and external publishing.
2. Inspect the failed deploy's build/start logs and identify the first failing stage.
3. Use Render's rollback to the recorded prior successful deploy if the application code is the cause.
4. Verify the rollback is live and smoke-test health, owner sign-in and dashboard.
5. Do not assume database changes or external actions are rolled back with application code. Keep schema changes backward-compatible and reconcile any external side effects separately.
6. Confirm Render's automatic-deploy setting after rollback before making another code change.

## Known release blockers

- Live provider failover and real specialist requests still need the owner's configured API keys and production smoke tests.
- YouTube, Instagram, Search Console, Blogger and WordPress.com require owner OAuth credentials and account grants.
- Supabase leaked-password protection is currently reported disabled.
- The Android app is a WebView companion, not a native rewrite; real-device and OAuth behavior must be tested.
- Direct official affiliate product/order/commission APIs are not yet implemented; commission imports depend on official source exports.
- No production deployment, live publishing, affiliate income or payouts are claimed by this runbook.

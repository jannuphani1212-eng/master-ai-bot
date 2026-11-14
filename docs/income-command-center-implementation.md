# Master AI Bot — income command-centre implementation

## Product boundaries

This repository is the existing Master AI Bot only: one coordinating Master agent and five specialists (Affiliate Marketing, App Development, YouTube, Blogging, SEO). It is not the separate MASTER AI CORPORATION – 1000 project. Do not share its database, credentials, agents, or deployment.

## Owner and safety rules

- Owner authentication is required for AI task execution and account-management routes.
- External actions are drafts until an owner explicitly approves them.
- Never publish, spend, purchase, delete, or deploy as a side effect of generating a draft.
- Store OAuth refresh tokens encrypted server-side. Never expose provider keys, service-role keys, or refresh tokens to browser code or logs.
- Display actual connected-account metrics only. Use "not connected" or "unavailable" rather than fabricated numbers.
- Keep each connected channel/account isolated by platform account ID and owner ID.

## 1. Provider stability

- Make provider order configurable with `AI_PROVIDER_ORDER`; preserve Gemini as an optional provider until the owner explicitly removes it.
- Record provider attempt, success, failure class, retry-after and cooldown in sanitized operational logs.
- Apply per-provider request timeouts, bounded retry/backoff for transient 429/5xx/network errors, and skip providers in cooldown.
- Validate every successful completion contains usable text. Continue fallback on empty, malformed or reasoning-only output.
- Never log authorization headers, API keys, full prompts containing secrets, or response bodies that might contain personal data.
- Add deterministic tests for provider ordering, cooldowns, missing keys, empty output, callback failures and all-provider failure.

## 2. Premium dashboard

- Preserve existing task form, owner approval flow and Global Rhymes 4U read-only panel.
- Use the navy / gold / blue glass visual system and responsive mobile-first layout.
- Metrics must be sourced from backend APIs and clearly distinguish live values from unavailable values.
- Add separate sections for agents, approval queue, affiliate pipeline, connected accounts, system health and actual revenue.

## 3. Affiliate research and video production

- Research all popular product categories for Indian audiences, Telugu + English.
- Product records should include product name, category, merchant, current checked price, commission terms, source URL, checked timestamp, claim evidence and disclosure requirements.
- Rank on audience fit, quality evidence, value and commission opportunity; commission alone must not determine recommendations.
- Generate separate YouTube Shorts and Instagram Reels packages: hook, bilingual script, scene plan, voiceover text, captions, title, tags, thumbnail brief, affiliate disclosure and CTA.
- Never invent product specifications, prices, reviews, stock, discount or commission rates. Mark unverified fields.
- Content status lifecycle: research -> draft -> quality review -> owner approval -> published -> performance review.

## 4. Multiple YouTube channels

- Replace the current single-row/single-channel storage assumption with an owner-scoped channel table keyed by owner + provider channel ID. The multi-channel schema, encrypted token storage, channel selector, channel-scoped read-only API requests and selected-channel specialist context are implemented on the feature branch; deployment still requires running the SQL schema and reconnecting accounts.
- Keep Global Rhymes 4U as its own connection and add the affiliate channel as a separate connection.
- Encrypt each refresh token with authenticated encryption and bind OAuth state to the owner and intended connection flow.
- Read-only analytics and channel data can be enabled after authorization. Upload/edit/delete remain disabled until a separate publishing feature and explicit approval are implemented.
- Respect YouTube API quota, OAuth verification and refresh-token lifecycle.

## 5. Instagram

- Implemented on the feature branch: Meta Instagram Login OAuth for professional Business/Creator accounts, owner-signed state, short-to-long-lived token exchange, AES-256-GCM token storage, token refresh and reconnect status.
- The `instagram_connections` and `instagram_publish_jobs` Supabase tables are applied with RLS enabled and service-role-only privileges.
- Implemented: exact-content Reel approval request (account + public HTTPS video URL + caption), disclosure/rights attestations, Owner Approval Center gate, media-container preparation, processing-status check, publishing-quota check and a separate explicit publish action.
- A conditional single-use job reservation prevents concurrent duplicate publish calls. Uncertain final results are marked `publish_unknown` rather than blindly retried.
- Dashboard connection and publish workflow UI are implemented. Meta app credentials, required publishing permission and real-account authorization remain owner setup steps.
- Automated tests use mocked Meta responses; live end-to-end publishing has not been tested.
- The Affiliate Video Studio currently creates scripts and captions, not finished video files; the owner must supply a publicly accessible compatible video URL.

## 6. Affiliate tracking and commissions

- Implemented: owner-scoped campaign drafts, owner-approved HTTPS tracking links, source-specific first-party redirects and exact database click counts.
- Implemented: normalized official commission CSV import, unique order de-duplication, owner review/verification and currency-separated summaries. Only owner-confirmed entries contribute to verified pending/approved/paid totals.
- The CSV importer expects the documented normalized columns; it does not yet parse arbitrary vendor export formats or call affiliate program APIs directly.
- Still needed: live product/catalog research, direct order/commission API connectors, returns/cancellations, expenses, payout reconciliation and net-profit reporting.
- Never infer sales from views or clicks; no fake revenue figures.

## 7. App Development cloud AAB

- Implemented: manual GitHub Actions Android cloud AAB workflow with project-path and debug/release inputs, Gradle build, artifact upload and SHA-256 checksum.
- Release builds require the owner's persistent keystore and GitHub Actions signing secrets; the workflow verifies the release AAB signature.
- Added Android cloud build instructions and signing configuration guidance.
- Still needed: a complete Android project in the repository, actual debug/release build verification, build artifact retention/traceability tests and any Play Console upload workflow.
- Do not commit keystores, passwords or signing keys. Play Console upload/publishing remains a separate owner-authorized step.

## 8. Blogging and SEO

- SEO implemented on the feature branch: read-only Google Search Console OAuth, encrypted refresh-token storage, connected property listing and query/page/country/device/date performance reports. Only properties returned for the connected Google account can be queried.
- The Search Console connection table is applied with RLS enabled and backend service-role-only access. Google OAuth credentials and property permissions still require owner setup and live testing.
- Blogging implemented: the existing owner-scoped Blog Draft Studio saves article drafts, supports owner edits and approve/reject decisions, and never publishes automatically. A CMS connection (WordPress, Blogger or another platform) and owner-approved publishing are not implemented yet.
- Avoid guaranteed ranking or traffic claims; Search Console returns top rows and may not include every query/page.

## 9. Release and security gates

- Automated Node tests and dependency/security checks on every pull request.
- Validate environment configuration without exposing values.
- Verify owner authorization on every private API route, input validation, request limits, safe error messages, token encryption and CSRF/state protection.
- Test Android viewport widths, keyboard navigation, loading/error/empty states and accessibility.
- Deploy only after CI passes and owner review. Verify health endpoint, task generation, approvals, integrations and rollback path.

## Current implementation note

The feature branch now contains:
- Premium navy/gold dashboard styling while preserving the existing owner approval and YouTube panels.
- Configurable Groq → OpenRouter → Gemini provider order, deterministic provider tests and automated CI checks. This does not prove every provider key works live or guarantee quota availability.
- Multi-channel YouTube connection storage, encrypted refresh-token persistence, a channel selector and channel-scoped read-only data requests. The new Supabase table is applied; real Google OAuth testing still requires the owner's accounts and Meta/Google credentials.
- An Affiliate Video Studio that saves English + Telugu Shorts/Reels drafts, marks product research and commission claims unverified, supports owner-approved HTTPS click tracking, and imports normalized official commission CSV rows for owner review. Only owner-confirmed entries contribute to verified commission summaries.
- Instagram Business/Creator account OAuth, encrypted long-lived token storage, refresh, exact-content approval and guarded Reel publishing flow. Live Meta account/API verification is still required.
- Google Search Console read-only OAuth, encrypted refresh-token storage, property listing and real search-performance queries.
- Owner-scoped blog draft generation, editing and approve/reject workflow; CMS publishing is not implemented.
- A manual Android cloud AAB workflow with debug/release modes, owner-keystore secret checks, signature verification and artifact upload. A complete Android app project is not yet present in the repository.

Still incomplete:
- Live affiliate product/catalog research and direct official commission/order API imports.
- Live Instagram publishing verification with the owner's Meta app/account and a real publicly hosted video.
- A complete Android app project and actual AAB build verification; Play Console upload/publishing.
- Blogging CMS connection and owner-approved publishing.
- Live Google/Instagram OAuth and end-to-end Render verification.

The Supabase tables for YouTube, Instagram, Search Console, affiliate campaigns, click events and commission entries have been created with RLS enabled and access limited to the backend service role. The feature branch is not merged or deployed. Do not treat any unconnected integration or unverified metric as complete.

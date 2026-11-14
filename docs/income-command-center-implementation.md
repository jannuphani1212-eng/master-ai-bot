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

- Use Meta's supported Instagram professional-account OAuth/API flow and required permissions.
- Store tokens server-side encrypted, track expiry and reconnect state, and verify that the account is eligible for the selected publishing API.
- Create a preview/approval queue. Publishing must require an explicit owner approval tied to the exact media, caption and destination account.
- If API permissions are unavailable, provide an export/manual-publishing workflow rather than pretending to publish.

## 6. Affiliate tracking and commissions

- Store affiliate programs, approved tracking links, campaign/content IDs and disclosure text.
- Track click events through a first-party redirect endpoint only where lawful and allowed by program terms.
- Import commissions/orders only from supported official reports/APIs or owner-uploaded statements.
- Separate clicks, conversions, pending commission, approved commission, paid commission, expenses and net profit.
- Never infer sales from views or clicks; no fake revenue figures.

## 7. App Development cloud AAB

- Add a cloud build workflow (GitHub Actions / Gradle) that accepts a reviewed Android project.
- Build debug artifacts for testing; signed release AAB requires owner-provided signing secrets stored only in GitHub Actions secrets.
- Do not commit keystores, passwords or signing keys.
- Store build artifacts with commit SHA, build logs, test results and checksum.
- Play Console upload/publishing remains a separate owner-authorized step.

## 8. Blogging and SEO

- Blogging: draft, source-check, editorial review, owner approval, then publish via an authorized CMS integration.
- SEO: Search Console/analytics integration with read-only scopes first; report indexed pages, queries, impressions, clicks and technical issues from real data.
- Avoid guaranteed ranking or traffic claims.

## 9. Release and security gates

- Automated Node tests and dependency/security checks on every pull request.
- Validate environment configuration without exposing values.
- Verify owner authorization on every private API route, input validation, request limits, safe error messages, token encryption and CSRF/state protection.
- Test Android viewport widths, keyboard navigation, loading/error/empty states and accessibility.
- Deploy only after CI passes and owner review. Verify health endpoint, task generation, approvals, integrations and rollback path.

## Current implementation note

The feature branch now contains:
- Premium navy/gold dashboard styling while preserving the existing owner approval and YouTube panels.
- Configurable Groq → OpenRouter → Gemini provider order, deterministic order tests and automated CI checks. This does not prove every provider key works live or guarantee quota availability.
- Multi-channel YouTube connection storage, encrypted refresh-token persistence, a channel selector and channel-scoped read-only data requests. The new Supabase table is applied, but Google OAuth still needs live testing with the owner's real accounts after merge/deploy.
- An Affiliate Video Studio that creates saved English + Telugu Shorts/Reels drafts, keeps research/commission values unverified, and enables owner-approved HTTPS affiliate click tracking. This does not import affiliate orders or commission statements and does not publish content.

Still incomplete:
- Instagram OAuth/API connection and publishing.
- Official affiliate product research sources, conversion imports and verified/paid commission reporting.
- Cloud Android AAB builds and Play Console upload workflow.
- Blogging CMS and SEO/Search Console integrations.
- Live OAuth, account and end-to-end Render verification.

The Supabase tables for YouTube and affiliate campaigns/click events have been created with RLS enabled and access limited to the backend service role. The feature branch is not merged or deployed. Do not treat any unconnected integration or unverified metric as complete.

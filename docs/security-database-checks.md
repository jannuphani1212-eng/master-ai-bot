# Master AI Bot security and database checks

## New integration tables

The following tables are created in the Master AI Bot Supabase project:

- `youtube_channel_connections`
- `instagram_connections`
- `instagram_publish_jobs`
- `search_console_connections`
- `affiliate_campaigns`
- `affiliate_click_events`
- `affiliate_commissions`

All have Row Level Security enabled. The browser roles `anon` and `authenticated` have no table privileges; the backend `service_role` is the only granted role. There are intentionally no RLS policies on these tables because browser clients must not access them directly. The Express server enforces owner authentication and filters every owner-scoped query by the verified owner ID.

OAuth tokens are encrypted in the backend before storage. Never expose the Supabase service-role key or provider secrets to browser JavaScript.

## Advisor results

- Supabase reports no unindexed foreign-key warnings after the supporting indexes were added.
- Unused-index INFO notices are expected while the new tables have zero rows and no production traffic.
- RLS-enabled/no-policy INFO notices are intentional for these service-role-only tables.
- Supabase currently warns that leaked-password protection is disabled. The owner should enable the compromised-password check in Supabase Authentication password-security settings.

## Release checks still required

- Confirm Render environment variables are present without sharing their values in chat.
- Confirm owner authentication on every protected route.
- Test OAuth callback, token refresh and reconnect behavior with real owner accounts.
- Test rate limits, request sizes, HTTPS-only affiliate redirects and audit logging.
- Do not enable publishing until exact-content approval and external API permissions are implemented and tested.

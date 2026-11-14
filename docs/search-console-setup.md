# Google Search Console read-only setup

## Google Cloud setup

1. Open the Google Cloud project used for the Master AI Bot (or create a dedicated project).
2. Enable the **Google Search Console API**.
3. Create a Web application OAuth client.
4. Add this exact authorized redirect URI:
   `https://master-ai-bot-iskj.onrender.com/api/seo/search-console/oauth/callback`
5. Add the Search Console read-only scope:
   `https://www.googleapis.com/auth/webmasters.readonly`
6. The Google account used to connect must already have permission to read the relevant Search Console property.

Official references:
- [Search Console API prerequisites](https://developers.google.com/webmaster-tools/v1/prereqs)
- [List Search Console properties](https://developers.google.com/webmaster-tools/v1/sites/list)
- [Search Analytics query](https://developers.google.com/webmaster-tools/v1/searchanalytics/query)

## Render environment variables

Set these in the existing Master AI Bot Render service:

- `GOOGLE_SEARCH_CONSOLE_CLIENT_ID`
- `GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET`
- `GOOGLE_SEARCH_CONSOLE_REDIRECT_URI` — exact callback URL above.
- `SEARCH_CONSOLE_TOKEN_ENCRYPTION_KEY` — optional 64-character hex key. If omitted, the existing `YOUTUBE_TOKEN_ENCRYPTION_KEY` is reused.

Never paste the OAuth client secret or token encryption key into chat or commit them to GitHub.

## What the integration does

- Connects one or more Google accounts to the signed-in Master AI Bot owner.
- Stores refresh tokens encrypted with AES-256-GCM in the owner-scoped `search_console_connections` table.
- Lists properties the connected Google account can access.
- Queries finalized Search Console performance data by query, page, country, device or date.
- Displays actual clicks, impressions, CTR and average position.

The integration is read-only. It does not add/remove properties, submit sitemaps, change website content or modify Search Console settings.

Search Console may delay recent data and its API returns top rows rather than guaranteeing every query/page row. Treat the returned data as observed Search Console evidence, not a complete export or a ranking forecast.

# Connect multiple YouTube channels to Master AI Bot

This integration uses Google's server-side OAuth 2.0 flow. It does not ask for or store the Google password. The current connection layer supports multiple channels under one owner account. It is read-only: it can show each connected channel, recent videos, public channel statistics, and available YouTube Analytics. It does not upload, edit, delete, render or publish videos.

## 1. Enable the Google APIs

1. Sign in to [Google Cloud Console](https://console.cloud.google.com/) with the dedicated Global Rhymes 4U Gmail account.
2. Create or select a Google Cloud project.
3. Open APIs & Services → Library.
4. Enable **YouTube Data API v3**.
5. Enable **YouTube Analytics API**.

## 2. Configure the OAuth consent screen

1. Open Google Auth Platform / OAuth consent screen.
2. Configure the app name and support email.
3. If the app is in Testing mode, add the dedicated Global Rhymes 4U Gmail address as a test user.
4. Add the scopes:
   - `https://www.googleapis.com/auth/youtube.readonly`
   - `https://www.googleapis.com/auth/yt-analytics.readonly`

Google may show an unverified-app warning while the OAuth app remains in testing or before verification. Only proceed if the consent screen identifies the expected Master AI Bot app and requested scopes.

## 3. Create a Web application OAuth client

1. In Google Cloud Console → APIs & Services → Credentials, create an OAuth client ID.
2. Choose **Web application**.
3. Add this exact Authorized redirect URI:

   `https://master-ai-bot-iskj.onrender.com/api/youtube/oauth/callback`

4. Save the OAuth client ID and client secret. Keep the secret private.

## 4. Prepare secure token storage in Supabase

Use the existing Supabase project connected to this Master AI Bot (not the separate future MASTER AI CORPORATION project).

1. Open Supabase → SQL Editor → New query.
2. Run the complete SQL in [youtube-connection-schema.sql](./youtube-connection-schema.sql).
3. Confirm that `public.youtube_connections` exists and RLS is enabled.
4. The table grants access only to the backend service role. The OAuth refresh token is encrypted by the backend before storage.

## 5. Add private Render environment variables

In Render → Master AI Bot service → Environment, add:

- `YOUTUBE_CLIENT_ID` — OAuth client ID from Google Cloud.
- `YOUTUBE_CLIENT_SECRET` — OAuth client secret from Google Cloud.
- `YOUTUBE_REDIRECT_URI` — exactly `https://master-ai-bot-iskj.onrender.com/api/youtube/oauth/callback`.
- `YOUTUBE_TOKEN_ENCRYPTION_KEY` — a random 64-character hexadecimal key (32 bytes).
- `SUPABASE_SERVICE_ROLE_KEY` — the service-role key from the existing Master AI Bot Supabase project. This is server-only and must never be put in frontend files, GitHub, or chat.

Generate the encryption key in a trusted Node.js terminal with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Copy the output directly into Render. Do not send it to anyone. If this key is lost or changed, the stored encrypted refresh token cannot be decrypted and the channel must be connected again.

After the environment variables are saved, Render will redeploy the service.

## 6. Connect from the dashboard

1. Open the deployed Master AI Bot dashboard.
2. Sign in through the Owner Approval Center with the configured owner account.
3. Find **YouTube Channels**.
4. Tap **Add YouTube channel**. Repeat this same OAuth flow for each additional Google account. If one Google account owns several YouTube channels, the callback saves all channels returned by YouTube for that authorized account.
5. Choose the dedicated Global Rhymes 4U Google account and review the consent screen.
6. Return to the dashboard and sign in again if the page asks.
7. Tap **Refresh channel data**.

The dashboard should then show all authorized channels. Select a channel to view its channel data, recent videos and available analytics. Tasks must name the intended channel; channel data must never be combined.

## Security and limits

- Google passwords are never collected by Master AI Bot.
- OAuth client secrets and refresh tokens remain on the backend. Refresh tokens are encrypted with AES-256-GCM before database storage.
- The browser receives only channel and video display data, never OAuth tokens.
- All data routes require the existing owner-authenticated session.
- OAuth callback state is signed and expires after 10 minutes.
- The multi-channel release requests read-only channel and analytics scopes. Video generation, rendering and publishing are separate capabilities and are not included by connecting YouTube. Publishing is deliberately not enabled. A later publishing feature must request the upload scope separately and use a fresh explicit owner approval before each upload.
- API quota limits and Google OAuth verification/testing restrictions apply. A connected account does not guarantee every analytics report is available immediately.

## OAuth testing-mode limitation

If the Google OAuth consent screen is an External app left in **Testing** status, Google issues refresh tokens that expire after 7 days for these YouTube scopes. You may need to reconnect weekly during testing. For ongoing use, review Google's production-readiness and verification requirements and publish/verify the OAuth app as applicable. Personal-use exceptions may apply, but Testing status still has the 7-day refresh-token limit for non-basic scopes. See [Google's refresh-token expiration rules](https://developers.google.com/identity/protocols/oauth2#expiration) and [OAuth app verification guidance](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview).

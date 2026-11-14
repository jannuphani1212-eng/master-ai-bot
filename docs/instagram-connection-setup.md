# Instagram account connection setup

## Account requirements

Use a separate Instagram **Business or Creator** account for the affiliate brand. Personal accounts are not accepted by this connection flow. Meta's Instagram API with Instagram Login is intended for professional accounts and does not require a Facebook Page. See the [Meta Instagram API changelog](https://developers.facebook.com/docs/instagram/platform/instagram-api/changelog/) and [Instagram Media API reference](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/v21.0/).

## Meta app configuration

1. Create or open a Meta developer app that you control.
2. Add the Instagram API with Instagram Login product.
3. Configure the OAuth redirect URI exactly as:
   `https://master-ai-bot-iskj.onrender.com/api/instagram/oauth/callback`
4. Configure the Instagram Business Login flow and the scopes:
   - `instagram_business_basic`
   - `instagram_business_content_publishing`
5. Add the account as an app role/tester while the app is in development mode. Complete Meta's required review and access checks before onboarding accounts outside the app roles.

## Render environment variables

Set these in the existing Master AI Bot Render service:

- `INSTAGRAM_APP_ID` — Meta app ID.
- `INSTAGRAM_APP_SECRET` — Meta app secret.
- `INSTAGRAM_REDIRECT_URI` — exact callback URL above.
- `INSTAGRAM_TOKEN_ENCRYPTION_KEY` — optional 64-character hex key. If omitted, the current `YOUTUBE_TOKEN_ENCRYPTION_KEY` is reused.

Never paste the app secret or encryption key into chat or commit them to GitHub.

## What the integration currently does

- Signs OAuth state with the Meta app secret and binds it to the signed-in owner.
- Exchanges the authorization code for a short-lived token and then a long-lived token.
- Reads the authorized account's ID, username and account type.
- Rejects accounts identified as personal rather than professional.
- Encrypts the token with AES-256-GCM and stores it in the owner-scoped `instagram_connections` table.
- Refreshes long-lived tokens when they approach expiry and shows a reconnect warning if refresh fails.

## Publishing status

The current branch implements account connection and token lifecycle only. It does **not** publish Reels. Automatic publishing still requires a separately implemented media-upload/publish workflow, a publicly accessible approved video file, exact-content owner approval, and confirmation that the Meta app has the required publishing access. The Affiliate Video Studio currently generates scripts and captions, not finished video files.

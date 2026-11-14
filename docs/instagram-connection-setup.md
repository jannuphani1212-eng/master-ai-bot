# Instagram account connection setup

## Account requirements

Use a separate Instagram **Business or Creator** account for the affiliate brand. Only Business and Creator professional account types are accepted by this connection flow; personal and unknown account types are rejected. Meta's Instagram API with Instagram Login is intended for professional accounts and does not require a Facebook Page. See the [Meta Instagram API changelog](https://developers.facebook.com/docs/instagram/platform/instagram-api/changelog/) and [Instagram Media API reference](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/v21.0/).

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

## Owner-approved Reel publishing

The feature branch now includes a guarded publishing workflow, subject to live Meta app access:

1. Connect a Business or Creator account.
2. Provide a publicly accessible HTTPS video URL and the exact caption.
3. Confirm the caption contains a clear affiliate disclosure and that you have rights to publish the video and audio.
4. Submit the exact account, video URL and caption to the Owner Approval Center.
5. After the request is approved, select **Prepare approved Reel**. The backend creates an Instagram media container.
6. Refresh processing status until Instagram reports the container as ready.
7. Select **Publish approved Reel now** and confirm the public action. The backend checks the account's publishing quota and uses a conditional single-use job reservation to prevent concurrent duplicate publishing.

The integration uses the Instagram Login publishing permission `instagram_business_content_publish` and the Instagram Reels container / `media_publish` flow. Meta currently limits API publishing to 50 posts in a rolling 24-hour period per professional account. The backend checks the publishing-limit edge before preparing and publishing.

A public HTTPS URL is required because Instagram must fetch the video. The current Affiliate Video Studio generates scripts and captions, not finished video files; you must host a finished, compatible video file before requesting publication.

If the final publish result cannot be confirmed after the API request, the job is marked `publish_unknown`. Check the Instagram account manually before retrying; the system deliberately avoids a blind retry that could create a duplicate post.

This code has automated mocked tests but still requires live Meta app review/permission, real-account OAuth and an end-to-end publishing test after deployment. No Reel has been published by this branch.

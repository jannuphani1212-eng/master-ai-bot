# Blogger, WordPress.com and Instagram setup

These integrations connect the owner's accounts using official OAuth flows. Access tokens are encrypted with AES-256-GCM and stored in Supabase using the server service-role key. Never paste tokens into ChatGPT, GitHub, the browser console, or frontend files.

## Blogger

1. Open Google Cloud Console and select the Google Cloud project used for your content tools.
2. Enable **Blogger API v3**.
3. Create an OAuth 2.0 client of type **Web application**.
4. Add this exact authorized redirect URI:
   `https://master-ai-bot-iskj.onrender.com/api/blog/oauth/callback`
5. Add these Render environment variables to the existing Master AI Bot web service:
   - `BLOGGER_CLIENT_ID` — Google OAuth client ID. You may reuse the existing YouTube Google OAuth client only if this redirect URI is also registered on that same client.
   - `BLOGGER_CLIENT_SECRET` — matching Google OAuth client secret.
   - `BLOGGER_REDIRECT_URI` — the exact callback URL above.
   - `BLOG_CMS_TOKEN_ENCRYPTION_KEY` — a private 32-byte random key encoded as 64 hexadecimal characters.
6. Sign in to the Master AI Bot owner workspace and tap **Connect Blogger**. Choose the Google account that owns your blog and approve Blogger access.

The Blogger integration lists your blogs and can create a remote Blogger **draft** only when an exact owner-approved proposal is supplied. It does not publish live posts.

## WordPress.com

1. Open the WordPress.com Applications Manager and register an application.
2. Set the redirect URI to:
   `https://master-ai-bot-iskj.onrender.com/api/blog/oauth/callback`
3. Add these Render environment variables:
   - `WORDPRESS_CLIENT_ID`
   - `WORDPRESS_CLIENT_SECRET`
   - `WORDPRESS_REDIRECT_URI` — the exact callback URL above.
   - Reuse the same `BLOG_CMS_TOKEN_ENCRYPTION_KEY` as Blogger.
4. In the owner workspace, tap **Connect WordPress.com** and authorize the account.

The integration requests the least-privilege `sites,posts` scopes needed to list sites and create draft posts. Live publishing is not enabled.

## Instagram professional account

The Instagram API with Instagram Login supports professional Business and Creator accounts. Personal accounts are not supported by this integration. Meta's Instagram Login path does not require a Facebook Page to be linked. See the [Meta Instagram API changelog](https://developers.facebook.com/docs/instagram/platform/instagram-api/changelog/) and [Meta's Instagram API documentation](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api).

1. Open Meta for Developers and create a Business app.
2. Add the Instagram API with Instagram Login product.
3. Register this exact redirect URI:
   `https://master-ai-bot-iskj.onrender.com/api/instagram/oauth/callback`
4. Add these Render environment variables:
   - `INSTAGRAM_APP_ID`
   - `INSTAGRAM_APP_SECRET`
   - `INSTAGRAM_REDIRECT_URI` — the exact callback URL above.
   - `INSTAGRAM_TOKEN_ENCRYPTION_KEY` — a private 32-byte random key encoded as 64 hexadecimal characters.
   - `META_GRAPH_API_VERSION` — currently set by default to `v26.0`; update it when Meta releases a new supported version.
5. Convert the Instagram account to a Business or Creator account in Instagram if it is currently personal.
6. In the owner workspace, tap **Connect Instagram** and sign in with the professional account.

The integration currently requests only `instagram_business_basic` and checks the connected account and token expiry. It does not publish posts. Content publishing permission will only be requested when an approval-backed publishing feature is implemented.

## Token encryption keys

Each key must be 64 hexadecimal characters (32 random bytes). Generate them using a trusted password manager or secure random-key generator. Store them only as Render environment variables. Do not reuse your Supabase service-role key or a human password.

## Verification and safety

After saving environment variables, Render restarts the web service. Open the owner workspace and use **Refresh connections**. A configured OAuth app is not the same as a connected account: the account appears only after the owner completes OAuth successfully.

OAuth callback routes use signed, short-lived state and store encrypted tokens. External publishing remains disabled. Creating a remote CMS draft requires an approved proposal matching the exact draft, provider and site.

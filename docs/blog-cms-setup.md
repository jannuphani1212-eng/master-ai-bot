# Blogger + WordPress.com connection setup

The Blog Draft Studio can connect one Blogger destination and one WordPress.com destination. It saves copies as drafts only. There is no automatic publish endpoint in this integration.

## Free hosting

- Keep the existing Master AI Bot backend on the current Render free web service.
- Keep the existing Supabase Free project for encrypted connection records and draft-sync references.
- Use a free Blogger blog and/or WordPress.com Free site.
- Free services can have sleep, pause, quota, or API restrictions. A successful OAuth connection and a real test draft are required before calling a platform integration verified.

## OAuth callback URLs

Register these exact callback URLs in the provider developer consoles, replacing the host only if the Render service URL changes:

- Blogger: `https://master-ai-bot-iskj.onrender.com/api/blog/cms/blogger/callback`
- WordPress.com: `https://master-ai-bot-iskj.onrender.com/api/blog/cms/wordpress/callback`

The callback URL in the provider console must exactly match the Render environment variable.

## Render environment variables

Set these in Render → Master AI Bot → Environment. Never put secrets in GitHub files, browser JavaScript, or chat.

### Shared encryption

- `BLOG_CMS_TOKEN_ENCRYPTION_KEY`: exactly 64 hexadecimal characters (32 bytes). If the existing `YOUTUBE_TOKEN_ENCRYPTION_KEY` is already configured, the CMS module can reuse it instead.

### Blogger

- `BLOGGER_CLIENT_ID`
- `BLOGGER_CLIENT_SECRET`
- `BLOGGER_REDIRECT_URI`: exact Blogger callback URL above

Enable Blogger API v3 in the Google Cloud project used for the OAuth client. The app requests the Blogger scope so it can list the owner's blogs and create posts with `isDraft=true`.

### WordPress.com

- `WORDPRESS_CLIENT_ID`
- `WORDPRESS_CLIENT_SECRET`
- `WORDPRESS_REDIRECT_URI`: exact WordPress.com callback URL above

Register an application in the WordPress.com Applications Manager. The app requests `posts` and `sites` scopes to list the owner's sites and create posts with `status=draft`.

## Owner connection flow

1. Sign in to Master AI Bot as the configured owner.
2. Open Blogging Bot → Blog Draft Studio.
3. Select Connect Blogger or Connect WordPress.com.
4. Sign in to the provider and grant the requested access.
5. Return to Master AI Bot and refresh the connection list.
6. Select the intended blog/site destination.
7. Generate or open a blog draft and choose Save to Blogger draft or Save to WordPress.com draft.
8. Open the provider website to review the saved draft. Publishing must be done manually there.

## Security and behavior

- OAuth state is signed and time-limited.
- Tokens are encrypted with AES-256-GCM before storage.
- CMS credentials and sync records are accessed only by the backend service role; RLS is enabled and browser roles have no table privileges.
- The CMS sync endpoints require the authenticated owner.
- The same internal draft is not intentionally sent twice to the same provider.
- A saved CMS copy is always created with draft status. The connector does not publish, schedule, delete, or edit remote posts.
- If WordPress.com Free does not grant the requested API scope or rejects draft creation, the connection must be reported as not verified rather than silently falling back to publishing.

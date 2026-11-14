# Android cloud AAB builds

## Current app

The repository contains an Android companion app in `android-app/`. It opens the existing Master AI Bot HTTPS dashboard in a hardened WebView. It reuses the existing backend and owner login; it is not a native rewrite.

## Automatic debug build

The **Android cloud AAB build** workflow runs on pushes to the feature branch and when the Android project changes in a pull request targeting `main`. It defaults to `android-app` and creates a debug AAB. It installs Java 17, Android SDK platform 35/build-tools 35.0.0, and Gradle 8.13.

After a successful run:
1. Open the repository's Actions tab.
2. Open the **Android cloud AAB build** run.
3. Download the `master-ai-android-debug` artifact.
4. Keep the AAB and SHA-256 checksum together.

You can also manually run the workflow and choose the project path and build variant.

## Configure a signed release

Create and preserve one release keystore for the app. Never create a different signing key for every release. Add these repository Actions secrets:

- `ANDROID_KEYSTORE_BASE64` — base64-encoded bytes of the owner's keystore.
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_PASSWORD`

The app's Gradle release signing configuration reads these environment variables injected by the workflow. The workflow fails safely if any secret is missing, and verifies the resulting AAB signature before upload.

Never paste these values into chat, commit them, or place them in ordinary repository files.

## Important limitations

- This is a WebView companion app, not a native rewrite of the web dashboard.
- OAuth providers that block embedded WebViews may require completing sign-in in the external browser; test each provider on a real Android device.
- A debug AAB is for testing, not a Play Store release.
- The workflow does not upload or publish to Google Play Console. Developer registration, app listing, policy declarations, testing tracks and publishing require owner action.
- Keep the same signing key for future updates to the same app.

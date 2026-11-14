# Master AI Bot Android companion app and cloud AAB build

The repository now contains a minimal Android companion app under `android-app/`. It opens the existing Master AI Bot HTTPS dashboard in a hardened WebView; it does not create a second backend or duplicate credentials.

## Build a debug App Bundle

1. Open GitHub → Actions → **Android cloud AAB build** → Run workflow.
2. Keep project path as `android-app`.
3. Select `debug`.
4. Wait for the workflow to finish, then download the `master-ai-android-debug` artifact. It contains the AAB and SHA-256 checksum.

The workflow installs Java 17, Android SDK and Gradle 8.13. The project uses Android Gradle Plugin 8.7.3, compile SDK 35 and minimum Android API 24.

## Release signing

A release build requires the owner's persistent keystore and the four GitHub Actions secrets documented in `docs/android-cloud-build.md`. Never commit keystores, signing passwords or private keys. A successful debug build is not a Play Store-ready release.

## App behavior and limitations

- Loads only the Master AI Bot Render HTTPS host inside the app.
- Opens other HTTP(S) destinations in the device browser.
- Disables file/content access and cleartext HTTP; blocks mixed content.
- Uses the existing web dashboard and its owner authentication.
- This is a companion WebView app, not a native rewrite. OAuth providers that block embedded WebViews may require completing sign-in in the external browser; test each provider on a real Android device.
- No Play Console upload or publishing is performed.

## Current verification

The source project is now present. A cloud AAB build must pass before claiming the Android artifact is verified.

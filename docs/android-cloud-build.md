# Android cloud AAB builds

## Current status

The repository now contains a manual GitHub Actions workflow at `.github/workflows/android-cloud-build.yml`. It can build an Android Gradle project stored in this repository without requiring a PC. The current repository does not yet contain a complete Android app project at `android-app/`, so the workflow is infrastructure-ready but cannot produce an app bundle until the app-development agent commits a real Android project.

## Run a debug AAB

1. Open the repository's **Actions** tab.
2. Select **Android cloud AAB build**.
3. Choose **Run workflow**.
4. Set `project_path` to the Android project directory (default `android-app`).
5. Choose `debug`.
6. Run the workflow and download the generated artifact after it succeeds.

Debug builds use the Android debug signing key and are for testing only. They are not Play Store release bundles.

## Configure a signed release

Create and preserve one release keystore for the app. Never create a different signing key for every release. Add these repository Actions secrets:

- `ANDROID_KEYSTORE_BASE64` — base64-encoded bytes of the owner's existing keystore.
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_PASSWORD`

Do not paste these values into chat, commit them, or put them in ordinary repository files.

The Android app's Gradle release signing configuration must read the environment variables injected by the workflow. Kotlin DSL example:

```kotlin
val releaseKeystorePath = System.getenv("ANDROID_KEYSTORE_PATH")

android {
    signingConfigs {
        if (!releaseKeystorePath.isNullOrBlank()) {
            create("release") {
                storeFile = file(releaseKeystorePath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            if (!releaseKeystorePath.isNullOrBlank()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
}
```

Then run the workflow with `variant=release`. The workflow checks that the resulting AAB is signed and uploads the artifact with a SHA-256 checksum. It does not upload or publish to Google Play Console.

## Important limitations

- The workflow builds an existing Android Gradle project; it does not yet convert a chat response into source files automatically.
- A release build fails safely if signing secrets are missing or the AAB is unsigned.
- Google Play Console developer registration, app listing, policy declarations, testing tracks and publishing still require owner action.
- Keep the same signing key for future updates to the same app.

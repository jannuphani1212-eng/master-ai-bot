# Cloud Android App Bundle (AAB) workflow

This repository currently contains the Master AI Bot web application, not an Android/Gradle app project. The workflow is ready to build an Android project after its source is added to this repository.

## Prepare an Android project

1. Add the complete Android project to the repository, for example in an `android/` folder.
2. Ensure it includes the Gradle wrapper: `android/gradlew` and `android/gradle/wrapper/gradle-wrapper.properties`.
3. Confirm the project builds locally or in Android Studio before using cloud CI.
4. Push the Android source to the branch you want to build.

## Run a cloud build

1. Open GitHub → Actions → Android AAB cloud build.
2. Select Run workflow.
3. Enter the project folder (default: `android`).
4. Choose `bundleDebug` for a test bundle. Choose `bundleRelease` only if the Android project's release signing configuration is already set up securely.
5. Download the generated AAB and SHA256 checksum from the workflow artifact.

## Signing and publishing

- Never commit a keystore, signing password, Play Console service-account JSON, or private key.
- A release AAB is installable/publishable only when the Android project itself is configured to sign it using securely managed secrets.
- This workflow does not create a signing key, upload to Google Play Console, or publish an app.
- Add a separate owner-approved Play Console upload step only after a tested release-signing setup exists.

## Current limitation

There is no Android project or Gradle wrapper in the current Master AI Bot repository. Therefore, the workflow cannot produce an AAB until the Android app source is supplied. The workflow intentionally fails early with a clear message instead of pretending a build succeeded.

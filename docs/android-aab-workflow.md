# Cloud Android App Bundle (AAB) workflow

The Master AI Bot repository currently contains a web application, not an Android/Gradle project. The manual workflow is ready to build an Android project once its source is added.

## Prepare the Android project

1. Add the complete Android project under a repository folder such as `android/`.
2. Include `gradlew` and `gradle/wrapper/gradle-wrapper.properties`.
3. Push the Android source to the branch to build.

## Run a cloud build

1. Open GitHub → Actions → Android AAB cloud build → Run workflow.
2. Keep project folder as `android`, or enter the folder containing the Gradle wrapper.
3. Select `bundleDebug` for a test bundle.
4. Select `bundleRelease` only after the Android project has a secure release-signing configuration.
5. Download the AAB and SHA-256 checksum from the workflow artifact.

## Signing and publishing

- Never commit keystores, signing passwords, Play Console service-account JSON or private keys.
- The workflow does not create signing credentials or upload/publish to Google Play.
- Release signing must be configured in the Android project using GitHub Actions secrets and a project-specific signing configuration.
- Play Console upload remains a separate owner-approved action.

## Current limitation

No Android app source or Gradle wrapper exists in this repository yet. The workflow therefore fails early with a clear message until the actual Android project is added. It does not claim to produce an AAB without source code.

# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# Project: language-learning-mobile-phrasebook

React Native / Expo (SDK 56) Android app — the mobile counterpart to the web app
`language-learning-drive-phrasebook`. Currently a **simple demo**: fetches saved
phrases from a personal backend and plays per-phrase audio.

## Architecture
- `App.js` — single screen: lists phrases, plays `normal`/`slow` MP3s via `expo-audio`.
- `src/api.js` — `listPhrases()` (`GET /phrases` on a Lambda Function URL; auth header
  `x-app-token` = `HMAC-SHA256(secret, floor(Date.now()/30000))` hex, via `js-sha256`)
  and `getAudioUrl(s3Key)` (resolves an S3 key to a URL).
- Config via `EXPO_PUBLIC_*` vars in `.env.local` (HMAC secret, Lambda URL, S3 base);
  `.env.example` is the template. These are inlined into the JS bundle at build time —
  the HMAC secret ships in the app by design (matches the web app).

## Build & run — LOCAL ONLY, no EAS, no OTA
- **Iterate:** `npx expo start` (Metro hot reload; press `w` for the web preview).
- **Build + install a standalone release APK** to a connected device: `npm run apk`
  (runs `scripts/build-apk.js` → direct Gradle `assembleRelease` + `adb install`).
- **Update loop:** edit code → `npm run apk` → reopen the app. (~30s incremental.)

## Gotchas — read before touching the build
- **Do NOT run `expo prebuild` / `expo run:android`.** `android/` is committed and we
  build Gradle directly. Prebuild regenerates `android/gradle/wrapper/gradle-wrapper.properties`
  back to **Gradle 9.3.1**, which breaks the build: RN 0.85's Gradle plugin uses the
  Gradle 8 API (`JvmVendorSpec.IBM_SEMERU`, removed in Gradle 9). The wrapper is pinned
  to **Gradle 8.13** on purpose (compatible with AGP 8.12 + the RN plugin). `npm run apk`
  skips prebuild, so the pin is safe.
- **No EAS.** EAS Build/Update and `expo-updates` were removed deliberately. Don't re-add
  `eas.json`, `updates.url`, `runtimeVersion`, or `expo-updates` unless explicitly asked.
- JDK = Android Studio's bundled JBR; `npm run apk` sets `JAVA_HOME`/`ANDROID_HOME` itself.
- The release APK is debug-signed — fine for personal sideloading, not for the Play Store.

# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# Project: language-learning-mobile-phrasebook

React Native / Expo (SDK 56) Android app — the mobile counterpart to the web app
`language-learning-drive-phrasebook`. An offline-first **"drive mode" trainer**:
sync a personal phrase library to the device, then run hands-free listening
sessions that play per-phrase audio on a repeating cadence (built for in-car use,
with background playback so it keeps going with the screen off).

## Architecture
No navigation library — like the web app, a single `view` state switches between
two screens (`home` → `drive`). State lives in `App.js` and flows down as props.

- `App.js` — top-level orchestrator. Bootstraps the audio session (background
  playback via `setAudioModeAsync`), loads saved prefs + the cached phrase list,
  and owns the home/drive switch. Android hardware back returns drive→home (and
  exits the app from home).
- `src/screens/Home.js` — the session builder. Picks a deck by **faceted filters**
  (languages × tags, plus an "Untagged" bucket; no filter = everything). Hosts the
  Sync button, namespace ("library") picker, theme toggle, and mode selector.
- `src/screens/Player.js` — the session player. Now-playing card, up-next / recently
  -played queues, and Stay / Play-Pause / Got-it controls. `useKeepAwake` keeps the
  screen on during a session.
- `src/audio/usePlayer.js` — the **cadence engine** (port of the web `usePlayer.ts`).
  A segment state machine: audio segments advance on expo-audio's `didJustFinish`,
  gap segments on a pausable `setTimeout`. Four modes (`MODES`): `normal`, `slow`,
  `drill` (normal→slow→normal), `recall` (translation→pause→normal). "Stay" loops
  the current phrase; "Got it" marks it learned and advances.
- `src/sync.js` — the **offline layer**. Per-namespace, caches the phrase-list JSON
  in AsyncStorage and downloads every normal/slow/translation MP3 under
  `documentDirectory/audio/<ns>/` (expo-file-system `File`/`Directory`). `syncLibrary`
  refreshes the list, downloads only what's missing, and prunes orphaned files.
  `resolveUrl` prefers the local file and falls back to the remote S3 URL.
  **Web has no expo-file-system**, so on web this degrades to online-only streaming
  (keeps the `expo start` web preview usable as a dev surface).
- `src/storage.js` — typed AsyncStorage wrappers for the three persisted prefs:
  `namespace`, `mode`, `theme`. (RN's AsyncStorage is async, unlike web localStorage.)
- `src/phrases.js` — shapes API rows into deck phrases and groups them by language
  for the Home picker (`groupByLanguage`). Resolves audio URLs through the offline
  layer; adds language endonyms for section headers.
- `src/theme.js` — two flat light/dark palettes; screens read colors from the
  active palette so the toggle recolors everything.
- `src/api.js` — read-only backend client. `listPhrases(namespace)` (`GET /phrases`
  on a Lambda Function URL; auth header `x-app-token` =
  `HMAC-SHA256(secret, floor(Date.now()/30000))` hex via `js-sha256`; optional
  `x-namespace` header selects a private library) and `getAudioUrl(s3Key)`.
- `scripts/build-apk.js` — the `npm run apk` local build (see below).
- `scripts/make-icon.js` — regenerates all app/adaptive/splash icons from code
  (pure Node zlib + a tiny PNG encoder; the green equalizer-bar mark). Re-run after
  tweaking colors/geometry — icons only appear in an installed build, not Expo Go.

## Config
`EXPO_PUBLIC_*` vars in `.env.local` (HMAC secret, Lambda URL, S3 base); `.env.example`
is the template. These are inlined into the JS bundle at build time — the HMAC secret
ships in the app by design (matches the web app).

## Build & run — LOCAL ONLY, no EAS, no OTA
- **Iterate:** `npm start` (`expo start`; Metro hot reload, press `w` for the web
  preview — note web is online-only, no offline cache).
- **Build + install a standalone release APK** to a connected device: `npm run apk`
  (runs `scripts/build-apk.js` → direct Gradle `assembleRelease`, **arm64-v8a only**,
  then `adb install`; on MIUI it falls back to `adb push` to Downloads for manual
  install when "Install via USB" is off).
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
- **Background playback** needs the media-playback foreground service + permissions in
  `app.json` (`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`) and
  `shouldPlayInBackground: true` in `setAudioModeAsync`. Don't drop these or sessions
  stop when the screen locks.
- **expo-audio quirk:** calling a released player throws (late status events after a
  screen unmounts). `usePlayer.js` guards every imperative call with an `alive` ref +
  try/catch — preserve that pattern when editing the engine.
- JDK = Android Studio's bundled JBR; `npm run apk` sets `JAVA_HOME`/`ANDROID_HOME` itself.
- The release APK is debug-signed — fine for personal sideloading, not for the Play Store.

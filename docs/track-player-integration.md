# react-native-track-player integration — paused (crashing)

Goal: features **#1 hardware/Bluetooth/steering-wheel media controls** and
**#5 lock-screen now-playing metadata**, by replacing `expo-audio` with
`react-native-track-player` (RNTP) as the audio engine + media session.

**Status: reverted from `main` because the app crashes.** The full attempt is
preserved in git so we can resume — see "How to resume" below.

## Where the code lives

The whole attempt is one commit:

```
b91a51c feat(audio): media controls + lock-screen metadata via track-player
```

It was reverted by the commit immediately after it. To get the code back:

```bash
git log --oneline            # find the "Revert ..." commit
git revert <revert-commit>   # un-revert: restores the RNTP attempt
# then: npm install && npm run apk
```

The brace-transform helper used to patch RNTP is kept at
`scripts/patch-rntp-newarch.js` (it is otherwise unused on `main`).

## What the attempt changed

- **`src/audio/trackPlayer.js`** (new) — `setupTrackPlayer()` (capabilities,
  `appKilledPlaybackBehavior`, `progressUpdateEventInterval`) + a no-op
  `playbackService`.
- **`index.js`** — `TrackPlayer.registerPlaybackService(() => playbackService)`.
- **`App.js`** — `await setupTrackPlayer()` on launch, in place of
  `setAudioModeAsync` from expo-audio.
- **`src/audio/usePlayer.js`** — ported the cadence engine off expo-audio:
  - each segment loaded as a single-item queue via `TrackPlayer.setQueue([track])`
    then `play()`/`pause()`; track tagged with `title`/`artist`/`artwork` (#5).
  - advance on `Event.PlaybackQueueEnded`; keep `lastDuration` from
    `Event.PlaybackProgressUpdated` (scale-based gaps).
  - `useTrackPlayerEvents` maps `RemotePlay/Pause/Stop/Next/Previous` onto engine
    actions (#1); engine stays the source of truth for play state.
- **`package.json`** — added `react-native-track-player@4.1.2`, `patch-package`
  (dev), and `"postinstall": "patch-package"`.
- **`patches/react-native-track-player+4.1.2.patch`** — see build fixes below.

## Build/runtime problems hit (in order)

### 1. Kotlin compile error (FIXED via patch)
RNTP 4.1.2 doesn't compile against this project's Kotlin 2.1.20:

```
MusicModule.kt:548 / :588 Argument type mismatch:
  actual type is 'Bundle?', but 'Bundle' was expected.
```

`Arguments.fromBundle(...)` now wants a non-null `Bundle`; `originalItem` is
nullable. Fix: `... .originalItem ?: Bundle()` at both call sites.

### 2. New Architecture TurboModule crash on launch (FIXED via patch)
With `newArchEnabled=true`, the app crashed at startup:

```
Unable to parse @ReactMethod annotations from native module: TrackPlayerModule.
TurboModule system assumes returnType == void iff the method is synchronous.
```

RNTP's `@ReactMethod` functions use Kotlin **expression bodies**
(`fun foo(...) = scope.launch { ... }`), so they return `Job` (non-void) while
being async — which the TurboModule interop forbids. Fix: rewrite all 37 such
methods to **block bodies** returning `Unit`:
`fun foo(...) { scope.launch { ... } }`. Done mechanically by
`scripts/patch-rntp-newarch.js` (string/comment-aware brace matcher), then
captured with `npx patch-package react-native-track-player`.

Both #1 and #2 are in `patches/react-native-track-player+4.1.2.patch` (~413
lines) and reapply automatically via the `postinstall` hook.

### 3. Still crashing after startup (UNRESOLVED — why it's paused)
After the two patches the build succeeds and JS boots:

```
I ReactNativeJS: Running "main"
D MediaSessionService: Media button session is changed to .../KotlinAudioPlayer
```

…so the TurboModule loads and the media session binds. But the activity is then
force-finished / killed (`ActivityManager: Killing ... crash`, an "Application
Error" surface). A clean single launch sometimes survived to a live process,
which suggests the crash may be on **session start** (first `setQueue`/`play`)
rather than at launch. No clean JS redbox or native stack was captured yet.

## Hypotheses to chase next

1. **RNTP 4.1.2 new-arch support is incomplete.** Even past the interop parse,
   runtime calls may misbehave under bridgeless/new arch. Worth testing.
2. **Foreground-service start restriction.** Android 12+ can throw
   `ForegroundServiceStartNotAllowed` / `ForegroundServiceDidNotStartInTime` if
   the media service starts while not properly foregrounded. We start playback
   from the engine effects, which may race the activity becoming foreground.
3. **Two media services declared.** The committed manifest still has expo-audio's
   `AudioControlsService` (mediaPlayback) alongside RNTP's `MusicService`. Likely
   harmless, but worth removing expo-audio if we keep RNTP.

## Concrete next steps

- Capture the real crash: `adb logcat -c` then launch and
  `adb logcat | grep -iE "AndroidRuntime|FATAL|ReactNativeJS|Foreground|RemoteService"`;
  also try a **debug** build (`assembleDebug`) for a JS redbox + full stack.
- Try toggling `newArchEnabled=false` in `android/gradle.properties` as a
  diagnostic to confirm/deny hypothesis #1 (revert after).
- Defer `setupTrackPlayer()` / first `play()` until after the Player screen has
  mounted and the activity is foreground (hypothesis #2).
- If keeping RNTP: remove the unused `expo-audio` dep and its manifest service,
  and update `AGENTS.md` (still documents expo-audio as the engine).

## Environment (at time of attempt)

- Expo SDK 56, React Native 0.85.3, `newArchEnabled=true`, Hermes on.
- Kotlin 2.1.20, AGP 8.12, Gradle 8.13 (pinned).
- react-native-track-player 4.1.2; build via `npm run apk` (local Gradle,
  arm64-v8a, `assembleRelease`).

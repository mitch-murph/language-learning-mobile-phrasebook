import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
} from 'react-native-track-player';

// react-native-track-player setup + the (required) playback service.
//
// We use RNTP purely as the audio engine + media session: it gives us the
// lock-screen / Bluetooth / steering-wheel transport controls and the
// now-playing notification "for free". The cadence state machine still lives in
// usePlayer.js, which loads one segment at a time and listens for remote events.

let ready = null;

// Idempotent: safe to call on every launch (and survives fast-refresh).
export function setupTrackPlayer() {
  if (ready) return ready;
  ready = (async () => {
    try {
      await TrackPlayer.setupPlayer({ autoHandleInterruptions: true });
    } catch (e) {
      // "player already initialized" after a fast-refresh — not a real error.
      if (!String(e?.message ?? e).toLowerCase().includes('already initialized')) {
        ready = null;
        throw e;
      }
    }
    await TrackPlayer.updateOptions({
      android: {
        appKilledPlaybackBehavior:
          AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
      },
      // Frequent progress events keep the engine's scale-based gap timing fed
      // with the current clip's duration.
      progressUpdateEventInterval: 1,
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
      ],
      compactCapabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext],
      notificationCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
      ],
    });
  })();
  return ready;
}

// Required by RNTP and registered in index.js. Remote events are handled inside
// the cadence engine (usePlayer) while a session is mounted — the only time
// audio plays — so the service itself has nothing to do.
export async function playbackService() {}

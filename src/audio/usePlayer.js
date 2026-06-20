import { useEffect, useRef, useState } from 'react';
import TrackPlayer, { Event, useTrackPlayerEvents } from 'react-native-track-player';

// Cadence engine — port of the web app's usePlayer.ts.
//
// Audio + the media session (lock-screen / Bluetooth / steering-wheel controls,
// and the now-playing notification) are handled by react-native-track-player;
// see src/audio/trackPlayer.js for setup. This hook is the state machine on top:
//   - audio segments advance when RNTP reports the queue finished
//   - gap segments advance on a setTimeout, pausable by tracking remaining ms
//   - remote control events are mapped onto the same actions as the on-screen
//     buttons, so the engine stays the single source of truth for play state.
// Refs mirror state so the imperative callbacks never read stale values. Every
// RNTP call is async and is guarded by an `alive` ref so a late event after the
// screen unmounts is a no-op.

export const MODES = ['normal', 'slow', 'drill', 'recall'];

export const MODE_META = {
  normal: { label: 'Normal', hint: 'Hear it once' },
  slow: { label: 'Slow', hint: 'Slow playback' },
  drill: { label: 'Drill', hint: 'Normal → slow → normal' },
  recall: { label: 'Recall', hint: 'Translate then reveal' },
};

function resolveGapMs(seg, lastAudioDuration) {
  if (seg.ms != null) return seg.ms;
  if (seg.scale != null) {
    const raw = lastAudioDuration * 1000 * seg.scale;
    const floored = Math.max(seg.minMs ?? 0, raw);
    return seg.maxMs != null ? Math.min(seg.maxMs, floored) : floored;
  }
  return 0;
}

// Each mode is a list of audio/gap segments. Gaps are either a fixed `ms` or
// `scale × last-audio-duration` clamped by min/maxMs. Identical to the web app.
const SEQUENCES = {
  normal: [
    { kind: 'audio', src: 'normal' },
    { kind: 'gap', scale: 1.2, minMs: 1500 },
  ],
  slow: [
    { kind: 'audio', src: 'slow' },
    { kind: 'gap', scale: 1.2, minMs: 1500 },
  ],
  drill: [
    { kind: 'audio', src: 'normal' },
    { kind: 'gap', scale: 0.6, minMs: 700 },
    { kind: 'audio', src: 'slow' },
    { kind: 'gap', scale: 0.6, minMs: 700 },
    { kind: 'audio', src: 'normal' },
    { kind: 'gap', scale: 1.2, minMs: 1500 },
  ],
  recall: [
    { kind: 'audio', src: 'translation' },
    { kind: 'gap', scale: 2.5, minMs: 4000, maxMs: 12000 },
    { kind: 'audio', src: 'normal' },
    { kind: 'gap', scale: 1.5, minMs: 2000 },
  ],
};

const HISTORY_CAP = 6;

// App icon, shown as the media-notification / lock-screen artwork.
const ARTWORK = require('../../assets/icon.png');

// Events the engine reacts to: audio finishing, duration updates, and the
// hardware / lock-screen / Bluetooth transport controls.
const TRACKED_EVENTS = [
  Event.PlaybackQueueEnded,
  Event.PlaybackProgressUpdated,
  Event.RemotePlay,
  Event.RemotePause,
  Event.RemoteStop,
  Event.RemoteNext,
  Event.RemotePrevious,
];

export function usePlayer(deck, initialMode = 'drill') {
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [staying, setStaying] = useState(false);
  const [mode, setModeState] = useState(initialMode);
  const [loop, setLoop] = useState(1);
  const [learned, setLearned] = useState(() => new Set());
  const [history, setHistory] = useState([]);
  const [segIdx, setSegIdx] = useState(0); // drives the recall reveal

  // Refs mirror state for the imperative engine.
  const S = useRef({ current, playing, staying, mode });
  S.current = { current, playing, staying, mode };
  const deckRef = useRef(deck);
  deckRef.current = deck;

  const segIdxRef = useRef(0);
  const lastDurationRef = useRef(0); // seconds, from the last audio segment
  const expectFinishRef = useRef(false); // are we waiting on the current audio?
  const aliveRef = useRef(true); // false after unmount — stop touching the player

  // RNTP calls are async; swallow rejections from late/raced calls.
  const safe = (fn) => {
    if (!aliveRef.current) return;
    try {
      const r = fn();
      if (r && typeof r.then === 'function') r.catch(() => {});
    } catch {
      /* not ready — ignore */
    }
  };

  // Pausable gap timer.
  const gapTimerRef = useRef(null);
  const gapStartRef = useRef(0);
  const gapRemainingRef = useRef(0);

  const startSegmentRef = useRef(() => {});
  const advanceRef = useRef(() => {});

  const clearGap = () => {
    if (gapTimerRef.current) {
      clearTimeout(gapTimerRef.current);
      gapTimerRef.current = null;
    }
  };

  const scheduleGap = () => {
    clearGap();
    gapStartRef.current = Date.now();
    gapTimerRef.current = setTimeout(() => {
      gapTimerRef.current = null;
      startSegmentRef.current(segIdxRef.current + 1);
    }, gapRemainingRef.current);
  };

  // Load a segment's clip as the sole queue item — tagged with the phrase text
  // so the lock screen / car display shows what's playing — then match playing
  // state. Replacing the single-item queue makes RNTP fire PlaybackQueueEnded
  // when the clip finishes, which is our "advance" signal.
  const loadSegment = async (track, shouldPlay) => {
    await TrackPlayer.setQueue([track]);
    if (shouldPlay) await TrackPlayer.play();
    else await TrackPlayer.pause();
  };

  startSegmentRef.current = (i) => {
    if (!aliveRef.current) return;
    const seq = SEQUENCES[S.current.mode];
    if (i >= seq.length) {
      // End of the sequence: loop the phrase if "staying", else move on.
      if (S.current.staying) {
        setLoop((n) => n + 1);
        startSegmentRef.current(0);
      } else {
        advanceRef.current();
      }
      return;
    }

    segIdxRef.current = i;
    setSegIdx(i);
    expectFinishRef.current = false;

    const seg = seq[i];
    const phrase = deckRef.current[S.current.current];
    if (!phrase) return;

    if (seg.kind === 'audio') {
      const url =
        seg.src === 'translation' ? phrase.translationUrl
        : seg.src === 'slow' ? phrase.slowUrl
        : phrase.normalUrl;
      // No recording for this source (e.g. recall with no translation) — skip it.
      if (!url) {
        startSegmentRef.current(i + 1);
        return;
      }
      const track = {
        id: `${phrase.id}:${seg.src}`,
        url,
        title: phrase.en,
        artist: phrase.native || phrase.ro || '',
        artwork: ARTWORK,
      };
      // Only expect a finish event if we're actually going to play right now.
      expectFinishRef.current = S.current.playing;
      safe(() => loadSegment(track, S.current.playing));
    } else {
      gapRemainingRef.current = resolveGapMs(seg, lastDurationRef.current);
      if (S.current.playing) scheduleGap();
    }
  };

  advanceRef.current = () => {
    const cur = S.current.current;
    setHistory((h) => [cur, ...h.filter((x) => x !== cur)].slice(0, HISTORY_CAP));
    const len = deckRef.current.length;
    const next = len ? (cur + 1) % len : 0;
    S.current.current = next;
    setCurrent(next);
    setLoop(1);
    startSegmentRef.current(0);
  };

  // Engine lifecycle: (re)start whenever a new deck (session) arrives.
  useEffect(() => {
    aliveRef.current = true;
    segIdxRef.current = 0;
    gapRemainingRef.current = 0;
    expectFinishRef.current = false;
    S.current.current = 0;
    setCurrent(0);
    S.current.playing = true;
    setPlaying(true);
    startSegmentRef.current(0);

    return () => {
      // Mark dead first so any in-flight event / timer is a no-op.
      aliveRef.current = false;
      clearGap();
      // Stop playback and clear the now-playing notification on leaving.
      TrackPlayer.reset().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck]);

  // Pause/resume: stop or restart whichever clock the current segment uses.
  useEffect(() => {
    const seg = SEQUENCES[S.current.mode][segIdxRef.current];
    if (playing) {
      if (seg?.kind === 'audio') {
        expectFinishRef.current = true;
        safe(() => TrackPlayer.play());
      } else if (seg?.kind === 'gap') {
        scheduleGap(); // resumes with the saved remaining ms
      }
    } else {
      if (seg?.kind === 'audio') {
        safe(() => TrackPlayer.pause());
      } else if (seg?.kind === 'gap' && gapTimerRef.current) {
        clearGap();
        gapRemainingRef.current = Math.max(
          0,
          gapRemainingRef.current - (Date.now() - gapStartRef.current),
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const setMode = (m) => {
    S.current.mode = m;
    setModeState(m);
    clearGap();
    segIdxRef.current = 0;
    expectFinishRef.current = false;
    startSegmentRef.current(0);
  };

  const togglePlay = () => setPlaying((p) => !p);

  const toggleStay = () =>
    setStaying((s) => {
      S.current.staying = !s;
      return !s;
    });

  const gotIt = () => {
    setLearned((l) => new Set(l).add(S.current.current));
    S.current.playing = true;
    setPlaying(true);
    clearGap();
    advanceRef.current();
  };

  const jumpTo = (idx) => {
    S.current.current = idx;
    setCurrent(idx);
    S.current.staying = false;
    setStaying(false);
    S.current.playing = true;
    setPlaying(true);
    setLoop(1);
    clearGap();
    segIdxRef.current = 0;
    expectFinishRef.current = false;
    startSegmentRef.current(0);
  };

  // Remote "next": advance to the next phrase without marking it learned.
  const skipNext = () => {
    S.current.playing = true;
    setPlaying(true);
    clearGap();
    advanceRef.current();
  };

  // Remote "previous": go back to the previously played phrase (deck order).
  const skipPrev = () => {
    const len = deckRef.current.length;
    if (len) jumpTo((S.current.current - 1 + len) % len);
  };

  // Single subscription for clip-finished, duration, and all remote controls.
  useTrackPlayerEvents(TRACKED_EVENTS, (event) => {
    if (!aliveRef.current) return;
    switch (event.type) {
      case Event.PlaybackProgressUpdated:
        if (event.duration) lastDurationRef.current = event.duration;
        break;
      case Event.PlaybackQueueEnded:
        if (expectFinishRef.current) {
          expectFinishRef.current = false;
          startSegmentRef.current(segIdxRef.current + 1);
        }
        break;
      case Event.RemotePlay:
        if (!S.current.playing) setPlaying(true);
        break;
      case Event.RemotePause:
      case Event.RemoteStop:
        if (S.current.playing) setPlaying(false);
        break;
      case Event.RemoteNext:
        skipNext();
        break;
      case Event.RemotePrevious:
        skipPrev();
        break;
      default:
        break;
    }
  });

  return {
    current,
    phrase: deck[current],
    playing,
    staying,
    mode,
    loop,
    learned,
    history,
    segIdx,
    setMode,
    togglePlay,
    toggleStay,
    gotIt,
    jumpTo,
  };
}

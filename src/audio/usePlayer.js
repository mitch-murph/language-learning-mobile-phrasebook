import { useEffect, useRef, useState } from 'react';
import { useAudioPlayer } from 'expo-audio';

// Cadence engine — port of the web app's usePlayer.ts.
//
// The web version drove gap timing and a progress bar off requestAnimationFrame
// reading an <audio> element. We're skipping the waveform/progress for now, so
// the engine reduces to a clean state machine:
//   - audio segments advance when expo-audio reports `didJustFinish`
//   - gap segments advance on a setTimeout, pausable by tracking remaining ms
// Refs mirror state so the imperative callbacks never read stale values.

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

export function usePlayer(deck, initialMode = 'drill') {
  // One reusable player; we swap its source per segment.
  const player = useAudioPlayer(null);

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

  // expo-audio throws if you call a released player (e.g. a late status event
  // after the screen unmounts), so wrap every imperative call defensively.
  const safe = (fn) => {
    if (!aliveRef.current) return;
    try {
      fn();
    } catch {
      /* player released or not ready — ignore */
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
      safe(() => {
        player.replace({ uri: url });
        player.seekTo(0);
      });
      if (S.current.playing) {
        expectFinishRef.current = true;
        safe(() => player.play());
      }
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

  // Listen for audio finishing + keep the last duration for scale-based gaps.
  useEffect(() => {
    const sub = player.addListener('playbackStatusUpdate', (st) => {
      if (!aliveRef.current) return;
      if (st?.duration) lastDurationRef.current = st.duration;
      if (st?.didJustFinish && expectFinishRef.current) {
        expectFinishRef.current = false;
        startSegmentRef.current(segIdxRef.current + 1);
      }
    });
    return () => sub?.remove?.();
  }, [player]);

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
      // Mark dead first so any in-flight status event / timer is a no-op.
      aliveRef.current = false;
      clearGap();
      try {
        player.pause();
      } catch {
        /* already released */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck]);

  // Pause/resume: stop or restart whichever clock the current segment uses.
  useEffect(() => {
    const seg = SEQUENCES[S.current.mode][segIdxRef.current];
    if (playing) {
      if (seg?.kind === 'audio') {
        expectFinishRef.current = true;
        safe(() => player.play());
      } else if (seg?.kind === 'gap') {
        scheduleGap(); // resumes with the saved remaining ms
      }
    } else {
      if (seg?.kind === 'audio') {
        safe(() => player.pause());
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

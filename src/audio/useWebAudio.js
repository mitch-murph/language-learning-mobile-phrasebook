import { useEffect, useState } from 'react';

// Web-only audio backend for usePlayer. Exposes the small slice of the
// expo-audio player API the engine uses (replace / seekTo / play / pause /
// addListener('playbackStatusUpdate')) on top of ONE persistent <audio> element.
//
// Why not expo-audio on web: mobile browsers only let a page start audio from a
// user gesture (or on an element that is already actively playing), and they
// throttle tabs that aren't playing. The engine's inter-clip gaps are plain
// timers with nothing playing, so on a phone the next play() was blocked and the
// session stopped after one phrase. Mirrors the desktop app's useQueuePlayer:
//   - a single reused element (the gesture-unlocked element is never replaced)
//   - a silent looping clip played during gaps so the element never goes idle
//   - Media Session handlers so lock-screen / headset controls work

// 1s of 8-bit mono silence as a WAV blob, looped during gaps.
function createSilentLoopUrl() {
  const sampleRate = 8000;
  const dataSize = sampleRate;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const str = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  str(36, 'data');
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < dataSize; i++) view.setUint8(44 + i, 128); // 8-bit silence
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

function createController() {
  const audio = new Audio();
  audio.preload = 'auto';
  let silentUrl = null;
  let silent = false; // is the element currently on the silent gap loop?
  const listeners = new Set();
  const emit = (st) => listeners.forEach((fn) => fn(st));

  const tryPlay = () => {
    audio.play().catch((err) => {
      // AbortError = src swapped while a play() was pending: benign.
      if (err?.name === 'AbortError') return;
      console.warn('[audio] play() rejected:', err?.name, err?.message);
    });
  };

  audio.addEventListener('loadedmetadata', () => {
    if (!silent && isFinite(audio.duration)) emit({ duration: audio.duration });
  });
  audio.addEventListener('ended', () => {
    if (silent) return;
    emit({ duration: isFinite(audio.duration) ? audio.duration : 0, didJustFinish: true });
  });
  // A missing / undecodable clip should behave like it finished, not stall.
  audio.addEventListener('error', () => {
    if (silent) return;
    setTimeout(() => emit({ didJustFinish: true }), 150);
  });

  return {
    replace({ uri }) {
      silent = false;
      audio.loop = false;
      if (audio.src !== uri) audio.src = uri;
    },
    seekTo(sec) {
      try {
        audio.currentTime = sec;
      } catch {
        /* not yet seekable */
      }
    },
    play: tryPlay,
    pause() {
      audio.pause();
    },
    // Keep the element "playing" through a gap (see header comment).
    holdSilence() {
      if (!silentUrl) silentUrl = createSilentLoopUrl();
      silent = true;
      audio.loop = true;
      if (audio.src !== silentUrl) audio.src = silentUrl;
      tryPlay();
    },
    addListener(event, fn) {
      if (event !== 'playbackStatusUpdate') return { remove() {} };
      listeners.add(fn);
      return { remove: () => listeners.delete(fn) };
    },
    destroy() {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      if (silentUrl) URL.revokeObjectURL(silentUrl);
    },
  };
}

export function useWebAudio() {
  const [ctl] = useState(createController);
  useEffect(() => () => ctl.destroy(), [ctl]);
  return ctl;
}

// OS media controls (lock screen, headset buttons). Handlers are re-registered
// when callbacks change; `phrase` feeds the now-playing metadata.
export function useMediaSession({ phrase, playing, onPlay, onPause, onNext }) {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', onPlay);
    ms.setActionHandler('pause', onPause);
    ms.setActionHandler('nexttrack', onNext);
    return () => {
      ms.setActionHandler('play', null);
      ms.setActionHandler('pause', null);
      ms.setActionHandler('nexttrack', null);
    };
  });

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    if (!phrase) {
      ms.metadata = null;
      ms.playbackState = 'none';
      return;
    }
    ms.metadata = new MediaMetadata({
      title: phrase.en || phrase.native || '',
      artist: phrase.native || '',
      album: 'Phrasebook',
    });
    ms.playbackState = playing ? 'playing' : 'paused';
  }, [phrase, playing]);
}

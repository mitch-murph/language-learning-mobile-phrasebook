import * as Haptics from 'expo-haptics';

// Tactile confirmation for taps so controls can be used by feel without looking
// (built for in-car use). Every call is fire-and-forget and swallows errors —
// haptics are a nicety, never a reason to crash a handler.
const swallow = (p) => {
  try {
    p?.catch?.(() => {});
  } catch {
    /* haptics unavailable (e.g. web) — ignore */
  }
};

// Light tick for ordinary controls (chips, mode buttons, toggles).
export const tap = () => swallow(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));

// Heavier thud for the big primary actions (Start, Got it, Stay, Resume).
export const tapStrong = () => swallow(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));

import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import { usePlayer, MODES, MODE_META } from '../audio/usePlayer';
import { Btn } from '../ui';

// The session player. Port of the web Player.tsx, minus the live waveform.
// useKeepAwake keeps the screen on during a session (background audio handles
// the screen-off case separately, configured in App.js).
//
// Built for in-car glancing: a fixed (non-scrolling) layout so the phrase is
// always centred and visible, an oversized now-playing card, and big controls.
// "Up next" was dropped — when driving you only need the current phrase and a
// way to jump back to something you just heard.

// Base type metrics for the now-playing card. Kept as plain numbers (not only
// inside the StyleSheet) so the auto-fit can scale them down by a factor.
const CARD_EN = { fontSize: 27, fontWeight: '700', lineHeight: 33 };
const CARD_NATIVE = { fontSize: 42, fontWeight: '600', lineHeight: 52, marginTop: 16 };
const CARD_RO = { fontSize: 25, fontWeight: '600', lineHeight: 31, marginTop: 10 };

// Chunk MODES into fixed-size rows so each row's buttons stretch (flex:1) to
// fill the full width edge-to-edge — content-hugging chips left ragged gaps
// on the right of each wrapped line instead of using the space.
const MODE_COLS = 4;
const MODE_ROWS = [];
for (let i = 0; i < MODES.length; i += MODE_COLS) MODE_ROWS.push(MODES.slice(i, i + MODE_COLS));

// Height of the absolutely-positioned controls block below (stayBtn 60 + gap
// 12 + controlRow 96 + controls' own paddingTop 12), so the replay list can
// reserve exactly that much space instead of sizing itself behind it.
const CONTROLS_HEIGHT = 180;

// Scale a card text's size by the fit factor (1 = natural). Returns only the
// size props so it can layer over the base style without dropping its colour.
function scaleFont(base, f) {
  const out = { fontSize: base.fontSize * f, lineHeight: base.lineHeight * f };
  if (base.marginTop != null) out.marginTop = base.marginTop * f;
  return out;
}

function ReplayRow({ p, done, onClick, styles }) {
  if (!p) return null;
  return (
    <Btn onPress={onClick} style={styles.replayRow}>
      <View style={{ flex: 1, opacity: done ? 0.6 : 1 }}>
        <Text style={styles.replayEn} numberOfLines={1}>{p.en}</Text>
        <Text style={styles.replayNative} numberOfLines={1}>{p.native}</Text>
      </View>
      <Text style={styles.replayIcon}>{done ? '✓' : '↺'}</Text>
    </Btn>
  );
}

export function Player({ deck, initialMode, palette }) {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(palette), [palette]);

  const player = usePlayer(deck, initialMode);
  const { phrase: p, playing, staying, mode, loop, learned, history, segIdx } = player;
  // recall/recallDrill hide the native text until the confirming audio plays
  // (you hear the translation and try to produce the native phrase).
  // reverseRecall hides the English text instead (you hear the native phrase
  // and try to recall its meaning) — same mechanic, opposite direction.
  const hideNative = mode === 'recall' || mode === 'recallDrill';
  const hideEnglish = mode === 'reverseRecall';
  const nativeRevealed = !hideNative || segIdx >= 2;
  const englishRevealed = !hideEnglish || segIdx >= 2;

  // Auto-fit: a hidden full-size measurer reports the content's natural height
  // (independent of the fit factor, so there's no measure→scale→measure loop),
  // and the visible copy scales its FONT — not its box — by `fit`. Scaling the
  // font keeps the text full-width, so left/right padding is identical for every
  // phrase; only long phrases render smaller and wrap onto more lines.
  const [availH, setAvailH] = useState(0);
  const [contentH, setContentH] = useState(0);
  const fit = availH > 0 && contentH > 0 ? Math.min(1, availH / contentH) : 1;
  const accent = staying ? palette.green : palette.amber;

  if (!p) return null;

  return (
    <View style={[s.container, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 14 }]}>
      {/* mode picker — a fixed-column grid so each row's buttons stretch to
          fill the width edge-to-edge, growing extra rows as modes grow.
          Theme toggle lives on Home only; it's a set-once preference, not
          worth the space here. (Exit via Android hardware back or, on web,
          the browser's back button — see App.js.) */}
      <View style={s.modeGrid}>
        {MODE_ROWS.map((row, ri) => (
          <View key={ri} style={s.modeRowLine}>
            {row.map((m) => {
              const active = mode === m;
              return (
                <Btn key={m} onPress={() => player.setMode(m)} style={[s.modeBtn, active && s.modeBtnActive]}>
                  <Text style={[s.modeBtnText, active && s.modeBtnTextActive]} numberOfLines={1}>{MODE_META[m].label}</Text>
                </Btn>
              );
            })}
          </View>
        ))}
      </View>

      {/* now-playing card — pinned near the top at a FIXED height so the layout
          never shifts as phrases of different lengths come and go. */}
      <View style={[s.card, { borderColor: accent }]}>
        {staying && (
          <View style={s.loopBadge}>
            <Text style={s.loopBadgeText}>↻ ×{loop}</Text>
          </View>
        )}
        {/* Hidden measurer: a full-size copy whose height feeds the fit factor.
            It's never scaled, so reading it back can't change its own size. */}
        <View
          style={s.measurer}
          pointerEvents="none"
          onLayout={(e) => setContentH(e.nativeEvent.layout.height)}
        >
          <Text style={s.cardEn}>{p.en}</Text>
          <Text style={s.cardNative}>{p.native}</Text>
          {p.nonLatin && !!p.ro && <Text style={s.cardRo}>{p.ro}</Text>}
        </View>

        {/* Visible copy: full width with the font scaled to fit, so horizontal
            padding stays identical no matter the phrase length. */}
        <View style={s.cardFit} onLayout={(e) => setAvailH(e.nativeEvent.layout.height)}>
          <Text style={[s.cardEn, scaleFont(CARD_EN, fit)]}>
            {hideEnglish && !englishRevealed ? '?' : p.en}
          </Text>
          <Text style={[s.cardNative, scaleFont(CARD_NATIVE, fit)]}>
            {hideNative && !nativeRevealed ? p.languageName : p.native}
          </Text>
          {p.nonLatin && !!p.ro && (
            <Text style={[s.cardRo, scaleFont(CARD_RO, fit), { color: accent, opacity: nativeRevealed ? 1 : 0 }]}>{p.ro}</Text>
          )}
        </View>
      </View>

      {/* recently played — scrolls vertically within its fixed slot (flows
          under the card, clipped above the pinned controls), so a longer
          history never pushes the card or controls around. */}
      {history.length > 0 && (
        <View style={s.replayWrap}>
          <Text style={s.replayLabel}>RECENTLY PLAYED · TAP TO REPLAY</Text>
          <ScrollView style={s.replayScroll} showsVerticalScrollIndicator={false} contentContainerStyle={s.replayScrollContent}>
            {history.map((idx) => (
              <ReplayRow key={idx} p={deck[idx]} done={learned.has(idx)} styles={s} onClick={() => player.jumpTo(idx)} />
            ))}
          </ScrollView>
        </View>
      )}

      {/* controls — absolutely pinned to the bottom, painted over the list */}
      <View style={[s.controls, { left: 18, right: 18, bottom: insets.bottom + 14 }]}>
        <Btn onPress={player.toggleStay} strong style={[s.stayBtn, staying && s.stayBtnActive]}>
          <Text style={[s.stayBtnText, staying && s.stayBtnTextActive]}>
            ↻ {staying ? 'STAYING ON THIS' : 'STAY ON PHRASE'}
          </Text>
        </Btn>
        <View style={s.controlRow}>
          <Btn onPress={player.togglePlay} strong style={s.playBtn}>
            <Text style={s.playBtnText}>{playing ? '❙❙' : '▶'}</Text>
            <Text style={s.playBtnLabel}>{playing ? 'PAUSE' : 'PLAY'}</Text>
          </Btn>
          <Btn onPress={player.gotIt} strong style={s.gotItBtn}>
            <Text style={s.gotItText}>✓ GOT IT</Text>
          </Btn>
        </View>
      </View>
    </View>
  );
}

function makeStyles(p) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: p.bg, paddingHorizontal: 18 },

    // A fixed-column grid (see MODE_ROWS) instead of natural wrapping: every
    // row's buttons stretch (flex:1) to fill the full width, so a short last
    // row doesn't leave ragged empty space on the right.
    modeGrid: { gap: 6 },
    modeRowLine: { flexDirection: 'row', gap: 6 },
    modeBtn: { flex: 1, paddingVertical: 11, borderRadius: 11, backgroundColor: p.surface, borderWidth: 1, borderColor: p.line, alignItems: 'center', justifyContent: 'center' },
    modeBtnActive: { backgroundColor: p.fg, borderColor: p.fg },
    modeBtnText: { fontSize: 12.5, fontWeight: '700', color: p.muted },
    modeBtnTextActive: { color: p.bg },

    // Fixed-height card pinned near the top. Content is auto-scaled to fit (see
    // the fit logic in the component) and clipped (overflow hidden), so a long
    // phrase can never grow the card and shove the rest of the layout around.
    card: { height: 300, padding: 26, borderRadius: 28, backgroundColor: p.surface, borderWidth: 2, marginTop: 16, overflow: 'hidden' },
    cardFit: { flex: 1, justifyContent: 'center' },
    // Full-size measurer overlaid inside the card padding (so its width — and
    // therefore its wrapping and height — matches the visible copy), invisible
    // and non-interactive.
    measurer: { position: 'absolute', top: 26, left: 26, right: 26, opacity: 0 },
    loopBadge: { position: 'absolute', top: 16, right: 18 },
    loopBadgeText: { fontSize: 14, fontWeight: '800', color: p.green },
    cardEn: { ...CARD_EN, color: p.fg },
    cardNative: { ...CARD_NATIVE, color: p.fg },
    cardRo: { ...CARD_RO },

    // flex:1 bounds this to the remaining space above the pinned controls —
    // marginBottom reserves the controls' own height so that space doesn't
    // extend behind them, and the ScrollView (itself flex:1, not just its
    // content) gets a real, correctly-sized viewport to scroll within.
    replayWrap: { flex: 1, marginTop: 14, marginBottom: CONTROLS_HEIGHT },
    replayLabel: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.4, color: p.muted2, marginBottom: 4, paddingHorizontal: 4 },
    replayScroll: { flex: 1 },
    replayScrollContent: { paddingBottom: 4 },
    replayRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: p.surface, marginBottom: 6 },
    replayEn: { fontSize: 17, fontWeight: '700', color: p.fg },
    replayNative: { fontSize: 15, fontWeight: '500', color: p.muted, marginTop: 2 },
    replayIcon: { fontSize: 20, fontWeight: '900', color: p.muted },

    controls: { position: 'absolute', gap: 12, paddingTop: 12, backgroundColor: p.bg },
    stayBtn: { height: 60, borderRadius: 20, borderWidth: 1.5, borderColor: p.green, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
    stayBtnActive: { backgroundColor: p.green },
    stayBtnText: { fontSize: 18, fontWeight: '800', color: p.green, letterSpacing: 0.5 },
    stayBtnTextActive: { color: p.bg },
    controlRow: { flexDirection: 'row', gap: 12, height: 96 },
    playBtn: { flex: 1, borderRadius: 22, backgroundColor: p.surface, borderWidth: 1, borderColor: p.line, alignItems: 'center', justifyContent: 'center', gap: 5 },
    playBtnText: { fontSize: 30, color: p.fg },
    playBtnLabel: { fontSize: 14, fontWeight: '700', color: p.fg, letterSpacing: 0.6 },
    gotItBtn: { flex: 1.7, borderRadius: 22, backgroundColor: p.green, alignItems: 'center', justifyContent: 'center' },
    gotItText: { fontSize: 26, fontWeight: '800', color: p.bg, letterSpacing: 0.4 },
  });
}

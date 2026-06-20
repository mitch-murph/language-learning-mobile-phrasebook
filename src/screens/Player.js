import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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

export function Player({ deck, initialMode, palette, themeName, onToggleTheme }) {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(palette), [palette]);

  const player = usePlayer(deck, initialMode);
  const { phrase: p, playing, staying, mode, loop, learned, history, segIdx } = player;
  const revealed = mode !== 'recall' || segIdx >= 2;

  // Auto-fit: measure the available box height and the content's natural
  // height, then scale the content down to fit. transform:scale doesn't affect
  // layout, so onLayout keeps reporting the natural height — no feedback loop.
  // Reveal opacity also doesn't change layout, so the scale stays put when the
  // translation appears in recall mode.
  const [availH, setAvailH] = useState(0);
  const [contentH, setContentH] = useState(0);
  const fit = availH > 0 && contentH > 0 ? Math.min(1, availH / contentH) : 1;
  const accent = staying ? palette.green : palette.amber;
  const allDone = learned.size >= deck.length;

  if (!p) return null;

  return (
    <View style={[s.container, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 14 }]}>
      {/* mode segmented + theme toggle (use the Android back button to exit) */}
      <View style={s.modeRow}>
        {MODES.map((m) => {
          const active = mode === m;
          return (
            <Btn key={m} onPress={() => player.setMode(m)} style={[s.modeBtn, active && s.modeBtnActive]}>
              <Text style={[s.modeBtnText, active && s.modeBtnTextActive]}>{MODE_META[m].label}</Text>
            </Btn>
          );
        })}
        <Btn onPress={onToggleTheme} style={s.themeBtn}>
          <Text style={s.themeBtnText}>{themeName === 'dark' ? '☀' : '☾'}</Text>
        </Btn>
      </View>

      {/* progress / review status */}
      <Text style={[s.status, { color: allDone ? palette.green : palette.muted }]}>
        {allDone ? '✓ ALL LEARNED — LOOPING FOR REVIEW' : `${learned.size} / ${deck.length} LEARNED`}
      </Text>

      {/* now-playing card — pinned near the top at a FIXED height so the layout
          never shifts as phrases of different lengths come and go. */}
      <View style={[s.card, { borderColor: accent }]}>
        {staying && (
          <View style={s.loopBadge}>
            <Text style={s.loopBadgeText}>↻ ×{loop}</Text>
          </View>
        )}
        <View style={s.cardFit} onLayout={(e) => setAvailH(e.nativeEvent.layout.height)}>
          <View
            style={{ transform: [{ scale: fit }] }}
            onLayout={(e) => setContentH(e.nativeEvent.layout.height)}
          >
            <Text style={s.cardEn}>{p.en}</Text>
            <Text style={[s.cardNative, { opacity: revealed ? 1 : 0 }]}>{p.native}</Text>
            {p.nonLatin && !!p.ro && (
              <Text style={[s.cardRo, { color: accent, opacity: revealed ? 1 : 0 }]}>{p.ro}</Text>
            )}
          </View>
        </View>
      </View>

      {/* recently played — flows under the card and overflows behind the
          controls, so its height never pushes the card around. */}
      {history.length > 0 && (
        <View style={s.replayWrap}>
          <Text style={s.replayLabel}>RECENTLY PLAYED · TAP TO REPLAY</Text>
          {history.slice(0, 2).map((idx) => (
            <ReplayRow key={idx} p={deck[idx]} done={learned.has(idx)} styles={s} onClick={() => player.jumpTo(idx)} />
          ))}
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

    modeRow: { flexDirection: 'row', gap: 6, alignItems: 'stretch' },
    modeBtn: { flex: 1, paddingVertical: 11, borderRadius: 11, backgroundColor: p.surface, borderWidth: 1, borderColor: p.line, alignItems: 'center' },
    modeBtnActive: { backgroundColor: p.fg, borderColor: p.fg },
    modeBtnText: { fontSize: 13, fontWeight: '700', color: p.muted },
    modeBtnTextActive: { color: p.bg },
    themeBtn: { width: 48, borderRadius: 11, borderWidth: 1, borderColor: p.line, backgroundColor: p.surface, alignItems: 'center', justifyContent: 'center' },
    themeBtnText: { fontSize: 18, color: p.fg },

    status: { fontSize: 12, fontWeight: '800', letterSpacing: 1.4, textAlign: 'center', marginTop: 12 },

    // Fixed-height card pinned near the top. Content is auto-scaled to fit (see
    // the fit logic in the component) and clipped (overflow hidden), so a long
    // phrase can never grow the card and shove the rest of the layout around.
    card: { height: 300, padding: 26, borderRadius: 28, backgroundColor: p.surface, borderWidth: 2, marginTop: 16, overflow: 'hidden' },
    cardFit: { flex: 1, justifyContent: 'center' },
    loopBadge: { position: 'absolute', top: 16, right: 18 },
    loopBadgeText: { fontSize: 14, fontWeight: '800', color: p.green },
    cardEn: { fontSize: 27, fontWeight: '700', color: p.fg, lineHeight: 33 },
    cardNative: { fontSize: 42, fontWeight: '600', color: p.fg, marginTop: 16, lineHeight: 52 },
    cardRo: { fontSize: 25, fontWeight: '600', marginTop: 10, lineHeight: 31 },

    // flex:1 so it fills the gap down to the bottom; overflow hidden + the
    // absolute controls on top mean extra rows simply disappear behind them.
    replayWrap: { flex: 1, marginTop: 14, overflow: 'hidden' },
    replayLabel: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.4, color: p.muted2, marginBottom: 4, paddingHorizontal: 4 },
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

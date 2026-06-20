import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import { usePlayer, MODES, MODE_META } from '../audio/usePlayer';

// The session player. Port of the web Player.tsx, minus the live waveform.
// useKeepAwake keeps the screen on during a session (background audio handles
// the screen-off case separately, configured in App.js).

function QueueRow({ p, done, onClick, styles, big = false, showDot = true }) {
  if (!p) return null;
  return (
    <Pressable onPress={onClick} style={styles.queueRow}>
      {showDot && (
        <View style={styles.queueIcon}>
          {done ? <Text style={styles.queueCheck}>✓</Text> : <View style={styles.queueDot} />}
        </View>
      )}
      <View style={{ flex: 1, opacity: done ? 0.66 : 1 }}>
        <Text style={[styles.queueEn, big && styles.queueEnBig]} numberOfLines={1}>{p.en}</Text>
        <Text style={[styles.queueNative, big && styles.queueNativeBig]} numberOfLines={1}>{p.native}</Text>
      </View>
    </Pressable>
  );
}

export function Player({ deck, initialMode, palette, themeName, onToggleTheme }) {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(palette), [palette]);

  const player = usePlayer(deck, initialMode);
  const { phrase: p, playing, staying, mode, loop, learned, history, segIdx } = player;
  const revealed = mode !== 'recall' || segIdx >= 2;
  const accent = staying ? palette.green : palette.amber;

  // Up next: following phrases, skipping learned ones.
  const upNext = [];
  for (let k = 1; k <= deck.length && upNext.length < 1; k++) {
    const idx = (player.current + k) % deck.length;
    if (idx === player.current || learned.has(idx)) continue;
    upNext.push(idx);
  }
  const allDone = learned.size >= deck.length;

  if (!p) return null;

  return (
    <View style={[s.container, { paddingTop: insets.top + 12 }]}>
      {/* mode segmented + theme toggle (use the Android back button to exit) */}
      <View style={s.modeRow}>
        {MODES.map((m) => {
          const active = mode === m;
          return (
            <Pressable key={m} onPress={() => player.setMode(m)} style={[s.modeBtn, active && s.modeBtnActive]}>
              <Text style={[s.modeBtnText, active && s.modeBtnTextActive]}>{MODE_META[m].label}</Text>
            </Pressable>
          );
        })}
        <Pressable onPress={onToggleTheme} style={s.themeBtn}>
          <Text style={s.themeBtnText}>{themeName === 'dark' ? '☀' : '☾'}</Text>
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
        {/* up next */}
        <Text style={[s.sectionLabel, { color: allDone ? palette.green : palette.muted }]}>
          {allDone ? 'LOOPING FOR REVIEW' : 'UP NEXT'}
        </Text>
        {upNext.length === 0 ? (
          <Text style={s.upNextEmpty}>All phrases learned — replaying for review.</Text>
        ) : (
          <QueueRow p={deck[upNext[0]]} styles={s} showDot={false} onClick={() => player.jumpTo(upNext[0])} />
        )}

        {/* now playing card */}
        <View style={[s.card, { borderColor: accent }]}>
          {staying && (
            <View style={s.loopBadge}>
              <Text style={s.loopBadgeText}>↻ ×{loop}</Text>
            </View>
          )}
          <Text style={s.cardEn}>{p.en}</Text>
          <Text style={[s.cardNative, { opacity: revealed ? 1 : 0 }]}>{p.native}</Text>
          {p.nonLatin && !!p.ro && (
            <Text style={[s.cardRo, { color: accent, opacity: revealed ? 1 : 0 }]}>{p.ro}</Text>
          )}
        </View>

        {/* recently played */}
        <Text style={[s.sectionLabel, { marginTop: 16 }]}>RECENTLY PLAYED</Text>
        {history.length === 0 ? (
          <Text style={s.upNextEmpty}>Nothing yet — it'll show here.</Text>
        ) : (
          history.slice(0, 2).map((idx) => (
            <QueueRow key={idx} p={deck[idx]} done={learned.has(idx)} big styles={s} onClick={() => player.jumpTo(idx)} />
          ))
        )}
      </ScrollView>

      {/* controls */}
      <View style={[s.controls, { paddingBottom: insets.bottom + 14 }]}>
        <Pressable onPress={player.toggleStay} style={[s.stayBtn, staying && s.stayBtnActive]}>
          <Text style={[s.stayBtnText, staying && s.stayBtnTextActive]}>
            ↻ {staying ? 'STAYING ON THIS' : 'STAY ON PHRASE'}
          </Text>
        </Pressable>
        <View style={s.controlRow}>
          <Pressable onPress={player.togglePlay} style={s.playBtn}>
            <Text style={s.playBtnText}>{playing ? '❙❙' : '▶'}</Text>
            <Text style={s.playBtnLabel}>{playing ? 'PAUSE' : 'PLAY'}</Text>
          </Pressable>
          <Pressable onPress={player.gotIt} style={s.gotItBtn}>
            <Text style={s.gotItText}>✓ GOT IT</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function makeStyles(p) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: p.bg, paddingHorizontal: 18 },

    modeRow: { flexDirection: 'row', gap: 6, alignItems: 'stretch' },
    modeBtn: { flex: 1, paddingVertical: 9, borderRadius: 11, backgroundColor: p.surface, borderWidth: 1, borderColor: p.line, alignItems: 'center' },
    modeBtnActive: { backgroundColor: p.fg, borderColor: p.fg },
    modeBtnText: { fontSize: 12.5, fontWeight: '700', color: p.muted },
    modeBtnTextActive: { color: p.bg },
    themeBtn: { width: 46, borderRadius: 11, borderWidth: 1, borderColor: p.line, backgroundColor: p.surface, alignItems: 'center', justifyContent: 'center' },
    themeBtnText: { fontSize: 17, color: p.fg },

    sectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.6, color: p.muted, marginBottom: 2, paddingHorizontal: 4 },
    upNextEmpty: { fontSize: 14, fontWeight: '600', color: p.muted2, paddingHorizontal: 12, paddingVertical: 5 },

    card: { marginTop: 12, padding: 22, borderRadius: 24, backgroundColor: p.surface, borderWidth: 2 },
    loopBadge: { position: 'absolute', top: 14, right: 16 },
    loopBadgeText: { fontSize: 12, fontWeight: '800', color: p.green },
    cardEn: { fontSize: 30, fontWeight: '700', color: p.fg, lineHeight: 36 },
    cardNative: { fontSize: 22, fontWeight: '500', color: p.muted, marginTop: 11, lineHeight: 29 },
    cardRo: { fontSize: 15, fontWeight: '600', marginTop: 5 },

    queueRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6, paddingHorizontal: 12 },
    queueIcon: { width: 20, alignItems: 'center' },
    queueCheck: { color: p.green, fontSize: 16, fontWeight: '900' },
    queueDot: { width: 7, height: 7, borderRadius: 7, backgroundColor: p.muted2 },
    queueEn: { fontSize: 14.5, fontWeight: '600', color: p.fg },
    queueEnBig: { fontSize: 18 },
    queueNative: { fontSize: 12.5, fontWeight: '500', color: p.muted, marginTop: 2 },
    queueNativeBig: { fontSize: 14.5 },

    controls: { paddingTop: 6, gap: 10 },
    stayBtn: { height: 52, borderRadius: 19, borderWidth: 1.5, borderColor: p.green, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
    stayBtnActive: { backgroundColor: p.green },
    stayBtnText: { fontSize: 16, fontWeight: '800', color: p.green, letterSpacing: 0.5 },
    stayBtnTextActive: { color: p.bg },
    controlRow: { flexDirection: 'row', gap: 11, height: 74 },
    playBtn: { flex: 1, borderRadius: 19, backgroundColor: p.surface, borderWidth: 1, borderColor: p.line, alignItems: 'center', justifyContent: 'center', gap: 4 },
    playBtnText: { fontSize: 24, color: p.fg },
    playBtnLabel: { fontSize: 12.5, fontWeight: '700', color: p.fg, letterSpacing: 0.6 },
    gotItBtn: { flex: 1.7, borderRadius: 19, backgroundColor: p.green, alignItems: 'center', justifyContent: 'center' },
    gotItText: { fontSize: 20, fontWeight: '800', color: p.bg, letterSpacing: 0.4 },
  });
}

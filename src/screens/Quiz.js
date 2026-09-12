import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import { useAudioPlayer } from 'expo-audio';
import { sampleChoices } from '../mcq';
import { Btn } from '../ui';

// Quiz mode: hear the English, reveal multiple-choice native options, pick
// the right one, hear it confirmed. Port of language-learning-youtube-
// phrasebook's Overlay.tsx "pause & consider" flow (prompt → choices →
// answered), adapted from a single random popup into a full pass through
// the deck — like Player, there's no end; it loops (mod deck length)
// instead of finishing.

// Base type metrics for the now-playing card, scaled by the fit factor below
// — same auto-fit technique (and same numbers) as Player's card: a hidden
// full-size measurer reports natural height, the visible copy scales its
// FONT (not its box) by `fit`, so a long phrase shrinks instead of growing
// the (fixed-height) card.
const CARD_EN = { fontSize: 27, fontWeight: '700', lineHeight: 33 };
const CARD_NATIVE = { fontSize: 38, fontWeight: '600', lineHeight: 46, marginTop: 14 };
const CARD_RO = { fontSize: 22, fontWeight: '600', lineHeight: 27, marginTop: 8 };

function scaleFont(base, f) {
  const out = { fontSize: base.fontSize * f, lineHeight: base.lineHeight * f };
  if (base.marginTop != null) out.marginTop = base.marginTop * f;
  return out;
}

export function Quiz({ deck, pool, palette }) {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(palette), [palette]);

  const player = useAudioPlayer(null);
  const aliveRef = useRef(true);
  // expo-audio throws if you call a released player (e.g. a late status
  // event after the screen unmounts) — guard every imperative call.
  const safe = (fn) => {
    if (!aliveRef.current) return;
    try {
      fn();
    } catch {
      /* player released or not ready — ignore */
    }
  };

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      try {
        player.pause();
      } catch {
        /* already released */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState('prompt'); // prompt -> choices -> answered
  const [wrongIds, setWrongIds] = useState(() => new Set());
  const [isPlaying, setIsPlaying] = useState(false);
  // Which url is actually loaded — the answered screen has two play buttons
  // (normal/slow) sharing one player, so each needs to know whether IT is
  // the one currently playing, not just whether something is.
  const [activeUrl, setActiveUrl] = useState(null);

  // Auto-fit for the card: see CARD_EN/CARD_NATIVE above. Keeps the card a
  // FIXED height no matter the phrase length, so the controls below it never
  // shift between phases.
  const [availH, setAvailH] = useState(0);
  const [contentH, setContentH] = useState(0);
  const fit = availH > 0 && contentH > 0 ? Math.min(1, availH / contentH) : 1;

  const target = deck[idx];
  // Same target → same options for the life of the round; recomputing only
  // when the target changes keeps the choices from reshuffling on re-render.
  const choices = useMemo(
    () => (target ? sampleChoices(target, pool) : []),
    [target, pool],
  );

  const playUrl = (url) => {
    if (!url) {
      setIsPlaying(false);
      return;
    }
    setActiveUrl(url);
    safe(() => {
      player.replace({ uri: url });
      player.seekTo(0);
      player.play();
    });
    setIsPlaying(true);
  };

  // New round: reset to the prompt and lead with the English audio, giving a
  // moment to think before the reveal.
  useEffect(() => {
    setPhase('prompt');
    setWrongIds(new Set());
    playUrl(target?.translationUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  useEffect(() => {
    const sub = player.addListener('playbackStatusUpdate', (st) => {
      if (!aliveRef.current) return;
      if (st?.didJustFinish) setIsPlaying(false);
    });
    return () => sub?.remove?.();
  }, [player]);

  if (!target) return null;

  // Native line stays behind the language name (same placeholder Player's
  // recall mode uses) until the question is actually answered.
  const revealed = phase === 'answered';

  const reveal = () => {
    safe(() => player.pause());
    setIsPlaying(false);
    setPhase('choices');
  };

  const pick = (choice) => {
    if (choice.id !== target.id) {
      setWrongIds((prev) => new Set(prev).add(choice.id));
      return;
    }
    setPhase('answered');
    playUrl(target.normalUrl);
  };

  // Toggling the button for whatever's already playing pauses it; toggling a
  // DIFFERENT button (e.g. slow while normal is playing) switches to it.
  const togglePlay = (url) => {
    if (isPlaying && activeUrl === url) {
      safe(() => player.pause());
      setIsPlaying(false);
    } else {
      playUrl(url);
    }
  };

  const next = () => {
    const len = deck.length;
    setIdx((i) => (len ? (i + 1) % len : 0));
  };

  return (
    <View style={[s.container, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 14 }]}>
      <Text style={s.progress}>{idx + 1} / {deck.length}</Text>

      {/* Now-playing-style card — fixed height, always on top across every
          phase. English is always visible; the native line sits right
          below it behind a language-name placeholder (Player's recall
          mode) until answered, so the reveal happens IN the card instead of
          popping up separately below it. */}
      <View style={[s.card, revealed && s.cardRevealed]}>
        <View
          style={s.measurer}
          pointerEvents="none"
          onLayout={(e) => setContentH(e.nativeEvent.layout.height)}
        >
          <Text style={s.cardEn}>{target.en}</Text>
          <Text style={s.cardNative}>{revealed ? target.native : target.languageName}</Text>
          {target.nonLatin && !!target.ro && <Text style={s.cardRo}>{target.ro}</Text>}
        </View>
        <View style={s.cardFit} onLayout={(e) => setAvailH(e.nativeEvent.layout.height)}>
          <Text style={[s.cardEn, scaleFont(CARD_EN, fit)]}>{target.en}</Text>
          <Text style={[s.cardNative, scaleFont(CARD_NATIVE, fit)]}>
            {revealed ? target.native : target.languageName}
          </Text>
          {target.nonLatin && !!target.ro && (
            <Text style={[s.cardRo, scaleFont(CARD_RO, fit), { opacity: revealed ? 1 : 0 }]}>{target.ro}</Text>
          )}
        </View>
      </View>

      {/* Choices sit right under the card (top-anchored — it's the thing to
          read next); the reveal/next action rows pin to the bottom instead,
          like Player's and Home's primary actions, rather than floating
          awkwardly in whatever space is left. */}
      <View style={[s.content, phase !== 'choices' && s.contentBottom]}>
        {phase === 'prompt' && (
          <View style={s.actions}>
            {!!target.translationUrl && (
              <Btn onPress={() => togglePlay(target.translationUrl)} style={s.playBtn}>
                <Text style={s.playBtnText}>
                  {isPlaying && activeUrl === target.translationUrl ? '❙❙' : '▶'}
                </Text>
              </Btn>
            )}
            <Btn onPress={reveal} strong style={s.revealBtn}>
              <Text style={s.revealBtnText}>REVEAL</Text>
            </Btn>
          </View>
        )}

        {phase === 'choices' && (
          <View style={s.choicesBody}>
            <View style={s.grid}>
              {choices.map((choice) => {
                const isWrong = wrongIds.has(choice.id);
                return (
                  <Btn
                    key={choice.id}
                    onPress={() => pick(choice)}
                    disabled={isWrong}
                    style={[s.choiceBtn, isWrong && s.choiceBtnWrong]}
                  >
                    <Text style={[s.choiceText, isWrong && s.choiceTextWrong]}>{choice.native}</Text>
                    {!!choice.ro && (
                      <Text style={[s.choiceRo, isWrong && s.choiceTextWrong]}>{choice.ro}</Text>
                    )}
                  </Btn>
                );
              })}
            </View>

            {/* Same bottom-left slot as the play buttons on the other two
                screens — REVEAL pauses the prompt's auto-played audio, so
                this is how to hear it again while weighing the options. */}
            <View style={s.actions}>
              {!!target.translationUrl && (
                <Btn onPress={() => togglePlay(target.translationUrl)} style={s.playBtn}>
                  <Text style={s.playBtnText}>
                    {isPlaying && activeUrl === target.translationUrl ? '❙❙' : '▶'}
                  </Text>
                </Btn>
              )}
            </View>
          </View>
        )}

        {phase === 'answered' && (
          <View style={s.actions}>
            <Btn onPress={() => togglePlay(target.normalUrl)} style={s.playBtn}>
              <Text style={s.playBtnText}>
                {isPlaying && activeUrl === target.normalUrl ? '❙❙' : '▶'}
              </Text>
            </Btn>
            {!!target.slowUrl && (
              <Btn onPress={() => togglePlay(target.slowUrl)} style={s.playBtn}>
                <Text style={s.playBtnText}>
                  {isPlaying && activeUrl === target.slowUrl ? '❙❙' : '½'}
                </Text>
              </Btn>
            )}
            <Btn onPress={next} strong style={s.nextBtn}>
              <Text style={s.nextBtnText}>NEXT ▸</Text>
            </Btn>
          </View>
        )}
      </View>
    </View>
  );
}

function makeStyles(p) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: p.bg, paddingHorizontal: 18 },
    progress: { fontSize: 13, fontWeight: '700', color: p.muted, letterSpacing: 0.8, marginBottom: 10 },

    // Fixed-height card — content is auto-scaled to fit (see the fit logic in
    // the component) and clipped, so a long phrase can never grow the card.
    card: { height: 280, padding: 24, borderRadius: 26, backgroundColor: p.surface, borderWidth: 2, borderColor: p.line, overflow: 'hidden' },
    cardRevealed: { borderColor: p.green },
    cardFit: { flex: 1, justifyContent: 'center' },
    // Full-size measurer overlaid inside the card padding (so its width —
    // and therefore its wrapping and height — matches the visible copy),
    // invisible and non-interactive.
    measurer: { position: 'absolute', top: 24, left: 24, right: 24, opacity: 0 },
    cardEn: { ...CARD_EN, color: p.fg, textAlign: 'center' },
    cardNative: { ...CARD_NATIVE, color: p.fg, textAlign: 'center' },
    cardRo: { ...CARD_RO, color: p.muted, textAlign: 'center' },

    content: { flex: 1 },
    contentBottom: { justifyContent: 'flex-end' },

    revealBtn: { flex: 1, height: 64, borderRadius: 18, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center' },
    revealBtnText: { fontSize: 20, fontWeight: '800', color: '#fff', letterSpacing: 1 },

    // Grid up top (right under the card), play button pinned to the bottom
    // — same split as content/contentBottom, scoped to just this phase so
    // the grid doesn't get pushed down too.
    choicesBody: { flex: 1, justifyContent: 'space-between' },

    // 2x2 grid: wraps to two per row, each cell a fixed fraction of the width
    // so choices never reflow based on their own text length.
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, justifyContent: 'space-between', marginTop: 22 },
    choiceBtn: { width: '47%', minHeight: 110, borderWidth: 2, borderColor: p.line, borderRadius: 16, padding: 16, backgroundColor: p.surface, alignItems: 'center', justifyContent: 'center' },
    choiceBtnWrong: { borderColor: p.danger, opacity: 0.5 },
    choiceText: { fontSize: 20, fontWeight: '700', color: p.fg, textAlign: 'center' },
    choiceTextWrong: { color: p.danger },
    choiceRo: { fontSize: 13, fontWeight: '500', color: p.muted, marginTop: 4, textAlign: 'center' },

    // Pinned to the bottom via contentBottom above, not trailing the card —
    // keeps REVEAL/NEXT in the same reachable spot every round.
    actions: { flexDirection: 'row', gap: 12 },
    playBtn: { width: 64, height: 64, borderRadius: 18, backgroundColor: p.bg, borderWidth: 1, borderColor: p.line, alignItems: 'center', justifyContent: 'center' },
    playBtnText: { fontSize: 24, color: p.fg },
    nextBtn: { flex: 1, height: 64, borderRadius: 18, backgroundColor: p.green, alignItems: 'center', justifyContent: 'center' },
    nextBtnText: { fontSize: 20, fontWeight: '800', color: '#fff', letterSpacing: 0.6 },
  });
}

import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MODES, MODE_META } from '../audio/usePlayer';

// The session builder. The deck is defined purely by filters — selected
// languages and tags (plus an "Untagged" bucket) — rather than picking
// individual phrases. No filters at all means "everything".
//
// Touch targets are sized for glanceable, in-car use: chips wrap (no hunting
// via horizontal scroll) and everything is large and high-contrast.

const UNTAGGED = ' untagged'; // sentinel tag for phrases with no tags

function formatSize(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return mb < 0.1 ? '<0.1 MB' : `${mb.toFixed(1)} MB`;
}

function formatAgo(ts) {
  if (!ts) return 'never';
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function Home({
  groups,
  palette,
  themeName,
  onToggleTheme,
  mode,
  onChangeMode,
  onStart,
  namespace,
  onChangeNamespace,
  onSync,
  syncing,
  syncProgress, // { done, total } | null
  lastSyncedAt,
  sizeBytes,
}) {
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(palette), [palette]);

  const [filterLangs, setFilterLangs] = useState(new Set());
  const [filterTags, setFilterTags] = useState(new Set()); // may include UNTAGGED
  const [showK, setShowK] = useState(false);
  const [nsDraft, setNsDraft] = useState(namespace ?? '');

  const allTags = useMemo(() => {
    const set = new Set();
    groups.forEach((g) => g.phrases.forEach((p) => p.tags.forEach((t) => set.add(t))));
    return [...set].sort();
  }, [groups]);

  const langFilterMatches = (p) => filterLangs.size === 0 || filterLangs.has(p.languageName);
  const tagFilterMatches = (p) => {
    if (filterTags.size === 0) return true;
    const wantUntagged = filterTags.has(UNTAGGED);
    return p.tags.some((t) => filterTags.has(t)) || (wantUntagged && p.tags.length === 0);
  };

  // Faceted availability: each facet's options depend on the OTHER facet's
  // selection, so a language/tag only stays offered if it can co-occur with
  // what's already picked. Currently-selected items always remain (to deselect).
  const availLangs = useMemo(() => {
    const set = new Set();
    groups.forEach((g) => {
      if (g.phrases.some(tagFilterMatches)) set.add(g.languageName);
    });
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, filterTags]);

  const availTags = useMemo(() => {
    const set = new Set();
    let untagged = false;
    groups.forEach((g) =>
      g.phrases.forEach((p) => {
        if (!langFilterMatches(p)) return;
        p.tags.forEach((t) => set.add(t));
        if (p.tags.length === 0) untagged = true;
      }),
    );
    return { set, untagged };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, filterLangs]);

  // A phrase is in the deck if it passes both the language and tag filters.
  // An empty filter set means "no constraint" (everything passes).
  const matches = (p) => {
    const langOk = filterLangs.size === 0 || filterLangs.has(p.languageName);
    if (!langOk) return false;
    if (filterTags.size === 0) return true;
    const wantUntagged = filterTags.has(UNTAGGED);
    return p.tags.some((t) => filterTags.has(t)) || (wantUntagged && p.tags.length === 0);
  };

  const matchedGroups = useMemo(() => {
    return groups
      .map((g) => ({ ...g, phrases: g.phrases.filter(matches) }))
      .filter((g) => g.phrases.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, filterLangs, filterTags]);

  const deck = useMemo(() => matchedGroups.flatMap((g) => g.phrases), [matchedGroups]);
  const count = deck.length;
  const langsUsed = matchedGroups.length;
  const everything = filterLangs.size === 0 && filterTags.size === 0;

  // Only offer options that can co-occur with the other facet (plus any already
  // selected, so they can be turned off).
  const visibleLangs = groups.filter(
    (g) => availLangs.has(g.languageName) || filterLangs.has(g.languageName),
  );
  const visibleTags = allTags.filter((t) => availTags.set.has(t) || filterTags.has(t));
  const showUntagged = availTags.untagged || filterTags.has(UNTAGGED);

  const toggleIn = (setter) => (value) =>
    setter((prev) => {
      const next = new Set(prev);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  const toggleLang = toggleIn(setFilterLangs);
  const toggleTag = toggleIn(setFilterTags);

  const selectEverything = () => {
    setFilterLangs(new Set());
    setFilterTags(new Set());
  };

  const nsChanged = (nsDraft.trim() || '').toLowerCase() !== (namespace ?? '').toLowerCase();

  const Chip = ({ active, label, onPress }) => (
    <Pressable onPress={onPress} style={[s.chip, active && s.chipActive]}>
      <Text style={[s.chipText, active && s.chipTextActive]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={[s.container, { paddingTop: insets.top + 12 }]}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 14 }} keyboardShouldPersistTaps="handled">
        {/* top controls: namespace (k) toggle, theme, sync */}
        <View style={s.syncBar}>
          <View style={s.controlRow}>
            <Pressable onPress={() => setShowK((v) => !v)} style={s.kToggle}>
              <Text style={s.kToggleText} numberOfLines={1}>🔑 {namespace || 'default'}</Text>
            </Pressable>
            <Pressable onPress={onToggleTheme} style={s.iconBtnSmall}>
              <Text style={s.iconBtnText}>{themeName === 'dark' ? '☀' : '☾'}</Text>
            </Pressable>
            <Pressable onPress={onSync} disabled={syncing} style={[s.syncBtn, syncing && s.disabled]}>
              <Text style={s.syncBtnText}>
                {syncing ? (syncProgress ? `↻ ${syncProgress.done}/${syncProgress.total}` : '↻ …') : '↓ Sync'}
              </Text>
            </Pressable>
          </View>
          <Text style={s.syncMeta}>Synced {formatAgo(lastSyncedAt)} · {formatSize(sizeBytes)}</Text>
          {showK && (
            <View style={s.nsRow}>
              <TextInput
                value={nsDraft}
                onChangeText={setNsDraft}
                placeholder="library (k) — blank = default"
                placeholderTextColor={palette.muted2}
                autoCapitalize="none"
                autoCorrect={false}
                style={s.nsInput}
              />
              <Pressable
                onPress={() => { onChangeNamespace(nsDraft.trim()); setShowK(false); }}
                disabled={!nsChanged}
                style={[s.smallBtn, !nsChanged && s.disabled]}
              >
                <Text style={s.smallBtnText}>Set</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* languages */}
        <Text style={s.sectionLabel}>LANGUAGES</Text>
        <View style={s.chipWrap}>
          <Chip active={everything} label="Everything" onPress={selectEverything} />
          {visibleLangs.map((g) => (
            <Chip
              key={g.languageName}
              active={filterLangs.has(g.languageName)}
              label={`${g.native}  ${g.languageName}`}
              onPress={() => toggleLang(g.languageName)}
            />
          ))}
        </View>

        {/* tags — only those present in the selected languages */}
        {(visibleTags.length > 0 || showUntagged) && (
          <>
            <Text style={s.sectionLabel}>TAGS</Text>
            <View style={s.chipWrap}>
              {visibleTags.map((tag) => (
                <Chip key={tag} active={filterTags.has(tag)} label={tag} onPress={() => toggleTag(tag)} />
              ))}
              {showUntagged && (
                <Chip active={filterTags.has(UNTAGGED)} label="Untagged" onPress={() => toggleTag(UNTAGGED)} />
              )}
            </View>
          </>
        )}

        {/* count */}
        <View style={s.statusRow}>
          <Text style={s.statusText}>
            {everything ? `All ${count}` : count} {count === 1 ? 'phrase' : 'phrases'} · {langsUsed} {langsUsed === 1 ? 'language' : 'languages'}
          </Text>
          {!everything && (
            <Pressable onPress={selectEverything} hitSlop={10}>
              <Text style={s.clearText}>Reset</Text>
            </Pressable>
          )}
        </View>

        {/* read-only preview of what will play */}
        {matchedGroups.length === 0 ? (
          <Text style={s.empty}>No phrases match these filters</Text>
        ) : (
          matchedGroups.map((g) => (
            <View key={g.languageName}>
              <View style={s.groupHeader}>
                <Text style={s.groupTitle}>
                  {g.native} <Text style={s.groupTitleSub}>{g.languageName.toUpperCase()}</Text>
                </Text>
                <Text style={s.groupCount}>{g.phrases.length}</Text>
              </View>
              {g.phrases.map((p) => (
                <View key={p.id} style={s.row}>
                  <Text style={s.rowEn} numberOfLines={1}>{p.en}</Text>
                  <Text style={s.rowNative} numberOfLines={1}>{p.native}</Text>
                </View>
              ))}
            </View>
          ))
        )}
      </ScrollView>

      {/* mode picker + start */}
      <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
        <View style={s.modeRow}>
          {MODES.map((m) => {
            const active = mode === m;
            return (
              <Pressable key={m} onPress={() => onChangeMode(m)} style={[s.modeBtn, active && s.modeBtnActive]}>
                <Text style={[s.modeBtnText, active && s.modeBtnTextActive]}>{MODE_META[m].label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          onPress={() => count > 0 && onStart(deck, mode)}
          disabled={count === 0}
          style={[s.startBtn, count === 0 && s.startBtnDisabled]}
        >
          <Text style={[s.startBtnText, count === 0 && s.startBtnTextDisabled]}>▶ START DRIVING</Text>
          <Text style={[s.startBtnSub, count === 0 && s.startBtnTextDisabled]}>
            {count} {count === 1 ? 'phrase' : 'phrases'} · {langsUsed} {langsUsed === 1 ? 'language' : 'languages'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function makeStyles(p) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: p.bg, paddingHorizontal: 18 },

    syncBar: { backgroundColor: p.surface, borderWidth: 1, borderColor: p.line, borderRadius: 14, padding: 10, gap: 8, marginBottom: 12 },
    controlRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    kToggle: { flex: 1, height: 44, borderRadius: 10, borderWidth: 1, borderColor: p.line, backgroundColor: p.bg, paddingHorizontal: 12, justifyContent: 'center' },
    kToggleText: { fontSize: 15, fontWeight: '700', color: p.fg },
    iconBtnSmall: { width: 48, height: 44, borderRadius: 10, borderWidth: 1, borderColor: p.line, backgroundColor: p.bg, alignItems: 'center', justifyContent: 'center' },
    iconBtnText: { fontSize: 18, color: p.fg },
    nsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    nsInput: { flex: 1, height: 44, borderRadius: 10, borderWidth: 1, borderColor: p.line, backgroundColor: p.bg, paddingHorizontal: 12, color: p.fg, fontSize: 15 },
    smallBtn: { paddingHorizontal: 16, height: 44, borderRadius: 10, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center' },
    smallBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
    syncMeta: { fontSize: 13, color: p.muted, fontWeight: '600' },
    syncBtn: { paddingHorizontal: 18, height: 44, borderRadius: 10, backgroundColor: p.green, alignItems: 'center', justifyContent: 'center' },
    syncBtnText: { color: '#fff', fontWeight: '800', fontSize: 14.5 },
    disabled: { opacity: 0.5 },

    sectionLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 1.4, color: p.muted, marginBottom: 8, marginTop: 4 },
    // Wrapping chip grid with large, fat-finger-friendly targets.
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
    chip: { borderWidth: 1.5, borderColor: p.line, borderRadius: 14, paddingHorizontal: 20, paddingVertical: 14, backgroundColor: p.surface },
    chipActive: { backgroundColor: p.green, borderColor: p.green },
    chipText: { fontSize: 17, fontWeight: '700', color: p.fg },
    chipTextActive: { color: '#fff' },

    statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
    statusText: { fontSize: 14.5, fontWeight: '700', color: p.green },
    clearText: { fontSize: 14.5, fontWeight: '700', color: p.muted },

    empty: { padding: 40, textAlign: 'center', fontSize: 15, fontWeight: '600', color: p.muted },
    groupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, paddingBottom: 4 },
    groupTitle: { fontSize: 16, fontWeight: '700', color: p.fg },
    groupTitleSub: { fontSize: 12, fontWeight: '700', letterSpacing: 1.2, color: p.muted },
    groupCount: { fontSize: 13, fontWeight: '700', color: p.muted },
    row: { paddingVertical: 5 },
    rowEn: { fontSize: 15.5, fontWeight: '600', color: p.fg },
    rowNative: { fontSize: 12.5, fontWeight: '500', color: p.muted, marginTop: 1 },

    footer: { borderTopWidth: 1, borderTopColor: p.line, paddingTop: 12, gap: 12 },
    modeRow: { flexDirection: 'row', gap: 7 },
    modeBtn: { flex: 1, paddingVertical: 15, borderRadius: 13, backgroundColor: p.surface, borderWidth: 1, borderColor: p.line, alignItems: 'center' },
    modeBtnActive: { backgroundColor: p.fg, borderColor: p.fg },
    modeBtnText: { fontSize: 14.5, fontWeight: '700', color: p.muted },
    modeBtnTextActive: { color: p.bg },
    startBtn: { borderRadius: 20, backgroundColor: p.green, paddingVertical: 20, alignItems: 'center', gap: 3 },
    startBtnDisabled: { backgroundColor: p.surface, borderWidth: 1, borderColor: p.line },
    startBtnText: { fontSize: 22, fontWeight: '800', color: '#fff', letterSpacing: 0.4 },
    startBtnSub: { fontSize: 13, fontWeight: '600', color: '#fff', opacity: 0.9 },
    startBtnTextDisabled: { color: p.muted2, opacity: 1 },
  });
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { setAudioModeAsync } from 'expo-audio';
import { groupByLanguage } from './src/phrases';
import { loadLibrary, syncLibrary, librarySizeBytes } from './src/sync';
import { paletteFor } from './src/theme';
import * as storage from './src/storage';
import { Home } from './src/screens/Home';
import { Player } from './src/screens/Player';

// Top-level orchestrator and view machine (home → drive). No navigation library
// — like the web app, a plain `view` state is enough for two screens.
//
// Offline-first: on launch we read the cached phrase list for the active
// library and render from it. The Sync button refreshes the list and downloads
// audio. Playback prefers local files (resolved in src/sync.js) and falls back
// to remote S3 for anything not yet downloaded.
function App() {
  const [ready, setReady] = useState(false);
  const [themeName, setThemeName] = useState('light');
  const [mode, setModeState] = useState('drill');
  const [shuffle, setShuffleState] = useState(false);
  const [lastSession, setLastSession] = useState(null);
  const [namespace, setNamespaceState] = useState(null);

  const [phrases, setPhrases] = useState([]); // cached raw list for this library
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [sizeBytes, setSizeBytes] = useState(0);

  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(null);

  const [view, setView] = useState('home');
  const [deck, setDeck] = useState([]);
  const [deckMode, setDeckMode] = useState('drill');

  const palette = paletteFor(themeName);

  // Read the cached list + on-device size for a given library into state.
  const loadCacheFor = useCallback(async (ns) => {
    const lib = await loadLibrary(ns);
    setPhrases(lib?.phrases ?? []);
    setLastSyncedAt(lib?.lastSyncedAt ?? null);
    setSizeBytes(librarySizeBytes(ns));
  }, []);

  // Bootstrap: audio session (with background playback) + saved prefs + cache.
  useEffect(() => {
    (async () => {
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: true, // keep drilling with the screen off
        interruptionMode: 'doNotMix',
      });
      const [t, m, sh, last, ns] = await Promise.all([
        storage.getTheme(),
        storage.getMode(),
        storage.getShuffle(),
        storage.getLastSession(),
        storage.getNamespace(),
      ]);
      setThemeName(t);
      setModeState(m);
      setShuffleState(sh);
      setLastSession(last);
      setNamespaceState(ns);
      await loadCacheFor(ns);
      setReady(true);
    })();
  }, [loadCacheFor]);

  const groups = useMemo(
    () => (phrases.length ? groupByLanguage(phrases, namespace) : []),
    [phrases, namespace],
  );

  const onToggleTheme = useCallback(() => {
    setThemeName((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      storage.setTheme(next);
      return next;
    });
  }, []);

  const onChangeMode = useCallback((m) => {
    setModeState(m);
    storage.setMode(m);
  }, []);

  const onChangeShuffle = useCallback((on) => {
    setShuffleState(on);
    storage.setShuffle(on);
  }, []);

  const onChangeNamespace = useCallback(
    async (ns) => {
      const value = ns ? ns : null;
      await storage.setNamespace(value);
      // Re-read so reserved words ("default") normalize the same way everywhere.
      const stored = await storage.getNamespace();
      setNamespaceState(stored);
      await loadCacheFor(stored);
    },
    [loadCacheFor],
  );

  const onSync = useCallback(async () => {
    setSyncing(true);
    setSyncProgress(null);
    try {
      const res = await syncLibrary(namespace, (done, total) => setSyncProgress({ done, total }));
      await loadCacheFor(namespace);
      const failedNote = res.failed ? ` (${res.failed} failed)` : '';
      Alert.alert('Sync complete', `${res.total} phrases · ${res.downloaded} new audio files${failedNote}.`);
    } catch (e) {
      Alert.alert("Couldn't sync", `${e.message}\n\nCheck your connection and the EXPO_PUBLIC_* values.`);
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  }, [namespace, loadCacheFor]);

  // Start a session and remember its recipe (filters + mode + shuffle) so the
  // next launch can offer a one-tap Resume. `meta` is the snapshot to persist.
  const startSession = useCallback((d, m, meta) => {
    setDeck(d);
    setDeckMode(m);
    setView('drive');
    if (meta) {
      setLastSession(meta);
      storage.setLastSession(meta);
    }
  }, []);

  // Android hardware back: from a session it returns Home; from Home it falls
  // through to the OS default (closes the app). Replaces the old in-app button.
  // Subscribe once and read the current view from a ref so we never re-register
  // (and never tear down) the handler while navigating.
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (viewRef.current === 'drive') {
        setView('home');
        return true; // handled — don't exit the app
      }
      return false; // Home: let the OS close the app
    });
    return () => sub.remove();
  }, []);

  if (!ready) {
    return (
      <View style={[styles.center, { backgroundColor: palette.bg }]}>
        <ActivityIndicator size="large" color={palette.accent} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        {view === 'home' && (
          <Home
            groups={groups}
            palette={palette}
            themeName={themeName}
            onToggleTheme={onToggleTheme}
            mode={mode}
            onChangeMode={onChangeMode}
            shuffle={shuffle}
            onChangeShuffle={onChangeShuffle}
            lastSession={lastSession}
            onStart={startSession}
            namespace={namespace}
            onChangeNamespace={onChangeNamespace}
            onSync={onSync}
            syncing={syncing}
            syncProgress={syncProgress}
            lastSyncedAt={lastSyncedAt}
            sizeBytes={sizeBytes}
          />
        )}

        {view === 'drive' && (
          <Player
            // Remount on a fresh session so the engine resets cleanly.
            key={deck.map((p) => p.id).join(',')}
            deck={deck}
            initialMode={deckMode}
            palette={palette}
            themeName={themeName}
            onToggleTheme={onToggleTheme}
          />
        )}

        <StatusBar style={themeName === 'dark' ? 'light' : 'dark'} />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

export default App;

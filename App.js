import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { listPhrases, getAudioUrl } from './src/api';

// Minimal demo: pull the saved phrases from the Lambda endpoint and play the
// normal / slow MP3s straight from S3. No drill engine, no waveform — just
// proof that the endpoint + S3 audio work from a native app.
export default function App() {
  const [phrases, setPhrases] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [nowPlaying, setNowPlaying] = useState(null); // `${phraseId}:${pace}`

  // One shared player; tapping a phrase swaps its source.
  const player = useAudioPlayer(null);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true });
  }, []);

  useEffect(() => {
    listPhrases()
      .then(setPhrases)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function toggle(phrase, pace) {
    const key = `${phrase.phraseId}:${pace}`;
    if (nowPlaying === key) {
      player.pause();
      setNowPlaying(null);
      return;
    }
    const s3Key = pace === 'slow' ? phrase.slowS3Key : phrase.normalS3Key;
    player.replace({ uri: getAudioUrl(s3Key) });
    player.play();
    setNowPlaying(key);
  }

  function renderItem({ item }) {
    return (
      <View style={styles.card}>
        <Text style={styles.native}>{item.text}</Text>
        {!!item.translation && <Text style={styles.translation}>{item.translation}</Text>}
        <Text style={styles.meta}>{item.languageName}</Text>
        <View style={styles.row}>
          {['normal', 'slow'].map((pace) => {
            const active = nowPlaying === `${item.phraseId}:${pace}`;
            return (
              <Pressable
                key={pace}
                onPress={() => toggle(item, pace)}
                style={[styles.btn, active && styles.btnActive]}
              >
                <Text style={[styles.btnText, active && styles.btnTextActive]}>
                  {active ? '❙❙ ' : '▶ '}
                  {pace === 'slow' ? 'Slow' : 'Normal'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Phrasebook</Text>

      {loading && <ActivityIndicator style={styles.center} size="large" />}

      {error && (
        <View style={styles.center}>
          <Text style={styles.error}>Couldn't load phrases</Text>
          <Text style={styles.errorDetail}>{error}</Text>
          <Text style={styles.errorDetail}>
            Check the EXPO_PUBLIC_* values in .env.local
          </Text>
        </View>
      )}

      {!loading && !error && (
        <FlatList
          data={phrases}
          keyExtractor={(p) => p.phraseId}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.errorDetail}>No phrases yet.</Text>
          }
        />
      )}

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 64, paddingHorizontal: 16 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  list: { paddingBottom: 32, gap: 12 },
  card: {
    borderWidth: 1,
    borderColor: '#e3e3e3',
    borderRadius: 14,
    padding: 16,
    backgroundColor: '#fafafa',
  },
  native: { fontSize: 22, fontWeight: '600' },
  translation: { fontSize: 16, color: '#444', marginTop: 2 },
  meta: { fontSize: 12, color: '#888', marginTop: 6, textTransform: 'uppercase', letterSpacing: 1 },
  row: { flexDirection: 'row', gap: 10, marginTop: 12 },
  btn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: '#1f6feb',
  },
  btnActive: { backgroundColor: '#0a3d8f' },
  btnText: { color: '#fff', fontWeight: '600' },
  btnTextActive: { color: '#dbe6ff' },
  error: { fontSize: 18, fontWeight: '600', color: '#b00020' },
  errorDetail: { fontSize: 13, color: '#888', textAlign: 'center' },
});

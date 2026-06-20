import { Platform } from 'react-native';
import { File, Directory, Paths } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { listPhrases, getAudioUrl } from './api';

// expo-file-system has no web implementation, so on web we skip all on-device
// storage and run online-only (stream from S3) — this keeps the `expo start`
// web preview working as a quick dev surface. Native gets the full offline path.
const OFFLINE_AVAILABLE = Platform.OS !== 'web';

// Offline layer. A "library" (namespace) caches two things on the device:
//   1. the phrase list JSON, in AsyncStorage   (so the app opens offline)
//   2. every normal/slow/translation MP3, under documentDirectory/audio/<ns>/
// The Sync button refreshes both. Playback then prefers the local file and
// falls back to the remote S3 URL for anything not yet downloaded.
//
// expo-file-system's File/Directory API (SDK 53+) is synchronous for `exists`,
// `uri`, `size` and `delete()`, which is what makes resolveUrl() cheap to call
// at deck-build time.

// Each namespace gets its own folder; the shared default library uses `_default`.
function nsFolder(namespace) {
  return namespace ? namespace.toLowerCase() : '_default';
}

// Constructed lazily (never at module load) so the web bundle, where Directory
// isn't implemented, doesn't crash on import.
function audioDir(namespace) {
  return new Directory(Paths.document, 'audio', nsFolder(namespace));
}

// S3 keys contain slashes and other characters that aren't valid as a single
// filename, so flatten them to a deterministic, collision-free local name.
function fileName(s3Key) {
  return s3Key.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function localFile(namespace, s3Key) {
  return new File(audioDir(namespace), fileName(s3Key));
}

function listKey(namespace) {
  return `phrasebook.library.${nsFolder(namespace)}`;
}

/**
 * Resolve an S3 key to the best available URI: the downloaded local file if it
 * exists, otherwise the remote S3 URL. Returns `null` for a missing key.
 */
export function resolveUrl(namespace, s3Key) {
  if (!s3Key) return null;
  if (!OFFLINE_AVAILABLE) return getAudioUrl(s3Key); // web: always remote
  const file = localFile(namespace, s3Key);
  return file.exists ? file.uri : getAudioUrl(s3Key);
}

/** The cached phrase list for a library, or `null` if never synced. */
export async function loadLibrary(namespace) {
  const raw = await AsyncStorage.getItem(listKey(namespace));
  if (!raw) return null;
  try {
    return JSON.parse(raw); // { phrases, lastSyncedAt }
  } catch {
    return null;
  }
}

/** All S3 keys referenced by a phrase (skipping the optional translation). */
function keysFor(phrase) {
  const keys = [];
  if (phrase.normalS3Key) keys.push(phrase.normalS3Key);
  if (phrase.slowS3Key) keys.push(phrase.slowS3Key);
  if (phrase.translationS3Key) keys.push(phrase.translationS3Key);
  return keys;
}

/**
 * Fetch the latest list for a library, download any audio not already on the
 * device, prune files no longer referenced, and cache the list. Requires a
 * network connection. `onProgress(done, total)` reports download progress.
 *
 * Returns { total, downloaded, failed }.
 */
export async function syncLibrary(namespace, onProgress) {
  const phrases = await listPhrases(namespace); // throws if offline

  // Web: refresh and cache the list only — there's no on-device audio store.
  if (!OFFLINE_AVAILABLE) {
    const record = { phrases, lastSyncedAt: Date.now() };
    await AsyncStorage.setItem(listKey(namespace), JSON.stringify(record));
    return { total: phrases.length, downloaded: 0, failed: 0, lastSyncedAt: record.lastSyncedAt };
  }

  const dir = audioDir(namespace);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });

  const allKeys = phrases.flatMap(keysFor);
  const wanted = new Set(allKeys.map(fileName));

  // Download only what's missing so re-syncs are cheap.
  const missing = allKeys.filter((k) => !localFile(namespace, k).exists);
  let done = 0;
  let failed = 0;
  for (const key of missing) {
    try {
      await File.downloadFileAsync(getAudioUrl(key), localFile(namespace, key));
    } catch {
      // Leave it missing — playback will fall back to the remote URL.
      failed += 1;
    }
    onProgress?.(++done, missing.length);
  }

  // Prune orphans (phrases deleted in the source library).
  for (const entry of dir.list()) {
    if (entry instanceof File && !wanted.has(entry.name)) {
      try {
        entry.delete();
      } catch {
        /* ignore */
      }
    }
  }

  const record = { phrases, lastSyncedAt: Date.now() };
  await AsyncStorage.setItem(listKey(namespace), JSON.stringify(record));

  return { total: phrases.length, downloaded: missing.length - failed, failed, lastSyncedAt: record.lastSyncedAt };
}

/** On-device size (bytes) of a library's downloaded audio. */
export function librarySizeBytes(namespace) {
  if (!OFFLINE_AVAILABLE) return 0; // web: nothing stored on device
  const dir = audioDir(namespace);
  if (!dir.exists) return 0;
  let total = 0;
  for (const entry of dir.list()) {
    if (entry instanceof File) total += entry.size || 0;
  }
  return total;
}

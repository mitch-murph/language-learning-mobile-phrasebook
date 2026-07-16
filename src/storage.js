import AsyncStorage from '@react-native-async-storage/async-storage';

// Small typed wrappers around AsyncStorage for the few preferences we persist.
// AsyncStorage is async on RN (unlike the web app's synchronous localStorage),
// so callers await these and seed React state from them on launch.

const NS_KEY = 'phrasebook.namespace';
const MODE_KEY = 'phrasebook.mode';
const THEME_KEY = 'phrasebook.theme';
const SHUFFLE_KEY = 'phrasebook.shuffle';
const INCLUDE_HIDDEN_KEY = 'phrasebook.includeHidden';

/**
 * The selected library ("namespace"), the mobile equivalent of the web app's
 * `#k=…` URL fragment. `null` means the shared "default" library, in which case
 * requests omit the `x-namespace` header. Must resolve to the same word in the
 * TTS app for the same library to appear.
 */
export async function getNamespace() {
  return (await AsyncStorage.getItem(NS_KEY)) || null;
}

export async function setNamespace(ns) {
  const word = (ns || '').trim();
  // Empty or the reserved word "default" returns to the shared library.
  if (word && word.toLowerCase() !== 'default') {
    await AsyncStorage.setItem(NS_KEY, word);
  } else {
    await AsyncStorage.removeItem(NS_KEY);
  }
}

export async function getMode() {
  return (await AsyncStorage.getItem(MODE_KEY)) || 'drill';
}

export async function setMode(mode) {
  await AsyncStorage.setItem(MODE_KEY, mode);
}

export async function getTheme() {
  return (await AsyncStorage.getItem(THEME_KEY)) || 'light';
}

export async function setTheme(theme) {
  await AsyncStorage.setItem(THEME_KEY, theme);
}

/** Whether to shuffle phrase order at the start of a session. */
export async function getShuffle() {
  return (await AsyncStorage.getItem(SHUFFLE_KEY)) === '1';
}

export async function setShuffle(on) {
  await AsyncStorage.setItem(SHUFFLE_KEY, on ? '1' : '0');
}

/** Whether to include phrases marked `hide: true` in the deck builder. Defaults to off. */
export async function getIncludeHidden() {
  return (await AsyncStorage.getItem(INCLUDE_HIDDEN_KEY)) === '1';
}

export async function setIncludeHidden(on) {
  await AsyncStorage.setItem(INCLUDE_HIDDEN_KEY, on ? '1' : '0');
}

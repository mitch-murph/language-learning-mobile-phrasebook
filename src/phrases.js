import { resolveUrl } from './sync';

// Port of the web app's phrases.ts. Two differences from web:
//   - No CSS font variables: React Native on Android renders CJK/Thai scripts
//     via the system fonts automatically, so we drop the `font` field.
//   - Audio URLs are resolved through the offline layer (local file if synced,
//     else remote S3), so grouping takes the active namespace.

// A library's own name, for section headers (keyed by lowercase language name).
const ENDONYM = {
  japanese: '日本語',
  korean: '한국어',
  thai: 'ภาษาไทย',
  chinese: '中文',
  mandarin: '中文',
  spanish: 'Español',
  french: 'Français',
  german: 'Deutsch',
  italian: 'Italiano',
  english: 'English',
};

function endonymFor(languageName) {
  return ENDONYM[languageName.trim().toLowerCase()] ?? languageName;
}

/** The unit the Home picker and the player work with. */
export function toDeckPhrase(p, namespace) {
  return {
    id: p.phraseId,
    en: p.translation?.trim() || p.text, // English translation — the hero line
    native: p.text, // native-script text
    ro: p.transcription?.trim() || '', // romanization (shown when nonLatin)
    code: p.languageCode,
    languageName: p.languageName,
    nonLatin: p.nonLatin,
    normalUrl: resolveUrl(namespace, p.normalS3Key),
    slowUrl: resolveUrl(namespace, p.slowS3Key),
    translationUrl: p.translationS3Key ? resolveUrl(namespace, p.translationS3Key) : undefined,
    tags: p.tags ?? [],
  };
}

/**
 * Group phrases by language for the Home picker, preserving the API's order
 * (oldest first) both for the groups and the phrases within them.
 */
export function groupByLanguage(phrases, namespace) {
  const groups = new Map();
  for (const p of phrases) {
    let g = groups.get(p.languageName);
    if (!g) {
      g = {
        languageName: p.languageName,
        native: endonymFor(p.languageName), // e.g. 日本語 for the section header
        phrases: [],
      };
      groups.set(p.languageName, g);
    }
    g.phrases.push(toDeckPhrase(p, namespace));
  }
  return [...groups.values()];
}

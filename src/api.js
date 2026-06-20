import { sha256 } from 'js-sha256';

// Read-only client for the TTS phrasebook backend. Mirrors the web app's
// `src/api/client.ts` + `crypto.ts`, just without Web Crypto (unavailable in
// React Native) — `js-sha256.hmac` produces the identical hex digest.
//
// EXPO_PUBLIC_* vars are inlined into the bundle at build time. As with the web
// client, the HMAC secret ships to the device — inherent to this design.
const LAMBDA_URL = (process.env.EXPO_PUBLIC_LAMBDA_URL ?? '').replace(/\/$/, '');
const AUDIO_BASE_URL = (process.env.EXPO_PUBLIC_AUDIO_BASE_URL ?? '').replace(/\/$/, '');
const HMAC_SECRET = process.env.EXPO_PUBLIC_HMAC_SECRET ?? '';

// Short-lived HMAC-TOTP token, matching the Lambda exactly:
// HMAC-SHA256(secret, floor(Date.now() / 30000)), hex-encoded. The server
// accepts the current and previous 30s window.
function generateToken() {
  const window = Math.floor(Date.now() / 30000);
  return sha256.hmac(HMAC_SECRET, String(window));
}

/** Resolve an S3 key to a fully-qualified audio URL. */
export function getAudioUrl(s3Key) {
  return `${AUDIO_BASE_URL}/${s3Key}`;
}

/** Fetch every saved phrase (oldest first). Read-only. */
export async function listPhrases() {
  const res = await fetch(`${LAMBDA_URL}/phrases`, {
    headers: { 'x-app-token': generateToken() },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error((body && body.error) || `HTTP ${res.status}`);
  }
  const { phrases } = await res.json();
  return phrases.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

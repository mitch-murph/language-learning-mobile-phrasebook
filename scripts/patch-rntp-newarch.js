// One-shot transform: react-native-track-player 4.1.2's @ReactMethod functions
// use Kotlin expression bodies (`= scope.launch { ... }`), so they return `Job`.
// The New Architecture's TurboModule interop rejects that ("returnType == void
// iff synchronous") and the app crashes on launch. This rewrites each such
// method to a block body (`{ scope.launch { ... } }`) so it returns Unit/void.
//
// Run via patch-rntp (see package scripts) BEFORE `npx patch-package` so the fix
// is captured into patches/. Brace matching is string/comment-aware.
const fs = require('fs');

const file =
  'node_modules/react-native-track-player/android/src/main/java/com/doublesymmetry/trackplayer/module/MusicModule.kt';
let src = fs.readFileSync(file, 'utf8');

if (src.includes('{ scope.launch {')) {
  console.log('MusicModule.kt already transformed — nothing to do.');
  process.exit(0);
}

// Mark which characters are real code (not inside strings, chars, or comments).
function codeMask(s) {
  const mask = new Array(s.length).fill(true);
  let state = 'code';
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    const c2 = s[i + 1];
    const off = () => { mask[i] = false; };
    if (state === 'code') {
      if (c === '/' && c2 === '/') { mask[i] = mask[i + 1] = false; state = 'line'; i += 2; continue; }
      if (c === '/' && c2 === '*') { mask[i] = mask[i + 1] = false; state = 'block'; i += 2; continue; }
      if (s.substr(i, 3) === '"""') { mask[i] = mask[i + 1] = mask[i + 2] = false; state = 'triple'; i += 3; continue; }
      if (c === '"') { off(); state = 'string'; i++; continue; }
      if (c === "'") { off(); state = 'char'; i++; continue; }
      i++; continue;
    }
    if (state === 'line') { off(); if (c === '\n') state = 'code'; i++; continue; }
    if (state === 'block') { off(); if (c === '*' && c2 === '/') { mask[i + 1] = false; state = 'code'; i += 2; continue; } i++; continue; }
    if (state === 'string') { off(); if (c === '\\') { mask[i + 1] = false; i += 2; continue; } if (c === '"') state = 'code'; i++; continue; }
    if (state === 'triple') { off(); if (s.substr(i, 3) === '"""') { mask[i + 1] = mask[i + 2] = false; state = 'code'; i += 3; continue; } i++; continue; }
    if (state === 'char') { off(); if (c === '\\') { mask[i + 1] = false; i += 2; continue; } if (c === "'") state = 'code'; i++; continue; }
  }
  return mask;
}

const mask = codeMask(src);
const re = /=\s*scope\.launch\s*\{/g;
const matches = [];
let m;
while ((m = re.exec(src))) {
  if (!mask[m.index]) continue; // matched inside a string/comment — skip
  matches.push({ start: m.index, end: m.index + m[0].length, brace: m.index + m[0].length - 1 });
}

// Process last-to-first so earlier offsets stay valid (methods never nest).
for (let i = matches.length - 1; i >= 0; i--) {
  const { start, end, brace } = matches[i];
  let depth = 0;
  let close = -1;
  for (let j = brace; j < src.length; j++) {
    if (!mask[j]) continue;
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) { close = j; break; }
  }
  if (close === -1) { console.error('No matching brace for method at offset', start); process.exit(1); }
  src = src.slice(0, close + 1) + ' }' + src.slice(close + 1);
  src = src.slice(0, start) + '{ scope.launch {' + src.slice(end);
}

fs.writeFileSync(file, src);
console.log('Transformed', matches.length, 'expression-body @ReactMethod functions.');

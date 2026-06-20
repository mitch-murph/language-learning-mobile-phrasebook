#!/usr/bin/env node
/*
 * One-shot local release build + install for this Expo app.
 *
 * Deliberately calls Gradle directly (NOT `expo run:android`) so prebuild never
 * runs and never reverts the pinned Gradle version in
 * android/gradle/wrapper/gradle-wrapper.properties (RN 0.85's plugin needs the
 * Gradle 8.x API; Gradle 9 removed JvmVendorSpec.IBM_SEMERU).
 *
 * Usage: npm run apk
 */
const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const isWin = process.platform === 'win32';
const root = path.resolve(__dirname, '..');
const androidDir = path.join(root, 'android');

// JDK: prefer an existing JAVA_HOME, else Android Studio's bundled JBR.
if (!process.env.JAVA_HOME && isWin) {
  process.env.JAVA_HOME = 'C:\\Program Files\\Android\\Android Studio\\jbr';
}

// Android SDK: prefer existing env, else the platform default location.
function defaultSdk() {
  if (process.env.ANDROID_HOME) return process.env.ANDROID_HOME;
  if (process.env.ANDROID_SDK_ROOT) return process.env.ANDROID_SDK_ROOT;
  if (isWin) return path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Android', 'sdk');
  return path.join(os.homedir(), 'Android', 'Sdk');
}
const sdk = defaultSdk();
process.env.ANDROID_HOME = sdk;
process.env.ANDROID_SDK_ROOT = sdk;

const adb = path.join(sdk, 'platform-tools', isWin ? 'adb.exe' : 'adb');
const gradlew = path.join(androidDir, isWin ? 'gradlew.bat' : 'gradlew');
const apk = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');

function run(cmd, args, opts = {}) {
  // On Windows, Node won't spawn .bat/.cmd files (e.g. gradlew.bat) without a
  // shell. Our paths/args contain no spaces, so shell quoting isn't a concern.
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: isWin, ...opts });
  if (r.error) throw r.error;
  return r.status;
}

// 1) Build the release APK (arm64-v8a only — matches the target phone, faster).
console.log('\n▶ Building release APK (Gradle)…');
const buildStatus = run(gradlew, [
  '-p', androidDir,
  ':app:assembleRelease',
  '-x', 'lint',
  '-x', 'test',
  '-PreactNativeArchitectures=arm64-v8a',
]);
if (buildStatus !== 0) {
  console.error('\n✗ Gradle build failed.');
  process.exit(buildStatus);
}
if (!fs.existsSync(apk)) {
  console.error(`\n✗ Build reported success but APK not found at ${apk}`);
  process.exit(1);
}
const sizeMb = (fs.statSync(apk).size / 1024 / 1024).toFixed(1);
console.log(`\n✓ Built ${path.relative(root, apk)} (${sizeMb} MB)`);

// 2) Try a direct adb install; fall back to pushing the file for manual install
//    (Xiaomi/MIUI blocks adb installs with INSTALL_FAILED_USER_RESTRICTED until
//    "Install via USB" is enabled in Developer options).
console.log('\n▶ Installing to device via adb…');
const installStatus = run(adb, ['install', '-r', apk]);
if (installStatus === 0) {
  console.log('\n✓ Installed. Open the app on your phone.');
} else {
  console.log('\n⚠ Direct install blocked (likely MIUI "Install via USB" is off).');
  console.log('  Pushing the APK to your phone for manual install instead…');
  const pushStatus = run(adb, ['push', apk, '/sdcard/Download/phrasebook.apk']);
  if (pushStatus === 0) {
    console.log('\n✓ Pushed to Downloads/phrasebook.apk');
    console.log('  On the phone: Files → Downloads → tap phrasebook.apk → Install.');
  } else {
    console.error('\n✗ Could not reach the device. Is it plugged in? (adb devices)');
    process.exit(pushStatus);
  }
}

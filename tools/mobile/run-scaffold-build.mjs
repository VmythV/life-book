import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const pnpmExecutable = process.env.npm_execpath;

if (pnpmExecutable === undefined) {
  console.error('Run the Android scaffold build through the pinned package manager.');
  process.exit(1);
}

const androidSdkCandidates = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  resolve(homedir(), 'Library/Android/sdk'),
  '/opt/homebrew/share/android-commandlinetools',
  '/usr/local/share/android-commandlinetools',
].filter((candidate) => candidate !== undefined);
const androidSdk = androidSdkCandidates.find((candidate) =>
  existsSync(resolve(candidate, 'platform-tools')),
);
const expectedJava = readFileSync(resolve(root, '.java-version'), 'utf8').trim();
const java = spawnSync('java', ['-version'], { encoding: 'utf8' });
const javaOutput = `${java.stdout}${java.stderr}`;

if (androidSdk === undefined) {
  console.error('BLOCKED: install Android SDK platform-tools or set ANDROID_HOME.');
  process.exit(2);
}
for (const requiredPath of [
  'build-tools/36.0.0',
  'ndk/27.1.12297006',
  'platforms/android-36',
  'platform-tools',
]) {
  if (!existsSync(resolve(androidSdk, requiredPath))) {
    console.error(`BLOCKED: Android SDK is missing ${requiredPath}.`);
    process.exit(2);
  }
}
if (java.status !== 0 || !javaOutput.includes(`version "${expectedJava}`)) {
  console.error(`BLOCKED: the Android release build requires Java ${expectedJava}.`);
  process.exit(2);
}

const buildEnvironment = {
  ...process.env,
  ANDROID_HOME: androidSdk,
  ANDROID_SDK_ROOT: androidSdk,
  CI: '1',
  EXPO_NO_TELEMETRY: '1',
  LIFE_BOOK_BUILD_PROFILE: 'release',
  LIFE_BOOK_CNG_APPLICATION_ID: 'dev.lifebook.scaffold',
  NODE_ENV: 'production',
};
const prebuild = spawnSync(
  process.execPath,
  [
    pnpmExecutable,
    '--filter',
    '@life-book/mobile',
    'exec',
    'expo',
    'prebuild',
    '--platform',
    'android',
    '--clean',
    '--no-install',
  ],
  {
    cwd: root,
    env: buildEnvironment,
    stdio: 'inherit',
  },
);

if (prebuild.status !== 0) {
  process.exit(prebuild.status ?? 1);
}

const androidRoot = resolve(root, 'apps/mobile/android');
const gradle = spawnSync(
  resolve(androidRoot, 'gradlew'),
  ['app:assembleRelease', '--stacktrace'],
  {
    cwd: androidRoot,
    env: buildEnvironment,
    stdio: 'inherit',
  },
);

if (gradle.status !== 0) {
  process.exit(gradle.status ?? 1);
}

const artifact = resolve(androidRoot, 'app/build/outputs/apk/release/app-release.apk');
if (!existsSync(artifact)) {
  console.error('Android Gradle build completed without the expected release APK.');
  process.exit(1);
}

const permissionAudit = spawnSync(
  resolve(androidSdk, 'build-tools/36.0.0/aapt'),
  ['dump', 'permissions', artifact],
  { encoding: 'utf8' },
);
if (permissionAudit.status !== 0) {
  console.error('Unable to audit Android release permissions.');
  process.exit(permissionAudit.status ?? 1);
}
for (const permission of [
  'android.permission.INTERNET',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.SCHEDULE_EXACT_ALARM',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.USE_BIOMETRIC',
  'android.permission.VIBRATE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
]) {
  if (permissionAudit.stdout.includes(permission)) {
    console.error(`Android scaffold APK unexpectedly declares ${permission}.`);
    process.exit(1);
  }
}

const artifactDirectory = resolve(root, 'dist/android');
const persistedArtifact = resolve(artifactDirectory, 'life-book-scaffold-release.apk');
mkdirSync(artifactDirectory, { recursive: true });
copyFileSync(artifact, persistedArtifact);

if (!androidRoot.startsWith(`${resolve(root, 'apps/mobile')}/`)) {
  throw new Error('Refusing to clean an unexpected Android generation path.');
}
rmSync(androidRoot, { force: true, recursive: true });

console.log(`Android scaffold APK: ${persistedArtifact}`);

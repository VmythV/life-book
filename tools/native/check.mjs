import { createHash } from 'node:crypto';
import { rmSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const mobileRoot = resolve(root, 'apps/mobile');
const androidDirectory = resolve(mobileRoot, 'android');
const generatedDirectories = [androidDirectory];
const pnpmExecutable = process.env.npm_execpath;
const m0ReleaseBlockedPermissions = [
  'android.permission.INTERNET',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.VIBRATE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
];

if (pnpmExecutable === undefined) {
  console.error('Native generation checks must run through the pinned package manager.');
  process.exit(1);
}

if (generatedDirectories.some(existsSync)) {
  console.error('Native generation check requires apps/mobile/android to be absent.');
  process.exit(1);
}

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    if (['.expo', 'android', 'node_modules'].includes(entry)) {
      return [];
    }
    const path = resolve(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function sourceDigest() {
  const hash = createHash('sha256');
  for (const path of walk(mobileRoot).sort()) {
    hash.update(relative(mobileRoot, path));
    hash.update(readFileSync(path));
  }
  return hash.digest('hex');
}

function runExpo(
  args,
  { useReleaseProfile = false, useSyntheticApplicationId = false } = {},
) {
  return spawnSync(
    process.execPath,
    [pnpmExecutable, '--filter', '@life-book/mobile', 'exec', 'expo', ...args],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CI: '1',
        EXPO_NO_TELEMETRY: '1',
        ...(useReleaseProfile ? { LIFE_BOOK_BUILD_PROFILE: 'release' } : {}),
        ...(useSyntheticApplicationId
          ? { LIFE_BOOK_CNG_APPLICATION_ID: 'dev.lifebook.scaffold' }
          : {}),
      },
      maxBuffer: 20 * 1024 * 1024,
    },
  );
}

function validatePublicConfig({ useReleaseProfile = false } = {}) {
  const result = runExpo(['config', '--type', 'public', '--json'], {
    useReleaseProfile,
  });
  if (result.status !== 0) {
    throw new Error(`Expo config failed: ${result.stderr.trim()}`);
  }

  const config = JSON.parse(result.stdout);
  const buildProperties = config.plugins?.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties',
  )?.[1]?.android;
  if (
    config.name !== '生活有谱' ||
    config.slug !== 'life-book' ||
    config.platforms?.length !== 1 ||
    config.platforms[0] !== 'android' ||
    config.updates?.enabled !== false ||
    config.android?.allowBackup !== false ||
    buildProperties?.useHermesV1 !== true ||
    buildProperties?.minSdkVersion !== 29 ||
    buildProperties?.compileSdkVersion !== 36 ||
    buildProperties?.targetSdkVersion !== 36 ||
    buildProperties?.buildToolsVersion !== '36.0.0'
  ) {
    throw new Error('Expo public config does not match the fail-closed M0 profile.');
  }
  const blockedPermissions = config.android?.blockedPermissions ?? [];
  if (
    (useReleaseProfile &&
      JSON.stringify(blockedPermissions) !==
        JSON.stringify(m0ReleaseBlockedPermissions)) ||
    (!useReleaseProfile && blockedPermissions.length !== 0)
  ) {
    throw new Error('Expo Android permission profile is not fail-closed.');
  }
  if (
    config.scheme !== undefined ||
    config.ios !== undefined ||
    config.android?.package !== undefined
  ) {
    throw new Error(
      'M0 must not commit a deep-link scheme or production application ID.',
    );
  }
}

function validateGeneratedProjects() {
  const required = [
    resolve(mobileRoot, 'android/gradlew'),
    resolve(mobileRoot, 'android/gradle.properties'),
  ];
  for (const path of required) {
    if (!existsSync(path)) {
      throw new Error(`CNG did not create ${relative(root, path)}.`);
    }
  }

  const gradleProperties = readFileSync(
    resolve(mobileRoot, 'android/gradle.properties'),
    'utf8',
  );
  if (!gradleProperties.includes('newArchEnabled=true')) {
    throw new Error('Android CNG output did not enable the New Architecture.');
  }
  if (!gradleProperties.includes('hermesEnabled=true')) {
    throw new Error('Android CNG output did not enable Hermes.');
  }
  const mainManifest = readFileSync(
    resolve(mobileRoot, 'android/app/src/main/AndroidManifest.xml'),
    'utf8',
  );
  const permissionDeclarations = mainManifest.match(/<uses-permission[^>]*>/gu) ?? [];
  for (const permission of m0ReleaseBlockedPermissions) {
    const declaration = permissionDeclarations.find((candidate) =>
      candidate.includes(`android:name="${permission}"`),
    );
    if (declaration === undefined || !declaration.includes('tools:node="remove"')) {
      throw new Error(`Android release CNG did not block ${permission}.`);
    }
  }
  const forbiddenPermissions = [
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.SCHEDULE_EXACT_ALARM',
    'android.permission.USE_BIOMETRIC',
  ];
  const generatedText = generatedDirectories
    .flatMap(walk)
    .filter((path) => !path.endsWith('.png'))
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
  for (const permission of forbiddenPermissions) {
    if (generatedText.includes(permission)) {
      throw new Error(`M0 CNG output unexpectedly registers ${permission}.`);
    }
  }
  if (generatedText.includes('/Users/')) {
    throw new Error('CNG output contains an absolute developer-machine path.');
  }
}

const beforeDigest = sourceDigest();
let failure;

try {
  validatePublicConfig();
  validatePublicConfig({ useReleaseProfile: true });
  const prebuild = runExpo(
    ['prebuild', '--platform', 'android', '--clean', '--no-install'],
    {
      useReleaseProfile: true,
      useSyntheticApplicationId: true,
    },
  );
  if (prebuild.status !== 0) {
    throw new Error(`Expo prebuild failed: ${prebuild.stdout}\n${prebuild.stderr}`);
  }
  validateGeneratedProjects();
} catch (error) {
  failure =
    error instanceof Error ? error : new Error('Unknown native generation failure.');
} finally {
  for (const path of generatedDirectories) {
    if (!path.startsWith(`${mobileRoot}/`)) {
      throw new Error('Refusing to clean an unexpected native generation path.');
    }
    rmSync(path, { force: true, recursive: true });
  }
}

if (sourceDigest() !== beforeDigest) {
  console.error('Expo prebuild changed a CNG source file; generation is not clean.');
  process.exit(1);
}

if (failure !== undefined) {
  console.error(failure.message);
  process.exit(1);
}

console.log(
  'Clean CNG generated Android with Hermes and New Architecture, then cleaned up.',
);

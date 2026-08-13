import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const mobileRoot = resolve(root, 'apps/mobile');
const spikeRoot = resolve(root, 'apps/android-capability-spike');
const pnpmExecutable = process.env.npm_execpath;
const spikeOnlyDependencies = [
  'expo-crypto',
  'expo-document-picker',
  'expo-file-system',
  'expo-local-authentication',
  'expo-notifications',
  'expo-secure-store',
  'expo-sharing',
  'expo-sqlite',
  'expo-task-manager',
];

if (pnpmExecutable === undefined) {
  console.error('Run spike isolation checks through the pinned package manager.');
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(existsSync(spikeRoot), 'The removable Android capability spike is missing.');

const productPackage = JSON.parse(
  readFileSync(resolve(mobileRoot, 'package.json'), 'utf8'),
);
const productDependencies = {
  ...productPackage.dependencies,
  ...productPackage.devDependencies,
};
for (const dependency of spikeOnlyDependencies) {
  assert(
    productDependencies[dependency] === undefined,
    `Production mobile unexpectedly depends on spike-only package ${dependency}.`,
  );
}

const productText = walk(mobileRoot)
  .map((path) => `${relative(mobileRoot, path)}\n${readFileSync(path, 'utf8')}`)
  .join('\n');
for (const marker of [
  '@life-book/android-capability-spike',
  'AndroidCapabilityProbe',
  'dev.lifebook.capabilityspike',
  'lifebook-capability-spike',
]) {
  assert(
    !productText.includes(marker),
    `Production mobile source unexpectedly references ${marker}.`,
  );
}

const spikePackage = JSON.parse(readFileSync(resolve(spikeRoot, 'package.json'), 'utf8'));
for (const dependency of spikeOnlyDependencies) {
  assert(
    typeof spikePackage.dependencies?.[dependency] === 'string',
    `Spike dependency ${dependency} is not locked explicitly.`,
  );
}
assert(
  spikePackage.expo?.autolinking?.nativeModulesDir === './modules',
  'The local Android probe module is not isolated under the spike.',
);

const configResult = spawnSync(
  process.execPath,
  [
    pnpmExecutable,
    '--filter',
    '@life-book/android-capability-spike',
    'exec',
    'expo',
    'config',
    '--type',
    'public',
    '--json',
  ],
  {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' },
    maxBuffer: 20 * 1024 * 1024,
  },
);
if (configResult.status !== 0) {
  throw new Error(`Android spike Expo config failed: ${configResult.stderr.trim()}`);
}

const config = JSON.parse(configResult.stdout);
const buildProperties = config.plugins?.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties',
)?.[1]?.android;
const sqliteProperties = config.plugins?.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-sqlite',
)?.[1];
assert(
  config.platforms?.length === 1 && config.platforms[0] === 'android',
  'The capability spike must remain Android-only.',
);
assert(config.ios === undefined, 'The Android spike must not define iOS config.');
assert(config.updates?.enabled === false, 'The spike must not accept OTA code.');
assert(config.android?.allowBackup === false, 'The spike must disable Android backup.');
assert(
  config.android?.package === 'dev.lifebook.capabilityspike',
  'The spike application ID changed unexpectedly.',
);
assert(
  buildProperties?.minSdkVersion === 29 &&
    buildProperties?.compileSdkVersion === 36 &&
    buildProperties?.targetSdkVersion === 36 &&
    buildProperties?.useHermesV1 === true,
  'The Android spike toolchain profile is not locked.',
);
assert(sqliteProperties?.useSQLCipher === true, 'SQLCipher is not enabled.');

const blockedPermissions = config.android?.blockedPermissions ?? [];
for (const permission of [
  'android.permission.INTERNET',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.WRITE_EXTERNAL_STORAGE',
]) {
  assert(
    blockedPermissions.includes(permission),
    `The Android spike does not block ${permission}.`,
  );
}
const permissions = config.android?.permissions ?? [];
for (const permission of [
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.SCHEDULE_EXACT_ALARM',
  'android.permission.USE_BIOMETRIC',
]) {
  assert(permissions.includes(permission), `The spike is missing ${permission}.`);
}

console.log(
  'Android capability spike is independently configured and absent from production mobile.',
);

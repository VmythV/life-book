import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const spikeRoot = resolve(root, 'apps/android-capability-spike');
const androidRoot = resolve(spikeRoot, 'android');
const localModuleBuildRoot = resolve(
  spikeRoot,
  'modules/android-capability-probe/android/build',
);
const pnpmExecutable = process.env.npm_execpath;
const sdkCandidates = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  resolve(homedir(), 'Library/Android/sdk'),
  '/opt/homebrew/share/android-commandlinetools',
  '/usr/local/share/android-commandlinetools',
].filter((candidate) => candidate !== undefined);
const androidSdk = sdkCandidates.find((candidate) =>
  existsSync(resolve(candidate, 'platform-tools')),
);

if (pnpmExecutable === undefined) {
  console.error('Run the spike build through the pinned package manager.');
  process.exit(1);
}
if (androidSdk === undefined) {
  console.error('BLOCKED: Android SDK platform-tools are unavailable.');
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

const expectedJava = readFileSync(resolve(root, '.java-version'), 'utf8').trim();
const java = spawnSync('java', ['-version'], { encoding: 'utf8' });
if (
  java.status !== 0 ||
  !`${java.stdout}${java.stderr}`.includes(`version "${expectedJava}`)
) {
  console.error(`BLOCKED: the Android spike build requires Java ${expectedJava}.`);
  process.exit(2);
}

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    if (['.expo', 'node_modules'].includes(entry)) {
      return [];
    }
    const path = resolve(directory, entry);
    if (path === androidRoot || path === localModuleBuildRoot) {
      return [];
    }
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function sourceDigest() {
  const hash = createHash('sha256');
  for (const path of walk(spikeRoot).sort()) {
    hash.update(relative(spikeRoot, path));
    hash.update(readFileSync(path));
  }
  return hash.digest('hex');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: options.encoding,
    env: options.env,
    maxBuffer: 30 * 1024 * 1024,
    stdio: options.encoding === undefined ? 'inherit' : undefined,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed${result.stderr ? `: ${result.stderr.trim()}` : ''}`,
    );
  }
  return result.stdout ?? '';
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const buildEnvironment = {
  ...process.env,
  ANDROID_HOME: androidSdk,
  ANDROID_SDK_ROOT: androidSdk,
  CI: '1',
  EXPO_NO_TELEMETRY: '1',
  NODE_ENV: 'production',
};
const beforeDigest = sourceDigest();
let failure;

try {
  run(
    process.execPath,
    [
      pnpmExecutable,
      '--filter',
      '@life-book/android-capability-spike',
      'exec',
      'expo',
      'prebuild',
      '--platform',
      'android',
      '--clean',
      '--no-install',
    ],
    { env: buildEnvironment },
  );

  const gradleProperties = readFileSync(
    resolve(androidRoot, 'gradle.properties'),
    'utf8',
  );
  assert(
    gradleProperties.includes('newArchEnabled=true') &&
      gradleProperties.includes('hermesEnabled=true') &&
      gradleProperties.includes('expo.sqlite.useSQLCipher=true'),
    'Generated Android project is missing Hermes, New Architecture, or SQLCipher.',
  );

  run(
    resolve(androidRoot, 'gradlew'),
    ['app:assembleRelease', '--no-daemon', '--console=plain'],
    {
      cwd: androidRoot,
      env: buildEnvironment,
    },
  );

  const artifact = resolve(androidRoot, 'app/build/outputs/apk/release/app-release.apk');
  const sourceMap = resolve(
    androidRoot,
    'app/build/generated/sourcemaps/react/release/index.android.bundle.map',
  );
  const nativeSymbols = resolve(
    androidRoot,
    'app/build/outputs/native-debug-symbols/release/native-debug-symbols.zip',
  );
  assert(existsSync(artifact), 'Gradle did not produce the release APK.');
  assert(existsSync(sourceMap), 'Gradle did not produce the Hermes source map.');
  assert(existsSync(nativeSymbols), 'Gradle did not produce native debug symbols.');

  const aapt = resolve(androidSdk, 'build-tools/36.0.0/aapt');
  const permissions = run(aapt, ['dump', 'permissions', artifact], {
    encoding: 'utf8',
  });
  for (const permission of [
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.SCHEDULE_EXACT_ALARM',
    'android.permission.USE_BIOMETRIC',
  ]) {
    assert(permissions.includes(permission), `Release APK is missing ${permission}.`);
  }
  for (const permission of [
    'android.permission.INTERNET',
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.SYSTEM_ALERT_WINDOW',
    'android.permission.WRITE_EXTERNAL_STORAGE',
  ]) {
    assert(
      !permissions.includes(permission),
      `Release APK unexpectedly has ${permission}.`,
    );
  }

  const badging = run(aapt, ['dump', 'badging', artifact], { encoding: 'utf8' });
  assert(
    badging.includes("package: name='dev.lifebook.capabilityspike'") &&
      badging.includes("sdkVersion:'29'") &&
      badging.includes("targetSdkVersion:'36'"),
    'Release APK identity or Android SDK bounds changed unexpectedly.',
  );
  const manifest = run(aapt, ['dump', 'xmltree', artifact, 'AndroidManifest.xml'], {
    encoding: 'utf8',
  });
  assert(
    manifest.includes('android:allowBackup') && manifest.includes('(type 0x12)0x0'),
    'Release APK does not disable Android backup.',
  );

  const archive = run('unzip', ['-l', artifact], { encoding: 'utf8' });
  for (const abi of ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64']) {
    assert(
      archive.includes(`lib/${abi}/libexpo-sqlite.so`) &&
        archive.includes(`lib/${abi}/libhermesvm.so`),
      `Release APK is missing SQLCipher or Hermes for ${abi}.`,
    );
  }

  const artifactDirectory = resolve(root, 'dist/android');
  mkdirSync(artifactDirectory, { recursive: true });
  const persistedArtifact = resolve(
    artifactDirectory,
    'life-book-android-capability-spike-release.apk',
  );
  const persistedSourceMap = resolve(
    artifactDirectory,
    'life-book-android-capability-spike-release.js.map',
  );
  const persistedNativeSymbols = resolve(
    artifactDirectory,
    'life-book-android-capability-spike-native-symbols.zip',
  );
  copyFileSync(artifact, persistedArtifact);
  copyFileSync(sourceMap, persistedSourceMap);
  copyFileSync(nativeSymbols, persistedNativeSymbols);

  const spikePackage = JSON.parse(
    readFileSync(resolve(spikeRoot, 'package.json'), 'utf8'),
  );
  const gitHead = run('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const gitStatus = run('git', ['status', '--porcelain'], {
    encoding: 'utf8',
  }).trim();
  const evidence = {
    artifact: relative(root, persistedArtifact),
    artifactSha256: createHash('sha256')
      .update(readFileSync(persistedArtifact))
      .digest('hex'),
    buildProfile: 'release',
    dependencies: Object.fromEntries(
      Object.entries(spikePackage.dependencies).filter(([name]) =>
        name.startsWith('expo'),
      ),
    ),
    gitHead,
    sourceDigest: beforeDigest,
    sourceMap: relative(root, persistedSourceMap),
    nativeSymbols: relative(root, persistedNativeSymbols),
    toolchain: {
      compileSdk: 36,
      java: expectedJava,
      minSdk: 29,
      ndk: '27.1.12297006',
      targetSdk: 36,
    },
    worktreeDirty: gitStatus.length > 0,
  };
  writeFileSync(
    resolve(artifactDirectory, 'life-book-android-capability-spike-build.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );

  console.log(`Android capability spike APK: ${persistedArtifact}`);
} catch (error) {
  failure = error instanceof Error ? error : new Error('Unknown spike build failure.');
} finally {
  if (!androidRoot.startsWith(`${spikeRoot}/`)) {
    throw new Error('Refusing to clean an unexpected Android generation path.');
  }
  if (!localModuleBuildRoot.startsWith(`${spikeRoot}/modules/`)) {
    throw new Error('Refusing to clean an unexpected local module build path.');
  }
  rmSync(androidRoot, { force: true, recursive: true });
  rmSync(localModuleBuildRoot, { force: true, recursive: true });
}

if (sourceDigest() !== beforeDigest) {
  console.error('Android spike prebuild changed a source file.');
  process.exit(1);
}
if (failure !== undefined) {
  console.error(failure.message);
  process.exit(1);
}

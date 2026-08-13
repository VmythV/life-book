import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const pnpmExecutable = process.env.npm_execpath;
const outputRoot = mkdtempSync(join(tmpdir(), 'life-book-bundle-'));
const privacyCanary = ['synthetic-private-', 'content-never-log'].join('');

if (pnpmExecutable === undefined) {
  console.error('Bundle checks must run through the pinned package manager.');
  process.exit(1);
}

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

let failure;

try {
  for (const platform of ['android']) {
    const outputDirectory = resolve(outputRoot, platform);
    const result = spawnSync(
      process.execPath,
      [
        pnpmExecutable,
        '--filter',
        '@life-book/mobile',
        'exec',
        'expo',
        'export',
        '--platform',
        platform,
        '--output-dir',
        outputDirectory,
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          EXPO_NO_TELEMETRY: '1',
          EXPO_OFFLINE: '1',
        },
        maxBuffer: 20 * 1024 * 1024,
      },
    );
    if (result.status !== 0) {
      throw new Error(`${platform} production bundle failed: ${result.stderr}`);
    }

    const outputFiles = walk(outputDirectory);
    if (!outputFiles.some((path) => path.endsWith('.hbc'))) {
      throw new Error(`${platform} export did not produce a Hermes bytecode bundle.`);
    }
    for (const path of outputFiles) {
      const output = readFileSync(path);
      if (output.includes('/Users/')) {
        throw new Error(`${platform} bundle contains an absolute developer path.`);
      }
      if (output.includes(privacyCanary)) {
        throw new Error(`${platform} production bundle contains the privacy canary.`);
      }
    }
  }
} catch (error) {
  failure = error instanceof Error ? error : new Error('Unknown mobile bundle failure.');
} finally {
  if (!outputRoot.startsWith(join(tmpdir(), 'life-book-bundle-'))) {
    throw new Error('Refusing to clean an unexpected bundle output path.');
  }
  rmSync(outputRoot, { force: true, recursive: true });
}

if (failure !== undefined) {
  console.error(failure.message);
  process.exit(1);
}

console.log('Offline Android Hermes production bundle passed privacy checks.');

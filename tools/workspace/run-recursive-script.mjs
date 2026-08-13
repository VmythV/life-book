import { spawnSync } from 'node:child_process';

const script = process.argv[2];
const pnpmExecutable = process.env.npm_execpath;

if (script === undefined || pnpmExecutable === undefined) {
  console.error('Run workspace scripts through the pinned package manager.');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [pnpmExecutable, '--recursive', '--if-present', 'run', script],
  { stdio: 'inherit' },
);

process.exit(result.status ?? 1);

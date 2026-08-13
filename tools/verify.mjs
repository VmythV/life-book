import { spawnSync } from 'node:child_process';

const checks = [
  'format:check',
  'lint',
  'typecheck',
  'test:unit',
  'test:architecture',
  'generate:check',
  'docs:check',
  'specs:check',
  'deps:check',
  'secrets:scan',
  'spike:android:isolation:check',
  'bundle:mobile:check',
  'native:generate:check',
];

const pnpmExecutable = process.env.npm_execpath;

if (pnpmExecutable === undefined) {
  console.error('Run verify through the pinned package manager: corepack pnpm verify.');
  process.exit(1);
}

for (const check of checks) {
  console.log(`\n[verify] ${check}`);
  const result = spawnSync(process.execPath, [pnpmExecutable, 'run', check], {
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    console.error(`[verify] ${check} failed.`);
    process.exit(result.status ?? 1);
  }
}

console.log('\n[verify] all workspace checks passed.');

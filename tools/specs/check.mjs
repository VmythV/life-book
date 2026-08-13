import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const checks = [
  'tools/oracles/check-testing-v1.mjs',
  'tools/oracles/check-scalars-v1.mjs',
  'tools/oracles/check-security-v1.mjs',
];

for (const check of checks) {
  const result = spawnSync(process.execPath, [resolve(root, check)], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log('All candidate specification oracles passed.');

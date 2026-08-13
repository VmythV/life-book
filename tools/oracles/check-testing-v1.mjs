import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const checks = [
  'tools/oracles/check-oracle-manifest-v1.mjs',
  'tools/oracles/check-evidence-index-v1.mjs',
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

console.log('Testing infrastructure v1 candidate oracle passed.');

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const expectedNode = readFileSync(resolve(root, '.node-version'), 'utf8').trim();
const expectedPnpm = packageJson.packageManager.replace('pnpm@', '');
const actualNode = process.versions.node;
const userAgent = process.env.npm_config_user_agent ?? '';
const pnpmMatch = /pnpm\/([^\s]+)/u.exec(userAgent);

if (actualNode !== expectedNode) {
  console.error(
    `Node version mismatch: expected ${expectedNode}, received ${actualNode}.`,
  );
  process.exitCode = 1;
}

if (packageJson.engines.node !== expectedNode) {
  console.error('package.json engines.node and .node-version must match exactly.');
  process.exitCode = 1;
}

if (pnpmMatch !== null && pnpmMatch[1] !== expectedPnpm) {
  console.error(
    `pnpm version mismatch: expected ${expectedPnpm}, received ${pnpmMatch[1]}.`,
  );
  process.exitCode = 1;
}

if (packageJson.engines.pnpm !== expectedPnpm) {
  console.error('package.json engines.pnpm and packageManager must match exactly.');
  process.exitCode = 1;
}

if (process.exitCode !== 1) {
  console.log(`Toolchain OK: Node ${expectedNode}, pnpm ${expectedPnpm}.`);
}

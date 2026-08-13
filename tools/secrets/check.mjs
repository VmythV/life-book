import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const ignoredDirectories = new Set([
  '.git',
  '.expo',
  'android',
  'coverage',
  'dist',
  'node_modules',
]);
const highConfidencePatterns = [
  {
    name: 'private_key',
    pattern: new RegExp(
      ['BEGIN ', '(?:RSA |EC |OPENSSH )?', 'PRIVATE KEY'].join(''),
      'u',
    ),
  },
  {
    name: 'aws_access_key',
    pattern: new RegExp(['AK', 'IA', '[0-9A-Z]{16}'].join(''), 'u'),
  },
  {
    name: 'github_token',
    pattern: new RegExp(['gh', '[pousr]_', '[A-Za-z0-9]{30,}'].join(''), 'u'),
  },
  {
    name: 'google_api_key',
    pattern: new RegExp(['AI', 'za', '[0-9A-Za-z_-]{20,}'].join(''), 'u'),
  },
  {
    name: 'openai_api_key',
    pattern: new RegExp(['sk-', '(?:proj-)?', '[A-Za-z0-9_-]{20,}'].join(''), 'u'),
  },
  {
    name: 'slack_token',
    pattern: new RegExp(['xo', 'x[baprs]-', '[0-9A-Za-z-]{20,}'].join(''), 'u'),
  },
  {
    name: 'public_secret_name',
    pattern: new RegExp(
      ['EXPO_', 'PUBLIC_', '[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY)'].join(''),
      'u',
    ),
  },
];
const privacyCanary = ['synthetic-private-', 'content-never-log'].join('');
const findings = [];

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    if (ignoredDirectories.has(entry)) {
      return [];
    }
    const path = resolve(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function scanText(label, text, options = {}) {
  for (const { name, pattern } of highConfidencePatterns) {
    if (pattern.test(text)) {
      findings.push(`${label}: matched ${name}.`);
    }
  }

  if (
    text.includes(privacyCanary) &&
    options.allowPrivacyCanary !== true &&
    !label.endsWith('.test.ts')
  ) {
    findings.push(`${label}: privacy canary escaped test-support.`);
  }
}

function scanCurrentTree() {
  for (const path of walk(root)) {
    const label = relative(root, path);
    if (
      /^(?:\.env|.*\/\.env)(?:\..+)?$/u.test(label) &&
      !label.endsWith('.env.example')
    ) {
      findings.push(`${label}: environment file is not allowed.`);
      continue;
    }

    const buffer = readFileSync(path);
    if (buffer.includes(0)) {
      continue;
    }
    scanText(label, buffer.toString('utf8'), {
      allowPrivacyCanary: label.startsWith('packages/test-support/'),
    });
  }
}

function scanReachableHistory() {
  const history = execFileSync(
    'git',
    [
      'log',
      '--all',
      '--format=commit:%H',
      '--patch',
      '--',
      '.',
      ':(exclude)docs/**',
      ':(exclude)specs/**',
    ],
    { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
  );
  scanText('reachable Git history', history, { allowPrivacyCanary: true });
}

function runSelfTest() {
  const before = findings.length;
  scanText('synthetic self-test', ['AK', 'IA', 'ABCDEFGHIJKLMNOP'].join(''));
  if (!findings.slice(before).some((finding) => finding.includes('aws_access_key'))) {
    console.error('Secret scanner self-test failed.');
    process.exit(1);
  }
  findings.splice(before);
  console.log('Secret scanner self-test passed.');
}

if (process.argv.includes('--self-test')) {
  runSelfTest();
}
scanCurrentTree();
scanReachableHistory();

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(finding);
  }
  process.exit(1);
}

console.log('Secret and privacy-canary scan passed for the tree and reachable history.');

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const markdownRoots = [
  resolve(root, 'README.md'),
  resolve(root, 'docs'),
  resolve(root, 'specs'),
];
const errors = [];

function walk(path) {
  if (!existsSync(path)) {
    return [];
  }
  if (!statSync(path).isDirectory()) {
    return [path];
  }
  return readdirSync(path).flatMap((entry) => walk(resolve(path, entry)));
}

function githubSlug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/gu, '')
    .replace(/[`*_~]/gu, '')
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, '')
    .replace(/\s+/gu, '-');
}

function anchorsFor(markdown) {
  const counts = new Map();
  const anchors = new Set();

  for (const line of markdown.split('\n')) {
    const match = /^(?:#{1,6})\s+(.+)$/u.exec(line);
    if (match?.[1] === undefined) {
      continue;
    }
    const base = githubSlug(match[1]);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }

  return anchors;
}

function checkMarkdown(path) {
  const markdown = readFileSync(path, 'utf8');
  const relativePath = relative(root, path);
  const fenceCount = markdown.split('\n').filter((line) => /^\s*```/u.test(line)).length;
  if (fenceCount % 2 !== 0) {
    errors.push(`${relativePath}: unbalanced fenced code block.`);
  }

  const linkPattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu;
  for (const match of markdown.matchAll(linkPattern)) {
    const destination = match[1];
    if (destination === undefined || /^(?:https?:|mailto:|tel:)/u.test(destination)) {
      continue;
    }

    const [encodedPath, encodedAnchor] = destination.split('#', 2);
    const decodedPath = decodeURIComponent(encodedPath ?? '');
    const targetPath =
      decodedPath.length === 0 ? path : resolve(dirname(path), decodedPath);
    if (!existsSync(targetPath)) {
      errors.push(`${relativePath}: local link target does not exist: ${destination}`);
      continue;
    }

    if (encodedAnchor !== undefined && extname(targetPath) === '.md') {
      const targetAnchors = anchorsFor(readFileSync(targetPath, 'utf8'));
      const anchor = decodeURIComponent(encodedAnchor).toLowerCase();
      if (!targetAnchors.has(anchor)) {
        errors.push(`${relativePath}: markdown anchor does not exist: ${destination}`);
      }
    }
  }
}

function checkJson(path) {
  try {
    JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown JSON parse error';
    errors.push(`${relative(root, path)}: ${message}`);
  }
}

function checkM0DocumentHeaders() {
  const required = [
    ['docs/system-architecture.md', '状态：文档基线'],
    ['docs/engineering-standards.md', '状态：文档基线'],
    ['docs/implementation-plan.md', '状态：文档基线'],
    ['docs/test-strategy.md', '状态：文档基线'],
    ['docs/adr/0001-mobile-client-stack.md', 'Status：`Accepted`'],
    ['docs/adr/0002-offline-first-client-architecture.md', 'Status：`Accepted`'],
  ];

  for (const [relativePath, marker] of required) {
    const content = readFileSync(resolve(root, relativePath), 'utf8').slice(0, 800);
    if (!content.includes(marker)) {
      errors.push(`${relativePath}: required M0 status marker is missing: ${marker}`);
    }
  }
}

function checkGovernanceSnapshot() {
  const governancePath = resolve(root, 'docs/documentation-governance.md');
  const governance = readFileSync(governancePath, 'utf8');
  const snapshotMatch = /本节是 `(GOV-REGISTRY-[^`]+)` 的事实快照/u.exec(governance);
  const snapshotId = snapshotMatch?.[1];
  if (snapshotId === undefined) {
    errors.push(
      'docs/documentation-governance.md: current registry snapshot ID is missing.',
    );
    return;
  }

  const log = execFileSync(
    'git',
    [
      'log',
      '--all',
      '--format=%H%x00%B%x00',
      '--fixed-strings',
      `--grep=Registry-Snapshot: ${snapshotId}`,
    ],
    { cwd: root, encoding: 'utf8' },
  );
  const trailer = `Registry-Snapshot: ${snapshotId}`;
  const occurrences = log
    .split('\0')
    .filter((part) => part.split('\n').some((line) => line.trim() === trailer)).length;
  if (occurrences !== 1) {
    errors.push(
      `Registry snapshot ${snapshotId} must have exactly one reachable trailer.`,
    );
    return;
  }

  const anchor = log.split('\0')[0];
  if (anchor === undefined || !/^[0-9a-f]{40}$/u.test(anchor)) {
    errors.push(`Registry snapshot ${snapshotId} does not resolve to a Git anchor.`);
    return;
  }

  const committedChanges = execFileSync(
    'git',
    ['diff', '--name-only', `${anchor}..HEAD`, '--', 'docs'],
    { cwd: root, encoding: 'utf8' },
  ).trim();
  const worktreeChanges = execFileSync('git', ['status', '--porcelain', '--', 'docs'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  if (committedChanges.length > 0 || worktreeChanges.length > 0) {
    errors.push(
      `Registry snapshot ${snapshotId} is stale because docs/ changed after its anchor.`,
    );
  }
}

for (const path of markdownRoots
  .flatMap(walk)
  .filter((path) => extname(path) === '.md')) {
  checkMarkdown(path);
}
for (const path of walk(resolve(root, 'specs')).filter(
  (path) => extname(path) === '.json',
)) {
  checkJson(path);
}
checkM0DocumentHeaders();
checkGovernanceSnapshot();

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error);
  }
  process.exit(1);
}

console.log(
  'Documentation links, fences, JSON, M0 statuses, and registry snapshot passed.',
);

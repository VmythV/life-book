import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const packageRoots = [
  root,
  ...readdirSync(resolve(root, 'apps')).map((name) => resolve(root, 'apps', name)),
  ...readdirSync(resolve(root, 'packages')).map((name) =>
    resolve(root, 'packages', name),
  ),
];
const errors = [];
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    if (
      ['.git', '.expo', 'android', 'coverage', 'dist', 'node_modules'].includes(entry)
    ) {
      return [];
    }
    const path = resolve(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function packageManifest(packageRoot) {
  return JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
}

function declaredDependencies(manifest) {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);
}

function packageNameFromSpecifier(specifier) {
  if (specifier.startsWith('@')) {
    return specifier.split('/').slice(0, 2).join('/');
  }
  return specifier.split('/')[0];
}

function importsFor(path) {
  const source = readFileSync(path, 'utf8');
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports = [];
  for (const statement of sourceFile.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      imports.push(statement.moduleSpecifier.text);
    }
  }
  return imports;
}

function checkManifest(packageRoot) {
  const manifest = packageManifest(packageRoot);
  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    for (const [name, version] of Object.entries(manifest[field] ?? {})) {
      if (version !== 'workspace:*' && !exactVersion.test(version)) {
        errors.push(
          `${relative(root, packageRoot) || '.'}/package.json: ${field}.${name} must be exact, received ${version}.`,
        );
      }
    }
  }

  const declared = declaredDependencies(manifest);
  const candidatePaths =
    packageRoot === root
      ? [
          ...walk(resolve(root, 'tools')),
          ...readdirSync(root)
            .map((entry) => resolve(root, entry))
            .filter((path) => !statSync(path).isDirectory()),
        ]
      : walk(packageRoot);
  const sourcePaths = candidatePaths.filter((path) =>
    ['.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'].includes(extname(path)),
  );
  for (const path of sourcePaths) {
    for (const specifier of importsFor(path)) {
      if (specifier.startsWith('.') || specifier.startsWith('node:')) {
        continue;
      }
      const importedPackage = packageNameFromSpecifier(specifier);
      if (importedPackage !== undefined && !declared.has(importedPackage)) {
        errors.push(
          `${relative(root, path)} imports undeclared direct dependency ${importedPackage}.`,
        );
      }
    }
  }
}

function runPnpm(args, options = {}) {
  const pnpmExecutable = process.env.npm_execpath;
  if (pnpmExecutable === undefined) {
    errors.push('Dependency checks must run through the pinned package manager.');
    return undefined;
  }
  return spawnSync(process.execPath, [pnpmExecutable, ...args], {
    cwd: root,
    encoding: 'utf8',
    ...options,
  });
}

function checkCriticalDuplicates() {
  const result = runPnpm(['list', '--recursive', '--depth', 'Infinity', '--json']);
  if (result === undefined || result.status !== 0) {
    errors.push(
      `Unable to inspect installed dependency graph: ${result?.stderr.trim() ?? ''}`,
    );
    return;
  }

  const versions = new Map([
    ['expo', new Set()],
    ['react', new Set()],
    ['react-native', new Set()],
  ]);

  function visit(node) {
    if (typeof node !== 'object' || node === null) {
      return;
    }
    if (typeof node.name === 'string' && typeof node.version === 'string') {
      versions.get(node.name)?.add(node.version);
    }
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      const dependencies = node[field];
      if (typeof dependencies === 'object' && dependencies !== null) {
        for (const [name, dependency] of Object.entries(dependencies)) {
          if (typeof dependency === 'object' && dependency !== null) {
            const version = dependency.version;
            if (typeof version === 'string') {
              versions.get(name)?.add(version);
            }
            visit({ name, ...dependency });
          }
        }
      }
    }
  }

  for (const project of JSON.parse(result.stdout)) {
    visit(project);
  }

  for (const [name, foundVersions] of versions) {
    if (foundVersions.size > 1) {
      errors.push(
        `${name} has duplicate versions: ${[...foundVersions].sort().join(', ')}.`,
      );
    }
  }
}

function checkLicenses() {
  const result = runPnpm(['licenses', 'list', '--prod', '--json']);
  if (result === undefined || result.status !== 0) {
    errors.push(`Unable to inspect production licenses: ${result?.stderr.trim() ?? ''}`);
    return;
  }
  const licenses = Object.keys(JSON.parse(result.stdout));
  const alwaysDenied = /AGPL|BUSL|Commons Clause|SSPL/iu;
  const strongCopyleft = /(?:^|[^A-Z])(?:L?GPL)-/iu;
  const permissiveAlternative = /Apache|BSD|ISC|MIT|MPL/iu;
  for (const license of licenses) {
    const hasAllowedOrChoice =
      license.includes(' OR ') && permissiveAlternative.test(license);
    if (
      alwaysDenied.test(license) ||
      (strongCopyleft.test(license) && !hasAllowedOrChoice)
    ) {
      errors.push(`Production dependency license policy rejected ${license}.`);
    }
  }
}

function checkVulnerabilities() {
  const result = runPnpm([
    'audit',
    '--prod',
    '--json',
    '--registry=https://registry.npmjs.org/',
  ]);
  if (result === undefined) {
    return;
  }

  let audit;
  try {
    audit = JSON.parse(result.stdout);
  } catch {
    errors.push(
      `Production vulnerability audit was blocked: ${result.stderr.trim() || result.stdout.trim()}`,
    );
    return;
  }

  const policy = JSON.parse(
    readFileSync(resolve(root, 'tools/dependencies/advisory-policy.json'), 'utf8'),
  );
  const exceptions = new Map(
    policy.exceptions.map((exception) => [exception.advisoryId, exception]),
  );
  const observedExceptions = new Set();
  const advisoryCounts = new Map();

  for (const advisory of Object.values(audit.advisories ?? {})) {
    advisoryCounts.set(
      advisory.severity,
      (advisoryCounts.get(advisory.severity) ?? 0) + 1,
    );
    if (!['critical', 'high'].includes(advisory.severity)) {
      continue;
    }
    const advisoryId = advisory.github_advisory_id;
    const exception = exceptions.get(advisoryId);
    const findings = advisory.findings ?? [];
    const exceptionMatches =
      exception !== undefined &&
      advisory.module_name === exception.package &&
      findings.length > 0 &&
      findings.every(
        (finding) =>
          finding.version === exception.exactVersion &&
          finding.paths.length > 0 &&
          finding.paths.every((path) => path.includes(exception.requiredPathSegment)),
      ) &&
      [
        exception.owner,
        exception.reason,
        exception.trackingItem,
        exception.exitCondition,
      ].every((value) => typeof value === 'string' && value.length > 0);

    if (!exceptionMatches) {
      errors.push(
        `Production vulnerability ${advisoryId} (${advisory.module_name}, ${advisory.severity}) has no matching narrow exception.`,
      );
    } else {
      observedExceptions.add(advisoryId);
    }
  }

  for (const advisoryId of exceptions.keys()) {
    if (!observedExceptions.has(advisoryId)) {
      errors.push(`Vulnerability exception ${advisoryId} is stale and must be removed.`);
    }
  }

  if (observedExceptions.size > 0) {
    console.log(
      `Dependency audit used ${observedExceptions.size} narrow build-time exception(s): ${[
        ...observedExceptions,
      ]
        .sort()
        .join(', ')}.`,
    );
  }
  const nonBlockingCount = [...advisoryCounts.entries()]
    .filter(([severity]) => !['critical', 'high'].includes(severity))
    .reduce((total, [, count]) => total + count, 0);
  if (nonBlockingCount > 0) {
    console.log(`Dependency audit observed ${nonBlockingCount} non-blocking advisory.`);
  }
}

const lockfiles = walk(root).filter((path) =>
  ['npm-shrinkwrap.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].includes(
    path.split('/').at(-1),
  ),
);
if (lockfiles.length !== 1 || relative(root, lockfiles[0] ?? '') !== 'pnpm-lock.yaml') {
  errors.push('The repository must contain exactly one root pnpm-lock.yaml.');
}

for (const packageRoot of packageRoots) {
  checkManifest(packageRoot);
}

const expoCheck = runPnpm(['--filter', '@life-book/mobile', 'run', 'dependencies:check']);
if (expoCheck === undefined || expoCheck.status !== 0) {
  errors.push(
    `Expo compatibility check failed: ${expoCheck?.stdout ?? ''} ${expoCheck?.stderr ?? ''}`,
  );
}

checkCriticalDuplicates();
checkLicenses();
checkVulnerabilities();

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error);
  }
  process.exit(1);
}

console.log(
  'Dependency versions, direct imports, Expo compatibility, licenses, and audit passed.',
);

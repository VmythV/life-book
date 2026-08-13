import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, normalize, resolve, sep } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const appRoot = resolve(root, 'apps/mobile');
const sourceRoots = [resolve(appRoot, 'src'), resolve(root, 'packages')];
const gatedPackages = new Set([
  '@opentelemetry/api',
  '@sentry/react-native',
  'axios',
  'expo-notifications',
  'expo-sqlite',
]);

function normalizedPath(path) {
  return normalize(path).split(sep).join('/');
}

function isSourceFile(path) {
  return ['.js', '.jsx', '.ts', '.tsx'].includes(extname(path));
}

function isProductionFile(path) {
  return (
    isSourceFile(path) &&
    !/\.(?:architecture\.|contract\.|e2e\.|integration\.|test\.)/u.test(path) &&
    !path.includes('/packages/test-support/')
  );
}

function walk(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function collectImports(filePath, source) {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
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

function collectDomainImplicitSources(filePath, source) {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const implicitSources = [];

  function visit(node) {
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Date'
    ) {
      implicitSources.push('new Date');
    }
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === 'Date') {
        implicitSources.push('Date()');
      }
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression)
      ) {
        const owner = node.expression.expression.text;
        const method = node.expression.name.text;
        if (
          (owner === 'Date' && method === 'now') ||
          (owner === 'Math' && method === 'random')
        ) {
          implicitSources.push(`${owner}.${method}()`);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return implicitSources;
}

function resolveRelativeImport(sourcePath, specifier, files) {
  if (!specifier.startsWith('.')) {
    return undefined;
  }

  const base = resolve(dirname(sourcePath), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    resolve(base, 'index.ts'),
    resolve(base, 'index.tsx'),
    resolve(base, 'public.ts'),
  ].map(normalizedPath);

  return candidates.find((candidate) => files.has(candidate));
}

function moduleName(path) {
  const match = /\/apps\/mobile\/src\/modules\/([^/]+)\//u.exec(path);
  return match?.[1];
}

function layerName(path) {
  const match = /\/(domain|application|ports|adapters|presentation)\//u.exec(path);
  return match?.[1];
}

function report(rule, sourcePath, specifier) {
  return { rule, sourcePath, specifier };
}

function analyze(files) {
  const violations = [];

  for (const [sourcePath, source] of files) {
    if (!isProductionFile(sourcePath)) {
      continue;
    }

    const normalizedSource = normalizedPath(sourcePath);
    const sourceLayer = layerName(normalizedSource);
    const sourceModule = moduleName(normalizedSource);
    const isComposition = normalizedSource.includes('/apps/mobile/src/composition/');

    if (sourceLayer === 'domain') {
      for (const implicitSource of collectDomainImplicitSources(
        normalizedSource,
        source,
      )) {
        violations.push(
          report('domain_to_implicit_source', normalizedSource, implicitSource),
        );
      }
    }

    for (const specifier of collectImports(normalizedSource, source)) {
      const targetPath = resolveRelativeImport(normalizedSource, specifier, files);
      const targetLayer = targetPath === undefined ? undefined : layerName(targetPath);
      const targetModule = targetPath === undefined ? undefined : moduleName(targetPath);

      if (gatedPackages.has(specifier)) {
        violations.push(report('stage_gated_sdk_import', normalizedSource, specifier));
      }

      if (specifier === '@life-book/test-support') {
        violations.push(
          report('production_to_test_support', normalizedSource, specifier),
        );
      }

      if (specifier.startsWith('@life-book/') && specifier.split('/').length > 2) {
        violations.push(report('workspace_deep_import', normalizedSource, specifier));
      }

      if (
        sourceLayer === 'domain' &&
        (specifier === 'react' ||
          specifier === 'react-native' ||
          specifier.startsWith('expo') ||
          specifier.startsWith('@expo/'))
      ) {
        violations.push(report('domain_to_platform', normalizedSource, specifier));
      }

      if (sourceLayer === 'presentation' && targetLayer === 'adapters') {
        violations.push(report('presentation_to_adapter', normalizedSource, specifier));
      }

      if (targetLayer === 'adapters' && sourceLayer !== 'adapters' && !isComposition) {
        violations.push(
          report('adapter_import_outside_composition', normalizedSource, specifier),
        );
      }

      if (
        sourceModule !== undefined &&
        targetModule !== undefined &&
        sourceModule !== targetModule &&
        targetPath !== undefined &&
        !targetPath.endsWith('/public.ts')
      ) {
        violations.push(report('cross_module_deep_import', normalizedSource, specifier));
      }

      if (
        isComposition &&
        targetPath !== undefined &&
        targetLayer !== undefined &&
        !['adapters', 'ports'].includes(targetLayer) &&
        !targetPath.endsWith('/public.ts')
      ) {
        violations.push(
          report('composition_private_import', normalizedSource, specifier),
        );
      }
    }
  }

  return violations;
}

function realProjectFiles() {
  const paths = [resolve(appRoot, 'index.ts'), ...sourceRoots.flatMap(walk)].filter(
    isSourceFile,
  );
  return new Map(paths.map((path) => [normalizedPath(path), readFileSync(path, 'utf8')]));
}

function runSelfTest() {
  const fixturePath = resolve(import.meta.dirname, 'fixtures/violations.json');
  const cases = JSON.parse(readFileSync(fixturePath, 'utf8'));

  for (const fixture of cases) {
    const files = new Map(Object.entries(fixture.files));
    const violations = analyze(files);
    if (!violations.some((violation) => violation.rule === fixture.expectedRule)) {
      console.error(
        `Architecture checker self-test failed: ${fixture.name} did not trigger ${fixture.expectedRule}.`,
      );
      process.exit(1);
    }
  }

  console.log(
    `Architecture checker self-test passed (${cases.length} violations rejected).`,
  );
}

if (process.argv.includes('--self-test')) {
  runSelfTest();
}

const violations = analyze(realProjectFiles());
if (violations.length > 0) {
  for (const violation of violations) {
    console.error(
      `${violation.rule}: ${violation.sourcePath} imports ${JSON.stringify(violation.specifier)}`,
    );
  }
  process.exit(1);
}

console.log('Architecture boundaries passed.');

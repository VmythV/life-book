import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function normalized(path) {
  return resolve(path).split(sep).join('/');
}

function isInside(parent, candidate) {
  const relativePath = relative(parent, candidate);
  return (
    relativePath.length === 0 ||
    (!relativePath.startsWith(`..${sep}`) && relativePath !== '..')
  );
}

export function createManifestValidator(schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  if (!ajv.validateSchema(schema)) {
    const details = ajv.errorsText(ajv.errors, { separator: '\n' });
    throw new Error(`Oracle manifest schema is invalid:\n${details}`);
  }

  const validate = ajv.compile(schema);
  return {
    validate(manifest) {
      const valid = validate(manifest);
      const errors = valid
        ? []
        : (validate.errors ?? []).map((error) => ({
            instancePath: error.instancePath,
            keyword: error.keyword,
            message: error.message ?? 'schema validation failed',
          }));

      if (Array.isArray(manifest?.fixtures)) {
        const paths = new Set();
        for (const [index, fixture] of manifest.fixtures.entries()) {
          if (typeof fixture?.path !== 'string') {
            continue;
          }
          if (paths.has(fixture.path)) {
            errors.push({
              instancePath: `/fixtures/${index}/path`,
              keyword: 'duplicate_fixture_path',
              message: `duplicates ${fixture.path}`,
            });
          }
          paths.add(fixture.path);
        }
      }

      if (Array.isArray(manifest?.contracts)) {
        const paths = new Set();
        for (const [index, contract] of manifest.contracts.entries()) {
          if (typeof contract?.path !== 'string') {
            continue;
          }
          if (paths.has(contract.path)) {
            errors.push({
              instancePath: `/contracts/${index}/path`,
              keyword: 'duplicate_contract_path',
              message: `duplicates ${contract.path}`,
            });
          }
          paths.add(contract.path);
        }
      }

      return { errors, valid: errors.length === 0 };
    },
  };
}

function describeErrors(errors) {
  return errors
    .map(
      ({ instancePath, keyword, message }) =>
        `${instancePath || '/'} [${keyword}] ${message}`,
    )
    .join('\n');
}

export function verifyOraclePackage({ manifestPath, root, schemaPath }) {
  const schema = readJson(schemaPath);
  const validator = createManifestValidator(schema);
  const manifest = readJson(manifestPath);
  const result = validator.validate(manifest);
  if (!result.valid) {
    throw new Error(
      `${normalized(manifestPath)} does not match the oracle manifest schema:\n${describeErrors(result.errors)}`,
    );
  }

  const contracts = manifest.contracts.map((contractEntry) => {
    const contractPath = resolve(root, contractEntry.path);
    if (!isInside(root, contractPath)) {
      throw new Error(`Contract escapes repository root: ${contractEntry.path}`);
    }
    const contractDigest = sha256(contractPath);
    if (contractDigest !== contractEntry.sha256) {
      throw new Error(
        `Contract checksum mismatch for ${contractEntry.path}: expected ${contractEntry.sha256}, received ${contractDigest}.`,
      );
    }
    return { entry: contractEntry, path: contractPath };
  });

  const fixtureRoot = dirname(manifestPath);
  const fixtures = [];
  for (const fixtureEntry of manifest.fixtures) {
    const fixturePath = resolve(fixtureRoot, fixtureEntry.path);
    if (!isInside(fixtureRoot, fixturePath)) {
      throw new Error(`Fixture escapes oracle directory: ${fixtureEntry.path}`);
    }
    const digest = sha256(fixturePath);
    if (digest !== fixtureEntry.sha256) {
      throw new Error(
        `Fixture checksum mismatch for ${fixtureEntry.path}: expected ${fixtureEntry.sha256}, received ${digest}.`,
      );
    }

    const fixture = readJson(fixturePath);
    if (fixture.fixtureVersion !== 1 || fixture.kind !== fixtureEntry.kind) {
      throw new Error(
        `${fixtureEntry.path} identity does not match fixtureVersion=1 and kind=${fixtureEntry.kind}.`,
      );
    }
    if (!Array.isArray(fixture.cases)) {
      throw new Error(`${fixtureEntry.path} must contain a cases array.`);
    }
    if (fixture.cases.length !== fixtureEntry.expectation.caseCount) {
      throw new Error(
        `${fixtureEntry.path} expected ${fixtureEntry.expectation.caseCount} cases, received ${fixture.cases.length}.`,
      );
    }

    if (
      fixtureEntry.expectation.mode === 'all_accept' &&
      fixture.cases.some((testCase) => 'expectedError' in testCase)
    ) {
      throw new Error(`${fixtureEntry.path} is all_accept but contains expectedError.`);
    }
    if (
      fixtureEntry.expectation.mode === 'all_reject' &&
      fixture.cases.some(
        (testCase) => !('expectedError' in testCase) && testCase.expectedValid !== false,
      )
    ) {
      throw new Error(`${fixtureEntry.path} is all_reject but contains an accept case.`);
    }

    fixtures.push({ entry: fixtureEntry, path: fixturePath, value: fixture });
  }

  return { contracts, fixtures, manifest, validator };
}

export function applyFixtureMutation(base, mutation) {
  const candidate = structuredClone(base);
  if (mutation.operation === 'none') {
    return candidate;
  }
  if (!Array.isArray(mutation.path) || mutation.path.length === 0) {
    throw new Error('A set/delete mutation requires a non-empty path.');
  }

  let owner = candidate;
  for (const segment of mutation.path.slice(0, -1)) {
    if (typeof owner !== 'object' || owner === null || !(segment in owner)) {
      throw new Error(`Mutation path does not exist: ${mutation.path.join('.')}`);
    }
    owner = owner[segment];
  }
  const leaf = mutation.path.at(-1);
  if (mutation.operation === 'set') {
    owner[leaf] = mutation.value;
    return candidate;
  }
  if (mutation.operation === 'delete') {
    delete owner[leaf];
    return candidate;
  }
  throw new Error(`Unknown fixture mutation: ${mutation.operation}`);
}

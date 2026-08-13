import { resolve } from 'node:path';
import { applyFixtureMutation, verifyOraclePackage } from './lib/oracle-manifest.mjs';

const root = resolve(import.meta.dirname, '../..');
const schemaPath = resolve(root, 'specs/testing/oracle-manifest-v1.schema.json');
const manifestPath = resolve(root, 'specs/testing/fixtures/v1/manifest.json');

try {
  const oracle = verifyOraclePackage({ manifestPath, root, schemaPath });
  if (
    oracle.manifest.oracleManifestVersion !== 1 ||
    oracle.manifest.oracleId !== 'testing_infrastructure_v1' ||
    !oracle.manifest.contracts.some(
      (contract) =>
        contract.path === 'specs/testing/oracle-manifest-v1.schema.json' &&
        contract.identity.name === 'oracleManifestVersion' &&
        contract.identity.value === 1,
    ) ||
    oracle.manifest.generator.implementationPath !==
      'tools/oracles/check-testing-v1.mjs' ||
    oracle.manifest.selfCheck.command !== 'corepack pnpm oracle:testing:check'
  ) {
    throw new Error('Testing oracle manifest identity is not oracleManifestVersion=1.');
  }

  const caseIds = new Set();
  let checked = 0;
  const fixtures = oracle.fixtures.filter(
    (fixture) => fixture.value.schema === 'oracle_manifest',
  );
  if (fixtures.length !== 3) {
    throw new Error('Testing oracle must contain three oracle_manifest fixtures.');
  }
  for (const fixture of fixtures) {
    if (
      typeof fixture.value.baseManifest !== 'object' ||
      fixture.value.baseManifest === null
    ) {
      throw new Error(`${fixture.entry.path} is missing baseManifest.`);
    }

    for (const testCase of fixture.value.cases) {
      if (typeof testCase.id !== 'string' || caseIds.has(testCase.id)) {
        throw new Error(`Duplicate or invalid schema oracle case ID: ${testCase.id}`);
      }
      caseIds.add(testCase.id);

      const candidate = applyFixtureMutation(
        fixture.value.baseManifest,
        testCase.mutation,
      );
      const result = oracle.validator.validate(candidate);
      if (result.valid !== testCase.expectedValid) {
        throw new Error(
          `${testCase.id}: expected valid=${testCase.expectedValid}, received valid=${result.valid}.`,
        );
      }
      if (
        typeof testCase.expectedKeyword === 'string' &&
        !result.errors.some((error) => error.keyword === testCase.expectedKeyword)
      ) {
        throw new Error(
          `${testCase.id}: expected validation keyword ${testCase.expectedKeyword}, received ${result.errors
            .map((error) => error.keyword)
            .join(', ')}.`,
        );
      }
      checked += 1;
    }
  }

  console.log(
    `Oracle manifest v1 schema self-check passed (${checked} golden/boundary/negative cases).`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

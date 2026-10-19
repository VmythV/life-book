import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  applyFixtureMutation,
  readJson,
  verifyOraclePackage,
} from './lib/oracle-manifest.mjs';

const root = resolve(import.meta.dirname, '../..');

function schemaValidator(path) {
  const schema = readJson(path);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  if (!ajv.validateSchema(schema)) {
    throw new Error(`Invalid evidence schema ${path}: ${ajv.errorsText(ajv.errors)}`);
  }
  const validateSchemaInstance = ajv.compile(schema);
  return (value) => {
    const valid = validateSchemaInstance(value);
    return {
      errors: valid
        ? []
        : (validateSchemaInstance.errors ?? []).map((error) => ({
            instancePath: error.instancePath,
            keyword: error.keyword,
            message: error.message ?? 'schema validation failed',
          })),
      valid,
    };
  };
}

function addError(result, keyword, message, instancePath = '/') {
  result.errors.push({ instancePath, keyword, message });
  result.valid = false;
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isCanonicalInstant(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/u.exec(
    value,
  );
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const monthLengths = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= monthLengths[month - 1] &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59
  );
}

function validateInstantOrder(startedAt, completedAt) {
  return (
    isCanonicalInstant(startedAt) &&
    isCanonicalInstant(completedAt) &&
    startedAt <= completedAt
  );
}

function validateGeneratedAt(value, result) {
  if (!isCanonicalInstant(value.generatedAt)) {
    addError(
      result,
      'calendar_validity',
      'generatedAt is not a real scalarEncodingVersion=1 Instant',
      '/generatedAt',
    );
  }
}

function validateConformance(value, validateSchemaInstance) {
  const result = validateSchemaInstance(value);
  if (!result.valid) {
    return result;
  }
  validateGeneratedAt(value, result);
  const suiteIds = new Set();
  for (const [suiteIndex, suite] of value.suites.entries()) {
    if (suiteIds.has(suite.suiteId)) {
      addError(
        result,
        'duplicate_suite_id',
        `duplicate suiteId ${suite.suiteId}`,
        `/suites/${suiteIndex}/suiteId`,
      );
    }
    suiteIds.add(suite.suiteId);

    const contractPaths = new Set();
    for (const [contractIndex, contract] of suite.contracts.entries()) {
      if (contractPaths.has(contract.path)) {
        addError(
          result,
          'duplicate_contract_path',
          `duplicate contract path ${contract.path}`,
          `/suites/${suiteIndex}/contracts/${contractIndex}/path`,
        );
      }
      contractPaths.add(contract.path);
    }

    const targetIds = new Set();
    const targets = new Map();
    for (const [targetIndex, target] of suite.targets.entries()) {
      if (targetIds.has(target.targetId)) {
        addError(
          result,
          'duplicate_target_id',
          `duplicate targetId ${target.targetId}`,
          `/suites/${suiteIndex}/targets/${targetIndex}/targetId`,
        );
      }
      targetIds.add(target.targetId);
      targets.set(target.targetId, target);
      if (
        target.assertions.passed + target.assertions.failed !==
        target.assertions.total
      ) {
        addError(
          result,
          'aggregate_invariant',
          'assertion passed + failed must equal total',
          `/suites/${suiteIndex}/targets/${targetIndex}/assertions`,
        );
      }
      if (
        target.status === 'pass' &&
        (target.assertions.failed !== 0 ||
          target.assertions.passed !== target.assertions.total)
      ) {
        addError(
          result,
          'aggregate_invariant',
          'a passing target requires zero failures and all assertions passed',
          `/suites/${suiteIndex}/targets/${targetIndex}/status`,
        );
      }
      if (!validateInstantOrder(target.startedAt, target.completedAt)) {
        addError(
          result,
          'aggregate_invariant',
          'target completedAt precedes startedAt',
          `/suites/${suiteIndex}/targets/${targetIndex}/completedAt`,
        );
      }
    }

    let everyRequiredPassed = true;
    for (const requiredTargetId of suite.requiredTargetIds) {
      const target = targets.get(requiredTargetId);
      if (target === undefined || !target.required || target.status !== 'pass') {
        everyRequiredPassed = false;
        addError(
          result,
          'aggregate_invariant',
          `required target ${requiredTargetId} is missing, not required, or not pass`,
          `/suites/${suiteIndex}/requiredTargetIds`,
        );
      }
    }
    for (const target of suite.targets) {
      if (target.required !== suite.requiredTargetIds.includes(target.targetId)) {
        everyRequiredPassed = false;
        addError(
          result,
          'aggregate_invariant',
          `target ${target.targetId} required flag must match requiredTargetIds`,
          `/suites/${suiteIndex}/requiredTargetIds`,
        );
      }
    }

    const expectedStatus = everyRequiredPassed
      ? 'verified'
      : suite.targets.some((target) => target.status === 'fail')
        ? 'failed'
        : 'blocked';
    if (suite.status !== expectedStatus) {
      addError(
        result,
        'aggregate_invariant',
        `suite status must be ${expectedStatus}`,
        `/suites/${suiteIndex}/status`,
      );
    }
  }
  return result;
}

function validateRelease(value, validateSchemaInstance) {
  const result = validateSchemaInstance(value);
  if (!result.valid) {
    return result;
  }
  validateGeneratedAt(value, result);
  const checkIds = new Set();
  for (const [index, check] of value.checks.entries()) {
    if (checkIds.has(check.checkId)) {
      addError(
        result,
        'duplicate_check_id',
        `duplicate checkId ${check.checkId}`,
        `/checks/${index}/checkId`,
      );
    }
    checkIds.add(check.checkId);
    if (!validateInstantOrder(check.startedAt, check.completedAt)) {
      addError(
        result,
        'aggregate_invariant',
        'check completedAt precedes startedAt',
        `/checks/${index}/completedAt`,
      );
    }
  }

  if (value.conformance.gitSha !== value.git.sha) {
    addError(
      result,
      'aggregate_invariant',
      'conformance and candidate must bind the same Git SHA',
      '/conformance/gitSha',
    );
  }
  if (!value.candidate.artifactUri.endsWith(`#${value.candidate.artifactSha256}`)) {
    addError(
      result,
      'aggregate_invariant',
      'candidate artifact URI digest must match artifactSha256',
      '/candidate/artifactUri',
    );
  }
  if (!value.conformance.artifactUri.endsWith(`#${value.conformance.indexSha256}`)) {
    addError(
      result,
      'aggregate_invariant',
      'conformance artifact URI digest must match indexSha256',
      '/conformance/artifactUri',
    );
  }

  const requiredChecks = value.checks.filter((check) => check.required);
  const allRequiredPassed =
    requiredChecks.length > 0 && requiredChecks.every((check) => check.status === 'pass');
  const expectedStatus = allRequiredPassed
    ? 'verified'
    : requiredChecks.some((check) => check.status === 'fail')
      ? 'failed'
      : 'blocked';
  if (value.status !== expectedStatus) {
    addError(
      result,
      'aggregate_invariant',
      `release status must be ${expectedStatus}`,
      '/status',
    );
  }
  return result;
}

function checkFixture(fixture, validator, caseIds) {
  let checked = 0;
  for (const testCase of fixture.cases) {
    if (caseIds.has(testCase.id)) {
      throw new Error(`Duplicate evidence fixture case ID: ${testCase.id}`);
    }
    caseIds.add(testCase.id);
    const candidate = applyFixtureMutation(fixture.baseIndex, testCase.mutation);
    const result = validator(candidate);
    if (result.valid !== testCase.expectedValid) {
      throw new Error(
        `${testCase.id}: expected valid=${testCase.expectedValid}, received ${result.valid}.`,
      );
    }
    if (
      typeof testCase.expectedKeyword === 'string' &&
      !result.errors.some((error) => error.keyword === testCase.expectedKeyword)
    ) {
      throw new Error(
        `${testCase.id}: expected keyword ${testCase.expectedKeyword}, received ${result.errors
          .map((error) => error.keyword)
          .join(', ')}.`,
      );
    }
    checked += 1;
  }
  return checked;
}

try {
  const oracle = verifyOraclePackage({
    manifestPath: resolve(root, 'specs/testing/fixtures/v1/manifest.json'),
    root,
    schemaPath: resolve(root, 'specs/testing/oracle-manifest-v1.schema.json'),
  });
  const identities = new Map(
    oracle.manifest.contracts.map((contract) => [
      contract.identity.name,
      contract.identity.value,
    ]),
  );
  if (
    identities.get('conformanceIndexVersion') !== 1 ||
    identities.get('releaseEvidenceIndexVersion') !== 1
  ) {
    throw new Error('Testing oracle does not bind both evidence index v1 schemas.');
  }
  const conformanceSchemaValidator = schemaValidator(
    resolve(root, 'specs/testing/conformance-index-v1.schema.json'),
  );
  const releaseSchemaValidator = schemaValidator(
    resolve(root, 'specs/testing/release-evidence-index-v1.schema.json'),
  );
  const conformanceValidator = (value) =>
    validateConformance(value, conformanceSchemaValidator);
  const releaseValidator = (value) => validateRelease(value, releaseSchemaValidator);
  const caseIds = new Set();
  let checked = 0;
  const fixtures = oracle.fixtures.filter((fixture) =>
    ['conformance', 'release'].includes(fixture.value.schema),
  );
  if (fixtures.length !== 4) {
    throw new Error('Testing oracle must contain four evidence index fixtures.');
  }
  for (const fixture of fixtures) {
    const validator =
      fixture.value.schema === 'conformance' ? conformanceValidator : releaseValidator;
    checked += checkFixture(fixture.value, validator, caseIds);
  }

  console.log(
    `Evidence index v1 schemas self-check passed (${checked} golden/negative cases; no evidence index generated).`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

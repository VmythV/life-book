import { createDecipheriv, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import Ajv2020 from 'ajv/dist/2020.js';
import { readJson, verifyOraclePackage } from './lib/oracle-manifest.mjs';

const root = resolve(import.meta.dirname, '../..');
const manifestPath = resolve(root, 'specs/security/fixtures/v1/manifest.json');
const manifestSchemaPath = resolve(root, 'specs/testing/oracle-manifest-v1.schema.json');
const anchorSchema = readJson(
  resolve(root, 'specs/security/installation-anchor-v1.schema.json'),
);
const deviceEnvelopeSchema = readJson(
  resolve(root, 'specs/security/device-key-envelope-v1.schema.json'),
);
const LONG_MAX = 9223372036854775807n;
const EXPECTED_KEY_PURPOSES = new Set([
  'database_data_key',
  'attachment_root_key',
  'dataset_control_key',
]);

class SecurityFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new SecurityFailure(code);
}

function compileSchema(schema, definition) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  if (!ajv.validateSchema(schema)) {
    throw new Error(
      `Invalid security schema ${schema.$id}: ${ajv.errorsText(ajv.errors)}`,
    );
  }
  if (definition === undefined) {
    return ajv.compile(schema);
  }
  return ajv.compile({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $ref: `#/$defs/${definition}`,
    $defs: schema.$defs,
  });
}

const validateAnchorOuterSchema = compileSchema(anchorSchema);
const validatePresenceSchema = compileSchema(anchorSchema, 'installPresenceRecord');
const validateBootstrapSchema = compileSchema(
  anchorSchema,
  'installationBootstrapRecord',
);
const validateDeviceEnvelopeSchema = compileSchema(deviceEnvelopeSchema);

function hasWellFormedSurrogates(value) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return false;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function assertWellFormedJson(value) {
  if (typeof value === 'string') {
    if (!hasWellFormedSurrogates(value)) {
      throw new Error('JCS input contains an unpaired surrogate.');
    }
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new Error('Security contracts only canonicalize safe integer JSON numbers.');
    }
    return;
  }
  if (value === null || typeof value === 'boolean') {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertWellFormedJson(item);
    }
    return;
  }
  if (typeof value !== 'object') {
    throw new Error('JCS input contains an unsupported JSON value.');
  }
  for (const [key, item] of Object.entries(value)) {
    assertWellFormedJson(key);
    assertWellFormedJson(item);
  }
}

function jcs(value) {
  assertWellFormedJson(value);
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => jcs(item)).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${jcs(value[key])}`)
    .join(',')}}`;
}

function parseStrictJcs(bytes, errorCode) {
  if (bytes.length === 0 || bytes.length > 65536) {
    fail(errorCode);
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    fail(errorCode);
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail(errorCode);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail(errorCode);
  }
  try {
    if (jcs(parsed) !== text) {
      fail(errorCode);
    }
  } catch (error) {
    if (error instanceof SecurityFailure) {
      throw error;
    }
    fail(errorCode);
  }
  return parsed;
}

function decodeBase64url(value, expectedBytes, errorCode) {
  if (
    typeof value !== 'string' ||
    value.includes('=') ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    fail(errorCode);
  }
  let decoded;
  try {
    decoded = Buffer.from(value, 'base64url');
  } catch {
    fail(errorCode);
  }
  if (decoded.length !== expectedBytes || decoded.toString('base64url') !== value) {
    fail(errorCode);
  }
  return decoded;
}

function decodeVariableBase64url(value, errorCode) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('=') ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    fail(errorCode);
  }
  let decoded;
  try {
    decoded = Buffer.from(value, 'base64url');
  } catch {
    fail(errorCode);
  }
  if (decoded.length === 0 || decoded.toString('base64url') !== value) {
    fail(errorCode);
  }
  return decoded;
}

function parseLongCounter(value, errorCode) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,18})$/u.test(value)) {
    fail(errorCode);
  }
  const parsed = BigInt(value);
  if (parsed > LONG_MAX) {
    fail(errorCode);
  }
  return parsed;
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function validateInstant(value, errorCode) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/u.exec(
    value,
  );
  if (match === null) {
    fail(errorCode);
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
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > monthLengths[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    fail(errorCode);
  }
}

function assertSchema(validate, value, errorCode) {
  if (!validate(value)) {
    fail(errorCode);
  }
}

function validatePresence(value) {
  assertSchema(validatePresenceSchema, value, 'anchor_malformed');
  parseLongCounter(value.presenceSequence, 'anchor_malformed');
  decodeBase64url(value.installationAnchorKeyId, 16, 'anchor_malformed');
  decodeBase64url(value.presenceNonce, 32, 'anchor_malformed');
  validateInstant(value.createdAt, 'anchor_malformed');
  return value;
}

function validateBootstrap(value) {
  assertSchema(validateBootstrapSchema, value, 'anchor_malformed');
  parseLongCounter(value.bootstrapSequence, 'anchor_malformed');
  parseLongCounter(value.notificationDatasetEpoch, 'anchor_malformed');
  if (value.initializedControlSequence !== null) {
    parseLongCounter(value.initializedControlSequence, 'anchor_malformed');
  }
  validateInstant(value.createdAt, 'anchor_malformed');
  if (
    value.phase === 'initializing' &&
    value.stateOperationId !== value.incarnationBootstrapOperationId
  ) {
    fail('anchor_identity_mismatch');
  }
  return value;
}

function validateAnchorOuter(value) {
  assertSchema(validateAnchorOuterSchema, value, 'anchor_malformed');
  decodeBase64url(value.installationAnchorKeyId, 16, 'anchor_malformed');
  decodeBase64url(value.nonce, 12, 'anchor_malformed');
  decodeVariableBase64url(value.ciphertext, 'anchor_malformed');
  decodeBase64url(value.tag, 16, 'anchor_malformed');
  return value;
}

function validateDeviceEnvelope(value) {
  assertSchema(validateDeviceEnvelopeSchema, value, 'device_envelope_malformed');
  parseLongCounter(value.envelopeSequence, 'device_envelope_malformed');
  decodeBase64url(value.keyId, 16, 'device_envelope_malformed');
  decodeBase64url(value.deviceWrappingKeyId, 16, 'device_envelope_malformed');
  decodeBase64url(value.nonce, 12, 'device_envelope_malformed');
  decodeBase64url(value.ciphertext, 32, 'device_envelope_malformed');
  decodeBase64url(value.tag, 16, 'device_envelope_malformed');
  validateInstant(value.createdAt, 'device_envelope_malformed');
  return value;
}

function domainSeparatedBytes(label, value) {
  return Buffer.concat([
    Buffer.from(label, 'utf8'),
    Buffer.from([0]),
    Buffer.from(jcs(value)),
  ]);
}

function presenceDigest(presence) {
  validatePresence(presence);
  return createHash('sha256')
    .update(domainSeparatedBytes('life-book/install-presence/v1', presence))
    .digest('hex');
}

function bootstrapDigest(bootstrap) {
  validateBootstrap(bootstrap);
  return createHash('sha256')
    .update(domainSeparatedBytes('life-book/installation-bootstrap/v1', bootstrap))
    .digest('hex');
}

function anchorAad(value) {
  return domainSeparatedBytes('life-book/installation-anchor/aead/v1', value);
}

function deviceAad(envelope) {
  validateDeviceEnvelope(envelope);
  return domainSeparatedBytes('life-book/device-key-envelope/aead/v1', {
    deviceWrappingKeyId: envelope.deviceWrappingKeyId,
    envelopeFormatVersion: envelope.envelopeFormatVersion,
    envelopeSequence: envelope.envelopeSequence,
    installationId: envelope.installationId,
    installationIncarnationId: envelope.installationIncarnationId,
    keyId: envelope.keyId,
    keyPurpose: envelope.keyPurpose,
    recordKind: envelope.recordKind,
    slotId: envelope.slotId,
    wrappingAlgorithm: envelope.wrappingAlgorithm,
  });
}

function keyFromHex(value, errorCode) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    fail(errorCode);
  }
  return Buffer.from(value, 'hex');
}

function aesGcmDecrypt({ aad, ciphertext, errorCode, key, nonce, tag }) {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce, {
      authTagLength: 16,
    });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    fail(errorCode);
  }
}

function decryptAnchor(outer, context) {
  validateAnchorOuter(outer);
  if (
    outer.recordKind !== context.physicalRecordKind ||
    outer.slotId !== context.physicalSlotId
  ) {
    fail('anchor_malformed');
  }
  const plaintext = aesGcmDecrypt({
    aad: anchorAad({
      applicationId: context.applicationId,
      envelopeFormatVersion: outer.envelopeFormatVersion,
      installationAnchorKeyId: outer.installationAnchorKeyId,
      recordKind: outer.recordKind,
      slotId: outer.slotId,
    }),
    ciphertext: decodeVariableBase64url(outer.ciphertext, 'anchor_malformed'),
    errorCode: 'anchor_authentication_failed',
    key: keyFromHex(context.keyHex, 'anchor_key_unavailable'),
    nonce: decodeBase64url(outer.nonce, 12, 'anchor_malformed'),
    tag: decodeBase64url(outer.tag, 16, 'anchor_malformed'),
  });
  const payload = parseStrictJcs(plaintext, 'anchor_malformed');
  if (outer.recordKind === 'install_presence') {
    validatePresence(payload);
    if (
      payload.installationAnchorKeyId !== outer.installationAnchorKeyId ||
      payload.applicationId !== context.applicationId
    ) {
      fail('anchor_identity_mismatch');
    }
  } else {
    validateBootstrap(payload);
  }
  return payload;
}

function decryptDeviceEnvelope(envelope, context) {
  validateDeviceEnvelope(envelope);
  if (
    envelope.installationId !== context.expectedInstallationId ||
    envelope.installationIncarnationId !== context.expectedInstallationIncarnationId ||
    envelope.keyPurpose !== context.expectedKeyPurpose ||
    envelope.slotId !== context.expectedSlotId
  ) {
    fail('device_envelope_identity_mismatch');
  }
  const plaintext = aesGcmDecrypt({
    aad: deviceAad(envelope),
    ciphertext: decodeBase64url(envelope.ciphertext, 32, 'device_envelope_malformed'),
    errorCode: 'device_envelope_authentication_failed',
    key: keyFromHex(context.keyHex, 'device_wrapping_key_unavailable'),
    nonce: decodeBase64url(envelope.nonce, 12, 'device_envelope_malformed'),
    tag: decodeBase64url(envelope.tag, 16, 'device_envelope_malformed'),
  });
  if (plaintext.length !== 32) {
    fail('device_envelope_malformed');
  }
  return plaintext;
}

function compatiblePair(presence, bootstrap) {
  validatePresence(presence);
  validateBootstrap(bootstrap);
  if (
    bootstrap.installPresenceRecordDigest !== presenceDigest(presence) ||
    bootstrap.installationId !== presence.installationId ||
    bootstrap.installationIncarnationId !== presence.installationIncarnationId ||
    bootstrap.incarnationBootstrapOperationId !== presence.incarnationBootstrapOperationId
  ) {
    fail('anchor_identity_mismatch');
  }
  return true;
}

function checkedHeadroom(current, required) {
  const value = parseLongCounter(current, 'anchor_sequence_exhausted');
  if (!Number.isSafeInteger(required) || required < 0) {
    fail('anchor_sequence_exhausted');
  }
  if (value + BigInt(required) > LONG_MAX) {
    fail('anchor_sequence_exhausted');
  }
  return true;
}

function clearHeadroom(input) {
  checkedHeadroom(input.presenceSequence, 1);
  checkedHeadroom(input.bootstrapSequence, 4);
  return true;
}

function rejectSequenceConflicts(candidates) {
  const sequences = new Map();
  for (const candidate of candidates.filter((item) => item.valid)) {
    const existing = sequences.get(candidate.sequence);
    if (existing !== undefined && existing !== candidate.digest) {
      fail('anchor_integrity_blocked');
    }
    sequences.set(candidate.sequence, candidate.digest);
  }
}

function selectPair(input) {
  rejectSequenceConflicts(input.presenceCandidates);
  rejectSequenceConflicts(input.bootstrapCandidates);
  const presences = input.presenceCandidates.filter((item) => item.valid);
  const pairs = input.bootstrapCandidates
    .filter((item) => item.valid)
    .flatMap((bootstrap) =>
      presences
        .filter(
          (presence) =>
            presence.identity === bootstrap.identity &&
            presence.digest === bootstrap.presenceDigest,
        )
        .map(() => bootstrap),
    );
  if (pairs.length === 0) {
    fail('anchor_integrity_blocked');
  }
  pairs.sort((left, right) => {
    const leftSequence = parseLongCounter(left.sequence, 'anchor_integrity_blocked');
    const rightSequence = parseLongCounter(right.sequence, 'anchor_integrity_blocked');
    return leftSequence < rightSequence ? 1 : leftSequence > rightSequence ? -1 : 0;
  });
  const selected = pairs[0];
  return {
    bootstrapSequence: selected.sequence,
    classification: selected.phase,
    identity: selected.identity,
  };
}

function selectClearPair(input) {
  if (!input.source.compatible || input.source.phase !== 'clearing') {
    fail('anchor_integrity_blocked');
  }
  if (
    input.target.presenceDurable &&
    input.target.bootstrapDurable &&
    input.target.compatible
  ) {
    return input.target.identity;
  }
  if (
    ['prepared', 'source_clearing', 'data_erased', 'target_presence_written'].includes(
      input.journalPhase,
    )
  ) {
    return input.source.identity;
  }
  fail('anchor_integrity_blocked');
}

function classify(input) {
  if (!input.keyAvailable && input.artifactsPresent) {
    return 'key_unavailable';
  }
  if (input.strictAllAbsent) {
    return input.orphanAliases ? 'reinstall_orphans' : 'fresh_eligible';
  }
  if (input.presenceOnly && input.matchingJournal) {
    return 'initializing';
  }
  return 'integrity_blocked';
}

function validateKeySet(input) {
  if (!Array.isArray(input.envelopes)) {
    fail('device_envelope_integrity_blocked');
  }
  const purposes = new Set();
  const keyIds = new Set();
  for (const envelope of input.envelopes) {
    if (
      !EXPECTED_KEY_PURPOSES.has(envelope.keyPurpose) ||
      purposes.has(envelope.keyPurpose) ||
      keyIds.has(envelope.keyId)
    ) {
      fail('device_envelope_integrity_blocked');
    }
    decodeBase64url(envelope.keyId, 16, 'device_envelope_integrity_blocked');
    purposes.add(envelope.keyPurpose);
    keyIds.add(envelope.keyId);
  }
  if (
    purposes.size !== EXPECTED_KEY_PURPOSES.size ||
    [...EXPECTED_KEY_PURPOSES].some((purpose) => !purposes.has(purpose))
  ) {
    fail('device_envelope_integrity_blocked');
  }
  return 'ready';
}

function executeCase(testCase, vectors) {
  const vector =
    typeof testCase.vector === 'string' ? vectors.get(testCase.vector) : undefined;
  switch (testCase.operation) {
    case 'strict_jcs_text':
      parseStrictJcs(Buffer.from(testCase.input, 'utf8'), 'anchor_malformed');
      return 'valid';
    case 'strict_jcs_repeated':
      if (
        typeof testCase.input?.ascii !== 'string' ||
        Buffer.byteLength(testCase.input.ascii, 'ascii') !== 1 ||
        !Number.isSafeInteger(testCase.input.count) ||
        testCase.input.count < 0
      ) {
        fail('anchor_malformed');
      }
      parseStrictJcs(
        Buffer.from(testCase.input.ascii.repeat(testCase.input.count), 'ascii'),
        'anchor_malformed',
      );
      return 'valid';
    case 'validate_presence':
      validatePresence(vector);
      return 'valid';
    case 'validate_presence_inline':
      validatePresence(testCase.input);
      return 'valid';
    case 'presence_digest':
      return presenceDigest(vector);
    case 'validate_bootstrap':
      validateBootstrap(vector);
      return 'valid';
    case 'validate_bootstrap_inline':
      validateBootstrap(testCase.input);
      return 'valid';
    case 'bootstrap_digest':
      return bootstrapDigest(vector);
    case 'anchor_aad':
      return anchorAad(testCase.input).toString('hex');
    case 'decrypt_anchor':
      return decryptAnchor(vector, testCase.context);
    case 'decrypt_anchor_inline':
      return decryptAnchor(testCase.input, testCase.context);
    case 'compatible_pair':
      return compatiblePair(
        vectors.get(testCase.inputVectors[0]),
        vectors.get(testCase.inputVectors[1]),
      );
    case 'compatible_pair_inline':
      return compatiblePair(testCase.input.presence, testCase.input.bootstrap);
    case 'validate_device_envelope':
      validateDeviceEnvelope(vector);
      return 'valid';
    case 'validate_device_envelope_inline':
      validateDeviceEnvelope(testCase.input);
      return 'valid';
    case 'device_aad':
      return deviceAad(vector).toString('hex');
    case 'decrypt_device_envelope':
      return decryptDeviceEnvelope(vector, testCase.context).toString('hex');
    case 'decrypt_device_envelope_inline':
      return decryptDeviceEnvelope(testCase.input, testCase.context).toString('hex');
    case 'headroom':
      return checkedHeadroom(testCase.input.current, testCase.input.required);
    case 'clear_headroom':
      return clearHeadroom(testCase.input);
    case 'select_pair':
      return selectPair(testCase.input);
    case 'select_clear_pair':
      return selectClearPair(testCase.input);
    case 'classify':
      return classify(testCase.input);
    case 'key_set':
      return validateKeySet(testCase.input);
    default:
      throw new Error(
        `${testCase.id}: unsupported security oracle operation ${testCase.operation}.`,
      );
  }
}

function expectedValue(testCase, vectors) {
  if (typeof testCase.expectedVector === 'string') {
    return vectors.get(testCase.expectedVector);
  }
  if (typeof testCase.expectedHex === 'string') {
    return testCase.expectedHex;
  }
  if (typeof testCase.expectedPlaintextHex === 'string') {
    return testCase.expectedPlaintextHex;
  }
  return testCase.expected;
}

function verifyCase(testCase, vectors) {
  if (typeof testCase.expectedError === 'string') {
    try {
      executeCase(testCase, vectors);
    } catch (error) {
      if (error instanceof SecurityFailure && error.code === testCase.expectedError) {
        return;
      }
      throw new Error(
        `${testCase.id}: expected ${testCase.expectedError}, received ${
          error instanceof SecurityFailure
            ? error.code
            : error instanceof Error
              ? error.message
              : String(error)
        }.`,
      );
    }
    throw new Error(
      `${testCase.id}: expected ${testCase.expectedError}, but the input was accepted.`,
    );
  }
  const actual = executeCase(testCase, vectors);
  const expected = expectedValue(testCase, vectors);
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(
      `${testCase.id}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
    );
  }
}

try {
  const oracle = verifyOraclePackage({
    manifestPath,
    root,
    schemaPath: manifestSchemaPath,
  });
  if (
    oracle.manifest.oracleId !== 'installation_security_v1' ||
    oracle.manifest.generator.implementationPath !==
      'tools/oracles/check-security-v1.mjs' ||
    oracle.manifest.selfCheck.command !== 'corepack pnpm oracle:security:check'
  ) {
    throw new Error('Security oracle identity is not installation_security_v1.');
  }
  const expectedContracts = new Map([
    ['installationAnchorProtocolVersion', 1],
    ['installationAnchorSchemaVersion', 1],
    ['deviceKeyEnvelopeProtocolVersion', 1],
    ['deviceKeyEnvelopeSchemaVersion', 1],
  ]);
  for (const contract of oracle.manifest.contracts) {
    const expected = expectedContracts.get(contract.identity.name);
    if (expected !== contract.identity.value) {
      throw new Error(
        `Unexpected security contract identity ${contract.identity.name}=${contract.identity.value}.`,
      );
    }
    expectedContracts.delete(contract.identity.name);
  }
  if (expectedContracts.size !== 0) {
    throw new Error(
      `Security oracle is missing contracts: ${[...expectedContracts.keys()].join(', ')}.`,
    );
  }

  const markdownContracts = oracle.contracts.filter((contract) =>
    contract.entry.path.endsWith('.md'),
  );
  for (const contract of markdownContracts) {
    const content = readFileSync(contract.path, 'utf8');
    for (const marker of [
      'Contract status：`Draft`',
      'Authority：`CANDIDATE`',
      'Platform scope：Android 10+；iOS 不在当前实现范围',
    ]) {
      if (!content.includes(marker)) {
        throw new Error(`${contract.entry.path} is missing marker: ${marker}`);
      }
    }
  }

  const vectors = new Map();
  for (const fixture of oracle.fixtures) {
    for (const [name, value] of Object.entries(fixture.value.vectors ?? {})) {
      if (vectors.has(name)) {
        throw new Error(`Duplicate security vector name: ${name}.`);
      }
      vectors.set(name, value);
    }
  }

  const caseIds = new Set();
  let checked = 0;
  for (const fixture of oracle.fixtures) {
    if (fixture.value.securityContractVersion !== 1) {
      throw new Error(`${fixture.entry.path} is not securityContractVersion=1.`);
    }
    for (const testCase of fixture.value.cases) {
      if (typeof testCase.id !== 'string' || caseIds.has(testCase.id)) {
        throw new Error(`Duplicate or invalid security case ID: ${testCase.id}`);
      }
      caseIds.add(testCase.id);
      verifyCase(testCase, vectors);
      checked += 1;
    }
  }

  console.log(
    `Android installation security v1 independent oracle passed (${checked} golden/boundary/negative cases).`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

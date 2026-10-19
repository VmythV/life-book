import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { verifyOraclePackage } from './lib/oracle-manifest.mjs';

const root = resolve(import.meta.dirname, '../..');
const manifestPath = resolve(root, 'specs/scalars/fixtures/v1/manifest.json');
const schemaPath = resolve(root, 'specs/testing/oracle-manifest-v1.schema.json');
const INSTANT_MIN = -62135596800000;
const INSTANT_MAX = 253402300799999;
const DECIMAL_SCALED_MAX = 999999999999999999n;
const SORT_KEY_MAX = (1n << 128n) - 1n;
const REVISION_MAX = 4294967295;
const LONG_COUNTER_MAX = 9223372036854775807n;
const MILLISECONDS_PER_DAY = 86400000;

class ScalarFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new ScalarFailure(code);
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year, month) {
  const lengths = [
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
  return lengths[month - 1] ?? 0;
}

function parseDateParts(value, errorCode) {
  if (typeof value !== 'string' || value.length !== 10) {
    fail(errorCode);
  }
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/u.exec(value);
  if (match === null) {
    fail(errorCode);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    year < 1 ||
    year > 9999 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    fail(errorCode);
  }
  return { day, month, year };
}

function parseTimeParts(value, errorCode) {
  if (typeof value !== 'string' || value.length !== 8) {
    fail(errorCode);
  }
  const match = /^([0-9]{2}):([0-9]{2}):([0-9]{2})$/u.exec(value);
  if (match === null) {
    fail(errorCode);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3]);
  if (hour > 23 || minute > 59 || second > 59) {
    fail(errorCode);
  }
  return { hour, minute, second };
}

// Howard Hinnant's civil calendar transformation, independently encoded here
// with proleptic Gregorian integer arithmetic and no platform Date parser.
function daysFromCivil(year, month, day) {
  const adjustedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const shiftedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

function civilFromDays(daysSinceEpoch) {
  const shiftedDays = daysSinceEpoch + 719468;
  const era = Math.floor(shiftedDays / 146097);
  const dayOfEra = shiftedDays - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  let year = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra -
    (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shiftedMonth = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * shiftedMonth + 2) / 5) + 1;
  const month = shiftedMonth + (shiftedMonth < 10 ? 3 : -9);
  year += month <= 2 ? 1 : 0;
  return { day, month, year };
}

function pad(value, width) {
  return String(value).padStart(width, '0');
}

function epochMilliseconds(parts) {
  return (
    daysFromCivil(parts.year, parts.month, parts.day) * MILLISECONDS_PER_DAY +
    parts.hour * 3600000 +
    parts.minute * 60000 +
    parts.second * 1000 +
    parts.millisecond
  );
}

function formatInstant(value) {
  if (!Number.isSafeInteger(value) || value < INSTANT_MIN || value > INSTANT_MAX) {
    fail('instant_out_of_range');
  }
  const days = Math.floor(value / MILLISECONDS_PER_DAY);
  let withinDay = value - days * MILLISECONDS_PER_DAY;
  const hour = Math.floor(withinDay / 3600000);
  withinDay -= hour * 3600000;
  const minute = Math.floor(withinDay / 60000);
  withinDay -= minute * 60000;
  const second = Math.floor(withinDay / 1000);
  const millisecond = withinDay - second * 1000;
  const date = civilFromDays(days);
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}T${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}.${pad(millisecond, 3)}Z`;
}

function parseCanonicalInstant(value) {
  if (typeof value !== 'string' || value.length !== 24) {
    fail('invalid_instant');
  }
  const match =
    /^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2}:[0-9]{2}:[0-9]{2})\.([0-9]{3})Z$/u.exec(
      value,
    );
  if (match === null) {
    fail('invalid_instant');
  }
  const date = parseDateParts(match[1], 'invalid_instant');
  const time = parseTimeParts(match[2], 'invalid_instant');
  const epoch = epochMilliseconds({
    ...date,
    ...time,
    millisecond: Number(match[3]),
  });
  if (epoch < INSTANT_MIN || epoch > INSTANT_MAX) {
    fail('instant_out_of_range');
  }
  const canonical = formatInstant(epoch);
  if (canonical !== value) {
    fail('invalid_instant');
  }
  return { canonical, epochMilliseconds: epoch };
}

function normalizeOffsetInstant(value) {
  if (typeof value !== 'string' || value.length !== 29) {
    fail('invalid_instant');
  }
  const match =
    /^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2}:[0-9]{2}:[0-9]{2})\.([0-9]{3})([+-])([0-9]{2}):([0-9]{2})$/u.exec(
      value,
    );
  if (match === null) {
    fail('invalid_instant');
  }
  const date = parseDateParts(match[1], 'invalid_instant');
  const time = parseTimeParts(match[2], 'invalid_instant');
  const offsetHour = Number(match[5]);
  const offsetMinute = Number(match[6]);
  if (offsetHour > 23 || offsetMinute > 59) {
    fail('invalid_instant');
  }
  const offsetSign = match[4] === '+' ? 1 : -1;
  const localEpoch = epochMilliseconds({
    ...date,
    ...time,
    millisecond: Number(match[3]),
  });
  const epoch = localEpoch - offsetSign * (offsetHour * 60 + offsetMinute) * 60000;
  if (epoch < INSTANT_MIN || epoch > INSTANT_MAX) {
    fail('instant_out_of_range');
  }
  return { canonical: formatInstant(epoch), epochMilliseconds: epoch };
}

function parseEntityId(value) {
  if (
    typeof value !== 'string' ||
    value.length !== 36 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)
  ) {
    fail('invalid_entity_id');
  }
  return value;
}

function parseLocalDate(value) {
  parseDateParts(value, 'invalid_local_date');
  return value;
}

function parseLocalTime(value) {
  const time = parseTimeParts(value, 'invalid_local_time');
  return {
    canonical: value,
    seconds: time.hour * 3600 + time.minute * 60 + time.second,
  };
}

function isZoneSyntax(value) {
  return (
    typeof value === 'string' &&
    value.length <= 255 &&
    (value === 'UTC' || /^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)+$/u.test(value))
  );
}

function resolveTimeZone(input) {
  if (
    typeof input !== 'object' ||
    input === null ||
    !isZoneSyntax(input.value) ||
    typeof input.resolver !== 'object' ||
    input.resolver === null
  ) {
    fail('invalid_time_zone_id');
  }
  if (input.resolver.kind === 'unknown') {
    fail('unknown_time_zone');
  }
  if (input.resolver.kind === 'canonical') {
    return input.value;
  }
  if (input.resolver.kind === 'alias' && isZoneSyntax(input.resolver.canonical)) {
    return input.resolver.canonical;
  }
  fail('invalid_time_zone_id');
}

function parseScaledInteger(value) {
  if (
    typeof value !== 'string' ||
    value.length > 19 ||
    !/^(?:0|-?[1-9][0-9]{0,17})$/u.test(value)
  ) {
    fail('invalid_scaled_integer');
  }
  const parsed = BigInt(value);
  if (parsed < -DECIMAL_SCALED_MAX || parsed > DECIMAL_SCALED_MAX) {
    fail('invalid_scaled_integer');
  }
  return parsed;
}

function formatScaledInteger(scaled) {
  const negative = scaled < 0n;
  const absolute = negative ? -scaled : scaled;
  const integer = absolute / 1000n;
  const remainder = absolute % 1000n;
  const fraction = remainder.toString().padStart(3, '0').replace(/0+$/u, '');
  return `${negative ? '-' : ''}${integer}${fraction.length > 0 ? `.${fraction}` : ''}`;
}

function parseDisplayDecimal(value) {
  if (
    typeof value !== 'string' ||
    value.length > 20 ||
    !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{0,2}[1-9])?$/u.test(value)
  ) {
    fail('invalid_exact_decimal');
  }
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [integerText, fractionText = ''] = unsigned.split('.');
  const magnitude =
    BigInt(integerText) * 1000n + BigInt(fractionText.padEnd(3, '0') || '0');
  const scaled = negative ? -magnitude : magnitude;
  if (scaled < -DECIMAL_SCALED_MAX || scaled > DECIMAL_SCALED_MAX) {
    fail('exact_decimal_out_of_range');
  }
  const canonical = formatScaledInteger(scaled);
  if (canonical !== value) {
    fail('invalid_exact_decimal');
  }
  return { canonical, scaled: scaled.toString() };
}

function parseSortKey(value) {
  if (
    typeof value !== 'string' ||
    value.length !== 32 ||
    !/^[0-9a-f]{32}$/u.test(value)
  ) {
    fail('invalid_sort_key');
  }
  return BigInt(`0x${value}`);
}

function formatSortKey(value) {
  return value.toString(16).padStart(32, '0');
}

function parseSortKeyResult(value) {
  const parsed = parseSortKey(value);
  return {
    assignable: parsed !== 0n && parsed !== SORT_KEY_MAX,
    decimal: parsed.toString(),
  };
}

function assignSortKey(value) {
  const parsed = parseSortKey(value);
  if (parsed === 0n || parsed === SORT_KEY_MAX) {
    fail('reserved_sort_key');
  }
  return value;
}

function midpoint(input) {
  if (typeof input !== 'object' || input === null) {
    fail('invalid_sort_key');
  }
  const left = parseSortKey(input.left);
  const right = parseSortKey(input.right);
  if (left >= right) {
    fail('invalid_sort_key');
  }
  if (right - left <= 1n) {
    fail('sort_key_gap_exhausted');
  }
  return formatSortKey((left + right) / 2n);
}

function rebalance(input) {
  if (!Array.isArray(input) || input.length === 0) {
    fail('invalid_sort_key');
  }
  const entries = input.map((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      fail('invalid_sort_key');
    }
    return {
      id: parseEntityId(entry.id),
      numericKey: parseSortKey(entry.sortKey),
    };
  });
  entries.sort((left, right) => {
    if (left.numericKey < right.numericKey) {
      return -1;
    }
    if (left.numericKey > right.numericKey) {
      return 1;
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
  const denominator = BigInt(entries.length + 1);
  return entries.map((entry, index) => ({
    id: entry.id,
    sortKey: formatSortKey((BigInt(index + 1) * SORT_KEY_MAX) / denominator),
  }));
}

function parseRevision(value) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > REVISION_MAX
  ) {
    fail('invalid_revision');
  }
  return value;
}

function incrementRevision(value) {
  const revision = parseRevision(value);
  if (revision === REVISION_MAX) {
    fail('revision_exhausted');
  }
  return revision + 1;
}

function parseLongCounter(value) {
  if (
    typeof value !== 'string' ||
    value.length > 19 ||
    !/^(?:0|[1-9][0-9]{0,18})$/u.test(value)
  ) {
    fail('invalid_long_counter');
  }
  const parsed = BigInt(value);
  if (parsed > LONG_COUNTER_MAX) {
    fail('invalid_long_counter');
  }
  return parsed;
}

function incrementLongCounter(value) {
  const counter = parseLongCounter(value);
  if (counter === LONG_COUNTER_MAX) {
    fail('long_counter_exhausted');
  }
  return (counter + 1n).toString();
}

function strictBoolean(value) {
  if (typeof value !== 'boolean') {
    fail('invalid_json_scalar');
  }
  return value;
}

function strictEnum(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u.test(value)) {
    fail('invalid_json_scalar');
  }
  return value;
}

function inspectPresence(input) {
  if (
    typeof input !== 'object' ||
    input === null ||
    typeof input.object !== 'object' ||
    input.object === null ||
    Array.isArray(input.object) ||
    typeof input.field !== 'string' ||
    typeof input.nullable !== 'boolean' ||
    typeof input.optional !== 'boolean'
  ) {
    fail('invalid_json_scalar');
  }
  const present = Object.hasOwn(input.object, input.field);
  if (!present) {
    if (!input.optional) {
      fail('invalid_json_scalar');
    }
    return { state: 'absent' };
  }
  const value = input.object[input.field];
  if (value === null) {
    if (!input.nullable) {
      fail('invalid_json_scalar');
    }
    return { state: 'null' };
  }
  return { state: 'value', value };
}

function hasWellFormedSurrogates(value) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return false;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function utf8RoundTrip(value) {
  if (typeof value !== 'string' || !hasWellFormedSurrogates(value)) {
    fail('invalid_json_scalar');
  }
  const bytes = new TextEncoder().encode(value);
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (decoded !== value) {
    fail('invalid_json_scalar');
  }
  return decoded;
}

function executeCase(testCase) {
  switch (`${testCase.scalar}.${testCase.operation}`) {
    case 'entity_id.parse':
      return parseEntityId(testCase.input);
    case 'instant.parse_canonical':
      return parseCanonicalInstant(testCase.input);
    case 'instant.normalize_offset':
      return normalizeOffsetInstant(testCase.input);
    case 'local_date.parse':
      return parseLocalDate(testCase.input);
    case 'local_time.parse':
      return parseLocalTime(testCase.input);
    case 'time_zone_id.resolve':
      return resolveTimeZone(testCase.input);
    case 'exact_decimal.parse_display':
      return parseDisplayDecimal(testCase.input);
    case 'exact_decimal.parse_scaled':
      return parseScaledInteger(testCase.input).toString();
    case 'exact_decimal.format_scaled':
      return formatScaledInteger(parseScaledInteger(testCase.input));
    case 'sort_key.parse':
      return parseSortKeyResult(testCase.input);
    case 'sort_key.assign':
      return assignSortKey(testCase.input);
    case 'sort_key.midpoint':
      return midpoint(testCase.input);
    case 'sort_key.rebalance':
      return rebalance(testCase.input);
    case 'revision.parse':
      return parseRevision(testCase.input);
    case 'revision.increment':
      return incrementRevision(testCase.input);
    case 'long_counter.parse':
      return parseLongCounter(testCase.input).toString();
    case 'long_counter.increment':
      return incrementLongCounter(testCase.input);
    case 'json_policy.boolean':
      return strictBoolean(testCase.input);
    case 'json_policy.enum':
      return strictEnum(testCase.input);
    case 'json_policy.presence':
      return inspectPresence(testCase.input);
    case 'json_policy.utf8':
      return utf8RoundTrip(testCase.input);
    default:
      throw new Error(
        `${testCase.id}: unsupported oracle operation ${testCase.scalar}.${testCase.operation}.`,
      );
  }
}

function verifyCase(testCase) {
  if (typeof testCase.expectedError === 'string') {
    try {
      executeCase(testCase);
    } catch (error) {
      if (error instanceof ScalarFailure && error.code === testCase.expectedError) {
        return;
      }
      throw new Error(
        `${testCase.id}: expected ${testCase.expectedError}, received ${
          error instanceof ScalarFailure
            ? error.code
            : error instanceof Error
              ? error.message
              : String(error)
        }.`,
      );
    }
    throw new Error(
      `${testCase.id}: expected ${testCase.expectedError}, but the value was accepted.`,
    );
  }

  if (!Object.hasOwn(testCase, 'expected')) {
    throw new Error(`${testCase.id}: case needs expected or expectedError.`);
  }
  const actual = executeCase(testCase);
  if (!isDeepStrictEqual(actual, testCase.expected)) {
    throw new Error(
      `${testCase.id}: expected ${JSON.stringify(testCase.expected)}, received ${JSON.stringify(actual)}.`,
    );
  }
}

try {
  const oracle = verifyOraclePackage({ manifestPath, root, schemaPath });
  if (
    oracle.manifest.oracleManifestVersion !== 1 ||
    oracle.manifest.oracleId !== 'scalar_encoding_v1' ||
    oracle.manifest.contracts.length !== 1 ||
    oracle.manifest.contracts[0].path !== 'specs/scalars/v1.md' ||
    oracle.manifest.contracts[0].identity.name !== 'scalarEncodingVersion' ||
    oracle.manifest.contracts[0].identity.value !== 1 ||
    oracle.manifest.generator.implementationPath !==
      'tools/oracles/check-scalars-v1.mjs' ||
    oracle.manifest.selfCheck.command !== 'corepack pnpm oracle:scalars:check'
  ) {
    throw new Error('Scalar oracle identity is not scalarEncodingVersion=1.');
  }

  const contract = readFileSync(oracle.contracts[0].path, 'utf8');
  for (const marker of [
    'Contract status：`Draft`',
    'Authority：`CANDIDATE`',
    'Stable identity：`scalarEncodingVersion = 1`',
  ]) {
    if (!contract.includes(marker)) {
      throw new Error(`Scalar candidate contract marker is missing: ${marker}`);
    }
  }

  const caseIds = new Set();
  let checked = 0;
  for (const fixture of oracle.fixtures) {
    if (fixture.value.scalarEncodingVersion !== 1) {
      throw new Error(`${fixture.entry.path} is not scalarEncodingVersion=1.`);
    }
    for (const testCase of fixture.value.cases) {
      if (typeof testCase.id !== 'string' || caseIds.has(testCase.id)) {
        throw new Error(`Duplicate or invalid scalar oracle case ID: ${testCase.id}`);
      }
      caseIds.add(testCase.id);
      verifyCase(testCase);
      checked += 1;
    }
  }

  console.log(
    `Scalar encoding v1 independent oracle passed (${checked} golden/boundary/negative cases).`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

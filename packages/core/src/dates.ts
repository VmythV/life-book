import { z } from 'zod';

/**
 * 业务日期，格式 `YYYY-MM-DD`，不带时区。
 * 日期运算统一换算成“天序号”（距 1970-01-01 的天数）再做，避免受本机时区影响。
 */
export type LocalDate = string;

const DAY_MS = 86_400_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidLocalDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export const localDateSchema = z
  .string()
  .refine(isValidLocalDate, { message: '日期格式应为 YYYY-MM-DD' });

export function parseLocalDate(date: LocalDate): {
  year: number;
  month: number;
  day: number;
} {
  const match = DATE_PATTERN.exec(date);
  if (match === null) {
    throw new RangeError(`Invalid local date: ${date}`);
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function makeLocalDate(year: number, month: number, day: number): LocalDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function toDayNumber(date: LocalDate): number {
  const { year, month, day } = parseLocalDate(date);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

export function fromDayNumber(dayNumber: number): LocalDate {
  const value = new Date(dayNumber * DAY_MS);
  return makeLocalDate(
    value.getUTCFullYear(),
    value.getUTCMonth() + 1,
    value.getUTCDate(),
  );
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromDayNumber(toDayNumber(date) + days);
}

/** `to - from` 相差的天数。 */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return toDayNumber(to) - toDayNumber(from);
}

/** 1 = 周一 ... 7 = 周日。 */
export function weekdayOf(date: LocalDate): number {
  // 1970-01-01 是周四。
  return ((((toDayNumber(date) + 3) % 7) + 7) % 7) + 1;
}

/** 某年某月的第 `day` 天；该月没有这一天时取当月最后一天。 */
export function clampedDate(year: number, month: number, day: number): LocalDate {
  return makeLocalDate(year, month, Math.min(day, daysInMonth(year, month)));
}

// ---- 时区换算 ----

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function wallClockParts(instant: Date, timeZone: string) {
  const values: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') {
      values[part.type] = Number(part.value);
    }
  }
  return {
    year: values.year ?? 0,
    month: values.month ?? 1,
    day: values.day ?? 1,
    // 个别引擎会把午夜输出为 24 点。
    hour: (values.hour ?? 0) % 24,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

/** 某个时间点在指定时区的日期和时刻（`HH:mm`）。 */
export function zonedDateTime(
  instant: Date,
  timeZone: string,
): { date: LocalDate; time: string } {
  const parts = wallClockParts(instant, timeZone);
  return {
    date: makeLocalDate(parts.year, parts.month, parts.day),
    time: `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`,
  };
}

/** 指定时区“今天”的日期。 */
export function todayIn(timeZone: string, now: Date = new Date()): LocalDate {
  return zonedDateTime(now, timeZone).date;
}

function offsetAt(instantMs: number, timeZone: string): number {
  const seconds = Math.floor(instantMs / 1000) * 1000;
  const parts = wallClockParts(new Date(seconds), timeZone);
  const wallAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return wallAsUtc - seconds;
}

/**
 * 指定时区的某天某刻对应的时间点。
 * 夏令时跳过的时刻会落到跳变之后；重复的时刻取较早的一个。
 */
export function zonedTimeToInstant(
  date: LocalDate,
  time: string,
  timeZone: string,
): Date {
  const { year, month, day } = parseLocalDate(date);
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const firstOffset = offsetAt(wallAsUtc, timeZone);
  const candidate = wallAsUtc - offsetAt(wallAsUtc - firstOffset, timeZone);
  if (offsetAt(candidate, timeZone) === wallAsUtc - candidate) {
    return new Date(candidate);
  }
  // 该时刻被夏令时跳过：用跳变前的偏移量换算，结果落在跳变之后。
  return new Date(wallAsUtc - firstOffset);
}

const WEEKDAY_SHORT = ['一', '二', '三', '四', '五', '六', '日'];

/** “10月24日 周六”；`withYear` 时为“2026年10月24日 周六”。 */
export function formatLocalDate(
  date: LocalDate,
  options: { withYear?: boolean } = {},
): string {
  const { year, month, day } = parseLocalDate(date);
  const weekday = `周${WEEKDAY_SHORT[weekdayOf(date) - 1] ?? ''}`;
  return `${options.withYear === true ? `${year}年` : ''}${month}月${day}日 ${weekday}`;
}

/** 界面上的日期：“今天”“明天”“昨天”，其余为“10月24日 周六”；不在今年时带上年份。 */
export function describeLocalDate(date: LocalDate, today: LocalDate): string {
  const offset = daysBetween(today, date);
  if (offset === 0) {
    return '今天';
  }
  if (offset === 1) {
    return '明天';
  }
  if (offset === -1) {
    return '昨天';
  }
  return formatLocalDate(date, {
    withYear: parseLocalDate(date).year !== parseLocalDate(today).year,
  });
}

import { z } from 'zod';

import {
  clampedDate,
  daysBetween,
  daysInMonth,
  type LocalDate,
  makeLocalDate,
  parseLocalDate,
} from './dates';

export const importantDateKinds = ['birthday', 'anniversary', 'expiry', 'other'] as const;
export type ImportantDateKind = (typeof importantDateKinds)[number];

export const IMPORTANT_DATE_KIND_LABELS: Record<ImportantDateKind, string> = {
  birthday: '生日',
  anniversary: '纪念日',
  expiry: '到期日',
  other: '其他',
};

const yearSchema = z
  .number({ error: '请填写年份' })
  .int({ error: '年份应为整数' })
  .min(1900, { error: '年份应在 1900～2200 之间' })
  .max(2200, { error: '年份应在 1900～2200 之间' });

/**
 * 重要日期。`repeat = once` 时必须有 `year`；`yearly` 时 `year` 为 `null`。
 * `startYear` 用于显示年龄或第 N 周年。首期只支持公历。
 */
export const importantDateSchema = z
  .object({
    kind: z.enum(importantDateKinds),
    repeat: z.enum(['once', 'yearly']),
    year: yearSchema.nullable(),
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
    startYear: yearSchema.nullable(),
    showCounter: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if ((value.repeat === 'once') !== (value.year !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['year'],
        message: value.repeat === 'once' ? '请填写年份' : '每年重复的日期不需要年份',
      });
    }
    // 每年重复时允许 2 月 29 日（平年按 2 月 28 日）。
    const year = value.year ?? 2000;
    if (value.day > daysInMonth(year, value.month)) {
      ctx.addIssue({ code: 'custom', path: ['day'], message: '这个月没有这一天' });
    }
  });
export type ImportantDate = z.infer<typeof importantDateSchema>;

/** 在某一年的日期；2 月 29 日在平年取 2 月 28 日。 */
function dateInYear(value: ImportantDate, year: number): LocalDate {
  return clampedDate(year, value.month, value.day);
}

/** 第 N 年：生日即年龄，纪念日即第 N 周年；没有起始年份或尚未开始时为 `null`。 */
function counterFor(value: ImportantDate, date: LocalDate): number | null {
  if (value.startYear === null) {
    return null;
  }
  const counter = parseLocalDate(date).year - value.startYear;
  return counter >= 1 ? counter : null;
}

export interface ImportantDateOccurrence {
  date: LocalDate;
  daysUntil: number;
  counter: number | null;
}

/** 不早于 `today` 的下一次发生；仅一次的日期已过去时返回 `null`。 */
export function nextImportantDate(
  value: ImportantDate,
  today: LocalDate,
): ImportantDateOccurrence | null {
  let date: LocalDate;
  if (value.repeat === 'once') {
    date = makeLocalDate(value.year ?? 0, value.month, value.day);
    if (date < today) {
      return null;
    }
  } else {
    const year = parseLocalDate(today).year;
    date = dateInYear(value, year);
    if (date < today) {
      date = dateInYear(value, year + 1);
    }
  }
  return { date, daysUntil: daysBetween(today, date), counter: counterFor(value, date) };
}

/** `[from, to]` 区间内的全部发生日期。 */
export function importantDateOccurrences(
  value: ImportantDate,
  from: LocalDate,
  to: LocalDate,
): LocalDate[] {
  if (value.repeat === 'once') {
    const date = makeLocalDate(value.year ?? 0, value.month, value.day);
    return date >= from && date <= to ? [date] : [];
  }
  const dates: LocalDate[] = [];
  for (let year = parseLocalDate(from).year; year <= parseLocalDate(to).year; year += 1) {
    const date = dateInYear(value, year);
    if (date >= from && date <= to) {
      dates.push(date);
    }
  }
  return dates;
}

/** “还有 5 天”“今天”“明天”。 */
export function describeDaysUntil(daysUntil: number): string {
  if (daysUntil === 0) {
    return '今天';
  }
  if (daysUntil === 1) {
    return '明天';
  }
  return `还有 ${daysUntil} 天`;
}

/** “60 岁生日”“10 周年”；没有计数或不显示时返回 `null`。 */
export function describeCounter(
  kind: ImportantDateKind,
  counter: number | null,
): string | null {
  if (counter === null) {
    return null;
  }
  if (kind === 'birthday') {
    return `${counter} 岁生日`;
  }
  if (kind === 'anniversary') {
    return `${counter} 周年`;
  }
  return null;
}

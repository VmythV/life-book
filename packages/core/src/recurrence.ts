import { z } from 'zod';

import {
  addDays,
  clampedDate,
  daysBetween,
  type LocalDate,
  localDateSchema,
  parseLocalDate,
  weekdayOf,
} from './dates';
import { localTimeSchema } from './time';

export const recurrenceFreqs = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type RecurrenceFreq = (typeof recurrenceFreqs)[number];

export const MAX_RECURRENCE_COUNT = 1000;

export const recurrenceEndSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('never') }),
  z.object({ type: z.literal('until'), until: localDateSchema }),
  z.object({
    type: z.literal('count'),
    count: z
      .number({ error: '请填写次数' })
      .int({ error: '次数应为整数' })
      .min(1, { error: '次数至少为 1' })
      .max(MAX_RECURRENCE_COUNT, { error: `次数最多 ${MAX_RECURRENCE_COUNT}` }),
  }),
]);
export type RecurrenceEnd = z.infer<typeof recurrenceEndSchema>;

export const weekdaySchema = z.number().int().min(1).max(7);

/**
 * 重复规则。
 * - weekly 必须指定 `byWeekdays`（1 = 周一 ... 7 = 周日）；
 * - monthly 必须指定 `byMonthDay`，当月没有这一天时取当月最后一天；
 * - yearly 取 `startDate` 的月和日，2 月 29 日在平年取 2 月 28 日；
 * - 其他频率下这两个字段为 `null`。
 */
export const recurrenceRuleSchema = z
  .object({
    startDate: localDateSchema,
    freq: z.enum(recurrenceFreqs),
    interval: z
      .number({ error: '请填写间隔' })
      .int({ error: '间隔应为整数' })
      .min(1, { error: '间隔至少为 1' })
      .max(99, { error: '间隔最多 99' }),
    byWeekdays: z
      .array(weekdaySchema)
      .min(1, { error: '请选择星期几' })
      .max(7)
      .nullable(),
    byMonthDay: z
      .number({ error: '请填写每月几号' })
      .int()
      .min(1, { error: '每月几号应在 1～31 之间' })
      .max(31, { error: '每月几号应在 1～31 之间' })
      .nullable(),
    timeOfDay: localTimeSchema.nullable(),
    end: recurrenceEndSchema,
  })
  .superRefine((rule, ctx) => {
    if ((rule.freq === 'weekly') !== (rule.byWeekdays !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['byWeekdays'],
        message: rule.freq === 'weekly' ? '请选择星期几' : '只有每周重复时才能选择星期',
      });
    }
    if ((rule.freq === 'monthly') !== (rule.byMonthDay !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['byMonthDay'],
        message:
          rule.freq === 'monthly' ? '请选择每月几号' : '只有每月重复时才能选择日期',
      });
    }
    if (rule.end.type === 'until' && rule.end.until < rule.startDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['end'],
        message: '结束日期不能早于开始日期',
      });
    }
  })
  .transform((rule) => ({
    ...rule,
    byWeekdays:
      rule.byWeekdays === null
        ? null
        : [...new Set(rule.byWeekdays)].sort((a, b) => a - b),
  }));
export type RecurrenceRule = z.output<typeof recurrenceRuleSchema>;
export type RecurrenceRuleInput = z.input<typeof recurrenceRuleSchema>;

/** 第 `index` 个周期内、按时间顺序排列的候选日期（可能早于 startDate）。 */
function periodDates(rule: RecurrenceRule, index: number): LocalDate[] {
  const start = parseLocalDate(rule.startDate);
  const step = index * rule.interval;
  switch (rule.freq) {
    case 'daily':
      return [addDays(rule.startDate, step)];
    case 'weekly': {
      const monday = addDays(rule.startDate, 1 - weekdayOf(rule.startDate) + step * 7);
      return (rule.byWeekdays ?? []).map((weekday) => addDays(monday, weekday - 1));
    }
    case 'monthly': {
      const monthIndex = start.month - 1 + step;
      const year = start.year + Math.floor(monthIndex / 12);
      const month = (monthIndex % 12) + 1;
      return [clampedDate(year, month, rule.byMonthDay ?? start.day)];
    }
    case 'yearly':
      return [clampedDate(start.year + step, start.month, start.day)];
  }
}

/** 包含 `date` 的周期序号（向下取整，可能是负数）。 */
function periodIndexOf(rule: RecurrenceRule, date: LocalDate): number {
  const start = parseLocalDate(rule.startDate);
  const target = parseLocalDate(date);
  switch (rule.freq) {
    case 'daily':
      return Math.floor(daysBetween(rule.startDate, date) / rule.interval);
    case 'weekly': {
      const monday = addDays(rule.startDate, 1 - weekdayOf(rule.startDate));
      return Math.floor(daysBetween(monday, date) / (7 * rule.interval));
    }
    case 'monthly':
      return Math.floor(
        ((target.year - start.year) * 12 + target.month - start.month) / rule.interval,
      );
    case 'yearly':
      return Math.floor((target.year - start.year) / rule.interval);
  }
}

/**
 * 按时间顺序产生不早于 `from` 的发生日期，直到规则结束。
 * 按次数结束的规则必须从头计数；其他规则直接跳到 `from` 所在的周期。
 */
export function* occurrencesFrom(
  rule: RecurrenceRule,
  from: LocalDate,
): Generator<LocalDate> {
  let index = rule.end.type === 'count' ? 0 : Math.max(0, periodIndexOf(rule, from) - 1);
  let produced = 0;
  for (;;) {
    for (const date of periodDates(rule, index)) {
      if (date < rule.startDate) {
        continue;
      }
      if (rule.end.type === 'until' && date > rule.end.until) {
        return;
      }
      produced += 1;
      if (date >= from) {
        yield date;
      }
      if (rule.end.type === 'count' && produced >= rule.end.count) {
        return;
      }
    }
    index += 1;
  }
}

/** `[from, to]` 区间内的全部发生日期。 */
export function expandOccurrences(
  rule: RecurrenceRule,
  from: LocalDate,
  to: LocalDate,
): LocalDate[] {
  const dates: LocalDate[] = [];
  for (const date of occurrencesFrom(rule, from)) {
    if (date > to) {
      break;
    }
    dates.push(date);
  }
  return dates;
}

/** 不早于 `date` 的下一次发生日期；规则已结束时返回 `null`。 */
export function nextOccurrence(rule: RecurrenceRule, date: LocalDate): LocalDate | null {
  const next = occurrencesFrom(rule, date).next();
  return next.done === true ? null : next.value;
}

/** 某天是否是规则的一次发生。 */
export function isOccurrenceDate(rule: RecurrenceRule, date: LocalDate): boolean {
  return nextOccurrence(rule, date) === date;
}

const WEEKDAY_NAMES = ['一', '二', '三', '四', '五', '六', '日'];

export function weekdayName(weekday: number): string {
  return `周${WEEKDAY_NAMES[weekday - 1] ?? ''}`;
}

/** 用中文描述规则，如“每天”“每 2 周的周一、周四”“每月 31 日”。 */
export function describeRecurrence(rule: RecurrenceRule): string {
  const every = (unit: string) => `每 ${rule.interval} ${unit}`;
  const start = parseLocalDate(rule.startDate);
  let text: string;
  switch (rule.freq) {
    case 'daily':
      text = rule.interval === 1 ? '每天' : `每 ${rule.interval} 天`;
      break;
    case 'weekly': {
      const days = (rule.byWeekdays ?? []).map(weekdayName).join('、');
      text = rule.interval === 1 ? `每${days}` : `${every('周')}的${days}`;
      break;
    }
    case 'monthly': {
      const day = `${rule.byMonthDay ?? start.day} 日`;
      text = rule.interval === 1 ? `每月 ${day}` : `${every('个月')}的 ${day}`;
      break;
    }
    case 'yearly': {
      const day = `${start.month} 月 ${start.day} 日`;
      text = rule.interval === 1 ? `每年 ${day}` : `${every('年')}的 ${day}`;
      break;
    }
  }
  if (rule.timeOfDay !== null) {
    text += ` ${rule.timeOfDay}`;
  }
  if (rule.end.type === 'until') {
    text += `，到 ${rule.end.until} 为止`;
  } else if (rule.end.type === 'count') {
    text += `，共 ${rule.end.count} 次`;
  }
  return text;
}

import { z } from 'zod';

import { addDays, daysBetween, type LocalDate, localDateSchema } from './dates';
import { expandOccurrences, nextOccurrence, type RecurrenceRule } from './recurrence';

/** “仅本次改期”最多移动的天数。 */
export const MAX_RESCHEDULE_DAYS = 60;

/**
 * 已保存的周期实例，键是**原定日期**。
 * - `pending`：只在改期后出现，表示移到了 `rescheduledTo`、还没处理；
 * - `completed` / `skipped`：已处理，可能同时带着改期后的日期。
 */
export interface StoredOccurrence {
  status: 'pending' | 'completed' | 'skipped';
  rescheduledTo: LocalDate | null;
}

export interface EffectiveOccurrence {
  /** 规则算出的原定日期，完成、跳过、改期等操作都用它。 */
  originalDate: LocalDate;
  /** 实际日期：改期后的日期，没有改期就是原定日期。 */
  date: LocalDate;
  stored: StoredOccurrence | undefined;
}

/**
 * `[from, to]` 区间内按实际日期出现的实例。
 * 原定日期在区间外、但改期到区间内的也算；改期到区间外的则不算。
 */
export function effectiveOccurrences(
  rule: RecurrenceRule,
  stored: ReadonlyMap<LocalDate, StoredOccurrence>,
  from: LocalDate,
  to: LocalDate,
): EffectiveOccurrence[] {
  return expandOccurrences(
    rule,
    addDays(from, -MAX_RESCHEDULE_DAYS),
    addDays(to, MAX_RESCHEDULE_DAYS),
  )
    .map((originalDate) => {
      const entry = stored.get(originalDate);
      return { originalDate, date: entry?.rescheduledTo ?? originalDate, stored: entry };
    })
    .filter((occurrence) => occurrence.date >= from && occurrence.date <= to)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.originalDate.localeCompare(b.originalDate),
    );
}

/** 已完成或已跳过。 */
export function isHandled(stored: StoredOccurrence | undefined): boolean {
  return stored !== undefined && stored.status !== 'pending';
}

export const rescheduleRequestSchema = z.object({ to: localDateSchema });
export type RescheduleRequest = z.input<typeof rescheduleRequestSchema>;

/** 改期的合法性：不能超出范围；返回错误信息，合法时返回 `null`。 */
export function rescheduleIssue(originalDate: LocalDate, to: LocalDate): string | null {
  if (Math.abs(daysBetween(originalDate, to)) > MAX_RESCHEDULE_DAYS) {
    return `最多改到前后 ${MAX_RESCHEDULE_DAYS} 天`;
  }
  return null;
}

/**
 * 从今天起下一次待完成的实际日期：考虑改期，跳过已完成和已跳过的实例。
 * 改期最多 60 天，所以先在 `[today, today + 60]` 内找，找不到再按规则往后找。
 */
export function nextPendingOccurrence(
  rule: RecurrenceRule,
  stored: ReadonlyMap<LocalDate, StoredOccurrence>,
  today: LocalDate,
): LocalDate | null {
  const until = addDays(today, MAX_RESCHEDULE_DAYS);
  const pending = effectiveOccurrences(rule, stored, today, until).find(
    (occurrence) => !isHandled(occurrence.stored),
  );
  return pending?.date ?? nextOccurrence(rule, addDays(until, 1));
}

/**
 * 详情页“最近”要显示的实例：今天及以前的全部，加上之后最近 `upcomingDays` 个日期的。
 * 按日期而不是条数截取，改期后同一天的两次都会显示。`items` 须按日期升序。
 */
export function recentOccurrences<TItem extends { date: LocalDate }>(
  items: readonly TItem[],
  today: LocalDate,
  upcomingDays = 3,
): TItem[] {
  const upcoming = items.filter((item) => item.date > today);
  const lastDate = [...new Set(upcoming.map((item) => item.date))]
    .slice(0, upcomingDays)
    .at(-1);
  return [
    ...items.filter((item) => item.date <= today),
    ...upcoming.filter((item) => lastDate !== undefined && item.date <= lastDate),
  ];
}

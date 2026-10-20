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
 * 下一次待完成的实际日期。`listed` 是 `[today, listedUntil]` 内已经查到的实例（含改期和处理状态）；
 * 区间内没有待完成的，再按规则往后找。
 */
export function nextPendingDate(
  rule: RecurrenceRule,
  listed: readonly { date: LocalDate; status: string }[] | undefined,
  today: LocalDate,
  listedUntil: LocalDate,
): LocalDate | null {
  if (listed === undefined) {
    return nextOccurrence(rule, today);
  }
  const pending = listed.find((item) => item.date >= today && item.status === 'pending');
  return pending?.date ?? nextOccurrence(rule, addDays(listedUntil, 1));
}

import { z } from 'zod';

import { isChecklistComplete } from './checklists';
import { addDays, type LocalDate, localDateSchema, zonedDateTime } from './dates';
import {
  type ImportantDate,
  importantDateKinds,
  nextImportantDate,
} from './important-dates';
import { type OccurrenceStatus, occurrenceStatuses } from './records';
import { effectiveOccurrences, isHandled, type StoredOccurrence } from './occurrences';
import { type RecurrenceRule } from './recurrence';
import { localTimeSchema } from './time';

/** 逾期最多回看的天数。 */
export const OVERDUE_LOOKBACK_DAYS = 30;
/** “今天”展示未来几天内的重要日期。 */
export const UPCOMING_DATES_DAYS = 7;

/** 周期实例的状态：已处理的直接返回；未处理且实际日期早于今天即逾期。 */
export function occurrenceStatus(
  date: LocalDate,
  stored: StoredOccurrence | undefined,
  today: LocalDate,
): OccurrenceStatus {
  if (stored !== undefined && stored.status !== 'pending') {
    return stored.status;
  }
  return date < today ? 'overdue' : 'pending';
}

export const occurrenceCardSchema = z.object({
  kind: z.literal('occurrence'),
  recordId: z.uuid(),
  title: z.string(),
  /** 实际日期；改期后是新的日期。 */
  date: localDateSchema,
  /** 原定日期，完成、跳过、改期都用它。 */
  originalDate: localDateSchema,
  time: localTimeSchema.nullable(),
  status: z.enum(occurrenceStatuses),
  /** 逾期卡片：除这一次外还有几次未处理。 */
  moreCount: z.number().int().min(0),
});
export type OccurrenceCard = z.infer<typeof occurrenceCardSchema>;

export const memoReminderCardSchema = z.object({
  kind: z.literal('memo_reminder'),
  recordId: z.uuid(),
  title: z.string(),
  reminderId: z.uuid(),
  fireAt: z.iso.datetime({ offset: true }),
  time: localTimeSchema,
});
export type MemoReminderCard = z.infer<typeof memoReminderCardSchema>;

export const importantDateCardSchema = z.object({
  kind: z.literal('important_date'),
  recordId: z.uuid(),
  title: z.string(),
  dateKind: z.enum(importantDateKinds),
  date: localDateSchema,
  daysUntil: z.number().int().min(0),
  counter: z.number().int().nullable(),
});
export type ImportantDateCard = z.infer<typeof importantDateCardSchema>;

/** 截止日期在今天（或已过期）的清单。 */
export const checklistCardSchema = z.object({
  kind: z.literal('checklist'),
  recordId: z.uuid(),
  title: z.string(),
  date: localDateSchema,
  time: localTimeSchema,
  dueAt: z.iso.datetime({ offset: true }),
  done: z.number().int().min(0),
  total: z.number().int().min(0),
});
export type ChecklistCard = z.infer<typeof checklistCardSchema>;

export const overdueCardSchema = z.discriminatedUnion('kind', [
  occurrenceCardSchema,
  checklistCardSchema,
]);
export type OverdueCard = z.infer<typeof overdueCardSchema>;

export const todayCardSchema = z.discriminatedUnion('kind', [
  occurrenceCardSchema,
  memoReminderCardSchema,
  checklistCardSchema,
]);
export type TodayCard = z.infer<typeof todayCardSchema>;

/** 低库存的家庭物品。 */
export const lowStockCardSchema = z.object({
  kind: z.literal('low_stock'),
  recordId: z.uuid(),
  title: z.string(),
  quantity: z.number(),
  unit: z.string(),
  threshold: z.number(),
  location: z.string().nullable(),
});
export type LowStockCard = z.infer<typeof lowStockCardSchema>;

export const todayQuerySchema = z.object({ date: localDateSchema.optional() });

export const todayResponseSchema = z.object({
  date: localDateSchema,
  overdue: z.array(overdueCardSchema),
  today: z.array(todayCardSchema),
  upcomingDates: z.array(importantDateCardSchema),
  lowStock: z.array(lowStockCardSchema),
});
export type TodayResponse = z.infer<typeof todayResponseSchema>;

export interface TodayInput {
  date: LocalDate;
  timeZone: string;
  recurring: {
    recordId: string;
    title: string;
    rule: RecurrenceRule;
    /** 已保存的实例（按原定日期），包括已处理和改期的。 */
    stored: ReadonlyMap<LocalDate, StoredOccurrence>;
  }[];
  importantDates: {
    recordId: string;
    title: string;
    value: ImportantDate;
  }[];
  /** 有截止时间的清单。 */
  checklists: {
    recordId: string;
    title: string;
    dueAt: Date;
    done: number;
    total: number;
  }[];
  /** 低库存的家庭物品。 */
  lowStock: Omit<LowStockCard, 'kind'>[];
  /** 启用的绝对时刻提醒（备忘）。 */
  memoReminders: {
    recordId: string;
    title: string;
    reminderId: string;
    fireAt: Date;
  }[];
}

/** 汇总“今天”：逾期（同一事项合并）、今天的实例、清单和备忘提醒、近期重要日期、低库存。 */
export function buildToday(input: TodayInput): TodayResponse {
  const overdue: OverdueCard[] = [];
  const today: TodayCard[] = [];

  for (const item of input.recurring) {
    const recent = effectiveOccurrences(
      item.rule,
      item.stored,
      addDays(input.date, -OVERDUE_LOOKBACK_DAYS),
      input.date,
    );
    const missed = recent.filter(
      (occurrence) => occurrence.date < input.date && !isHandled(occurrence.stored),
    );
    const latest = missed.at(-1);
    if (latest !== undefined) {
      overdue.push({
        kind: 'occurrence',
        recordId: item.recordId,
        title: item.title,
        date: latest.date,
        originalDate: latest.originalDate,
        time: item.rule.timeOfDay,
        status: 'overdue',
        moreCount: missed.length - 1,
      });
    }
    // 改期到今天的实例和今天原本的实例都会出现。
    for (const occurrence of recent.filter((entry) => entry.date === input.date)) {
      today.push({
        kind: 'occurrence',
        recordId: item.recordId,
        title: item.title,
        date: occurrence.date,
        originalDate: occurrence.originalDate,
        time: item.rule.timeOfDay,
        status: occurrenceStatus(occurrence.date, occurrence.stored, input.date),
        moreCount: 0,
      });
    }
  }

  const lookbackStart = addDays(input.date, -OVERDUE_LOOKBACK_DAYS);
  for (const checklist of input.checklists) {
    const local = zonedDateTime(checklist.dueAt, input.timeZone);
    const card: ChecklistCard = {
      kind: 'checklist',
      recordId: checklist.recordId,
      title: checklist.title,
      date: local.date,
      time: local.time,
      dueAt: checklist.dueAt.toISOString(),
      done: checklist.done,
      total: checklist.total,
    };
    if (local.date === input.date) {
      today.push(card);
    } else if (
      !isChecklistComplete(checklist.done, checklist.total) &&
      local.date < input.date &&
      local.date >= lookbackStart
    ) {
      overdue.push(card);
    }
  }

  for (const reminder of input.memoReminders) {
    const local = zonedDateTime(reminder.fireAt, input.timeZone);
    if (local.date === input.date) {
      today.push({
        kind: 'memo_reminder',
        recordId: reminder.recordId,
        title: reminder.title,
        reminderId: reminder.reminderId,
        fireAt: reminder.fireAt.toISOString(),
        time: local.time,
      });
    }
  }

  const upcomingDates: ImportantDateCard[] = [];
  for (const item of input.importantDates) {
    const next = nextImportantDate(item.value, input.date);
    if (next !== null && next.daysUntil <= UPCOMING_DATES_DAYS) {
      upcomingDates.push({
        kind: 'important_date',
        recordId: item.recordId,
        title: item.title,
        dateKind: item.value.kind,
        date: next.date,
        daysUntil: next.daysUntil,
        counter: item.value.showCounter ? next.counter : null,
      });
    }
  }

  overdue.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  // 全天的事项排在前面，其余按时刻。
  today.sort(
    (a, b) =>
      (a.time ?? '').localeCompare(b.time ?? '') || a.title.localeCompare(b.title),
  );
  upcomingDates.sort(
    (a, b) => a.daysUntil - b.daysUntil || a.title.localeCompare(b.title),
  );

  const lowStock: LowStockCard[] = input.lowStock
    .map((item) => ({ kind: 'low_stock' as const, ...item }))
    .sort((a, b) => a.title.localeCompare(b.title));

  return { date: input.date, overdue, today, upcomingDates, lowStock };
}

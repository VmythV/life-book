import { z } from 'zod';

import {
  addDays,
  type LocalDate,
  localDateSchema,
  todayIn,
  zonedDateTime,
  zonedTimeToInstant,
} from './dates';
import { type ImportantDate, importantDateOccurrences } from './important-dates';
import { recordTypeSchema, type RecordType } from './record-types';
import { effectiveOccurrences, isHandled, type StoredOccurrence } from './occurrences';
import { type RecurrenceRule } from './recurrence';
import { localTimeSchema } from './time';

/**
 * 提醒。
 * - `absolute`：具体时刻，用于备忘；
 * - `relative`：相对每次发生日提前几天、几点，用于重复日常和重要日期。
 *   `timeOfDay` 为空时取重复规则的时刻，再取用户的默认提醒时间。
 */
export const reminderInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('absolute'),
    fireAt: z.iso.datetime({ offset: true, error: '请填写提醒的日期和时间' }),
  }),
  z.object({
    kind: z.literal('relative'),
    daysBefore: z
      .number({ error: '请填写提前几天' })
      .int()
      .min(0, { error: '提前天数不能为负' })
      .max(365, { error: '最多提前 365 天' }),
    timeOfDay: localTimeSchema.nullable(),
  }),
]);
export type ReminderInput = z.infer<typeof reminderInputSchema>;

export const MAX_REMINDERS_PER_RECORD = 10;

export const reminderSchema = z.intersection(
  z.object({ id: z.uuid(), enabled: z.boolean() }),
  reminderInputSchema,
);
export type Reminder = z.infer<typeof reminderSchema>;

/** 每个提醒时刻的唯一键，手机端直接用作通知 ID。 */
export function reminderKey(
  reminderId: string,
  occurrenceDate: LocalDate | null,
): string {
  return `${reminderId}:${occurrenceDate ?? 'once'}`;
}

export const upcomingReminderSchema = z.object({
  key: z.string(),
  /** 低库存提醒没有对应的提醒设置，为 `null`。 */
  reminderId: z.uuid().nullable(),
  recordId: z.uuid(),
  recordType: recordTypeSchema,
  title: z.string(),
  fireAt: z.iso.datetime({ offset: true }),
  /** 对应的实际发生日期（改期后的日期）；绝对时刻的提醒为 `null`。 */
  occurrenceDate: localDateSchema.nullable(),
  /** 重复日常的原定日期，用于“完成”等操作；改期前后不变。其他提醒为 `null`。 */
  originalDate: localDateSchema.nullable(),
});
export type UpcomingReminder = z.infer<typeof upcomingReminderSchema>;

export const upcomingRemindersQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(30).default(7),
});

export const upcomingRemindersResponseSchema = z.object({
  items: z.array(upcomingReminderSchema),
});
export type UpcomingRemindersResponse = z.infer<typeof upcomingRemindersResponseSchema>;

export interface ReminderSource {
  recordId: string;
  recordType: RecordType;
  title: string;
  /** 只传入启用的提醒。 */
  reminders: Reminder[];
  recurring: RecurrenceRule | null;
  /** 重复日常已保存的实例（按原定日期）：已处理的不再提醒，改期的按新日期提醒。 */
  stored: ReadonlyMap<LocalDate, StoredOccurrence>;
  importantDate: ImportantDate | null;
  /** 已全部完成的清单不再提醒。 */
  finished: boolean;
}

export interface ReminderWindow {
  now: Date;
  until: Date;
  timeZone: string;
  defaultReminderTime: string;
}

/** `[now, until]` 之间的全部提醒时刻，按时间排序。 */
export function computeUpcomingReminders(
  sources: ReminderSource[],
  window: ReminderWindow,
): UpcomingReminder[] {
  const today = todayIn(window.timeZone, window.now);
  const lastDay = zonedDateTime(window.until, window.timeZone).date;
  const items: UpcomingReminder[] = [];
  const inWindow = (fireAt: Date) =>
    fireAt.getTime() >= window.now.getTime() &&
    fireAt.getTime() <= window.until.getTime();

  for (const source of sources) {
    if (source.finished) {
      continue;
    }
    for (const reminder of source.reminders) {
      const base = {
        reminderId: reminder.id,
        recordId: source.recordId,
        recordType: source.recordType,
        title: source.title,
      };
      if (reminder.kind === 'absolute') {
        const fireAt = new Date(reminder.fireAt);
        if (inWindow(fireAt)) {
          items.push({
            ...base,
            key: reminderKey(reminder.id, null),
            fireAt: fireAt.toISOString(),
            occurrenceDate: null,
            originalDate: null,
          });
        }
        continue;
      }
      const from = addDays(today, reminder.daysBefore);
      const to = addDays(lastDay, reminder.daysBefore);
      // 每次发生：实际日期决定提醒时间，原定日期用作通知的键，改期后同一个通知会被替换。
      let dates: { date: LocalDate; originalDate: LocalDate | null }[] = [];
      if (source.recurring !== null) {
        dates = effectiveOccurrences(source.recurring, source.stored, from, to)
          .filter((occurrence) => !isHandled(occurrence.stored))
          .map((occurrence) => ({
            date: occurrence.date,
            originalDate: occurrence.originalDate,
          }));
      } else if (source.importantDate !== null) {
        dates = importantDateOccurrences(source.importantDate, from, to).map((date) => ({
          date,
          originalDate: null,
        }));
      }
      const time =
        reminder.timeOfDay ?? source.recurring?.timeOfDay ?? window.defaultReminderTime;
      for (const { date, originalDate } of dates) {
        const fireAt = zonedTimeToInstant(
          addDays(date, -reminder.daysBefore),
          time,
          window.timeZone,
        );
        if (inWindow(fireAt)) {
          items.push({
            ...base,
            key: reminderKey(reminder.id, originalDate ?? date),
            fireAt: fireAt.toISOString(),
            occurrenceDate: date,
            originalDate,
          });
        }
      }
    }
  }
  return items.sort(
    (a, b) => a.fireAt.localeCompare(b.fireAt) || a.key.localeCompare(b.key),
  );
}

/** “提前 1 天 09:00”“当天”。 */
export function describeReminder(reminder: ReminderInput, timeZone: string): string {
  if (reminder.kind === 'absolute') {
    const { date, time } = zonedDateTime(new Date(reminder.fireAt), timeZone);
    return `${date} ${time}`;
  }
  const day = reminder.daysBefore === 0 ? '当天' : `提前 ${reminder.daysBefore} 天`;
  return reminder.timeOfDay === null ? day : `${day} ${reminder.timeOfDay}`;
}

/** 低库存提醒的键：同一次低库存只对应一个通知。 */
export function lowStockReminderKey(recordId: string, since: Date): string {
  return `lowstock:${recordId}:${since.toISOString()}`;
}

/**
 * 还没提醒过的低库存，各提醒一次：时间取低库存开始的时刻，已经过去的就是现在。
 * 手机排好通知后会告诉服务端，之后不再返回。
 */
export function computeLowStockAlerts(
  items: { recordId: string; title: string; lowStockSince: Date }[],
  now: Date,
): UpcomingReminder[] {
  return items.map((item) => ({
    key: lowStockReminderKey(item.recordId, item.lowStockSince),
    reminderId: null,
    recordId: item.recordId,
    recordType: 'household_item',
    title: item.title,
    fireAt: new Date(Math.max(item.lowStockSince.getTime(), now.getTime())).toISOString(),
    occurrenceDate: null,
    originalDate: null,
  }));
}

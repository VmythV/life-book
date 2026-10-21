import { z } from 'zod';

import {
  addDays,
  clampedDate,
  daysBetween,
  daysInMonth,
  type LocalDate,
  localDateSchema,
  makeLocalDate,
  parseLocalDate,
  weekdayOf,
  zonedDateTime,
} from './dates';
import {
  importantDateKinds,
  importantDateOccurrences,
  nextImportantDate,
} from './important-dates';
import { effectiveOccurrences } from './occurrences';
import { type RecordType } from './record-types';
import {
  checklistCardSchema,
  memoReminderCardSchema,
  occurrenceCardSchema,
  occurrenceStatus,
  type TodayInput,
} from './today';

/** 日历一次最多查询的天数；月视图最多 6 周，即 42 天。 */
export const MAX_CALENDAR_DAYS = 62;

export const calendarViews = ['day', 'week', 'month'] as const;
export type CalendarView = (typeof calendarViews)[number];

export const CALENDAR_VIEW_LABELS: Record<CalendarView, string> = {
  day: '日',
  week: '周',
  month: '月',
};

/** 周一为一周的第一天。 */
export const WEEKDAY_HEADERS = ['一', '二', '三', '四', '五', '六', '日'] as const;

export const calendarQuerySchema = z
  .object({ from: localDateSchema, to: localDateSchema })
  .refine((range) => range.from <= range.to, { message: '开始日期不能晚于结束日期' })
  .refine((range) => daysBetween(range.from, range.to) < MAX_CALENDAR_DAYS, {
    message: `一次最多查询 ${MAX_CALENDAR_DAYS} 天`,
  });
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;

/** 某一天的重要日期；和“今天”里的卡片不同，日期可以已经过去，所以不带“还有几天”。 */
export const calendarImportantDateSchema = z.object({
  kind: z.literal('important_date'),
  recordId: z.uuid(),
  title: z.string(),
  dateKind: z.enum(importantDateKinds),
  date: localDateSchema,
  counter: z.number().int().nullable(),
});
export type CalendarImportantDate = z.infer<typeof calendarImportantDateSchema>;

/** 备忘提醒；“今天”里的卡片不需要日期，日历里要按日期分组。 */
export const calendarMemoReminderSchema = memoReminderCardSchema.extend({
  date: localDateSchema,
});
export type CalendarMemoReminder = z.infer<typeof calendarMemoReminderSchema>;

export const calendarItemSchema = z.discriminatedUnion('kind', [
  occurrenceCardSchema,
  calendarMemoReminderSchema,
  checklistCardSchema,
  calendarImportantDateSchema,
]);
export type CalendarItem = z.infer<typeof calendarItemSchema>;

export const calendarResponseSchema = z.object({
  from: localDateSchema,
  to: localDateSchema,
  /** 用户时区的今天，客户端用它标出今天和判断逾期。 */
  today: localDateSchema,
  /** 按日期排序；同一天里全天的在前，其余按时刻。 */
  items: z.array(calendarItemSchema),
});
export type CalendarResponse = z.infer<typeof calendarResponseSchema>;

export type CalendarInput = Pick<
  TodayInput,
  'timeZone' | 'recurring' | 'importantDates' | 'checklists' | 'memoReminders'
> & {
  from: LocalDate;
  to: LocalDate;
  today: LocalDate;
};

/** 事项的时刻；全天的（重要日期、没有时刻的重复日常）为 `null`。 */
export function calendarItemTime(item: CalendarItem): string | null {
  return item.kind === 'important_date' ? null : item.time;
}

/** 事项对应的记录类型，用于显示“重复日常”“备忘”等标签。 */
export function calendarItemRecordType(item: CalendarItem): RecordType {
  switch (item.kind) {
    case 'occurrence':
      return 'recurring';
    case 'memo_reminder':
      return 'memo';
    case 'checklist':
      return 'checklist';
    case 'important_date':
      return 'important_date';
  }
}

/** 列表里的 React key：同一条重复日常改期后同一天可能出现两次，用原定日期区分。 */
export function calendarItemKey(item: CalendarItem): string {
  switch (item.kind) {
    case 'occurrence':
      return `${item.recordId}:${item.originalDate}`;
    case 'memo_reminder':
      return item.reminderId;
    case 'checklist':
      return item.recordId;
    case 'important_date':
      return `${item.recordId}:${item.date}`;
  }
}

/** 汇总 `[from, to]` 内每天的事项：重复日常的实例（考虑改期）、重要日期、清单截止和备忘提醒。 */
export function buildCalendar(input: CalendarInput): CalendarResponse {
  const items: CalendarItem[] = [];
  const inRange = (date: LocalDate) => date >= input.from && date <= input.to;

  for (const item of input.recurring) {
    for (const occurrence of effectiveOccurrences(
      item.rule,
      item.stored,
      input.from,
      input.to,
    )) {
      items.push({
        kind: 'occurrence',
        recordId: item.recordId,
        title: item.title,
        date: occurrence.date,
        originalDate: occurrence.originalDate,
        time: item.rule.timeOfDay,
        status: occurrenceStatus(occurrence.date, occurrence.stored, input.today),
        moreCount: 0,
      });
    }
  }

  for (const item of input.importantDates) {
    for (const date of importantDateOccurrences(item.value, input.from, input.to)) {
      items.push({
        kind: 'important_date',
        recordId: item.recordId,
        title: item.title,
        dateKind: item.value.kind,
        date,
        counter: item.value.showCounter
          ? (nextImportantDate(item.value, date)?.counter ?? null)
          : null,
      });
    }
  }

  for (const checklist of input.checklists) {
    const local = zonedDateTime(checklist.dueAt, input.timeZone);
    if (inRange(local.date)) {
      items.push({
        kind: 'checklist',
        recordId: checklist.recordId,
        title: checklist.title,
        date: local.date,
        time: local.time,
        dueAt: checklist.dueAt.toISOString(),
        done: checklist.done,
        total: checklist.total,
      });
    }
  }

  for (const reminder of input.memoReminders) {
    const local = zonedDateTime(reminder.fireAt, input.timeZone);
    if (inRange(local.date)) {
      items.push({
        kind: 'memo_reminder',
        recordId: reminder.recordId,
        title: reminder.title,
        reminderId: reminder.reminderId,
        date: local.date,
        fireAt: reminder.fireAt.toISOString(),
        time: local.time,
      });
    }
  }

  items.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (calendarItemTime(a) ?? '').localeCompare(calendarItemTime(b) ?? '') ||
      a.title.localeCompare(b.title),
  );
  return { from: input.from, to: input.to, today: input.today, items };
}

// ---- 视图的日期范围 ----

/** 所在这一周的周一。 */
export function startOfWeek(date: LocalDate): LocalDate {
  return addDays(date, 1 - weekdayOf(date));
}

/** 视图要显示的日期：日视图是当天，周视图是周一到周日，月视图是覆盖整月的几个整周。 */
export function calendarRange(
  view: CalendarView,
  anchor: LocalDate,
): { from: LocalDate; to: LocalDate } {
  if (view === 'day') {
    return { from: anchor, to: anchor };
  }
  if (view === 'week') {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 6) };
  }
  const { year, month } = parseLocalDate(anchor);
  const last = makeLocalDate(year, month, daysInMonth(year, month));
  return {
    from: startOfWeek(makeLocalDate(year, month, 1)),
    to: addDays(startOfWeek(last), 6),
  };
}

/** 上一页或下一页的锚点日期；月视图换到相邻月份的同一天，没有这一天时取月末。 */
export function shiftCalendarAnchor(
  view: CalendarView,
  anchor: LocalDate,
  step: -1 | 1,
): LocalDate {
  if (view === 'day') {
    return addDays(anchor, step);
  }
  if (view === 'week') {
    return addDays(anchor, 7 * step);
  }
  const { year, month, day } = parseLocalDate(anchor);
  const index = year * 12 + (month - 1) + step;
  return clampedDate(Math.floor(index / 12), (index % 12) + 1, day);
}

/** `[from, to]` 内的每一天。 */
export function datesBetween(from: LocalDate, to: LocalDate): LocalDate[] {
  return Array.from({ length: daysBetween(from, to) + 1 }, (_, index) =>
    addDays(from, index),
  );
}

/**
 * 视图标题：“2026年10月”“2026年10月19日 - 25日”；日视图是“2026年10月21日 今天”，
 * 不是今天、明天、昨天时用星期，如“2026年10月24日 周六”。
 */
export function describeCalendarRange(
  view: CalendarView,
  anchor: LocalDate,
  today: LocalDate,
): string {
  const { year, month, day } = parseLocalDate(anchor);
  if (view === 'month') {
    return `${year}年${month}月`;
  }
  if (view === 'day') {
    const offset = daysBetween(today, anchor);
    const relative =
      offset === 0
        ? '今天'
        : offset === 1
          ? '明天'
          : offset === -1
            ? '昨天'
            : `周${WEEKDAY_HEADERS[weekdayOf(anchor) - 1] ?? ''}`;
    return `${year}年${month}月${day}日 ${relative}`;
  }
  const range = calendarRange('week', anchor);
  const from = parseLocalDate(range.from);
  const to = parseLocalDate(range.to);
  if (from.year !== to.year) {
    return `${from.year}年${from.month}月${from.day}日 - ${to.year}年${to.month}月${to.day}日`;
  }
  if (from.month !== to.month) {
    return `${from.year}年${from.month}月${from.day}日 - ${to.month}月${to.day}日`;
  }
  return `${from.year}年${from.month}月${from.day}日 - ${to.day}日`;
}

/** 月视图格子里的日期：每月 1 日和整张表的第一格写上月份，如“10月1日”，其余只写几号。 */
export function describeMonthCellDate(date: LocalDate, isFirstCell: boolean): string {
  const { month, day } = parseLocalDate(date);
  return day === 1 || isFirstCell ? `${month}月${day}日` : String(day);
}

// ---- 时间轴 ----

/** 事项只有时刻、没有时长：在日视图和周视图的时间轴上按 30 分钟画一块。 */
export const CALENDAR_BLOCK_MINUTES = 30;

/** “HH:mm”是一天中的第几分钟。 */
export function minutesOfDay(time: string): number {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return hour * 60 + minute;
}

export interface TimedBlock {
  item: CalendarItem;
  /** 开始于一天中的第几分钟。 */
  start: number;
  /** 和它重叠的几块并排时，它在第几列（从 0 开始），一共几列。 */
  column: number;
  columns: number;
}

/**
 * 一天里定时事项在时间轴上的位置。每块占 `blockMinutes`，互相重叠的并排显示：
 * 连在一起重叠的一组共用列数，每块放进最左边空着的那一列。全天事项不在其中。
 */
export function layoutTimedItems(
  items: readonly CalendarItem[],
  blockMinutes = CALENDAR_BLOCK_MINUTES,
): TimedBlock[] {
  const timed = items
    .flatMap((item) => {
      const time = calendarItemTime(item);
      return time === null ? [] : [{ item, start: minutesOfDay(time) }];
    })
    .sort((a, b) => a.start - b.start);
  const blocks: TimedBlock[] = [];
  let group: TimedBlock[] = [];
  let groupEnd = -1;
  // 每一列最后一块的结束时刻。
  let columnEnds: number[] = [];
  const closeGroup = () => {
    for (const block of group) {
      block.columns = columnEnds.length;
    }
    blocks.push(...group);
    group = [];
    columnEnds = [];
  };
  for (const { item, start } of timed) {
    if (start >= groupEnd) {
      closeGroup();
    }
    let column = columnEnds.findIndex((end) => end <= start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(0);
    }
    columnEnds[column] = start + blockMinutes;
    groupEnd = Math.max(groupEnd, start + blockMinutes);
    group.push({ item, start, column, columns: 0 });
  }
  closeGroup();
  return blocks;
}

/** 事项是否已经过去：早于今天的；今天的定时事项时刻早于现在的。全天事项当天不算过去。 */
export function isPastCalendarItem(
  item: CalendarItem,
  today: LocalDate,
  nowTime: string,
): boolean {
  if (item.date !== today) {
    return item.date < today;
  }
  const time = calendarItemTime(item);
  return time !== null && time < nowTime;
}

/** 已完成或已跳过的周期实例。 */
export function isHandledCalendarItem(item: CalendarItem): boolean {
  return (
    item.kind === 'occurrence' &&
    (item.status === 'completed' || item.status === 'skipped')
  );
}

/** 按日期分组，保持每天内的顺序。 */
export function groupCalendarItems(
  items: readonly CalendarItem[],
): Map<LocalDate, CalendarItem[]> {
  const groups = new Map<LocalDate, CalendarItem[]>();
  for (const item of items) {
    const group = groups.get(item.date) ?? [];
    group.push(item);
    groups.set(item.date, group);
  }
  return groups;
}

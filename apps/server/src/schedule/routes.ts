import {
  addDays,
  buildCalendar,
  buildToday,
  calendarQuerySchema,
  OVERDUE_LOOKBACK_DAYS,
  computeLowStockAlerts,
  checklistProgress,
  computeUpcomingReminders,
  displayTitle,
  MAX_RESCHEDULE_DAYS,
  type StoredOccurrence,
  type LifeRecord,
  type LocalDate,
  todayIn,
  todayQuerySchema,
  type TodayInput,
  upcomingRemindersQuerySchema,
  type UpcomingRemindersResponse,
} from '@life-book/core';
import { and, eq, gte, inArray, isNotNull, isNull } from 'drizzle-orm';
import { Hono } from 'hono';

import { requireAuth } from '../auth/middleware';
import { type Executor } from '../db/client';
import { householdItems, occurrences, records } from '../db/schema';
import { type AppDeps, type AppEnv } from '../http/context';
import { readQuery } from '../http/validate';
import { loadRecords } from '../records/repository';
import { loadSettings } from '../users/settings';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 参与“今天”和提醒计算的记录：未删除、未归档的重复日常、重要日期、备忘、清单和家庭物品。 */
async function loadScheduleRecords(
  db: Executor,
  userId: string,
  /** 从这一天（按原定日期）开始读取已保存的实例。 */
  storedFrom: LocalDate,
  now: Date,
): Promise<{
  items: LifeRecord[];
  stored: Map<string, Map<LocalDate, StoredOccurrence>>;
}> {
  const rows = await db
    .select({ id: records.id })
    .from(records)
    .where(
      and(
        eq(records.userId, userId),
        isNull(records.deletedAt),
        isNull(records.archivedAt),
        inArray(records.type, [
          'recurring',
          'important_date',
          'memo',
          'checklist',
          'household_item',
        ]),
      ),
    );
  const items = await loadRecords(
    db,
    userId,
    rows.map((row) => row.id),
    now,
  );
  const storedRows = await db
    .select()
    .from(occurrences)
    .where(
      and(eq(occurrences.userId, userId), gte(occurrences.occurrenceDate, storedFrom)),
    );
  const stored = new Map<string, Map<LocalDate, StoredOccurrence>>();
  for (const row of storedRows) {
    const dates = stored.get(row.recordId) ?? new Map<LocalDate, StoredOccurrence>();
    dates.set(row.occurrenceDate, {
      status: row.status,
      rescheduledTo: row.rescheduledTo,
    });
    stored.set(row.recordId, dates);
  }
  return { items, stored };
}

/** “今天”和日历共用的输入：重复日常、重要日期、有截止时间的清单和备忘提醒。 */
function scheduleInput(
  items: readonly LifeRecord[],
  stored: ReadonlyMap<string, ReadonlyMap<LocalDate, StoredOccurrence>>,
): Pick<TodayInput, 'recurring' | 'importantDates' | 'checklists' | 'memoReminders'> {
  return {
    recurring: items.flatMap((record) =>
      record.recurring === null
        ? []
        : [
            {
              recordId: record.id,
              title: displayTitle(record),
              rule: record.recurring,
              stored: stored.get(record.id) ?? new Map(),
            },
          ],
    ),
    importantDates: items.flatMap((record) =>
      record.importantDate === null
        ? []
        : [
            {
              recordId: record.id,
              title: displayTitle(record),
              value: record.importantDate,
            },
          ],
    ),
    checklists: items.flatMap((record) => {
      if (record.checklist?.dueAt == null) {
        return [];
      }
      const progress = checklistProgress(record.checklist.items);
      return [
        {
          recordId: record.id,
          title: displayTitle(record),
          dueAt: new Date(record.checklist.dueAt),
          done: progress.done,
          total: progress.total,
        },
      ];
    }),
    memoReminders: items.flatMap((record) =>
      record.type !== 'memo'
        ? []
        : record.reminders.flatMap((reminder) =>
            reminder.kind === 'absolute' && reminder.enabled
              ? [
                  {
                    recordId: record.id,
                    title: displayTitle(record),
                    reminderId: reminder.id,
                    fireAt: new Date(reminder.fireAt),
                  },
                ]
              : [],
          ),
    ),
  };
}

export function todayRoutes(deps: AppDeps) {
  return new Hono<AppEnv>().use(requireAuth(deps)).get('/', async (c) => {
    const { userId } = c.get('auth');
    const query = readQuery(c, todayQuerySchema);
    const settings = await loadSettings(deps.db, userId);
    const date = query.date ?? todayIn(settings.timezone, deps.now());
    // 改期最多移动 60 天，所以要多往前读这么多天的实例。
    const { items, stored } = await loadScheduleRecords(
      deps.db,
      userId,
      addDays(date, -OVERDUE_LOOKBACK_DAYS - MAX_RESCHEDULE_DAYS - 1),
      deps.now(),
    );

    return c.json(
      buildToday({
        date,
        timeZone: settings.timezone,
        ...scheduleInput(items, stored),
        lowStock: items.flatMap((record) => {
          const item = record.householdItem;
          if (item === null || !item.isLowStock || item.lowStockThreshold === null) {
            return [];
          }
          return [
            {
              recordId: record.id,
              title: displayTitle(record),
              quantity: item.quantity,
              unit: item.unit,
              threshold: item.lowStockThreshold,
              location: item.location,
            },
          ];
        }),
      }),
    );
  });
}

export function calendarRoutes(deps: AppDeps) {
  return new Hono<AppEnv>().use(requireAuth(deps)).get('/', async (c) => {
    const { userId } = c.get('auth');
    const query = readQuery(c, calendarQuerySchema);
    const settings = await loadSettings(deps.db, userId);
    // 改期最多移动 60 天：原定日期在区间前 60 天内的实例也可能移进来。
    const { items, stored } = await loadScheduleRecords(
      deps.db,
      userId,
      addDays(query.from, -MAX_RESCHEDULE_DAYS),
      deps.now(),
    );
    return c.json(
      buildCalendar({
        from: query.from,
        to: query.to,
        today: todayIn(settings.timezone, deps.now()),
        timeZone: settings.timezone,
        ...scheduleInput(items, stored),
      }),
    );
  });
}

export function reminderRoutes(deps: AppDeps) {
  return new Hono<AppEnv>().use(requireAuth(deps)).get('/upcoming', async (c) => {
    const { userId } = c.get('auth');
    const query = readQuery(c, upcomingRemindersQuerySchema);
    const settings = await loadSettings(deps.db, userId);
    const now = deps.now();
    const { items, stored } = await loadScheduleRecords(
      deps.db,
      userId,
      addDays(todayIn(settings.timezone, now), -MAX_RESCHEDULE_DAYS),
      now,
    );

    // 还没提醒过的低库存（只算未删除、未归档的物品）。
    const activeIds = new Set(items.map((record) => record.id));
    const titles = new Map(items.map((record) => [record.id, displayTitle(record)]));
    const pendingLowStock = await deps.db
      .select({
        recordId: householdItems.recordId,
        lowStockSince: householdItems.lowStockSince,
      })
      .from(householdItems)
      .where(
        and(
          eq(householdItems.userId, userId),
          isNotNull(householdItems.lowStockSince),
          isNull(householdItems.lowStockNotifiedAt),
        ),
      );
    const lowStockAlerts = computeLowStockAlerts(
      pendingLowStock.flatMap((row) =>
        row.lowStockSince === null || !activeIds.has(row.recordId)
          ? []
          : [
              {
                recordId: row.recordId,
                title: titles.get(row.recordId) ?? '',
                lowStockSince: row.lowStockSince,
              },
            ],
      ),
      now,
    );

    const scheduled = computeUpcomingReminders(
      items.map((record) => ({
        recordId: record.id,
        recordType: record.type,
        title: displayTitle(record),
        reminders: record.reminders.filter((reminder) => reminder.enabled),
        recurring: record.recurring,
        stored: stored.get(record.id) ?? new Map(),
        importantDate: record.importantDate,
        finished:
          record.checklist !== null &&
          checklistProgress(record.checklist.items).isComplete,
      })),
      {
        now,
        until: new Date(now.getTime() + query.days * DAY_MS),
        timeZone: settings.timezone,
        defaultReminderTime: settings.defaultReminderTime,
      },
    );
    const body: UpcomingRemindersResponse = {
      items: [...lowStockAlerts, ...scheduled].sort((a, b) =>
        a.fireAt.localeCompare(b.fireAt),
      ),
    };
    return c.json(body);
  });
}

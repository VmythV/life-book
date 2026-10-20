import {
  type Checklist,
  type ChecklistItem,
  type HouseholdItem,
  isLowStock,
  type StockTransaction,
  type ImportantDate,
  type LifeRecord,
  type LocalDate,
  type RecurrenceRule,
  type Reminder,
} from '@life-book/core';

import {
  type checklistItems,
  type checklists,
  type householdItems,
  type importantDates,
  type records,
  type recurringRules,
  type reminders,
  type stockTransactions,
} from '../db/schema';

/** PostgreSQL time 列返回 HH:mm:ss，API 只用到分钟。 */
export const toLocalTime = (value: string) => value.slice(0, 5);

export function toRecurrenceRule(
  row: typeof recurringRules.$inferSelect,
): RecurrenceRule {
  let end: RecurrenceRule['end'] = { type: 'never' };
  if (row.endType === 'until' && row.untilDate !== null) {
    end = { type: 'until', until: row.untilDate };
  } else if (row.endType === 'count' && row.count !== null) {
    end = { type: 'count', count: row.count };
  }
  return {
    startDate: row.startDate,
    freq: row.freq,
    interval: row.interval,
    byWeekdays: row.byWeekdays,
    byMonthDay: row.byMonthDay,
    timeOfDay: row.timeOfDay === null ? null : toLocalTime(row.timeOfDay),
    end,
  };
}

export function fromRecurrenceRule(rule: RecurrenceRule) {
  return {
    startDate: rule.startDate,
    freq: rule.freq,
    interval: rule.interval,
    byWeekdays: rule.byWeekdays,
    byMonthDay: rule.byMonthDay,
    timeOfDay: rule.timeOfDay,
    endType: rule.end.type,
    untilDate: rule.end.type === 'until' ? rule.end.until : null,
    count: rule.end.type === 'count' ? rule.end.count : null,
  };
}

export function toImportantDate(row: typeof importantDates.$inferSelect): ImportantDate {
  return {
    kind: row.kind,
    repeat: row.repeat,
    year: row.year,
    month: row.month,
    day: row.day,
    startYear: row.startYear,
    showCounter: row.showCounter,
  };
}

export function toReminder(row: typeof reminders.$inferSelect): Reminder {
  if (row.kind === 'absolute') {
    return {
      id: row.id,
      enabled: row.enabled,
      kind: 'absolute',
      fireAt: (row.fireAt ?? new Date(0)).toISOString(),
    };
  }
  return {
    id: row.id,
    enabled: row.enabled,
    kind: 'relative',
    daysBefore: row.daysBefore ?? 0,
    timeOfDay: row.timeOfDay === null ? null : toLocalTime(row.timeOfDay),
  };
}

export function toChecklistItem(row: typeof checklistItems.$inferSelect): ChecklistItem {
  return {
    id: row.id,
    groupName: row.groupName,
    title: row.title,
    notes: row.notes,
    quantity: row.quantity,
    unit: row.unit,
    isDone: row.isDone,
    doneAt: row.doneAt?.toISOString() ?? null,
    sortOrder: row.sortOrder,
    householdItemId: row.householdItemId,
  };
}

export function toChecklist(
  row: typeof checklists.$inferSelect,
  items: (typeof checklistItems.$inferSelect)[],
): Checklist {
  return {
    purpose: row.purpose,
    dueAt: row.dueAt?.toISOString() ?? null,
    sourceTemplateId: row.sourceTemplateId,
    items: items.map(toChecklistItem),
  };
}

export function toHouseholdItem(row: typeof householdItems.$inferSelect): HouseholdItem {
  return {
    unit: row.unit,
    quantity: row.quantity,
    lowStockThreshold: row.lowStockThreshold,
    location: row.location,
    isLowStock: isLowStock(row.quantity, row.lowStockThreshold),
    lowStockSince: row.lowStockSince?.toISOString() ?? null,
  };
}

export function toStockTransaction(
  row: typeof stockTransactions.$inferSelect,
): StockTransaction {
  return {
    id: row.id,
    kind: row.kind,
    delta: row.delta,
    quantityAfter: row.quantityAfter,
    occurredAt: row.occurredAt.toISOString(),
    note: row.note,
    correctsId: row.correctsId,
  };
}

export function toRecordDto(
  row: typeof records.$inferSelect,
  details: {
    rule: typeof recurringRules.$inferSelect | undefined;
    importantDate: typeof importantDates.$inferSelect | undefined;
    checklist: typeof checklists.$inferSelect | undefined;
    checklistItems: (typeof checklistItems.$inferSelect)[];
    householdItem: typeof householdItems.$inferSelect | undefined;
    reminders: (typeof reminders.$inferSelect)[];
    tagIds: string[];
    nextOccurrenceDate: LocalDate | null;
  },
): LifeRecord {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    notes: row.notes,
    categoryId: row.categoryId,
    tagIds: details.tagIds,
    isPinned: row.isPinned,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    recurring: details.rule === undefined ? null : toRecurrenceRule(details.rule),
    importantDate:
      details.importantDate === undefined ? null : toImportantDate(details.importantDate),
    checklist:
      details.checklist === undefined
        ? null
        : toChecklist(details.checklist, details.checklistItems),
    householdItem:
      details.householdItem === undefined ? null : toHouseholdItem(details.householdItem),
    reminders: details.reminders.map(toReminder),
    nextOccurrenceDate: details.nextOccurrenceDate,
  };
}

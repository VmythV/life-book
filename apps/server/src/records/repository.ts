import {
  addDays,
  type ChecklistData,
  type ChecklistSettingsData,
  type HouseholdItemData,
  type HouseholdSettingsData,
  isLowStock,
  lowStockTransition,
  type ImportantDate,
  type LifeRecord,
  type LocalDate,
  MAX_RESCHEDULE_DAYS,
  nextPendingOccurrence,
  type RecurrenceRule,
  type ReminderInput,
  type StoredOccurrence,
  todayIn,
} from '@life-book/core';
import { and, asc, eq, gte, inArray } from 'drizzle-orm';
import { type PgColumn } from 'drizzle-orm/pg-core';

import { type Executor } from '../db/client';
import {
  categories,
  checklistItems,
  checklists,
  householdItems,
  importantDates,
  occurrences,
  records,
  recordTags,
  recurringRules,
  reminders,
  stockTransactions,
  tags,
  userSettings,
} from '../db/schema';
import { validationFailed } from '../http/errors';
import { fromRecurrenceRule, toRecordDto, toRecurrenceRule } from './mappers';

/**
 * 读取一组记录的完整信息，按传入的 ID 顺序返回；不属于该用户的 ID 会被忽略。
 * `now` 用来按用户时区算出重复日常的下一次。
 */
export async function loadRecords(
  db: Executor,
  userId: string,
  recordIds: string[],
  now: Date,
): Promise<LifeRecord[]> {
  if (recordIds.length === 0) {
    return [];
  }
  const owned = (table: { userId: PgColumn; recordId: PgColumn }) =>
    and(eq(table.userId, userId), inArray(table.recordId, recordIds));

  const [
    recordRows,
    ruleRows,
    dateRows,
    checklistRows,
    itemRows,
    householdRows,
    reminderRows,
    tagRows,
  ] = await Promise.all([
    db
      .select()
      .from(records)
      .where(and(eq(records.userId, userId), inArray(records.id, recordIds))),
    db.select().from(recurringRules).where(owned(recurringRules)),
    db.select().from(importantDates).where(owned(importantDates)),
    db.select().from(checklists).where(owned(checklists)),
    db
      .select()
      .from(checklistItems)
      .where(owned(checklistItems))
      .orderBy(asc(checklistItems.sortOrder), asc(checklistItems.createdAt)),
    db.select().from(householdItems).where(owned(householdItems)),
    db
      .select()
      .from(reminders)
      .where(owned(reminders))
      .orderBy(asc(reminders.createdAt), asc(reminders.id)),
    db
      .select({ recordId: recordTags.recordId, tagId: recordTags.tagId })
      .from(recordTags)
      .where(owned(recordTags))
      .orderBy(asc(recordTags.createdAt)),
  ]);

  const nextDates = await loadNextOccurrenceDates(db, userId, ruleRows, now);
  const byId = new Map(recordRows.map((row) => [row.id, row]));
  return recordIds.flatMap((id) => {
    const row = byId.get(id);
    if (row === undefined) {
      return [];
    }
    return [
      toRecordDto(row, {
        rule: ruleRows.find((rule) => rule.recordId === id),
        importantDate: dateRows.find((date) => date.recordId === id),
        checklist: checklistRows.find((checklist) => checklist.recordId === id),
        checklistItems: itemRows.filter((item) => item.recordId === id),
        householdItem: householdRows.find((item) => item.recordId === id),
        reminders: reminderRows.filter((reminder) => reminder.recordId === id),
        tagIds: tagRows.filter((tag) => tag.recordId === id).map((tag) => tag.tagId),
        nextOccurrenceDate: nextDates.get(id) ?? null,
      }),
    ];
  });
}

/** 重复日常从今天起下一次待完成的日期；改期最多 60 天，所以只需读最近 60 天以后的实例。 */
async function loadNextOccurrenceDates(
  db: Executor,
  userId: string,
  ruleRows: (typeof recurringRules.$inferSelect)[],
  now: Date,
): Promise<Map<string, LocalDate | null>> {
  const result = new Map<string, LocalDate | null>();
  if (ruleRows.length === 0) {
    return result;
  }
  const [settings] = await db
    .select({ timezone: userSettings.timezone })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  const today = todayIn(settings?.timezone ?? 'UTC', now);
  const storedRows = await db
    .select()
    .from(occurrences)
    .where(
      and(
        eq(occurrences.userId, userId),
        inArray(
          occurrences.recordId,
          ruleRows.map((rule) => rule.recordId),
        ),
        gte(occurrences.occurrenceDate, addDays(today, -MAX_RESCHEDULE_DAYS)),
      ),
    );
  for (const rule of ruleRows) {
    const stored = new Map<LocalDate, StoredOccurrence>(
      storedRows
        .filter((row) => row.recordId === rule.recordId)
        .map((row) => [
          row.occurrenceDate,
          { status: row.status, rescheduledTo: row.rescheduledTo },
        ]),
    );
    result.set(
      rule.recordId,
      nextPendingOccurrence(toRecurrenceRule(rule), stored, today),
    );
  }
  return result;
}

export async function loadRecord(
  db: Executor,
  userId: string,
  recordId: string,
  now: Date,
): Promise<LifeRecord | undefined> {
  const [record] = await loadRecords(db, userId, [recordId], now);
  return record;
}

/** 分类和标签必须属于当前用户，否则按参数错误处理。 */
export async function assertTaxonomyOwned(
  db: Executor,
  userId: string,
  input: { categoryId?: string | null | undefined; tagIds?: string[] | undefined },
): Promise<void> {
  if (input.categoryId !== undefined && input.categoryId !== null) {
    const [category] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.userId, userId), eq(categories.id, input.categoryId)));
    if (category === undefined) {
      throw validationFailed({ categoryId: '分类不存在' });
    }
  }
  if (input.tagIds !== undefined && input.tagIds.length > 0) {
    const found = await db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.userId, userId), inArray(tags.id, input.tagIds)));
    if (found.length !== input.tagIds.length) {
      throw validationFailed({ tagIds: '标签不存在' });
    }
  }
}

interface DetailWrite {
  userId: string;
  recordId: string;
  now: Date;
}

export async function writeRecurringRule(
  tx: Executor,
  target: DetailWrite,
  rule: RecurrenceRule,
): Promise<void> {
  const values = { ...fromRecurrenceRule(rule), updatedAt: target.now };
  await tx
    .insert(recurringRules)
    .values({ recordId: target.recordId, userId: target.userId, ...values })
    .onConflictDoUpdate({ target: recurringRules.recordId, set: values });
}

export async function writeImportantDate(
  tx: Executor,
  target: DetailWrite,
  value: ImportantDate,
): Promise<void> {
  const values = { ...value, updatedAt: target.now };
  await tx
    .insert(importantDates)
    .values({ recordId: target.recordId, userId: target.userId, ...values })
    .onConflictDoUpdate({ target: importantDates.recordId, set: values });
}

/** 整体替换提醒。提醒 ID 随之改变，手机端会按新的提醒重新排通知。 */
export async function replaceReminders(
  tx: Executor,
  target: DetailWrite,
  items: ReminderInput[],
): Promise<void> {
  await tx
    .delete(reminders)
    .where(
      and(eq(reminders.userId, target.userId), eq(reminders.recordId, target.recordId)),
    );
  if (items.length === 0) {
    return;
  }
  await tx.insert(reminders).values(
    items.map((item, index) => ({
      userId: target.userId,
      recordId: target.recordId,
      kind: item.kind,
      fireAt: item.kind === 'absolute' ? new Date(item.fireAt) : null,
      daysBefore: item.kind === 'relative' ? item.daysBefore : null,
      timeOfDay: item.kind === 'relative' ? item.timeOfDay : null,
      // 保持提交时的顺序。
      createdAt: new Date(target.now.getTime() + index),
      updatedAt: target.now,
    })),
  );
}

export async function replaceTags(
  tx: Executor,
  target: DetailWrite,
  tagIds: string[],
): Promise<void> {
  await tx
    .delete(recordTags)
    .where(
      and(eq(recordTags.userId, target.userId), eq(recordTags.recordId, target.recordId)),
    );
  if (tagIds.length === 0) {
    return;
  }
  await tx.insert(recordTags).values(
    tagIds.map((tagId, index) => ({
      userId: target.userId,
      recordId: target.recordId,
      tagId,
      createdAt: new Date(target.now.getTime() + index),
    })),
  );
}

/** 新建清单：写入清单设置和初始项目，项目按提交顺序排序。 */
export async function writeChecklist(
  tx: Executor,
  target: DetailWrite,
  checklist: ChecklistData,
  sourceTemplateId: string | null = null,
): Promise<void> {
  await tx.insert(checklists).values({
    recordId: target.recordId,
    userId: target.userId,
    purpose: checklist.purpose,
    dueAt: checklist.dueAt === null ? null : new Date(checklist.dueAt),
    sourceTemplateId,
    updatedAt: target.now,
  });
  if (checklist.items.length > 0) {
    await tx.insert(checklistItems).values(
      checklist.items.map((item, index) => ({
        userId: target.userId,
        recordId: target.recordId,
        groupName: item.groupName,
        title: item.title,
        notes: item.notes,
        quantity: item.quantity,
        unit: item.unit,
        sortOrder: index,
        createdAt: target.now,
        updatedAt: target.now,
      })),
    );
  }
}

export async function updateChecklistSettings(
  tx: Executor,
  target: DetailWrite,
  settings: ChecklistSettingsData,
): Promise<void> {
  await tx
    .update(checklists)
    .set({
      ...(settings.purpose === undefined ? {} : { purpose: settings.purpose }),
      ...(settings.dueAt === undefined
        ? {}
        : { dueAt: settings.dueAt === null ? null : new Date(settings.dueAt) }),
      updatedAt: target.now,
    })
    .where(
      and(eq(checklists.userId, target.userId), eq(checklists.recordId, target.recordId)),
    );
}

/** 新建家庭物品：写入物品和一条“期初”流水；期初就低库存时记下开始时间。 */
export async function writeHouseholdItem(
  tx: Executor,
  target: DetailWrite,
  item: HouseholdItemData,
): Promise<void> {
  await tx.insert(householdItems).values({
    recordId: target.recordId,
    userId: target.userId,
    unit: item.unit,
    quantity: item.quantity,
    lowStockThreshold: item.lowStockThreshold,
    location: item.location,
    lowStockSince: isLowStock(item.quantity, item.lowStockThreshold) ? target.now : null,
    updatedAt: target.now,
  });
  await tx.insert(stockTransactions).values({
    userId: target.userId,
    recordId: target.recordId,
    kind: 'opening',
    delta: item.quantity,
    quantityAfter: item.quantity,
    occurredAt: target.now,
    createdAt: target.now,
  });
}

/** 低库存状态变化时更新开始时间和提醒标记。 */
export function lowStockUpdate(
  current: { lowStockSince: Date | null },
  quantity: number,
  threshold: number | null,
  now: Date,
): { lowStockSince?: Date | null; lowStockNotifiedAt?: null } {
  switch (lowStockTransition(current.lowStockSince !== null, quantity, threshold)) {
    case 'entered':
      return { lowStockSince: now, lowStockNotifiedAt: null };
    case 'left':
      return { lowStockSince: null, lowStockNotifiedAt: null };
    case 'none':
      return {};
  }
}

/** 修改单位、最低库存或位置；最低库存变化可能改变低库存状态。 */
export async function updateHouseholdSettings(
  tx: Executor,
  target: DetailWrite,
  settings: HouseholdSettingsData,
): Promise<void> {
  const [current] = await tx
    .select()
    .from(householdItems)
    .where(
      and(
        eq(householdItems.userId, target.userId),
        eq(householdItems.recordId, target.recordId),
      ),
    )
    .for('update');
  if (current === undefined) {
    return;
  }
  const threshold =
    settings.lowStockThreshold === undefined
      ? current.lowStockThreshold
      : settings.lowStockThreshold;
  await tx
    .update(householdItems)
    .set({
      ...(settings.unit === undefined ? {} : { unit: settings.unit }),
      ...(settings.location === undefined ? {} : { location: settings.location }),
      lowStockThreshold: threshold,
      ...lowStockUpdate(current, current.quantity, threshold, target.now),
      updatedAt: target.now,
    })
    .where(
      and(
        eq(householdItems.userId, target.userId),
        eq(householdItems.recordId, target.recordId),
      ),
    );
}

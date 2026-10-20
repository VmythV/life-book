import {
  addDays,
  type BatchResponse,
  batchRequestSchema,
  createRecordRequestSchema,
  isOccurrenceDate,
  type LifeRecord,
  localDateSchema,
  type Occurrence,
  type OccurrenceListResponse,
  occurrenceRangeQuerySchema,
  occurrenceStatus,
  effectiveOccurrences,
  isHandled,
  MAX_RESCHEDULE_DAYS,
  rescheduleIssue,
  rescheduleRequestSchema,
  type RecordListResponse,
  recordContentIssues,
  recordListQuerySchema,
  type RecurrenceRule,
  setOccurrenceRequestSchema,
  daysBetween,
  todayIn,
  updateRecordRequestSchema,
} from '@life-book/core';
import {
  and,
  desc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

import { requireAuth } from '../auth/middleware';
import { type Executor, isUniqueViolation } from '../db/client';
import { checklistItems, occurrences, records, recordTags } from '../db/schema';
import { type AppDeps, type AppEnv } from '../http/context';
import { ApiError, notFound, validationFailed } from '../http/errors';
import { readJson, readQuery } from '../http/validate';
import { loadSettings } from '../users/settings';
import {
  assertTaxonomyOwned,
  loadRecord,
  loadRecords,
  replaceReminders,
  replaceTags,
  updateChecklistSettings,
  updateHouseholdSettings,
  writeChecklist,
  writeHouseholdItem,
  writeImportantDate,
  writeRecurringRule,
} from './repository';

const MAX_OCCURRENCE_RANGE_DAYS = 366;

const cursorSchema = z.tuple([z.boolean(), z.iso.datetime(), z.uuid()]);

function encodeCursor(record: LifeRecord): string {
  return Buffer.from(
    JSON.stringify([record.isPinned, record.updatedAt, record.id]),
  ).toString('base64url');
}

function decodeCursor(cursor: string): z.infer<typeof cursorSchema> {
  try {
    return cursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
  } catch {
    throw validationFailed({ cursor: '分页参数无效' });
  }
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');

function recordIdParam(c: Context): string {
  const result = z.uuid().safeParse(c.req.param('id'));
  if (!result.success) {
    throw notFound();
  }
  return result.data;
}

/** 规则的重复方式变了（不只是开始日期或时刻），新规则从今天开始，避免把过去的日子算成逾期。 */
function adjustChangedRule(
  previous: RecurrenceRule | null,
  next: RecurrenceRule,
  today: string,
): RecurrenceRule {
  if (previous === null || next.freq === 'yearly' || next.startDate >= today) {
    return next;
  }
  const pattern = (rule: RecurrenceRule) =>
    JSON.stringify([
      rule.freq,
      rule.interval,
      rule.byWeekdays,
      rule.byMonthDay,
      rule.end,
    ]);
  return pattern(previous) === pattern(next) ? next : { ...next, startDate: today };
}

export function recordRoutes(deps: AppDeps) {
  /** 读取当前用户的一条记录；在回收站中的记录只有指定 `includeTrashed` 时才返回。 */
  async function findRecord(
    db: Executor,
    userId: string,
    recordId: string,
    options: { includeTrashed?: boolean; lock?: boolean } = {},
  ) {
    const query = db
      .select()
      .from(records)
      .where(and(eq(records.userId, userId), eq(records.id, recordId)));
    const [row] = await (options.lock === true ? query.for('update') : query);
    if (
      row === undefined ||
      (row.deletedAt !== null && options.includeTrashed !== true)
    ) {
      throw notFound();
    }
    return row;
  }

  async function respondWithRecord(
    c: Context<AppEnv>,
    db: Executor,
    recordId: string,
    status: 200 | 201 = 200,
  ) {
    const record = await loadRecord(db, c.get('auth').userId, recordId, deps.now());
    if (record === undefined) {
      throw notFound();
    }
    return c.json(record, status);
  }

  /** 归档、删除、恢复等只改状态的操作：版本号加一。 */
  async function changeState(
    c: Context<AppEnv>,
    options: { includeTrashed: boolean; requireTrashed?: boolean },
    values: Partial<typeof records.$inferInsert>,
  ) {
    const { userId } = c.get('auth');
    const recordId = recordIdParam(c);
    const row = await findRecord(deps.db, userId, recordId, options);
    if (options.requireTrashed === true && row.deletedAt === null) {
      throw notFound();
    }
    await deps.db
      .update(records)
      .set({ ...values, version: sql`${records.version} + 1`, updatedAt: deps.now() })
      .where(and(eq(records.userId, userId), eq(records.id, recordId)));
    return respondWithRecord(c, deps.db, recordId);
  }

  /** 实例操作的公共部分：未删除的重复日常和合法的原定日期，否则 404。 */
  async function findOccurrenceTarget(c: Context<AppEnv>, userId: string) {
    const recordId = recordIdParam(c);
    const date = localDateSchema.safeParse(c.req.param('date'));
    if (!date.success) {
      throw notFound();
    }
    const record = await loadRecord(deps.db, userId, recordId, deps.now());
    if (record?.recurring == null || record.deletedAt !== null) {
      throw notFound();
    }
    return { recordId, date: date.data, rule: record.recurring };
  }

  return new Hono<AppEnv>()
    .use(requireAuth(deps))
    .get('/', async (c) => {
      const { userId } = c.get('auth');
      const query = readQuery(c, recordListQuerySchema);
      const conditions = [eq(records.userId, userId)];
      if (query.status === 'trash') {
        conditions.push(isNotNull(records.deletedAt));
      } else {
        conditions.push(isNull(records.deletedAt));
        conditions.push(
          query.status === 'archived'
            ? isNotNull(records.archivedAt)
            : isNull(records.archivedAt),
        );
      }
      if (query.type !== undefined) {
        conditions.push(eq(records.type, query.type));
      }
      if (query.categoryId !== undefined) {
        conditions.push(eq(records.categoryId, query.categoryId));
      }
      if (query.tagId !== undefined) {
        conditions.push(
          exists(
            deps.db
              .select({ one: sql`1` })
              .from(recordTags)
              .where(
                and(
                  eq(recordTags.userId, userId),
                  eq(recordTags.recordId, records.id),
                  eq(recordTags.tagId, query.tagId),
                ),
              ),
          ),
        );
      }
      if (query.q !== undefined && query.q !== '') {
        const pattern = `%${escapeLike(query.q)}%`;
        const match = or(
          ilike(records.title, pattern),
          ilike(records.notes, pattern),
          // 清单也按项目名称搜索。
          exists(
            deps.db
              .select({ one: sql`1` })
              .from(checklistItems)
              .where(
                and(
                  eq(checklistItems.userId, userId),
                  eq(checklistItems.recordId, records.id),
                  ilike(checklistItems.title, pattern),
                ),
              ),
          ),
        );
        if (match !== undefined) {
          conditions.push(match);
        }
      }
      if (query.cursor !== undefined) {
        const [pinned, updatedAt, id] = decodeCursor(query.cursor);
        conditions.push(
          sql`(${records.isPinned}, ${records.updatedAt}, ${records.id}) < (${pinned}::boolean, ${updatedAt}::timestamptz, ${id}::uuid)`,
        );
      }

      const rows = await deps.db
        .select({ id: records.id })
        .from(records)
        .where(and(...conditions))
        .orderBy(desc(records.isPinned), desc(records.updatedAt), desc(records.id))
        .limit(query.limit + 1);
      const items = await loadRecords(
        deps.db,
        userId,
        rows.slice(0, query.limit).map((row) => row.id),
        deps.now(),
      );
      const last = items.at(-1);
      const body: RecordListResponse = {
        items,
        nextCursor:
          rows.length > query.limit && last !== undefined ? encodeCursor(last) : null,
      };
      return c.json(body);
    })
    .post('/', async (c) => {
      const { userId } = c.get('auth');
      const input = await readJson(c, createRecordRequestSchema);
      const now = deps.now();

      if (input.id !== undefined) {
        const [existing] = await deps.db
          .select({ userId: records.userId })
          .from(records)
          .where(eq(records.id, input.id));
        if (existing !== undefined) {
          // 重复提交：返回已经创建的记录。
          if (existing.userId === userId) {
            return respondWithRecord(c, deps.db, input.id);
          }
          throw new ApiError(409, 'ID_CONFLICT', '记录 ID 已被使用，请重新提交');
        }
      }
      await assertTaxonomyOwned(deps.db, userId, input);

      const insertRecord = deps.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(records)
          .values({
            ...(input.id === undefined ? {} : { id: input.id }),
            userId,
            type: input.type,
            title: input.title,
            notes: input.notes,
            categoryId: input.categoryId,
            isPinned: input.isPinned,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: records.id });
        if (row === undefined) {
          throw new Error('Insert did not return the record.');
        }
        const target = { userId, recordId: row.id, now };
        if (input.type === 'recurring') {
          await writeRecurringRule(tx, target, input.recurring);
        } else if (input.type === 'important_date') {
          await writeImportantDate(tx, target, input.importantDate);
        } else if (input.type === 'checklist') {
          await writeChecklist(tx, target, input.checklist);
        } else if (input.type === 'household_item') {
          await writeHouseholdItem(tx, target, input.householdItem);
        }
        await replaceReminders(tx, target, input.reminders);
        await replaceTags(tx, target, input.tagIds);
        return row.id;
      });
      let recordId: string;
      try {
        recordId = await insertRecord;
      } catch (error) {
        // 同一个 ID 的两次提交同时到达：后到的那次返回先创建的记录。
        if (input.id !== undefined && isUniqueViolation(error)) {
          return respondWithRecord(c, deps.db, input.id);
        }
        throw error;
      }
      return respondWithRecord(c, deps.db, recordId, 201);
    })
    .post('/batch', async (c) => {
      const { userId } = c.get('auth');
      const input = await readJson(c, batchRequestSchema);
      const now = deps.now();
      if (input.action === 'setCategory' || input.action === 'addTags') {
        await assertTaxonomyOwned(deps.db, userId, {
          categoryId: input.categoryId,
          tagIds: input.tagIds,
        });
      }
      const mine = and(eq(records.userId, userId), inArray(records.id, input.ids));
      const bump = { version: sql`${records.version} + 1`, updatedAt: now };

      const updated = await deps.db.transaction(async (tx) => {
        switch (input.action) {
          case 'archive':
            return tx
              .update(records)
              .set({ ...bump, archivedAt: now })
              .where(and(mine, isNull(records.deletedAt), isNull(records.archivedAt)))
              .returning({ id: records.id });
          case 'unarchive':
            return tx
              .update(records)
              .set({ ...bump, archivedAt: null })
              .where(and(mine, isNull(records.deletedAt), isNotNull(records.archivedAt)))
              .returning({ id: records.id });
          case 'delete':
            return tx
              .update(records)
              .set({ ...bump, deletedAt: now })
              .where(and(mine, isNull(records.deletedAt)))
              .returning({ id: records.id });
          case 'restore':
            return tx
              .update(records)
              .set({ ...bump, deletedAt: null })
              .where(and(mine, isNotNull(records.deletedAt)))
              .returning({ id: records.id });
          case 'setCategory':
            return tx
              .update(records)
              .set({ ...bump, categoryId: input.categoryId ?? null })
              .where(and(mine, isNull(records.deletedAt)))
              .returning({ id: records.id });
          case 'addTags': {
            const rows = await tx
              .update(records)
              .set(bump)
              .where(and(mine, isNull(records.deletedAt)))
              .returning({ id: records.id });
            const tagIds = input.tagIds ?? [];
            if (rows.length > 0) {
              // 已有的标签保持不变，只补上缺少的。
              await tx
                .insert(recordTags)
                .values(
                  rows.flatMap((row) =>
                    tagIds.map((tagId) => ({
                      userId,
                      recordId: row.id,
                      tagId,
                      createdAt: now,
                    })),
                  ),
                )
                .onConflictDoNothing();
            }
            return rows;
          }
        }
      });
      const body: BatchResponse = { updated: updated.length };
      return c.json(body);
    })
    .get('/:id', async (c) => {
      const record = await loadRecord(
        deps.db,
        c.get('auth').userId,
        recordIdParam(c),
        deps.now(),
      );
      if (record === undefined) {
        throw notFound();
      }
      return c.json(record);
    })
    .patch('/:id', async (c) => {
      const { userId } = c.get('auth');
      const recordId = recordIdParam(c);
      const input = await readJson(c, updateRecordRequestSchema);
      const now = deps.now();
      await assertTaxonomyOwned(deps.db, userId, input);
      const settings = await loadSettings(deps.db, userId);

      await deps.db.transaction(async (tx) => {
        await findRecord(tx, userId, recordId, { lock: true });
        const current = await loadRecord(tx, userId, recordId, deps.now());
        if (current === undefined) {
          throw notFound();
        }
        if (current.version !== input.version) {
          throw new ApiError(
            409,
            'VERSION_CONFLICT',
            '记录已在其他地方修改，请刷新后再试',
            {
              currentVersion: current.version,
            },
          );
        }
        if (input.recurring !== undefined && current.type !== 'recurring') {
          throw validationFailed({ recurring: '只有重复日常可以设置重复规则' });
        }
        if (input.importantDate !== undefined && current.type !== 'important_date') {
          throw validationFailed({ importantDate: '只有重要日期可以设置日期' });
        }
        if (input.checklist !== undefined && current.type !== 'checklist') {
          throw validationFailed({ checklist: '只有清单可以设置截止时间' });
        }
        if (input.householdItem !== undefined && current.type !== 'household_item') {
          throw validationFailed({ householdItem: '只有家庭物品可以设置库存' });
        }
        const issues = recordContentIssues({
          type: current.type,
          title: input.title ?? current.title,
          notes: input.notes === undefined ? current.notes : input.notes,
          reminders: input.reminders ?? current.reminders,
        });
        if (Object.keys(issues).length > 0) {
          throw validationFailed(issues);
        }

        await tx
          .update(records)
          .set({
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.notes === undefined ? {} : { notes: input.notes }),
            ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
            ...(input.isPinned === undefined ? {} : { isPinned: input.isPinned }),
            version: current.version + 1,
            updatedAt: now,
          })
          .where(and(eq(records.userId, userId), eq(records.id, recordId)));
        const target = { userId, recordId, now };
        if (input.recurring !== undefined) {
          const today = todayIn(settings.timezone, now);
          await writeRecurringRule(
            tx,
            target,
            adjustChangedRule(current.recurring, input.recurring, today),
          );
        }
        if (input.importantDate !== undefined) {
          await writeImportantDate(tx, target, input.importantDate);
        }
        if (input.checklist !== undefined) {
          await updateChecklistSettings(tx, target, input.checklist);
        }
        if (input.householdItem !== undefined) {
          await updateHouseholdSettings(tx, target, input.householdItem);
        }
        if (input.reminders !== undefined) {
          await replaceReminders(tx, target, input.reminders);
        }
        if (input.tagIds !== undefined) {
          await replaceTags(tx, target, input.tagIds);
        }
      });
      return respondWithRecord(c, deps.db, recordId);
    })
    .post('/:id/archive', (c) =>
      changeState(c, { includeTrashed: false }, { archivedAt: deps.now() }),
    )
    .post('/:id/unarchive', (c) =>
      changeState(c, { includeTrashed: false }, { archivedAt: null }),
    )
    .delete('/:id', (c) =>
      changeState(c, { includeTrashed: false }, { deletedAt: deps.now() }),
    )
    .post('/:id/restore', (c) =>
      changeState(c, { includeTrashed: true, requireTrashed: true }, { deletedAt: null }),
    )
    .delete('/:id/permanent', async (c) => {
      const { userId } = c.get('auth');
      const recordId = recordIdParam(c);
      const row = await findRecord(deps.db, userId, recordId, { includeTrashed: true });
      if (row.deletedAt === null) {
        throw validationFailed({ id: '只能永久删除回收站中的记录' });
      }
      await deps.db
        .delete(records)
        .where(and(eq(records.userId, userId), eq(records.id, recordId)));
      return c.body(null, 204);
    })
    .get('/:id/occurrences', async (c) => {
      const { userId } = c.get('auth');
      const recordId = recordIdParam(c);
      const range = readQuery(c, occurrenceRangeQuerySchema);
      if (daysBetween(range.from, range.to) > MAX_OCCURRENCE_RANGE_DAYS) {
        throw validationFailed({ to: `一次最多查询 ${MAX_OCCURRENCE_RANGE_DAYS} 天` });
      }
      const record = await loadRecord(deps.db, userId, recordId, deps.now());
      // 只读：回收站里的记录也可以查看历史实例。
      if (record?.recurring == null) {
        throw notFound();
      }
      const settings = await loadSettings(deps.db, userId);
      const today = todayIn(settings.timezone, deps.now());
      const rows = await loadStoredOccurrences(
        deps.db,
        userId,
        recordId,
        addDays(range.from, -MAX_RESCHEDULE_DAYS),
        addDays(range.to, MAX_RESCHEDULE_DAYS),
      );
      const stored = new Map(
        rows.map((row) => [
          row.occurrenceDate,
          { status: row.status, rescheduledTo: row.rescheduledTo },
        ]),
      );
      const handledAt = new Map(rows.map((row) => [row.occurrenceDate, row.handledAt]));
      const items: Occurrence[] = effectiveOccurrences(
        record.recurring,
        stored,
        range.from,
        range.to,
      ).map((occurrence) => ({
        recordId,
        date: occurrence.date,
        originalDate: occurrence.originalDate,
        status: occurrenceStatus(occurrence.date, occurrence.stored, today),
        handledAt: isHandled(occurrence.stored)
          ? (handledAt.get(occurrence.originalDate)?.toISOString() ?? null)
          : null,
      }));
      // 规则修改前处理过、现在已不在规则里的实例，作为历史一并列出。
      const listed = new Set(items.map((item) => item.originalDate));
      for (const row of rows) {
        const date = row.rescheduledTo ?? row.occurrenceDate;
        if (
          !listed.has(row.occurrenceDate) &&
          row.status !== 'pending' &&
          date >= range.from &&
          date <= range.to
        ) {
          items.push({
            recordId,
            date,
            originalDate: row.occurrenceDate,
            status: row.status,
            handledAt: row.handledAt.toISOString(),
          });
        }
      }
      items.sort((a, b) => a.date.localeCompare(b.date));
      const body: OccurrenceListResponse = { items };
      return c.json(body);
    })
    .put('/:id/occurrences/:date', async (c) => {
      const { userId } = c.get('auth');
      const { recordId, date, rule } = await findOccurrenceTarget(c, userId);
      const input = await readJson(c, setOccurrenceRequestSchema);
      if (!isOccurrenceDate(rule, date)) {
        throw validationFailed({ date: '这一天没有安排' });
      }
      const now = deps.now();
      // 已改期的实例保留新日期，只改状态。
      const [row] = await deps.db
        .insert(occurrences)
        .values({
          userId,
          recordId,
          occurrenceDate: date,
          status: input.status,
          handledAt: now,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [occurrences.recordId, occurrences.occurrenceDate],
          set: { status: input.status, handledAt: now },
        })
        .returning();
      if (row === undefined) {
        throw new Error('Upsert did not return the occurrence.');
      }
      const body: Occurrence = toOccurrence(recordId, row);
      return c.json(body);
    })
    .delete('/:id/occurrences/:date', async (c) => {
      const { userId } = c.get('auth');
      const { recordId, date } = await findOccurrenceTarget(c, userId);
      const where = and(
        eq(occurrences.userId, userId),
        eq(occurrences.recordId, recordId),
        eq(occurrences.occurrenceDate, date),
      );
      // 撤销完成或跳过：改期过的回到“已改期、待完成”，否则删掉这一行。
      await deps.db.transaction(async (tx) => {
        await tx
          .update(occurrences)
          .set({ status: 'pending' })
          .where(and(where, isNotNull(occurrences.rescheduledTo)));
        await tx.delete(occurrences).where(and(where, isNull(occurrences.rescheduledTo)));
      });
      return c.body(null, 204);
    })
    .put('/:id/occurrences/:date/reschedule', async (c) => {
      const { userId } = c.get('auth');
      const { recordId, date, rule } = await findOccurrenceTarget(c, userId);
      const input = await readJson(c, rescheduleRequestSchema);
      if (!isOccurrenceDate(rule, date)) {
        throw validationFailed({ date: '这一天没有安排' });
      }
      const issue = rescheduleIssue(date, input.to);
      if (issue !== null) {
        throw validationFailed({ to: issue });
      }
      const now = deps.now();
      const [existing] = await deps.db
        .select()
        .from(occurrences)
        .where(
          and(
            eq(occurrences.userId, userId),
            eq(occurrences.recordId, recordId),
            eq(occurrences.occurrenceDate, date),
          ),
        );
      if (existing !== undefined && existing.status !== 'pending') {
        throw validationFailed({ date: '已完成或已跳过的不能改期，请先撤销' });
      }
      if (input.to === date) {
        // 改回原定日期就是取消改期。
        await deps.db
          .delete(occurrences)
          .where(
            and(
              eq(occurrences.userId, userId),
              eq(occurrences.recordId, recordId),
              eq(occurrences.occurrenceDate, date),
            ),
          );
        return c.json(
          toOccurrence(recordId, {
            occurrenceDate: date,
            rescheduledTo: null,
            status: 'pending',
            handledAt: null,
          }),
        );
      }
      const [row] = await deps.db
        .insert(occurrences)
        .values({
          userId,
          recordId,
          occurrenceDate: date,
          status: 'pending',
          rescheduledTo: input.to,
          handledAt: now,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [occurrences.recordId, occurrences.occurrenceDate],
          set: { rescheduledTo: input.to },
        })
        .returning();
      if (row === undefined) {
        throw new Error('Upsert did not return the occurrence.');
      }
      return c.json(toOccurrence(recordId, row));
    })
    .delete('/:id/occurrences/:date/reschedule', async (c) => {
      const { userId } = c.get('auth');
      const { recordId, date } = await findOccurrenceTarget(c, userId);
      const where = and(
        eq(occurrences.userId, userId),
        eq(occurrences.recordId, recordId),
        eq(occurrences.occurrenceDate, date),
      );
      // 取消改期：没处理的直接删掉，已处理的只去掉新日期。
      await deps.db.transaction(async (tx) => {
        await tx.delete(occurrences).where(and(where, eq(occurrences.status, 'pending')));
        await tx.update(occurrences).set({ rescheduledTo: null }).where(where);
      });
      return c.body(null, 204);
    });
}

function toOccurrence(
  recordId: string,
  row: {
    occurrenceDate: string;
    rescheduledTo: string | null;
    status: 'pending' | 'completed' | 'skipped';
    handledAt: Date | null;
  },
): Occurrence {
  const handled = row.status !== 'pending';
  return {
    recordId,
    date: row.rescheduledTo ?? row.occurrenceDate,
    originalDate: row.occurrenceDate,
    status: row.status,
    handledAt: handled ? (row.handledAt?.toISOString() ?? null) : null,
  };
}

async function loadStoredOccurrences(
  db: Executor,
  userId: string,
  recordId: string,
  from: string,
  to: string,
) {
  return db
    .select()
    .from(occurrences)
    .where(
      and(
        eq(occurrences.userId, userId),
        eq(occurrences.recordId, recordId),
        gte(occurrences.occurrenceDate, from),
        lte(occurrences.occurrenceDate, to),
      ),
    );
}

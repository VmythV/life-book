import {
  type ChecklistItem,
  completeAllRequestSchema,
  createChecklistItemRequestSchema,
  MAX_CHECKLIST_ITEMS,
  saveAsTemplateRequestSchema,
  updateChecklistItemRequestSchema,
} from '@life-book/core';
import { and, count, eq, max, sql } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

import { requireAuth } from '../auth/middleware';
import { type Executor } from '../db/client';
import { checklistItems, records } from '../db/schema';
import { type AppDeps, type AppEnv } from '../http/context';
import { notFound, validationFailed } from '../http/errors';
import { readJson } from '../http/validate';
import { insertTemplate, loadTemplate } from '../templates/repository';
import { toChecklistItem } from './mappers';
import { loadRecord } from './repository';

function uuidParam(c: Context, name: string): string {
  const result = z.uuid().safeParse(c.req.param(name));
  if (!result.success) {
    throw notFound();
  }
  return result.data;
}

/** 清单项目的增删改；项目变化只更新记录的修改时间，不改版本号。 */
export function checklistItemRoutes(deps: AppDeps) {
  /** 当前用户未删除的清单，否则 404；同时在事务内锁住这条记录。 */
  async function findChecklist(db: Executor, userId: string, recordId: string) {
    const [row] = await db
      .select({ type: records.type, deletedAt: records.deletedAt })
      .from(records)
      .where(and(eq(records.userId, userId), eq(records.id, recordId)))
      .for('update');
    if (row === undefined || row.deletedAt !== null || row.type !== 'checklist') {
      throw notFound();
    }
  }

  async function touchRecord(db: Executor, userId: string, recordId: string, now: Date) {
    await db
      .update(records)
      .set({ updatedAt: now })
      .where(and(eq(records.userId, userId), eq(records.id, recordId)));
  }

  return new Hono<AppEnv>()
    .use(requireAuth(deps))
    .post('/:id/items', async (c) => {
      const { userId } = c.get('auth');
      const recordId = uuidParam(c, 'id');
      const input = await readJson(c, createChecklistItemRequestSchema);
      const now = deps.now();
      const item = await deps.db.transaction(async (tx) => {
        await findChecklist(tx, userId, recordId);
        const [stats] = await tx
          .select({ total: count(), last: max(checklistItems.sortOrder) })
          .from(checklistItems)
          .where(
            and(eq(checklistItems.userId, userId), eq(checklistItems.recordId, recordId)),
          );
        if ((stats?.total ?? 0) >= MAX_CHECKLIST_ITEMS) {
          throw validationFailed({ title: `一个清单最多 ${MAX_CHECKLIST_ITEMS} 项` });
        }
        const [row] = await tx
          .insert(checklistItems)
          .values({
            userId,
            recordId,
            groupName: input.groupName,
            title: input.title,
            notes: input.notes,
            quantity: input.quantity,
            unit: input.unit,
            isDone: input.isDone,
            doneAt: input.isDone ? now : null,
            sortOrder: (stats?.last ?? -1) + 1,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        await touchRecord(tx, userId, recordId, now);
        return row;
      });
      if (item === undefined) {
        throw new Error('Insert did not return the item.');
      }
      const body: ChecklistItem = toChecklistItem(item);
      return c.json(body, 201);
    })
    .patch('/:id/items/:itemId', async (c) => {
      const { userId } = c.get('auth');
      const recordId = uuidParam(c, 'id');
      const itemId = uuidParam(c, 'itemId');
      const input = await readJson(c, updateChecklistItemRequestSchema);
      const now = deps.now();
      const item = await deps.db.transaction(async (tx) => {
        await findChecklist(tx, userId, recordId);
        const [row] = await tx
          .update(checklistItems)
          .set({
            ...(input.groupName === undefined ? {} : { groupName: input.groupName }),
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.notes === undefined ? {} : { notes: input.notes }),
            ...(input.quantity === undefined ? {} : { quantity: input.quantity }),
            ...(input.unit === undefined ? {} : { unit: input.unit }),
            ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
            ...(input.isDone === undefined
              ? {}
              : {
                  isDone: input.isDone,
                  // 已勾选的再次勾选时保留原来的完成时间。
                  doneAt: input.isDone
                    ? sql`coalesce(${checklistItems.doneAt}, ${now.toISOString()}::timestamptz)`
                    : null,
                }),
            updatedAt: now,
          })
          .where(
            and(
              eq(checklistItems.userId, userId),
              eq(checklistItems.recordId, recordId),
              eq(checklistItems.id, itemId),
            ),
          )
          .returning();
        if (row === undefined) {
          throw notFound('项目不存在');
        }
        await touchRecord(tx, userId, recordId, now);
        return row;
      });
      const body: ChecklistItem = toChecklistItem(item);
      return c.json(body);
    })
    .delete('/:id/items/:itemId', async (c) => {
      const { userId } = c.get('auth');
      const recordId = uuidParam(c, 'id');
      const itemId = uuidParam(c, 'itemId');
      const now = deps.now();
      await deps.db.transaction(async (tx) => {
        await findChecklist(tx, userId, recordId);
        const deleted = await tx
          .delete(checklistItems)
          .where(
            and(
              eq(checklistItems.userId, userId),
              eq(checklistItems.recordId, recordId),
              eq(checklistItems.id, itemId),
            ),
          )
          .returning({ id: checklistItems.id });
        if (deleted.length === 0) {
          throw notFound('项目不存在');
        }
        await touchRecord(tx, userId, recordId, now);
      });
      return c.body(null, 204);
    })
    .post('/:id/items/complete-all', async (c) => {
      const { userId } = c.get('auth');
      const recordId = uuidParam(c, 'id');
      const input = await readJson(c, completeAllRequestSchema);
      const now = deps.now();
      await deps.db.transaction(async (tx) => {
        await findChecklist(tx, userId, recordId);
        await tx
          .update(checklistItems)
          .set({ isDone: input.done, doneAt: input.done ? now : null, updatedAt: now })
          .where(
            and(
              eq(checklistItems.userId, userId),
              eq(checklistItems.recordId, recordId),
              // 只改状态不同的项目，已勾选的保留原来的完成时间。
              eq(checklistItems.isDone, !input.done),
            ),
          );
        await touchRecord(tx, userId, recordId, now);
      });
      const record = await loadRecord(deps.db, userId, recordId, deps.now());
      if (record === undefined) {
        throw notFound();
      }
      return c.json(record);
    })
    .post('/:id/save-as-template', async (c) => {
      const { userId } = c.get('auth');
      const recordId = uuidParam(c, 'id');
      const input = await readJson(c, saveAsTemplateRequestSchema);
      const record = await loadRecord(deps.db, userId, recordId, deps.now());
      if (record?.checklist == null || record.deletedAt !== null) {
        throw notFound();
      }
      const checklist = record.checklist;
      // 模板只保存项目本身，不带勾选状态。
      const templateId = await deps.db.transaction((tx) =>
        insertTemplate(tx, {
          userId,
          title:
            input.title === undefined || input.title === '' ? record.title : input.title,
          notes: record.notes,
          items: checklist.items.map((item) => ({
            groupName: item.groupName,
            title: item.title,
            quantity: item.quantity,
            unit: item.unit,
          })),
          now: deps.now(),
        }),
      );
      return c.json(await loadTemplate(deps.db, userId, templateId), 201);
    });
}

import {
  type AddToShoppingListResponse,
  addToShoppingListRequestSchema,
  computeStockChange,
  createStockTransactionRequestSchema,
  MAX_CHECKLIST_ITEMS,
  type StockTransactionListResponse,
  type StockTransactionResult,
} from '@life-book/core';
import { and, count, desc, eq, isNull, max } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

import { requireAuth } from '../auth/middleware';
import { type Executor, isUniqueViolation } from '../db/client';
import {
  checklistItems,
  checklists,
  householdItems,
  records,
  stockTransactions,
} from '../db/schema';
import { type AppDeps, type AppEnv } from '../http/context';
import { notFound, validationFailed } from '../http/errors';
import { readJson } from '../http/validate';
import { toHouseholdItem, toStockTransaction } from './mappers';
import { lowStockUpdate, writeChecklist } from './repository';

const MAX_LISTED_TRANSACTIONS = 100;

function recordIdParam(c: Context): string {
  const result = z.uuid().safeParse(c.req.param('id'));
  if (!result.success) {
    throw notFound();
  }
  return result.data;
}

/** 当前用户未删除的家庭物品（行锁），否则 404。 */
async function lockHouseholdItem(db: Executor, userId: string, recordId: string) {
  const [row] = await db
    .select({ item: householdItems, record: records })
    .from(householdItems)
    .innerJoin(
      records,
      and(
        eq(records.id, householdItems.recordId),
        eq(records.userId, householdItems.userId),
      ),
    )
    .where(and(eq(householdItems.userId, userId), eq(householdItems.recordId, recordId)))
    .for('update');
  if (row === undefined || row.record.deletedAt !== null) {
    throw notFound();
  }
  return row;
}

export function householdRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .use(requireAuth(deps))
    .get('/:id/stock-transactions', async (c) => {
      const { userId } = c.get('auth');
      const recordId = recordIdParam(c);
      const [item] = await deps.db
        .select({ recordId: householdItems.recordId })
        .from(householdItems)
        .where(
          and(eq(householdItems.userId, userId), eq(householdItems.recordId, recordId)),
        );
      if (item === undefined) {
        throw notFound();
      }
      const rows = await deps.db
        .select()
        .from(stockTransactions)
        .where(
          and(
            eq(stockTransactions.userId, userId),
            eq(stockTransactions.recordId, recordId),
          ),
        )
        .orderBy(desc(stockTransactions.createdAt), desc(stockTransactions.id))
        .limit(MAX_LISTED_TRANSACTIONS);
      const body: StockTransactionListResponse = { items: rows.map(toStockTransaction) };
      return c.json(body);
    })
    .post('/:id/stock-transactions', async (c) => {
      const { userId } = c.get('auth');
      const recordId = recordIdParam(c);
      const input = await readJson(c, createStockTransactionRequestSchema);
      const now = deps.now();

      // 同一个事务里锁住物品、算出新数量，再写流水和新数量。
      const body = await deps.db.transaction(
        async (tx): Promise<StockTransactionResult> => {
          const { item } = await lockHouseholdItem(tx, userId, recordId);
          const change = computeStockChange(item.quantity, input);
          if (!change.ok) {
            throw validationFailed({ amount: change.message });
          }
          const correctsId = input.kind === 'adjust' ? input.correctsId : null;
          if (correctsId !== null) {
            const [corrected] = await tx
              .select({ id: stockTransactions.id })
              .from(stockTransactions)
              .where(
                and(
                  eq(stockTransactions.userId, userId),
                  eq(stockTransactions.recordId, recordId),
                  eq(stockTransactions.id, correctsId),
                ),
              );
            if (corrected === undefined) {
              throw validationFailed({ correctsId: '要更正的流水不存在' });
            }
          }
          const [transaction] = await tx
            .insert(stockTransactions)
            .values({
              userId,
              recordId,
              kind: input.kind,
              delta: change.delta,
              quantityAfter: change.quantityAfter,
              occurredAt: now,
              note: input.note,
              correctsId,
              createdAt: now,
            })
            .returning();
          const [updated] = await tx
            .update(householdItems)
            .set({
              quantity: change.quantityAfter,
              ...lowStockUpdate(item, change.quantityAfter, item.lowStockThreshold, now),
              updatedAt: now,
            })
            .where(
              and(
                eq(householdItems.userId, userId),
                eq(householdItems.recordId, recordId),
              ),
            )
            .returning();
          await tx
            .update(records)
            .set({ updatedAt: now })
            .where(and(eq(records.userId, userId), eq(records.id, recordId)));
          if (transaction === undefined || updated === undefined) {
            throw new Error('Stock update did not return rows.');
          }
          return {
            item: toHouseholdItem(updated),
            transaction: toStockTransaction(transaction),
          };
        },
      );
      return c.json(body, 201);
    })
    .post('/:id/low-stock-notified', async (c) => {
      const { userId } = c.get('auth');
      const recordId = recordIdParam(c);
      const input = await readJson(
        c,
        z.object({ since: z.iso.datetime({ offset: true }) }),
      );
      // 只标记手机排好的那一次低库存；之后又恢复再变低时会重新提醒。
      await deps.db
        .update(householdItems)
        .set({ lowStockNotifiedAt: deps.now() })
        .where(
          and(
            eq(householdItems.userId, userId),
            eq(householdItems.recordId, recordId),
            eq(householdItems.lowStockSince, new Date(input.since)),
            isNull(householdItems.lowStockNotifiedAt),
          ),
        );
      return c.body(null, 204);
    })
    .post('/:id/add-to-shopping-list', async (c) => {
      const { userId } = c.get('auth');
      const recordId = recordIdParam(c);
      const input = await readJson(c, addToShoppingListRequestSchema);
      const now = deps.now();

      const add = () =>
        deps.db.transaction(async (tx): Promise<AddToShoppingListResponse> => {
          const { item, record } = await lockHouseholdItem(tx, userId, recordId);

          // 目标清单：指定的、最近修改的未完成采购清单，或者新建一个。
          let checklistId = input.checklistId;
          if (checklistId !== undefined) {
            const [target] = await tx
              .select({ id: records.id })
              .from(records)
              .innerJoin(
                checklists,
                and(
                  eq(checklists.recordId, records.id),
                  eq(checklists.userId, records.userId),
                ),
              )
              .where(
                and(
                  eq(records.userId, userId),
                  eq(records.id, checklistId),
                  isNull(records.deletedAt),
                ),
              );
            if (target === undefined) {
              throw validationFailed({ checklistId: '采购清单不存在' });
            }
          } else {
            const [latest] = await tx
              .select({ id: records.id })
              .from(records)
              .innerJoin(
                checklists,
                and(
                  eq(checklists.recordId, records.id),
                  eq(checklists.userId, records.userId),
                ),
              )
              .where(
                and(
                  eq(records.userId, userId),
                  eq(checklists.purpose, 'shopping'),
                  isNull(records.deletedAt),
                  isNull(records.archivedAt),
                ),
              )
              .orderBy(desc(records.updatedAt))
              .limit(1);
            checklistId = latest?.id;
          }
          if (checklistId === undefined) {
            const [created] = await tx
              .insert(records)
              .values({
                userId,
                type: 'checklist',
                title: '采购清单',
                createdAt: now,
                updatedAt: now,
              })
              .returning({ id: records.id });
            if (created === undefined) {
              throw new Error('Insert did not return the record.');
            }
            checklistId = created.id;
            await writeChecklist(
              tx,
              { userId, recordId: checklistId, now },
              { purpose: 'shopping', dueAt: null, items: [] },
            );
          }

          // 同一物品在同一清单里只有一条未完成的采购项。
          const [existing] = await tx
            .select({ id: checklistItems.id })
            .from(checklistItems)
            .where(
              and(
                eq(checklistItems.userId, userId),
                eq(checklistItems.recordId, checklistId),
                eq(checklistItems.householdItemId, recordId),
                eq(checklistItems.isDone, false),
              ),
            );
          if (existing !== undefined) {
            return { checklistId, itemId: existing.id, created: false };
          }
          const [stats] = await tx
            .select({ total: count(), last: max(checklistItems.sortOrder) })
            .from(checklistItems)
            .where(
              and(
                eq(checklistItems.userId, userId),
                eq(checklistItems.recordId, checklistId),
              ),
            );
          if ((stats?.total ?? 0) >= MAX_CHECKLIST_ITEMS) {
            throw validationFailed({
              checklistId: `一个清单最多 ${MAX_CHECKLIST_ITEMS} 项`,
            });
          }
          const [inserted] = await tx
            .insert(checklistItems)
            .values({
              userId,
              recordId: checklistId,
              title: record.title,
              unit: item.unit,
              householdItemId: recordId,
              sortOrder: (stats?.last ?? -1) + 1,
              createdAt: now,
              updatedAt: now,
            })
            .returning({ id: checklistItems.id });
          await tx
            .update(records)
            .set({ updatedAt: now })
            .where(and(eq(records.userId, userId), eq(records.id, checklistId)));
          if (inserted === undefined) {
            throw new Error('Insert did not return the item.');
          }
          return { checklistId, itemId: inserted.id, created: true };
        });

      try {
        return c.json(await add());
      } catch (error) {
        // 两次添加同时到达时，唯一索引会拦下后一次；重试一次即可读到已有的项目。
        if (isUniqueViolation(error)) {
          return c.json(await add());
        }
        throw error;
      }
    });
}

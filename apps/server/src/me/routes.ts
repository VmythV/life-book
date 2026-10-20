import {
  deleteAccountRequestSchema,
  EXPORT_FORMAT_VERSION,
  type MeResponse,
  updateSettingsRequestSchema,
} from '@life-book/core';
import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { clearSessionCookie, requireAuth } from '../auth/middleware';
import { verifyPassword } from '../auth/password';
import { RateLimiter } from '../auth/rate-limit';
import {
  categories,
  occurrences,
  records,
  stockTransactions,
  tags,
  userSettings,
  users,
} from '../db/schema';
import { type AppDeps, type AppEnv } from '../http/context';
import { ApiError, unauthenticated } from '../http/errors';
import { readJson } from '../http/validate';
import { loadRecords } from '../records/repository';
import { loadTemplates } from '../templates/repository';
import { toSettingsDto, toUserDto } from '../users/mappers';

const MINUTE_MS = 60 * 1000;

export function meRoutes(deps: AppDeps) {
  const deleteLimiter = new RateLimiter(10, 15 * MINUTE_MS);

  return new Hono<AppEnv>()
    .use(requireAuth(deps))
    .get('/', async (c) => {
      const { userId } = c.get('auth');
      const [row] = await deps.db
        .select({ user: users, settings: userSettings })
        .from(users)
        .innerJoin(userSettings, eq(userSettings.userId, users.id))
        .where(eq(users.id, userId));
      if (row === undefined) {
        throw unauthenticated();
      }
      const body: MeResponse = {
        user: toUserDto(row.user),
        settings: toSettingsDto(row.settings),
      };
      return c.json(body);
    })
    .patch('/settings', async (c) => {
      const { userId } = c.get('auth');
      const input = await readJson(c, updateSettingsRequestSchema);
      const [row] = await deps.db
        .update(userSettings)
        .set({
          ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
          ...(input.defaultReminderTime === undefined
            ? {}
            : { defaultReminderTime: input.defaultReminderTime }),
          ...(input.weekStartsOn === undefined
            ? {}
            : { weekStartsOn: input.weekStartsOn }),
          updatedAt: deps.now(),
        })
        .where(eq(userSettings.userId, userId))
        .returning();
      if (row === undefined) {
        throw unauthenticated();
      }
      return c.json(toSettingsDto(row));
    })
    .get('/export', async (c) => {
      const { userId } = c.get('auth');
      const [row] = await deps.db
        .select({ user: users, settings: userSettings })
        .from(users)
        .innerJoin(userSettings, eq(userSettings.userId, users.id))
        .where(eq(users.id, userId));
      if (row === undefined) {
        throw unauthenticated();
      }
      const recordIds = await deps.db
        .select({ id: records.id })
        .from(records)
        .where(eq(records.userId, userId))
        .orderBy(asc(records.createdAt));
      const [categoryRows, tagRows, occurrenceRows, stockRows, templates, allRecords] =
        await Promise.all([
          deps.db.select().from(categories).where(eq(categories.userId, userId)),
          deps.db.select().from(tags).where(eq(tags.userId, userId)),
          deps.db
            .select()
            .from(occurrences)
            .where(eq(occurrences.userId, userId))
            .orderBy(asc(occurrences.occurrenceDate)),
          deps.db
            .select()
            .from(stockTransactions)
            .where(eq(stockTransactions.userId, userId))
            .orderBy(asc(stockTransactions.createdAt)),
          loadTemplates(deps.db, userId),
          loadRecords(
            deps.db,
            userId,
            recordIds.map((record) => record.id),
            deps.now(),
          ),
        ]);
      const filename = `life-book-${row.user.username}-${deps.now().toISOString().slice(0, 10)}.json`;
      c.header('content-disposition', `attachment; filename="${filename}"`);
      // 导出包含账号下的全部数据，包括已归档和回收站里的记录；不含密码和会话。
      return c.json({
        format: 'life-book-export',
        version: EXPORT_FORMAT_VERSION,
        exportedAt: deps.now().toISOString(),
        user: toUserDto(row.user),
        settings: toSettingsDto(row.settings),
        categories: categoryRows.map(({ id, name, color, sortOrder }) => ({
          id,
          name,
          color,
          sortOrder,
        })),
        tags: tagRows.map(({ id, name, color }) => ({ id, name, color })),
        records: allRecords,
        occurrences: occurrenceRows.map((occurrence) => ({
          recordId: occurrence.recordId,
          date: occurrence.occurrenceDate,
          status: occurrence.status,
          handledAt: occurrence.handledAt.toISOString(),
        })),
        stockTransactions: stockRows.map((transaction) => ({
          recordId: transaction.recordId,
          id: transaction.id,
          kind: transaction.kind,
          delta: transaction.delta,
          quantityAfter: transaction.quantityAfter,
          occurredAt: transaction.occurredAt.toISOString(),
          note: transaction.note,
          correctsId: transaction.correctsId,
        })),
        templates,
      });
    })
    .delete('/', async (c) => {
      const now = deps.now();
      const { userId } = c.get('auth');
      const limitKey = `delete-account:${userId}`;
      if (deleteLimiter.isLimited(limitKey, now)) {
        throw new ApiError(429, 'TOO_MANY_REQUESTS', '尝试次数过多，请稍后再试');
      }
      const input = await readJson(c, deleteAccountRequestSchema);
      const [user] = await deps.db.select().from(users).where(eq(users.id, userId));
      if (user === undefined) {
        throw unauthenticated();
      }
      if (!(await verifyPassword(input.password, user.passwordHash))) {
        deleteLimiter.hit(limitKey, now);
        throw new ApiError(400, 'WRONG_PASSWORD', '密码不正确');
      }
      // 所有表都以 user_id 级联删除：会话、设置、记录及其子表、分类、标签、模板。
      await deps.db.delete(users).where(eq(users.id, userId));
      clearSessionCookie(c);
      return c.body(null, 204);
    });
}

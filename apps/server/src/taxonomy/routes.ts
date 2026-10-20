import {
  createTaxonomyRequestSchema,
  reorderRequestSchema,
  type Taxonomy,
  type TaxonomyListResponse,
  updateTaxonomyRequestSchema,
} from '@life-book/core';
import { and, asc, eq, sql } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

import { requireAuth } from '../auth/middleware';
import { isUniqueViolation } from '../db/client';
import { categories, records, tags } from '../db/schema';
import { type AppDeps, type AppEnv } from '../http/context';
import { ApiError, notFound } from '../http/errors';
import { readJson } from '../http/validate';

const toDto = (row: { id: string; name: string; color: string | null }): Taxonomy => ({
  id: row.id,
  name: row.name,
  color: row.color,
});

function idParam(c: Context): string {
  const result = z.uuid().safeParse(c.req.param('id'));
  if (!result.success) {
    throw notFound('不存在');
  }
  return result.data;
}

const nameTaken = () => new ApiError(409, 'NAME_TAKEN', '已经有同名的了');

/** 分类和标签：列出、新建（重名时返回已有的那个）、重命名和删除。 */
function taxonomyRoutes(deps: AppDeps, table: typeof categories | typeof tags) {
  const label = table === categories ? '分类' : '标签';
  const orderBy =
    table === categories
      ? [asc(categories.sortOrder), asc(categories.name)]
      : [asc(table.name)];

  return new Hono<AppEnv>()
    .use(requireAuth(deps))
    .get('/', async (c) => {
      const rows = await deps.db
        .select()
        .from(table)
        .where(eq(table.userId, c.get('auth').userId))
        .orderBy(...orderBy);
      const body: TaxonomyListResponse = { items: rows.map(toDto) };
      return c.json(body);
    })
    .post('/', async (c) => {
      const { userId } = c.get('auth');
      const input = await readJson(c, createTaxonomyRequestSchema);
      const now = deps.now();
      const [created] = await deps.db
        .insert(table)
        .values({
          userId,
          name: input.name,
          createdAt: now,
          updatedAt: now,
          // 新分类排在最后。
          ...(table === categories
            ? {
                sortOrder: sql`(select coalesce(max(${categories.sortOrder}), -1) + 1 from ${categories} where ${categories.userId} = ${userId})`,
              }
            : {}),
        })
        .onConflictDoNothing()
        .returning();
      if (created !== undefined) {
        return c.json(toDto(created), 201);
      }
      const [existing] = await deps.db
        .select()
        .from(table)
        .where(
          and(eq(table.userId, userId), sql`lower(${table.name}) = lower(${input.name})`),
        );
      if (existing === undefined) {
        throw new Error('Taxonomy insert conflicted but no existing row was found.');
      }
      return c.json(toDto(existing), 200);
    })
    .patch('/:id', async (c) => {
      const { userId } = c.get('auth');
      const input = await readJson(c, updateTaxonomyRequestSchema);
      try {
        const [row] = await deps.db
          .update(table)
          .set({ name: input.name, updatedAt: deps.now() })
          .where(and(eq(table.userId, userId), eq(table.id, idParam(c))))
          .returning();
        if (row === undefined) {
          throw notFound(`${label}不存在`);
        }
        return c.json(toDto(row));
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw nameTaken();
        }
        throw error;
      }
    })
    .delete('/:id', async (c) => {
      const { userId } = c.get('auth');
      const id = idParam(c);
      await deps.db.transaction(async (tx) => {
        if (table === categories) {
          // 记录的分类外键不会自动置空，先清空再删除；记录本身不算修改。
          await tx
            .update(records)
            .set({ categoryId: null })
            .where(and(eq(records.userId, userId), eq(records.categoryId, id)));
        }
        const deleted = await tx
          .delete(table)
          .where(and(eq(table.userId, userId), eq(table.id, id)))
          .returning({ id: table.id });
        if (deleted.length === 0) {
          throw notFound(`${label}不存在`);
        }
      });
      return c.body(null, 204);
    });
}

export const categoryRoutes = (deps: AppDeps) =>
  taxonomyRoutes(deps, categories).post('/reorder', async (c) => {
    const { userId } = c.get('auth');
    const input = await readJson(c, reorderRequestSchema);
    await deps.db.transaction(async (tx) => {
      // 没有列出的分类排在最后，保持它们原来的相对顺序。
      await tx
        .update(categories)
        .set({ sortOrder: sql`${categories.sortOrder} + ${input.ids.length}` })
        .where(eq(categories.userId, userId));
      for (const [index, id] of input.ids.entries()) {
        await tx
          .update(categories)
          .set({ sortOrder: index })
          .where(and(eq(categories.userId, userId), eq(categories.id, id)));
      }
    });
    const rows = await deps.db
      .select()
      .from(categories)
      .where(eq(categories.userId, userId))
      .orderBy(asc(categories.sortOrder), asc(categories.name));
    const body: TaxonomyListResponse = { items: rows.map(toDto) };
    return c.json(body);
  });

export const tagRoutes = (deps: AppDeps) => taxonomyRoutes(deps, tags);

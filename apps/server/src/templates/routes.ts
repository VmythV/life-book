import {
  createTemplateRequestSchema,
  instantiateTemplateRequestSchema,
  type TemplateListResponse,
  updateTemplateRequestSchema,
} from '@life-book/core';
import { and, eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

import { requireAuth } from '../auth/middleware';
import { isUniqueViolation } from '../db/client';
import { checklistTemplates, records } from '../db/schema';
import { type AppDeps, type AppEnv } from '../http/context';
import { ApiError, notFound } from '../http/errors';
import { readJson } from '../http/validate';
import { loadRecord, writeChecklist } from '../records/repository';
import {
  insertTemplate,
  loadTemplate,
  loadTemplates,
  replaceTemplateItems,
} from './repository';

function templateIdParam(c: Context): string {
  const result = z.uuid().safeParse(c.req.param('id'));
  if (!result.success) {
    throw notFound('模板不存在');
  }
  return result.data;
}

export function templateRoutes(deps: AppDeps) {
  async function respondWithTemplate(
    c: Context<AppEnv>,
    id: string,
    status: 200 | 201 = 200,
  ) {
    const template = await loadTemplate(deps.db, c.get('auth').userId, id);
    if (template === undefined) {
      throw notFound('模板不存在');
    }
    return c.json(template, status);
  }

  return new Hono<AppEnv>()
    .use(requireAuth(deps))
    .get('/', async (c) => {
      const body: TemplateListResponse = {
        items: await loadTemplates(deps.db, c.get('auth').userId),
      };
      return c.json(body);
    })
    .post('/', async (c) => {
      const { userId } = c.get('auth');
      const input = await readJson(c, createTemplateRequestSchema);
      const id = await deps.db.transaction((tx) =>
        insertTemplate(tx, { userId, ...input, now: deps.now() }),
      );
      return respondWithTemplate(c, id, 201);
    })
    .get('/:id', (c) => respondWithTemplate(c, templateIdParam(c)))
    .patch('/:id', async (c) => {
      const { userId } = c.get('auth');
      const id = templateIdParam(c);
      const input = await readJson(c, updateTemplateRequestSchema);
      await deps.db.transaction(async (tx) => {
        const updated = await tx
          .update(checklistTemplates)
          .set({
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.notes === undefined ? {} : { notes: input.notes }),
            updatedAt: deps.now(),
          })
          .where(
            and(eq(checklistTemplates.userId, userId), eq(checklistTemplates.id, id)),
          )
          .returning({ id: checklistTemplates.id });
        if (updated.length === 0) {
          throw notFound('模板不存在');
        }
        if (input.items !== undefined) {
          await replaceTemplateItems(tx, userId, id, input.items);
        }
      });
      return respondWithTemplate(c, id);
    })
    .delete('/:id', async (c) => {
      const { userId } = c.get('auth');
      const deleted = await deps.db
        .delete(checklistTemplates)
        .where(
          and(
            eq(checklistTemplates.userId, userId),
            eq(checklistTemplates.id, templateIdParam(c)),
          ),
        )
        .returning({ id: checklistTemplates.id });
      if (deleted.length === 0) {
        throw notFound('模板不存在');
      }
      return c.body(null, 204);
    })
    .post('/:id/instantiate', async (c) => {
      const { userId } = c.get('auth');
      const templateId = templateIdParam(c);
      const input = await readJson(c, instantiateTemplateRequestSchema);
      const template = await loadTemplate(deps.db, userId, templateId);
      if (template === undefined) {
        throw notFound('模板不存在');
      }
      const now = deps.now();

      // 与新建记录相同的幂等规则：同一个 ID 重复提交返回已创建的清单。
      const existing = async () => {
        if (input.id === undefined) {
          return undefined;
        }
        const [row] = await deps.db
          .select({ userId: records.userId })
          .from(records)
          .where(eq(records.id, input.id));
        if (row !== undefined && row.userId !== userId) {
          throw new ApiError(409, 'ID_CONFLICT', '记录 ID 已被使用，请重新提交');
        }
        return row === undefined
          ? undefined
          : loadRecord(deps.db, userId, input.id, deps.now());
      };
      const before = await existing();
      if (before !== undefined) {
        return c.json(before);
      }

      let recordId: string;
      try {
        recordId = await deps.db.transaction(async (tx) => {
          const [row] = await tx
            .insert(records)
            .values({
              ...(input.id === undefined ? {} : { id: input.id }),
              userId,
              type: 'checklist',
              title:
                input.title === undefined || input.title === ''
                  ? template.title
                  : input.title,
              notes: template.notes,
              createdAt: now,
              updatedAt: now,
            })
            .returning({ id: records.id });
          if (row === undefined) {
            throw new Error('Insert did not return the record.');
          }
          await writeChecklist(
            tx,
            { userId, recordId: row.id, now },
            {
              purpose: 'general',
              dueAt: input.dueAt,
              items: template.items.map((item) => ({ ...item, notes: null })),
            },
            template.id,
          );
          return row.id;
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          const after = await existing();
          if (after !== undefined) {
            return c.json(after);
          }
        }
        throw error;
      }
      const record = await loadRecord(deps.db, userId, recordId, deps.now());
      return c.json(record, 201);
    });
}

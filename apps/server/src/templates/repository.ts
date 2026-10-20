import { type ChecklistTemplate } from '@life-book/core';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import { type Executor } from '../db/client';
import { checklistTemplateItems, checklistTemplates } from '../db/schema';

export interface TemplateItemData {
  groupName: string | null;
  title: string;
  quantity: number | null;
  unit: string | null;
}

/** 读取当前用户的模板；不传 `ids` 时读取全部，按修改时间倒序。 */
export async function loadTemplates(
  db: Executor,
  userId: string,
  ids?: string[],
): Promise<ChecklistTemplate[]> {
  const rows = await db
    .select()
    .from(checklistTemplates)
    .where(
      and(
        eq(checklistTemplates.userId, userId),
        ids === undefined ? undefined : inArray(checklistTemplates.id, ids),
      ),
    )
    .orderBy(desc(checklistTemplates.updatedAt), desc(checklistTemplates.id));
  if (rows.length === 0) {
    return [];
  }
  const items = await db
    .select()
    .from(checklistTemplateItems)
    .where(
      and(
        eq(checklistTemplateItems.userId, userId),
        inArray(
          checklistTemplateItems.templateId,
          rows.map((row) => row.id),
        ),
      ),
    )
    .orderBy(asc(checklistTemplateItems.sortOrder));
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    notes: row.notes,
    items: items
      .filter((item) => item.templateId === row.id)
      .map((item) => ({
        id: item.id,
        groupName: item.groupName,
        title: item.title,
        quantity: item.quantity,
        unit: item.unit,
        sortOrder: item.sortOrder,
      })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function loadTemplate(
  db: Executor,
  userId: string,
  id: string,
): Promise<ChecklistTemplate | undefined> {
  const [template] = await loadTemplates(db, userId, [id]);
  return template;
}

/** 整体替换模板的项目，按提交顺序排序。 */
export async function replaceTemplateItems(
  tx: Executor,
  userId: string,
  templateId: string,
  items: TemplateItemData[],
): Promise<void> {
  await tx
    .delete(checklistTemplateItems)
    .where(
      and(
        eq(checklistTemplateItems.userId, userId),
        eq(checklistTemplateItems.templateId, templateId),
      ),
    );
  if (items.length === 0) {
    return;
  }
  await tx.insert(checklistTemplateItems).values(
    items.map((item, index) => ({
      userId,
      templateId,
      groupName: item.groupName,
      title: item.title,
      quantity: item.quantity,
      unit: item.unit,
      sortOrder: index,
    })),
  );
}

/** 新建模板并写入项目，返回模板 ID。 */
export async function insertTemplate(
  tx: Executor,
  input: {
    userId: string;
    title: string;
    notes: string | null;
    items: TemplateItemData[];
    now: Date;
  },
): Promise<string> {
  const [row] = await tx
    .insert(checklistTemplates)
    .values({
      userId: input.userId,
      title: input.title,
      notes: input.notes,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning({ id: checklistTemplates.id });
  if (row === undefined) {
    throw new Error('Insert did not return the template.');
  }
  await replaceTemplateItems(tx, input.userId, row.id, input.items);
  return row.id;
}

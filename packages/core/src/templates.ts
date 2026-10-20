import { z } from 'zod';

import { checklistItemInputSchema, MAX_CHECKLIST_ITEMS } from './checklists';

const templateItemsSchema = z
  .array(checklistItemInputSchema.omit({ notes: true }))
  .max(MAX_CHECKLIST_ITEMS, { error: `最多 ${MAX_CHECKLIST_ITEMS} 项` });

const templateTitleSchema = z
  .string()
  .trim()
  .min(1, { error: '请填写模板名称' })
  .max(200, { error: '名称太长了' });

const templateNotesSchema = z
  .string()
  .max(20_000, { error: '内容太长了' })
  .nullable()
  .transform((value) => (value === null || value.trim() === '' ? null : value));

/** 清单模板：和从它创建的清单互相独立，修改一方不影响另一方。 */
export const createTemplateRequestSchema = z.object({
  title: templateTitleSchema,
  notes: templateNotesSchema.default(null),
  items: templateItemsSchema.default([]),
});
export type CreateTemplateRequest = z.input<typeof createTemplateRequestSchema>;

/** 修改模板；`items` 提交时整体替换。 */
export const updateTemplateRequestSchema = z.object({
  title: templateTitleSchema.optional(),
  notes: templateNotesSchema.optional(),
  items: templateItemsSchema.optional(),
});
export type UpdateTemplateRequest = z.input<typeof updateTemplateRequestSchema>;

export const templateItemSchema = z.object({
  id: z.uuid(),
  groupName: z.string().nullable(),
  title: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  sortOrder: z.number().int(),
});
export type TemplateItem = z.infer<typeof templateItemSchema>;

export const templateSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  notes: z.string().nullable(),
  items: z.array(templateItemSchema),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type ChecklistTemplate = z.infer<typeof templateSchema>;

export const templateListResponseSchema = z.object({ items: z.array(templateSchema) });
export type TemplateListResponse = z.infer<typeof templateListResponseSchema>;

/** 从模板创建清单；标题默认用模板名称。 */
export const instantiateTemplateRequestSchema = z.object({
  /** 客户端生成的记录 ID，重复提交时返回同一条记录。 */
  id: z.uuid().optional(),
  title: z.string().trim().max(200).optional(),
  dueAt: z.iso.datetime({ offset: true }).nullable().default(null),
});
export type InstantiateTemplateRequest = z.input<typeof instantiateTemplateRequestSchema>;

/** 把清单另存为模板；名称默认用清单标题。 */
export const saveAsTemplateRequestSchema = z.object({
  title: z.string().trim().max(200).optional(),
});
export type SaveAsTemplateRequest = z.input<typeof saveAsTemplateRequestSchema>;

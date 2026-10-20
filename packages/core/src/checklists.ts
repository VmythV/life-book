import { z } from 'zod';

export const checklistPurposes = ['general', 'shopping'] as const;
export type ChecklistPurpose = (typeof checklistPurposes)[number];

export const CHECKLIST_PURPOSE_LABELS: Record<ChecklistPurpose, string> = {
  general: '普通清单',
  shopping: '采购清单',
};

export const MAX_CHECKLIST_ITEMS = 500;

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, { message })
    .nullable()
    .transform((value) => (value === null || value === '' ? null : value));

/** 数量最多 3 位小数，与数据库的 numeric(12,3) 一致。 */
export const quantitySchema = z
  .number({ error: '请填写数量' })
  .min(0, { error: '数量不能为负' })
  .max(999_999_999, { error: '数量太大了' })
  .refine((value) => Math.round(value * 1000) / 1000 === value, {
    message: '数量最多 3 位小数',
  });

/**
 * 项目的各字段，不带默认值：zod 4 里 `.default()` 再 `.optional()` 仍会补上默认值，
 * 修改接口复用时会把没提交的字段清空。默认值只加在新建用的 schema 上。
 */
const itemFields = {
  /** 分组名；为空表示未分组。 */
  groupName: optionalText(30, '分组名最多 30 个字'),
  title: z
    .string()
    .trim()
    .min(1, { error: '请填写项目' })
    .max(200, { error: '项目名称太长了' }),
  notes: optionalText(1000, '备注太长了'),
  quantity: quantitySchema.nullable(),
  unit: optionalText(10, '单位最多 10 个字'),
};

export const checklistItemInputSchema = z.object({
  ...itemFields,
  groupName: itemFields.groupName.default(null),
  notes: itemFields.notes.default(null),
  quantity: itemFields.quantity.default(null),
  unit: itemFields.unit.default(null),
});
export type ChecklistItemInput = z.input<typeof checklistItemInputSchema>;

export const checklistItemSchema = z.object({
  id: z.uuid(),
  groupName: z.string().nullable(),
  title: z.string(),
  notes: z.string().nullable(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  isDone: z.boolean(),
  doneAt: z.iso.datetime({ offset: true }).nullable(),
  sortOrder: z.number().int(),
  /** 采购清单里关联的家庭物品。 */
  householdItemId: z.uuid().nullable(),
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

/** 新建清单时的详情；项目可以一起提交，之后用项目接口增删改。 */
const purposeSchema = z.enum(checklistPurposes);
const dueAtSchema = z.iso.datetime({ offset: true, error: '请填写截止时间' }).nullable();

export const checklistInputSchema = z.object({
  purpose: purposeSchema.default('general'),
  dueAt: dueAtSchema.default(null),
  items: z
    .array(checklistItemInputSchema)
    .max(MAX_CHECKLIST_ITEMS, { error: `最多 ${MAX_CHECKLIST_ITEMS} 项` })
    .default([]),
});
export type ChecklistInput = z.input<typeof checklistInputSchema>;
export type ChecklistData = z.output<typeof checklistInputSchema>;

/** 修改记录时只改清单本身的设置，项目通过项目接口修改。 */
export const checklistSettingsSchema = z.object({
  purpose: purposeSchema.optional(),
  dueAt: dueAtSchema.optional(),
});
export type ChecklistSettingsData = z.output<typeof checklistSettingsSchema>;

export const checklistSchema = z.object({
  purpose: z.enum(checklistPurposes),
  dueAt: z.iso.datetime({ offset: true }).nullable(),
  /** 从哪个模板创建；模板删除后仍保留，只作说明。 */
  sourceTemplateId: z.uuid().nullable(),
  items: z.array(checklistItemSchema),
});
export type Checklist = z.infer<typeof checklistSchema>;

export const createChecklistItemRequestSchema = checklistItemInputSchema.extend({
  isDone: z.boolean().default(false),
});
export type CreateChecklistItemRequest = z.input<typeof createChecklistItemRequestSchema>;

export const updateChecklistItemRequestSchema = z.object({
  groupName: itemFields.groupName.optional(),
  title: itemFields.title.optional(),
  notes: itemFields.notes.optional(),
  quantity: itemFields.quantity.optional(),
  unit: itemFields.unit.optional(),
  isDone: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});
export type UpdateChecklistItemRequest = z.input<typeof updateChecklistItemRequestSchema>;

export const completeAllRequestSchema = z.object({ done: z.boolean().default(true) });
export type CompleteAllRequest = z.input<typeof completeAllRequestSchema>;

export interface ChecklistProgress {
  done: number;
  total: number;
  /** 全部项目都勾选才算完成；空清单不算完成。 */
  isComplete: boolean;
}

/** 全部有效项目都勾选即完成；空清单不算完成。 */
export function isChecklistComplete(done: number, total: number): boolean {
  return total > 0 && done === total;
}

export function checklistProgress(
  items: readonly { isDone: boolean }[],
): ChecklistProgress {
  const done = items.filter((item) => item.isDone).length;
  return {
    done,
    total: items.length,
    isComplete: isChecklistComplete(done, items.length),
  };
}

export interface ChecklistGroup<TItem> {
  /** `null` 表示未分组。 */
  name: string | null;
  items: TItem[];
}

/** 按分组展示：未分组的在最前，其余分组按第一次出现的顺序，组内按排序号。 */
export function groupChecklistItems<
  TItem extends { groupName: string | null; sortOrder: number },
>(items: readonly TItem[]): ChecklistGroup<TItem>[] {
  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
  const groups = new Map<string | null, TItem[]>([[null, []]]);
  for (const item of sorted) {
    const list = groups.get(item.groupName) ?? [];
    list.push(item);
    groups.set(item.groupName, list);
  }
  return [...groups.entries()]
    .filter(([, list]) => list.length > 0)
    .map(([name, list]) => ({ name, items: list }));
}

/** “2 个”“1.5 kg”；没有数量时返回 `null`。 */
export function describeQuantity(
  quantity: number | null,
  unit: string | null,
): string | null {
  if (quantity === null) {
    return unit;
  }
  return unit === null ? String(quantity) : `${quantity} ${unit}`;
}

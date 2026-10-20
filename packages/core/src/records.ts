import { z } from 'zod';

import {
  checklistInputSchema,
  checklistSchema,
  checklistSettingsSchema,
} from './checklists';
import { localDateSchema } from './dates';
import {
  householdItemInputSchema,
  householdItemSchema,
  householdSettingsSchema,
} from './household';
import { importantDateSchema } from './important-dates';
import { recordTypeSchema, type RecordType } from './record-types';
import { recurrenceRuleSchema } from './recurrence';
import {
  MAX_REMINDERS_PER_RECORD,
  type ReminderInput,
  reminderInputSchema,
  reminderSchema,
} from './reminders';

export const MAX_TITLE_LENGTH = 200;
export const MAX_NOTES_LENGTH = 20_000;
export const MAX_TAGS_PER_RECORD = 20;

const titleSchema = z.string().trim().max(MAX_TITLE_LENGTH, { message: '标题太长了' });
/** 空白正文按“没有正文”保存。 */
const notesSchema = z
  .string()
  .max(MAX_NOTES_LENGTH, { message: '内容太长了' })
  .nullable()
  .transform((value) => (value === null || value.trim() === '' ? null : value));
const tagIdsSchema = z
  .array(z.uuid())
  .max(MAX_TAGS_PER_RECORD)
  .transform((ids) => [...new Set(ids)]);
const remindersSchema = z.array(reminderInputSchema).max(MAX_REMINDERS_PER_RECORD);

export interface RecordContent {
  type: RecordType;
  title: string;
  notes: string | null;
  reminders: ReminderInput[];
}

/** 跨字段的内容规则，新建和修改后都要满足。返回字段名到错误信息。 */
export function recordContentIssues(record: RecordContent): Record<string, string> {
  const issues: Record<string, string> = {};
  if (record.type === 'memo') {
    if (record.title === '' && record.notes === null) {
      issues.title = '标题和内容不能都为空';
    }
  } else if (record.title === '') {
    issues.title = '请填写标题';
  }
  if (record.type === 'household_item') {
    // 家庭物品只有低库存时的自动提醒。
    if (record.reminders.length > 0) {
      issues.reminders = '家庭物品不需要设置提醒，低库存时会自动提醒一次';
    }
    return issues;
  }
  // 备忘和清单在具体时刻提醒；重复日常和重要日期相对每次发生的日期提醒。
  const expectedKind =
    record.type === 'memo' || record.type === 'checklist' ? 'absolute' : 'relative';
  if (record.reminders.some((reminder) => reminder.kind !== expectedKind)) {
    issues.reminders =
      expectedKind === 'absolute'
        ? '提醒需要具体的日期和时间'
        : '提醒应相对每次发生的日期';
  }
  return issues;
}

const baseCreateFields = {
  /** 客户端生成的 ID，重复提交时返回同一条记录。 */
  id: z.uuid().optional(),
  title: titleSchema.default(''),
  notes: notesSchema.default(null),
  categoryId: z.uuid().nullable().default(null),
  tagIds: tagIdsSchema.default([]),
  isPinned: z.boolean().default(false),
  reminders: remindersSchema.default([]),
};

export const createRecordRequestSchema = z
  .discriminatedUnion('type', [
    z.object({
      ...baseCreateFields,
      type: z.literal('recurring'),
      recurring: recurrenceRuleSchema,
    }),
    z.object({
      ...baseCreateFields,
      type: z.literal('important_date'),
      importantDate: importantDateSchema,
    }),
    z.object({ ...baseCreateFields, type: z.literal('memo') }),
    z.object({
      ...baseCreateFields,
      type: z.literal('checklist'),
      checklist: checklistInputSchema.default({
        purpose: 'general',
        dueAt: null,
        items: [],
      }),
    }),
    z.object({
      ...baseCreateFields,
      type: z.literal('household_item'),
      householdItem: householdItemInputSchema,
    }),
  ])
  .superRefine((record, ctx) => {
    for (const [field, message] of Object.entries(recordContentIssues(record))) {
      ctx.addIssue({ code: 'custom', path: [field], message });
    }
  });
export type CreateRecordRequest = z.input<typeof createRecordRequestSchema>;
export type CreateRecordData = z.output<typeof createRecordRequestSchema>;

/** 修改记录。省略的字段保持不变；`reminders` 和类型详情整体替换。 */
export const updateRecordRequestSchema = z.object({
  version: z.number().int().min(1),
  title: titleSchema.optional(),
  notes: notesSchema.optional(),
  categoryId: z.uuid().nullable().optional(),
  tagIds: tagIdsSchema.optional(),
  isPinned: z.boolean().optional(),
  recurring: recurrenceRuleSchema.optional(),
  importantDate: importantDateSchema.optional(),
  checklist: checklistSettingsSchema.optional(),
  householdItem: householdSettingsSchema.optional(),
  reminders: remindersSchema.optional(),
});
export type UpdateRecordRequest = z.input<typeof updateRecordRequestSchema>;
export type UpdateRecordData = z.output<typeof updateRecordRequestSchema>;

const timestampSchema = z.iso.datetime({ offset: true });

export const recordSchema = z.object({
  id: z.uuid(),
  type: recordTypeSchema,
  title: z.string(),
  notes: z.string().nullable(),
  categoryId: z.uuid().nullable(),
  tagIds: z.array(z.uuid()),
  isPinned: z.boolean(),
  archivedAt: timestampSchema.nullable(),
  deletedAt: timestampSchema.nullable(),
  version: z.number().int(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  recurring: recurrenceRuleSchema.nullable(),
  importantDate: importantDateSchema.nullable(),
  checklist: checklistSchema.nullable(),
  householdItem: householdItemSchema.nullable(),
  reminders: z.array(reminderSchema),
  /**
   * 重复日常下一次待完成的实际日期（按用户时区的今天算，已考虑改期、完成和跳过）；
   * 规则已结束或不是重复日常时为 `null`。
   */
  nextOccurrenceDate: localDateSchema.nullable(),
});
export type LifeRecord = z.infer<typeof recordSchema>;

export const recordStatuses = ['active', 'archived', 'trash'] as const;

export const recordListQuerySchema = z.object({
  type: recordTypeSchema.optional(),
  categoryId: z.uuid().optional(),
  tagId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
  status: z.enum(recordStatuses).default('active'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
});
// `limit` 在查询字符串里是文本，schema 用 coerce 解析；客户端传数字。
export type RecordListQuery = Omit<z.input<typeof recordListQuerySchema>, 'limit'> & {
  limit?: number;
};

export const recordListResponseSchema = z.object({
  items: z.array(recordSchema),
  nextCursor: z.string().nullable(),
});
export type RecordListResponse = z.infer<typeof recordListResponseSchema>;

// ---- 周期实例 ----

export const handledOccurrenceStatuses = ['completed', 'skipped'] as const;
export const occurrenceStatuses = [
  'pending',
  'overdue',
  ...handledOccurrenceStatuses,
] as const;
export type OccurrenceStatus = (typeof occurrenceStatuses)[number];
export type HandledOccurrenceStatus = (typeof handledOccurrenceStatuses)[number];

export const setOccurrenceRequestSchema = z.object({
  status: z.enum(handledOccurrenceStatuses),
});
export type SetOccurrenceRequest = z.input<typeof setOccurrenceRequestSchema>;

export const occurrenceSchema = z.object({
  recordId: z.uuid(),
  /** 实际日期；改期后是新的日期。 */
  date: localDateSchema,
  /** 原定日期，操作这个实例时使用。 */
  originalDate: localDateSchema,
  status: z.enum(occurrenceStatuses),
  handledAt: timestampSchema.nullable(),
});
export type Occurrence = z.infer<typeof occurrenceSchema>;

export const occurrenceRangeQuerySchema = z
  .object({ from: localDateSchema, to: localDateSchema })
  .refine((range) => range.from <= range.to, { message: '开始日期不能晚于结束日期' });

export const occurrenceListResponseSchema = z.object({
  items: z.array(occurrenceSchema),
});
export type OccurrenceListResponse = z.infer<typeof occurrenceListResponseSchema>;

// ---- 分类和标签 ----

export const taxonomySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  color: z.string().nullable(),
});
export type Taxonomy = z.infer<typeof taxonomySchema>;

const taxonomyNameSchema = z
  .string()
  .trim()
  .min(1, { message: '请输入名称' })
  .max(30, { message: '名称最多 30 个字' });

export const createTaxonomyRequestSchema = z.object({ name: taxonomyNameSchema });
export type CreateTaxonomyRequest = z.input<typeof createTaxonomyRequestSchema>;

/** 重命名；与已有名称重复（不区分大小写）时返回 409 `NAME_TAKEN`。 */
export const updateTaxonomyRequestSchema = z.object({ name: taxonomyNameSchema });
export type UpdateTaxonomyRequest = z.input<typeof updateTaxonomyRequestSchema>;

/** 按给定顺序重新排列分类；没有列出的分类排在后面。 */
export const reorderRequestSchema = z.object({ ids: z.array(z.uuid()).max(500) });
export type ReorderRequest = z.input<typeof reorderRequestSchema>;

export const taxonomyListResponseSchema = z.object({ items: z.array(taxonomySchema) });
export type TaxonomyListResponse = z.infer<typeof taxonomyListResponseSchema>;

/** 回收站里的记录保留的天数，过期后每天自动永久删除。 */
export const TRASH_RETENTION_DAYS = 30;

/**
 * 还有几天会被永久删除：不足一天按一天算，刚删除时是 30 天；
 * 已到期、等待每天的清理任务时为 0。
 */
export function trashDaysLeft(deletedAt: string, now: Date): number {
  const expiresAt = Date.parse(deletedAt) + TRASH_RETENTION_DAYS * 86_400_000;
  return Math.max(0, Math.ceil((expiresAt - now.getTime()) / 86_400_000));
}

/** “30 天后永久删除”；已到期的显示“即将永久删除”。 */
export function describeTrashExpiry(deletedAt: string, now: Date): string {
  const days = trashDaysLeft(deletedAt, now);
  return days === 0 ? '即将永久删除' : `${days} 天后永久删除`;
}

// ---- 批量操作（Web） ----

export const batchActions = [
  'archive',
  'unarchive',
  'delete',
  'restore',
  'setCategory',
  'addTags',
] as const;

export const batchRequestSchema = z
  .object({
    ids: z
      .array(z.uuid())
      .min(1, { message: '请选择记录' })
      .max(200, { message: '一次最多 200 条' }),
    action: z.enum(batchActions),
    /** `setCategory` 时使用；`null` 表示清除分类。 */
    categoryId: z.uuid().nullable().optional(),
    /** `addTags` 时使用。 */
    tagIds: tagIdsSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === 'setCategory' && value.categoryId === undefined) {
      ctx.addIssue({ code: 'custom', path: ['categoryId'], message: '请选择分类' });
    }
    if (
      value.action === 'addTags' &&
      (value.tagIds === undefined || value.tagIds.length === 0)
    ) {
      ctx.addIssue({ code: 'custom', path: ['tagIds'], message: '请选择标签' });
    }
  });
export type BatchRequest = z.input<typeof batchRequestSchema>;

export const batchResponseSchema = z.object({
  /** 实际改动的记录数；不属于当前用户或状态不符的记录会被跳过。 */
  updated: z.number().int().min(0),
});
export type BatchResponse = z.infer<typeof batchResponseSchema>;

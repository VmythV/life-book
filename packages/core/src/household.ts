import { z } from 'zod';

import { quantitySchema } from './checklists';

export const stockKinds = [
  'opening',
  'purchase',
  'consume',
  'adjust',
  'discard',
  'lost',
] as const;
export type StockKind = (typeof stockKinds)[number];

export const STOCK_KIND_LABELS: Record<StockKind, string> = {
  opening: '期初',
  purchase: '买入',
  consume: '使用',
  adjust: '调整',
  discard: '报废',
  lost: '丢失',
};

/** 按增减量提交的流水；期初和调整按目标数量提交，由服务端算出增减量。 */
export const deltaStockKinds = ['purchase', 'consume', 'discard', 'lost'] as const;
export type DeltaStockKind = (typeof deltaStockKinds)[number];

const unitSchema = z
  .string()
  .trim()
  .min(1, { error: '请填写单位，如“个”“包”“kg”' })
  .max(10, { error: '单位最多 10 个字' });

const locationSchema = z
  .string()
  .trim()
  .max(50, { error: '位置最多 50 个字' })
  .nullable()
  .transform((value) => (value === null || value === '' ? null : value));

/** 新建家庭物品：`quantity` 是期初数量，会记为一条“期初”流水。 */
export const householdItemInputSchema = z.object({
  unit: unitSchema,
  quantity: quantitySchema.default(0),
  lowStockThreshold: quantitySchema.nullable().default(null),
  location: locationSchema.default(null),
});
export type HouseholdItemInput = z.input<typeof householdItemInputSchema>;
export type HouseholdItemData = z.output<typeof householdItemInputSchema>;

/** 修改物品的设置；数量只能通过库存流水改变。 */
export const householdSettingsSchema = z.object({
  unit: unitSchema.optional(),
  lowStockThreshold: quantitySchema.nullable().optional(),
  location: locationSchema.optional(),
});
export type HouseholdSettingsData = z.output<typeof householdSettingsSchema>;

export const householdItemSchema = z.object({
  unit: z.string(),
  quantity: z.number(),
  lowStockThreshold: z.number().nullable(),
  location: z.string().nullable(),
  isLowStock: z.boolean(),
  /** 当前这次低库存从何时开始；恢复后为 `null`。 */
  lowStockSince: z.iso.datetime({ offset: true }).nullable(),
});
export type HouseholdItem = z.infer<typeof householdItemSchema>;

export const stockTransactionSchema = z.object({
  id: z.uuid(),
  kind: z.enum(stockKinds),
  delta: z.number(),
  quantityAfter: z.number(),
  occurredAt: z.iso.datetime({ offset: true }),
  note: z.string().nullable(),
  correctsId: z.uuid().nullable(),
});
export type StockTransaction = z.infer<typeof stockTransactionSchema>;

export const stockTransactionListResponseSchema = z.object({
  items: z.array(stockTransactionSchema),
});
export type StockTransactionListResponse = z.infer<
  typeof stockTransactionListResponseSchema
>;

const noteSchema = z
  .string()
  .trim()
  .max(200, { error: '备注最多 200 个字' })
  .nullable()
  .transform((value) => (value === null || value === '' ? null : value))
  .default(null);

export const createStockTransactionRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.enum(deltaStockKinds),
    amount: quantitySchema.refine((value) => value > 0, { message: '数量要大于 0' }),
    note: noteSchema,
  }),
  z.object({
    kind: z.literal('adjust'),
    /** 调整后的数量。 */
    quantity: quantitySchema,
    note: noteSchema,
    /** 改错时指向被更正的那条流水。 */
    correctsId: z.uuid().nullable().default(null),
  }),
]);
export type CreateStockTransactionRequest = z.input<
  typeof createStockTransactionRequestSchema
>;
export type StockTransactionData = z.output<typeof createStockTransactionRequestSchema>;

/** 写流水后的结果：物品和新的流水。 */
export const stockTransactionResultSchema = z.object({
  item: householdItemSchema,
  transaction: stockTransactionSchema,
});
export type StockTransactionResult = z.infer<typeof stockTransactionResultSchema>;

// 数量按千分之一的整数计算，避免浮点误差。
const toMilli = (value: number) => Math.round(value * 1000);
const fromMilli = (value: number) => value / 1000;

export type StockChange =
  { ok: true; delta: number; quantityAfter: number } | { ok: false; message: string };

/** 计算一条流水的增减量和结果数量；结果为负时拒绝。 */
export function computeStockChange(
  current: number,
  request: StockTransactionData,
): StockChange {
  const before = toMilli(current);
  let after: number;
  if (request.kind === 'adjust') {
    after = toMilli(request.quantity);
  } else {
    const amount = toMilli(request.amount);
    after = request.kind === 'purchase' ? before + amount : before - amount;
  }
  if (after < 0) {
    return { ok: false, message: `库存不足，当前只有 ${current}` };
  }
  return { ok: true, delta: fromMilli(after - before), quantityAfter: fromMilli(after) };
}

/** 当前数量不高于最低库存即“低库存”；没有设置最低库存时永远不算。 */
export function isLowStock(quantity: number, threshold: number | null): boolean {
  return threshold !== null && toMilli(quantity) <= toMilli(threshold);
}

/**
 * 数量或阈值变化后低库存状态的变化：
 * - `entered`：从正常变成低库存，记下开始时间，之后提醒一次；
 * - `left`：恢复到阈值以上，清空开始时间和提醒标记；
 * - `none`：状态没变。
 */
export function lowStockTransition(
  wasLow: boolean,
  quantity: number,
  threshold: number | null,
): 'entered' | 'left' | 'none' {
  const low = isLowStock(quantity, threshold);
  if (low === wasLow) {
    return 'none';
  }
  return low ? 'entered' : 'left';
}

/** 添加到采购清单的结果。 */
export const addToShoppingListRequestSchema = z.object({
  /** 指定的采购清单；不传时用最近修改的一个，没有就新建。 */
  checklistId: z.uuid().optional(),
});
export type AddToShoppingListRequest = z.input<typeof addToShoppingListRequestSchema>;

export const addToShoppingListResponseSchema = z.object({
  checklistId: z.uuid(),
  itemId: z.uuid(),
  /** `false` 表示清单里已有这件物品，没有重复添加。 */
  created: z.boolean(),
});
export type AddToShoppingListResponse = z.infer<typeof addToShoppingListResponseSchema>;

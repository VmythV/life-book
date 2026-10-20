import { describe, expect, it } from 'vitest';

import {
  checklistInputSchema,
  checklistProgress,
  checklistSettingsSchema,
  describeQuantity,
  groupChecklistItems,
  quantitySchema,
  toChecklistItemDraft,
  toChecklistItemUpdate,
  updateChecklistItemRequestSchema,
  validateChecklistItemDraft,
} from './checklists';

describe('checklistProgress', () => {
  it('is complete only when every item is done and the list is not empty', () => {
    expect(checklistProgress([])).toEqual({ done: 0, total: 0, isComplete: false });
    expect(checklistProgress([{ isDone: true }, { isDone: false }])).toEqual({
      done: 1,
      total: 2,
      isComplete: false,
    });
    expect(checklistProgress([{ isDone: true }]).isComplete).toBe(true);
  });
});

describe('groupChecklistItems', () => {
  it('puts ungrouped items first and keeps groups in order of appearance', () => {
    const item = (title: string, groupName: string | null, sortOrder: number) => ({
      title,
      groupName,
      sortOrder,
    });
    const groups = groupChecklistItems([
      item('牙刷', '洗漱', 2),
      item('护照', null, 0),
      item('充电器', '电子', 1),
      item('毛巾', '洗漱', 3),
    ]);
    expect(groups.map((group) => [group.name, group.items.map((i) => i.title)])).toEqual([
      [null, ['护照']],
      ['电子', ['充电器']],
      ['洗漱', ['牙刷', '毛巾']],
    ]);
  });
});

describe('checklist schemas', () => {
  it('normalizes empty optional text to null', () => {
    expect(
      checklistInputSchema.parse({
        items: [{ title: ' 鸡蛋 ', groupName: ' ', unit: '', quantity: 12 }],
      }),
    ).toEqual({
      purpose: 'general',
      dueAt: null,
      items: [{ title: '鸡蛋', groupName: null, notes: null, unit: null, quantity: 12 }],
    });
  });

  it('leaves out fields a partial update does not send', () => {
    expect(updateChecklistItemRequestSchema.parse({ isDone: true })).toEqual({
      isDone: true,
    });
    expect(updateChecklistItemRequestSchema.parse({ groupName: ' ' })).toEqual({
      groupName: null,
    });
    expect(checklistSettingsSchema.parse({ dueAt: null })).toEqual({ dueAt: null });
  });

  it('allows up to three decimals for quantities', () => {
    expect(quantitySchema.safeParse(1.125).success).toBe(true);
    expect(quantitySchema.safeParse(0.1).success).toBe(true);
    expect(quantitySchema.safeParse(1.1234).success).toBe(false);
    expect(quantitySchema.safeParse(-1).success).toBe(false);
  });

  it('describes quantities', () => {
    expect(describeQuantity(1.5, 'kg')).toBe('1.5 kg');
    expect(describeQuantity(2, null)).toBe('2');
    expect(describeQuantity(null, null)).toBeNull();
  });
});

describe('checklist item drafts', () => {
  it('round-trips an item and normalizes empty text', () => {
    const draft = toChecklistItemDraft({
      id: '01a15256-d783-72e5-8e2d-150e2e1c6400',
      groupName: null,
      title: '鸡蛋',
      notes: null,
      quantity: 1.5,
      unit: 'kg',
      isDone: false,
      doneAt: null,
      sortOrder: 0,
      householdItemId: null,
    });
    expect(draft).toEqual({ title: '鸡蛋', groupName: '', quantity: '1.5', unit: 'kg' });
    expect(
      updateChecklistItemRequestSchema.parse(
        toChecklistItemUpdate({ ...draft, quantity: ' ', groupName: '冷藏 ' }),
      ),
    ).toEqual({ title: '鸡蛋', groupName: '冷藏', quantity: null, unit: 'kg' });
  });

  it('rejects a non-numeric quantity before it is sent', () => {
    expect(
      validateChecklistItemDraft({
        title: '鸡蛋',
        groupName: '',
        quantity: '一打',
        unit: '',
      }),
    ).toEqual({ data: null, error: '请填写数量' });
    expect(
      validateChecklistItemDraft({ title: ' ', groupName: '', quantity: '', unit: '' })
        .error,
    ).toBe('请填写项目');
  });
});

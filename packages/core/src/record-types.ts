import { z } from 'zod';

export const recordTypes = [
  'recurring',
  'important_date',
  'memo',
  'checklist',
  'household_item',
] as const;
export const recordTypeSchema = z.enum(recordTypes);
export type RecordType = z.infer<typeof recordTypeSchema>;

/** 可以新建的类型，也是“新建”菜单的顺序。 */
export const creatableRecordTypes = [
  'recurring',
  'important_date',
  'memo',
  'checklist',
  'household_item',
] as const;
export type CreatableRecordType = (typeof creatableRecordTypes)[number];

export function isCreatableRecordType(type: string): type is CreatableRecordType {
  return (creatableRecordTypes as readonly string[]).includes(type);
}

export const RECORD_TYPE_LABELS: Record<RecordType, string> = {
  recurring: '重复日常',
  important_date: '重要日期',
  memo: '备忘',
  checklist: '清单',
  household_item: '家庭物品',
};

/** 列表和通知中显示的标题：备忘可以没有标题，此时取正文第一行。 */
export function displayTitle(record: { title: string; notes: string | null }): string {
  if (record.title !== '') {
    return record.title;
  }
  const firstLine = (record.notes ?? '').trim().split('\n')[0]?.trim() ?? '';
  if (firstLine === '') {
    return '无标题';
  }
  return firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine;
}

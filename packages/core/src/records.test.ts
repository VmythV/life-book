import { describe, expect, it } from 'vitest';

import { displayTitle } from './record-types';
import {
  createRecordRequestSchema,
  describeTrashExpiry,
  trashDaysLeft,
  updateRecordRequestSchema,
} from './records';

const rule = {
  startDate: '2026-10-20',
  freq: 'weekly',
  interval: 1,
  byWeekdays: [1, 4],
  byMonthDay: null,
  timeOfDay: '09:00',
  end: { type: 'never' },
};

describe('createRecordRequestSchema', () => {
  it('fills defaults for a recurring record', () => {
    expect(
      createRecordRequestSchema.parse({
        type: 'recurring',
        title: ' 给绿植浇水 ',
        recurring: rule,
      }),
    ).toEqual({
      type: 'recurring',
      title: '给绿植浇水',
      notes: null,
      categoryId: null,
      tagIds: [],
      isPinned: false,
      reminders: [],
      recurring: rule,
    });
  });

  it('requires a title except for memos with content', () => {
    expect(
      createRecordRequestSchema.safeParse({
        type: 'recurring',
        title: ' ',
        recurring: rule,
      }).success,
    ).toBe(false);
    expect(
      createRecordRequestSchema.safeParse({ type: 'memo', notes: '  ' }).success,
    ).toBe(false);
    expect(
      createRecordRequestSchema.parse({ type: 'memo', notes: 'Wi-Fi 密码' }),
    ).toMatchObject({ title: '', notes: 'Wi-Fi 密码' });
  });

  it('checks reminder kinds against the record type', () => {
    expect(
      createRecordRequestSchema.safeParse({
        type: 'memo',
        title: '带身份证',
        reminders: [{ kind: 'relative', daysBefore: 0, timeOfDay: null }],
      }).success,
    ).toBe(false);
    expect(
      createRecordRequestSchema.safeParse({
        type: 'recurring',
        title: '浇水',
        recurring: rule,
        reminders: [{ kind: 'absolute', fireAt: '2026-10-20T01:00:00Z' }],
      }).success,
    ).toBe(false);
  });

  it('rejects the details of another type', () => {
    expect(
      createRecordRequestSchema.safeParse({
        type: 'important_date',
        title: '生日',
        recurring: rule,
      }).success,
    ).toBe(false);
  });
});

describe('updateRecordRequestSchema', () => {
  it('requires the version and keeps omitted fields absent', () => {
    expect(updateRecordRequestSchema.safeParse({ title: 'x' }).success).toBe(false);
    expect(updateRecordRequestSchema.parse({ version: 2, notes: '' })).toEqual({
      version: 2,
      notes: null,
    });
  });
});

describe('displayTitle', () => {
  it('falls back to the first line of the notes', () => {
    expect(displayTitle({ title: '', notes: '\n  第一行 \n第二行' })).toBe('第一行');
    expect(displayTitle({ title: '', notes: null })).toBe('无标题');
    expect(displayTitle({ title: '标题', notes: '正文' })).toBe('标题');
  });
});

describe('trashDaysLeft', () => {
  const deletedAt = '2026-10-01T08:00:00.000Z';

  it('rounds partial days up so a fresh deletion shows the full retention', () => {
    expect(trashDaysLeft(deletedAt, new Date('2026-10-01T08:00:01Z'))).toBe(30);
    expect(trashDaysLeft(deletedAt, new Date('2026-10-30T09:00:00Z'))).toBe(1);
    expect(trashDaysLeft(deletedAt, new Date('2026-10-31T08:00:00Z'))).toBe(0);
    expect(trashDaysLeft(deletedAt, new Date('2026-11-02T00:00:00Z'))).toBe(0);
  });

  it('describes the expiry', () => {
    expect(describeTrashExpiry(deletedAt, new Date('2026-10-02T08:00:00Z'))).toBe(
      '29 天后永久删除',
    );
    expect(describeTrashExpiry(deletedAt, new Date('2026-11-01T00:00:00Z'))).toBe(
      '即将永久删除',
    );
  });
});

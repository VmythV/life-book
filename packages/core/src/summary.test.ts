import { describe, expect, it } from 'vitest';

import { type LifeRecord } from './records';
import { describeRecordSummary } from './summary';

const base: LifeRecord = {
  id: '01a15256-d783-72e5-8e2d-150e2e1c6400',
  type: 'memo',
  title: '',
  notes: null,
  categoryId: null,
  tagIds: [],
  isPinned: false,
  archivedAt: null,
  deletedAt: null,
  version: 1,
  createdAt: '2026-10-19T02:00:00.000Z',
  updatedAt: '2026-10-19T02:00:00.000Z',
  recurring: null,
  importantDate: null,
  checklist: null,
  householdItem: null,
  reminders: [],
  nextOccurrenceDate: null,
};

describe('describeRecordSummary', () => {
  it('describes the rule and the next occurrence', () => {
    expect(
      describeRecordSummary(
        {
          ...base,
          type: 'recurring',
          title: '浇水',
          recurring: {
            startDate: '2026-10-01',
            freq: 'weekly',
            interval: 1,
            byWeekdays: [4],
            byMonthDay: null,
            timeOfDay: null,
            end: { type: 'never' },
          },
          nextOccurrenceDate: '2026-10-22',
        },
        '2026-10-19',
        'Asia/Shanghai',
      ),
    ).toBe('每周四 · 下次 10月22日 周四');
  });

  it('says a recurring record has ended when there is no next date', () => {
    expect(
      describeRecordSummary(
        {
          ...base,
          type: 'recurring',
          title: '复健',
          recurring: {
            startDate: '2026-09-01',
            freq: 'daily',
            interval: 1,
            byWeekdays: [],
            byMonthDay: null,
            timeOfDay: null,
            end: { type: 'count', count: 10 },
          },
        },
        '2026-10-19',
        'Asia/Shanghai',
      ),
    ).toBe('每天，共 10 次 · 已结束');
  });

  it('shows how far away an important date is', () => {
    expect(
      describeRecordSummary(
        {
          ...base,
          type: 'important_date',
          title: '生日',
          importantDate: {
            kind: 'birthday',
            repeat: 'yearly',
            year: null,
            month: 10,
            day: 20,
            startYear: null,
            showCounter: true,
          },
        },
        '2026-10-19',
        'Asia/Shanghai',
      ),
    ).toBe('明天');
  });

  it('shows checklist progress and the due time', () => {
    const item = (isDone: boolean) => ({
      id: '01a15256-d783-72e5-8e2d-150e2e1c6401',
      groupName: null,
      title: 'x',
      notes: null,
      quantity: null,
      unit: null,
      isDone,
      doneAt: null,
      sortOrder: 0,
      householdItemId: null,
    });
    const checklist = (items: ReturnType<typeof item>[], dueAt: string | null) => ({
      ...base,
      type: 'checklist' as const,
      title: '行李',
      checklist: { purpose: 'general' as const, dueAt, sourceTemplateId: null, items },
    });
    expect(
      describeRecordSummary(
        checklist([item(true), item(false)], '2026-10-20T12:00:00Z'),
        '2026-10-19',
        'Asia/Shanghai',
      ),
    ).toBe('1/2 · 截止 明天 20:00');
    expect(
      describeRecordSummary(checklist([], null), '2026-10-19', 'Asia/Shanghai'),
    ).toBe('还没有项目');
  });

  it('shows the start of a memo only when it has a separate title', () => {
    expect(
      describeRecordSummary(
        { ...base, title: 'Wi-Fi', notes: ' 密码\n abc ' },
        '2026-10-19',
        'Asia/Shanghai',
      ),
    ).toBe('密码 abc');
    expect(
      describeRecordSummary(
        { ...base, notes: '密码 abc' },
        '2026-10-19',
        'Asia/Shanghai',
      ),
    ).toBe('');
  });
});

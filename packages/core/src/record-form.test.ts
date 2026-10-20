import { describe, expect, it } from 'vitest';

import { initialRecordFormState, toRecordRequest } from './record-form';
import { createRecordRequestSchema, type LifeRecord } from './records';

const base: Omit<
  LifeRecord,
  'type' | 'recurring' | 'importantDate' | 'checklist' | 'householdItem' | 'reminders'
> = {
  id: '01a15256-d783-72e5-8e2d-150e2e1c6400',
  title: '标题',
  notes: null,
  categoryId: null,
  tagIds: [],
  isPinned: true,
  archivedAt: null,
  deletedAt: null,
  version: 3,
  createdAt: '2026-10-19T02:00:00.000Z',
  updatedAt: '2026-10-19T02:00:00.000Z',
};

describe('record form model', () => {
  it('round-trips a recurring record', () => {
    const record: LifeRecord = {
      ...base,
      type: 'recurring',
      recurring: {
        startDate: '2026-10-01',
        freq: 'weekly',
        interval: 2,
        byWeekdays: [1, 4],
        byMonthDay: null,
        timeOfDay: '07:30',
        end: { type: 'count', count: 8 },
      },
      importantDate: null,
      checklist: null,
      householdItem: null,
      reminders: [
        {
          id: '01a15256-d783-72e5-8e2d-150e2e1c6401',
          enabled: true,
          kind: 'relative',
          daysBefore: 1,
          timeOfDay: null,
        },
      ],
    };
    const state = initialRecordFormState(
      'recurring',
      '2026-10-19',
      'Asia/Shanghai',
      record,
    );
    const request = createRecordRequestSchema.parse(
      toRecordRequest('recurring', state, 'Asia/Shanghai'),
    );
    expect(request).toMatchObject({
      title: '标题',
      isPinned: true,
      recurring: record.recurring,
      reminders: [{ kind: 'relative', daysBefore: 1, timeOfDay: null }],
    });
  });

  it('converts absolute reminders with the user’s time zone', () => {
    const state = initialRecordFormState('memo', '2026-10-19', 'Asia/Shanghai');
    state.notes = '带身份证';
    state.reminders = [{ kind: 'absolute', date: '2026-10-20', time: '14:00' }];
    expect(toRecordRequest('memo', state, 'Asia/Shanghai').reminders).toEqual([
      { kind: 'absolute', fireAt: '2026-10-20T06:00:00.000Z' },
    ]);
  });

  it('only sends the year of one-off important dates', () => {
    const state = initialRecordFormState('important_date', '2026-10-19', 'Asia/Shanghai');
    state.title = '护照到期';
    state.importantDate = { ...state.importantDate, kind: 'expiry', date: '2031-05-31' };
    expect(toRecordRequest('important_date', state, 'Asia/Shanghai')).toMatchObject({
      importantDate: { repeat: 'yearly', year: null, month: 5, day: 31 },
    });
    state.importantDate.repeat = 'once';
    expect(toRecordRequest('important_date', state, 'Asia/Shanghai')).toMatchObject({
      importantDate: { repeat: 'once', year: 2031 },
    });
  });

  it('leaves invalid numbers for the schema to report', () => {
    const state = initialRecordFormState('recurring', '2026-10-19', 'Asia/Shanghai');
    state.title = '浇水';
    state.recurring.interval = '';
    const result = createRecordRequestSchema.safeParse(
      toRecordRequest('recurring', state, 'Asia/Shanghai'),
    );
    expect(result.error?.issues[0]?.message).toBe('请填写间隔');
  });
});

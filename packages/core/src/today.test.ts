import { describe, expect, it } from 'vitest';

import { recurrenceRuleSchema } from './recurrence';
import { buildToday, occurrenceStatus, type TodayInput } from './today';

const ids = {
  water: '01a15256-d783-72e5-8e2d-150e2e1c6410',
  pills: '01a15256-d783-72e5-8e2d-150e2e1c6411',
  fee: '01a15256-d783-72e5-8e2d-150e2e1c6412',
  mom: '01a15256-d783-72e5-8e2d-150e2e1c6413',
  memo: '01a15256-d783-72e5-8e2d-150e2e1c6414',
  reminder: '01a15256-d783-72e5-8e2d-150e2e1c6415',
};

function daily(startDate: string, timeOfDay: string | null = null) {
  return recurrenceRuleSchema.parse({
    startDate,
    freq: 'daily',
    interval: 1,
    byWeekdays: null,
    byMonthDay: null,
    timeOfDay,
    end: { type: 'never' },
  });
}

const input: TodayInput = {
  date: '2026-10-19',
  timeZone: 'Asia/Shanghai',
  recurring: [
    {
      recordId: ids.pills,
      title: '吃维生素',
      rule: daily('2026-10-16', '21:00'),
      stored: new Map([['2026-10-16', { status: 'completed', rescheduledTo: null }]]),
    },
    {
      recordId: ids.water,
      title: '给绿植浇水',
      rule: daily('2026-10-19'),
      stored: new Map([['2026-10-19', { status: 'completed', rescheduledTo: null }]]),
    },
    {
      recordId: ids.fee,
      title: '交物业费',
      rule: recurrenceRuleSchema.parse({
        startDate: '2026-01-15',
        freq: 'monthly',
        interval: 1,
        byWeekdays: null,
        byMonthDay: 15,
        timeOfDay: null,
        end: { type: 'never' },
      }),
      stored: new Map(),
    },
  ],
  importantDates: [
    {
      recordId: ids.mom,
      title: '妈妈的生日',
      value: {
        kind: 'birthday',
        repeat: 'yearly',
        year: null,
        month: 10,
        day: 24,
        startYear: 1966,
        showCounter: true,
      },
    },
    {
      recordId: '01a15256-d783-72e5-8e2d-150e2e1c6416',
      title: '太远的纪念日',
      value: {
        kind: 'anniversary',
        repeat: 'yearly',
        year: null,
        month: 12,
        day: 1,
        startYear: null,
        showCounter: true,
      },
    },
  ],
  lowStock: [
    {
      recordId: '01a15256-d783-72e5-8e2d-150e2e1c6420',
      title: '洗衣液',
      quantity: 0.5,
      unit: '瓶',
      threshold: 1,
      location: '阳台',
    },
  ],
  checklists: [
    {
      recordId: '01a15256-d783-72e5-8e2d-150e2e1c6417',
      title: '出差行李',
      dueAt: new Date('2026-10-19T12:00:00Z'),
      done: 1,
      total: 3,
    },
    {
      recordId: '01a15256-d783-72e5-8e2d-150e2e1c6418',
      title: '上周的采购',
      dueAt: new Date('2026-10-17T12:00:00Z'),
      done: 0,
      total: 2,
    },
    {
      recordId: '01a15256-d783-72e5-8e2d-150e2e1c6419',
      title: '已经买齐的',
      dueAt: new Date('2026-10-17T12:00:00Z'),
      done: 2,
      total: 2,
    },
  ],
  memoReminders: [
    {
      recordId: ids.memo,
      title: '带身份证去银行',
      reminderId: ids.reminder,
      fireAt: new Date('2026-10-19T06:00:00Z'),
    },
    {
      recordId: ids.memo,
      title: '带身份证去银行',
      reminderId: ids.reminder,
      fireAt: new Date('2026-10-20T06:00:00Z'),
    },
  ],
};

describe('buildToday', () => {
  const today = buildToday(input);

  it('merges overdue occurrences and lists unfinished past-due checklists', () => {
    expect(today.overdue).toEqual([
      {
        kind: 'occurrence',
        recordId: ids.fee,
        title: '交物业费',
        date: '2026-10-15',
        originalDate: '2026-10-15',
        time: null,
        status: 'overdue',
        moreCount: 0,
      },
      {
        kind: 'checklist',
        recordId: '01a15256-d783-72e5-8e2d-150e2e1c6418',
        title: '上周的采购',
        date: '2026-10-17',
        time: '20:00',
        dueAt: '2026-10-17T12:00:00.000Z',
        done: 0,
        total: 2,
      },
      {
        kind: 'occurrence',
        recordId: ids.pills,
        title: '吃维生素',
        date: '2026-10-18',
        originalDate: '2026-10-18',
        time: '21:00',
        status: 'overdue',
        moreCount: 1,
      },
    ]);
  });

  it('lists today’s occurrences, checklists and memo reminders, all-day items first', () => {
    expect(today.today.map((card) => [card.kind, card.title, card.time])).toEqual([
      ['occurrence', '给绿植浇水', null],
      ['memo_reminder', '带身份证去银行', '14:00'],
      ['checklist', '出差行李', '20:00'],
      ['occurrence', '吃维生素', '21:00'],
    ]);
    expect(today.today[0]).toMatchObject({ status: 'completed' });
  });

  it('shows important dates within the next 7 days', () => {
    expect(today.upcomingDates).toEqual([
      {
        kind: 'important_date',
        recordId: ids.mom,
        title: '妈妈的生日',
        dateKind: 'birthday',
        date: '2026-10-24',
        daysUntil: 5,
        counter: 60,
      },
    ]);
  });

  it('only looks back 30 days for overdue occurrences', () => {
    const result = buildToday({
      ...input,
      recurring: [
        {
          recordId: ids.pills,
          title: '吃维生素',
          rule: daily('2026-01-01'),
          stored: new Map(),
        },
      ],
    });
    const card = result.overdue.find((item) => item.recordId === ids.pills);
    expect(card?.kind === 'occurrence' ? card.moreCount : null).toBe(29);
  });
});

describe('rescheduled occurrences', () => {
  const rule = daily('2026-10-01');
  const build = (
    stored: [
      string,
      { status: 'pending' | 'completed' | 'skipped'; rescheduledTo: string | null },
    ][],
  ) =>
    buildToday({
      ...input,
      checklists: [],
      memoReminders: [],
      lowStock: [],
      importantDates: [],
      recurring: [{ recordId: ids.water, title: '浇水', rule, stored: new Map(stored) }],
    });

  it('moves an occurrence out of overdue and onto its new date', () => {
    const result = build([
      ...Array.from(
        { length: 18 },
        (_, index) =>
          [
            `2026-10-${String(index + 1).padStart(2, '0')}`,
            { status: 'completed' as const, rescheduledTo: null },
          ] as [string, { status: 'completed'; rescheduledTo: null }],
      ),
      ['2026-10-18', { status: 'pending', rescheduledTo: '2026-10-19' }],
    ]);
    expect(result.overdue).toEqual([]);
    expect(
      result.today.map((card) =>
        card.kind === 'occurrence' ? [card.date, card.originalDate, card.status] : null,
      ),
    ).toEqual([
      ['2026-10-19', '2026-10-18', 'pending'],
      ['2026-10-19', '2026-10-19', 'pending'],
    ]);
  });

  it('keeps a completed move handled and hides occurrences moved to the future', () => {
    const result = build([
      ...Array.from(
        { length: 18 },
        (_, index) =>
          [
            `2026-10-${String(index + 1).padStart(2, '0')}`,
            { status: 'completed' as const, rescheduledTo: null },
          ] as [string, { status: 'completed'; rescheduledTo: null }],
      ),
      ['2026-10-19', { status: 'pending', rescheduledTo: '2026-10-21' }],
    ]);
    expect(result.today).toEqual([]);
    expect(result.overdue).toEqual([]);
  });
});

describe('low stock in today', () => {
  it('passes low stock items through as cards', () => {
    expect(buildToday(input).lowStock).toEqual([
      {
        kind: 'low_stock',
        recordId: '01a15256-d783-72e5-8e2d-150e2e1c6420',
        title: '洗衣液',
        quantity: 0.5,
        unit: '瓶',
        threshold: 1,
        location: '阳台',
      },
    ]);
  });
});

describe('occurrenceStatus', () => {
  it('derives pending and overdue from the date', () => {
    expect(occurrenceStatus('2026-10-18', undefined, '2026-10-19')).toBe('overdue');
    expect(occurrenceStatus('2026-10-19', undefined, '2026-10-19')).toBe('pending');
    expect(
      occurrenceStatus(
        '2026-10-18',
        { status: 'skipped', rescheduledTo: null },
        '2026-10-19',
      ),
    ).toBe('skipped');
  });
});

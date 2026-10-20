import { describe, expect, it } from 'vitest';

import {
  buildCalendar,
  type CalendarInput,
  calendarItemKey,
  calendarQuerySchema,
  calendarRange,
  datesBetween,
  describeCalendarRange,
  groupCalendarItems,
  shiftCalendarAnchor,
  startOfWeek,
} from './calendar';
import { recurrenceRuleSchema } from './recurrence';

const ids = {
  water: '01a15256-d783-72e5-8e2d-150e2e1c6410',
  mom: '01a15256-d783-72e5-8e2d-150e2e1c6413',
  trip: '01a15256-d783-72e5-8e2d-150e2e1c6417',
  memo: '01a15256-d783-72e5-8e2d-150e2e1c6414',
  reminder: '01a15256-d783-72e5-8e2d-150e2e1c6415',
};

const weekly = recurrenceRuleSchema.parse({
  startDate: '2026-10-01',
  freq: 'weekly',
  interval: 1,
  byWeekdays: [1],
  byMonthDay: null,
  timeOfDay: '08:00',
  end: { type: 'never' },
});

const input: CalendarInput = {
  from: '2026-10-12',
  to: '2026-10-25',
  today: '2026-10-20',
  timeZone: 'Asia/Shanghai',
  recurring: [
    {
      recordId: ids.water,
      title: '给绿植浇水',
      rule: weekly,
      stored: new Map([
        ['2026-10-12', { status: 'completed', rescheduledTo: null }],
        // 10 月 26 日的这次提前到 24 日：原定日期在区间外，也要出现。
        ['2026-10-26', { status: 'pending', rescheduledTo: '2026-10-24' }],
      ]),
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
  ],
  checklists: [
    {
      recordId: ids.trip,
      title: '出差行李',
      dueAt: new Date('2026-10-24T01:00:00Z'),
      done: 1,
      total: 3,
    },
  ],
  memoReminders: [
    {
      recordId: ids.memo,
      title: '带身份证去银行',
      reminderId: ids.reminder,
      // 上海时间 10 月 26 日 00:30，不在区间内。
      fireAt: new Date('2026-10-25T16:30:00Z'),
    },
    {
      recordId: ids.memo,
      title: '带身份证去银行',
      reminderId: '01a15256-d783-72e5-8e2d-150e2e1c6416',
      // 上海时间 10 月 20 日 14:00。
      fireAt: new Date('2026-10-20T06:00:00Z'),
    },
  ],
};

describe('buildCalendar', () => {
  const calendar = buildCalendar(input);

  it('lists occurrences with their status, including ones moved into the range', () => {
    const occurrences = calendar.items.filter((item) => item.kind === 'occurrence');
    expect(
      occurrences.map((item) => [item.date, item.originalDate, item.status]),
    ).toEqual([
      ['2026-10-12', '2026-10-12', 'completed'],
      ['2026-10-19', '2026-10-19', 'overdue'],
      ['2026-10-24', '2026-10-26', 'pending'],
    ]);
  });

  it('sorts each day with all-day items first, then by time', () => {
    expect(
      calendar.items
        .filter((item) => item.date === '2026-10-24')
        .map((item) => item.title),
    ).toEqual(['妈妈的生日', '给绿植浇水', '出差行李']);
  });

  it('keeps the important date counter and drops things outside the range', () => {
    expect(calendar.items.find((item) => item.kind === 'important_date')).toEqual({
      kind: 'important_date',
      recordId: ids.mom,
      title: '妈妈的生日',
      dateKind: 'birthday',
      date: '2026-10-24',
      counter: 60,
    });
    expect(
      calendar.items
        .filter((item) => item.kind === 'memo_reminder')
        .map((item) => [item.date, item.time]),
    ).toEqual([['2026-10-20', '14:00']]);
    expect(calendar.today).toBe('2026-10-20');
  });

  it('gives every item a distinct key and groups them by date', () => {
    const keys = calendar.items.map(calendarItemKey);
    expect(new Set(keys).size).toBe(keys.length);
    const groups = groupCalendarItems(calendar.items);
    expect([...groups.keys()]).toEqual([
      '2026-10-12',
      '2026-10-19',
      '2026-10-20',
      '2026-10-24',
    ]);
    expect(groups.get('2026-10-24')).toHaveLength(3);
  });
});

describe('calendar ranges', () => {
  it('starts weeks on Monday', () => {
    expect(startOfWeek('2026-10-20')).toBe('2026-10-19');
    expect(startOfWeek('2026-10-19')).toBe('2026-10-19');
    expect(startOfWeek('2026-10-25')).toBe('2026-10-19');
  });

  it('covers whole weeks around the month', () => {
    expect(calendarRange('month', '2026-10-20')).toEqual({
      from: '2026-09-28',
      to: '2026-11-01',
    });
    // 2026 年 2 月 1 日是周日，28 日是周六：要 5 周。
    expect(calendarRange('month', '2026-02-10')).toEqual({
      from: '2026-01-26',
      to: '2026-03-01',
    });
    expect(calendarRange('week', '2026-10-20')).toEqual({
      from: '2026-10-19',
      to: '2026-10-25',
    });
    expect(calendarRange('day', '2026-10-20')).toEqual({
      from: '2026-10-20',
      to: '2026-10-20',
    });
  });

  it('pages by day, week and month', () => {
    expect(shiftCalendarAnchor('day', '2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftCalendarAnchor('week', '2026-10-20', -1)).toBe('2026-10-13');
    expect(shiftCalendarAnchor('month', '2026-01-31', 1)).toBe('2026-02-28');
    expect(shiftCalendarAnchor('month', '2026-01-15', -1)).toBe('2025-12-15');
    expect(shiftCalendarAnchor('month', '2026-12-15', 1)).toBe('2027-01-15');
  });

  it('lists the days in a range', () => {
    expect(datesBetween('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
  });

  it('describes the range shown', () => {
    expect(describeCalendarRange('month', '2026-10-20')).toBe('2026年10月');
    expect(describeCalendarRange('day', '2026-10-20')).toBe('2026年10月20日 周二');
    expect(describeCalendarRange('week', '2026-10-20')).toBe('2026年10月19日–25日');
    expect(describeCalendarRange('week', '2026-10-29')).toBe('2026年10月26日–11月1日');
    expect(describeCalendarRange('week', '2026-12-30')).toBe(
      '2026年12月28日–2027年1月3日',
    );
  });

  it('limits how many days one query covers', () => {
    expect(
      calendarQuerySchema.safeParse({ from: '2026-09-28', to: '2026-11-08' }).success,
    ).toBe(true);
    expect(
      calendarQuerySchema.safeParse({ from: '2026-10-01', to: '2026-12-31' }).success,
    ).toBe(false);
    expect(
      calendarQuerySchema.safeParse({ from: '2026-10-02', to: '2026-10-01' }).success,
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import { type ImportantDate } from './important-dates';
import { recurrenceRuleSchema } from './recurrence';
import {
  computeUpcomingReminders,
  describeReminder,
  type ReminderSource,
  reminderKey,
} from './reminders';

const RECORD_ID = '01a15256-d783-72e5-8e2d-150e2e1c6400';
const REMINDER_ID = '01a15256-d783-72e5-8e2d-150e2e1c6401';

const window = {
  // 上海时间 2026-10-19 08:00，周一。
  now: new Date('2026-10-19T00:00:00Z'),
  until: new Date('2026-10-25T00:00:00Z'),
  timeZone: 'Asia/Shanghai',
  defaultReminderTime: '09:00',
};

function recurringSource(overrides: Partial<ReminderSource> = {}): ReminderSource {
  return {
    recordId: RECORD_ID,
    recordType: 'recurring',
    title: '给绿植浇水',
    reminders: [
      {
        id: REMINDER_ID,
        enabled: true,
        kind: 'relative',
        daysBefore: 0,
        timeOfDay: null,
      },
    ],
    recurring: recurrenceRuleSchema.parse({
      startDate: '2026-10-01',
      freq: 'weekly',
      interval: 1,
      byWeekdays: [1, 4],
      byMonthDay: null,
      timeOfDay: '07:30',
      end: { type: 'never' },
    }),
    stored: new Map(),
    importantDate: null,
    finished: false,
    ...overrides,
  };
}

describe('computeUpcomingReminders', () => {
  it('uses the rule time and skips times that have already passed', () => {
    // 周一 07:30 已过，剩下周四 10-22 07:30。
    expect(computeUpcomingReminders([recurringSource()], window)).toEqual([
      {
        key: `${REMINDER_ID}:2026-10-22`,
        reminderId: REMINDER_ID,
        recordId: RECORD_ID,
        recordType: 'recurring',
        title: '给绿植浇水',
        fireAt: '2026-10-21T23:30:00.000Z',
        occurrenceDate: '2026-10-22',
        originalDate: '2026-10-22',
      },
    ]);
  });

  it('reminds about a rescheduled occurrence on its new date with the same key', () => {
    const source = recurringSource({
      stored: new Map([
        ['2026-10-22', { status: 'pending', rescheduledTo: '2026-10-24' }],
      ]),
    });
    expect(computeUpcomingReminders([source], window)).toEqual([
      expect.objectContaining({
        key: `${REMINDER_ID}:2026-10-22`,
        fireAt: '2026-10-23T23:30:00.000Z',
        occurrenceDate: '2026-10-24',
        originalDate: '2026-10-22',
      }),
    ]);
  });

  it('does not remind about finished checklists', () => {
    const source = recurringSource({ finished: true });
    expect(computeUpcomingReminders([source], window)).toEqual([]);
  });

  it('does not remind about occurrences that were already handled', () => {
    const source = recurringSource({
      stored: new Map([['2026-10-22', { status: 'completed', rescheduledTo: null }]]),
    });
    expect(computeUpcomingReminders([source], window)).toEqual([]);
  });

  it('reminds days before an important date at the default time', () => {
    const birthday: ImportantDate = {
      kind: 'birthday',
      repeat: 'yearly',
      year: null,
      month: 10,
      day: 24,
      startYear: null,
      showCounter: true,
    };
    const source: ReminderSource = {
      recordId: RECORD_ID,
      recordType: 'important_date',
      title: '妈妈的生日',
      reminders: [
        {
          id: REMINDER_ID,
          enabled: true,
          kind: 'relative',
          daysBefore: 7,
          timeOfDay: null,
        },
        {
          id: '01a15256-d783-72e5-8e2d-150e2e1c6402',
          enabled: true,
          kind: 'relative',
          daysBefore: 1,
          timeOfDay: '20:00',
        },
      ],
      recurring: null,
      stored: new Map(),
      importantDate: birthday,
      finished: false,
    };
    const items = computeUpcomingReminders([source], window);
    // 提前 7 天是 10-17，已过；提前 1 天是 10-23 20:00。
    expect(items.map((item) => [item.key, item.fireAt])).toEqual([
      ['01a15256-d783-72e5-8e2d-150e2e1c6402:2026-10-24', '2026-10-23T12:00:00.000Z'],
    ]);
  });

  it('includes absolute reminders inside the window only', () => {
    const memo = (fireAt: string): ReminderSource => ({
      recordId: RECORD_ID,
      recordType: 'memo',
      title: '带身份证',
      reminders: [{ id: REMINDER_ID, enabled: true, kind: 'absolute', fireAt }],
      recurring: null,
      stored: new Map(),
      importantDate: null,
      finished: false,
    });
    expect(
      computeUpcomingReminders(
        [
          memo('2026-10-19T06:00:00Z'),
          memo('2026-10-18T06:00:00Z'),
          memo('2026-11-01T00:00:00Z'),
        ],
        window,
      ).map((item) => item.key),
    ).toEqual([reminderKey(REMINDER_ID, null)]);
  });
});

describe('describeReminder', () => {
  it('describes relative and absolute reminders', () => {
    expect(
      describeReminder(
        { kind: 'relative', daysBefore: 0, timeOfDay: null },
        'Asia/Shanghai',
      ),
    ).toBe('当天');
    expect(
      describeReminder(
        { kind: 'relative', daysBefore: 1, timeOfDay: '20:00' },
        'Asia/Shanghai',
      ),
    ).toBe('提前 1 天 20:00');
    expect(
      describeReminder(
        { kind: 'absolute', fireAt: '2026-10-19T06:00:00Z' },
        'Asia/Shanghai',
      ),
    ).toBe('2026-10-19 14:00');
  });
});

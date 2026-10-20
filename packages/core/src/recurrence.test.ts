import { describe, expect, it } from 'vitest';

import {
  describeRecurrence,
  expandOccurrences,
  isOccurrenceDate,
  nextOccurrence,
  type RecurrenceRuleInput,
  recurrenceRuleSchema,
} from './recurrence';

function rule(input: Partial<RecurrenceRuleInput>) {
  return recurrenceRuleSchema.parse({
    startDate: '2026-01-01',
    freq: 'daily',
    interval: 1,
    byWeekdays: null,
    byMonthDay: null,
    timeOfDay: null,
    end: { type: 'never' },
    ...input,
  });
}

describe('recurrenceRuleSchema', () => {
  it('requires weekdays for weekly rules and a day for monthly rules', () => {
    const weekly = recurrenceRuleSchema.safeParse({ ...rule({}), freq: 'weekly' });
    expect(weekly.success).toBe(false);
    const monthly = recurrenceRuleSchema.safeParse({ ...rule({}), freq: 'monthly' });
    expect(monthly.success).toBe(false);
  });

  it('rejects an end date before the start date', () => {
    const result = recurrenceRuleSchema.safeParse({
      ...rule({}),
      end: { type: 'until', until: '2025-12-31' },
    });
    expect(result.success).toBe(false);
  });

  it('sorts and deduplicates weekdays', () => {
    expect(rule({ freq: 'weekly', byWeekdays: [4, 1, 4] }).byWeekdays).toEqual([1, 4]);
  });
});

describe('expandOccurrences', () => {
  it('repeats daily with an interval', () => {
    expect(expandOccurrences(rule({ interval: 3 }), '2026-01-01', '2026-01-10')).toEqual([
      '2026-01-01',
      '2026-01-04',
      '2026-01-07',
      '2026-01-10',
    ]);
  });

  it('jumps ahead for long-running daily rules', () => {
    expect(expandOccurrences(rule({ interval: 2 }), '2030-06-01', '2030-06-04')).toEqual([
      '2030-06-01',
      '2030-06-03',
    ]);
  });

  it('repeats on several weekdays, skipping days before the start', () => {
    // 2026-10-21 是周三。
    const weekly = rule({ startDate: '2026-10-21', freq: 'weekly', byWeekdays: [1, 4] });
    expect(expandOccurrences(weekly, '2026-10-19', '2026-11-02')).toEqual([
      '2026-10-22',
      '2026-10-26',
      '2026-10-29',
      '2026-11-02',
    ]);
  });

  it('repeats every other week counted from the start week', () => {
    const biweekly = rule({
      startDate: '2026-10-19',
      freq: 'weekly',
      interval: 2,
      byWeekdays: [1],
    });
    expect(expandOccurrences(biweekly, '2026-10-19', '2026-11-30')).toEqual([
      '2026-10-19',
      '2026-11-02',
      '2026-11-16',
      '2026-11-30',
    ]);
  });

  it('uses the last day of shorter months', () => {
    const monthly = rule({ startDate: '2026-01-31', freq: 'monthly', byMonthDay: 31 });
    expect(expandOccurrences(monthly, '2026-01-01', '2026-05-31')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
  });

  it('skips a monthly day that falls before the start date', () => {
    const monthly = rule({ startDate: '2026-10-20', freq: 'monthly', byMonthDay: 15 });
    expect(nextOccurrence(monthly, '2026-10-01')).toBe('2026-11-15');
  });

  it('moves February 29 to February 28 in common years', () => {
    const yearly = rule({ startDate: '2024-02-29', freq: 'yearly' });
    expect(expandOccurrences(yearly, '2024-01-01', '2028-12-31')).toEqual([
      '2024-02-29',
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
    ]);
  });

  it('stops after a number of occurrences', () => {
    const counted = rule({ end: { type: 'count', count: 3 } });
    expect(expandOccurrences(counted, '2026-01-02', '2026-01-31')).toEqual([
      '2026-01-02',
      '2026-01-03',
    ]);
  });

  it('stops after the end date', () => {
    const until = rule({
      freq: 'weekly',
      byWeekdays: [5],
      end: { type: 'until', until: '2026-01-16' },
    });
    expect(expandOccurrences(until, '2026-01-01', '2026-12-31')).toEqual([
      '2026-01-02',
      '2026-01-09',
      '2026-01-16',
    ]);
    expect(nextOccurrence(until, '2026-01-17')).toBeNull();
  });

  it('tells whether a date is an occurrence', () => {
    const weekly = rule({ freq: 'weekly', byWeekdays: [1] });
    expect(isOccurrenceDate(weekly, '2026-10-19')).toBe(true);
    expect(isOccurrenceDate(weekly, '2026-10-20')).toBe(false);
  });
});

describe('describeRecurrence', () => {
  it.each<[Partial<RecurrenceRuleInput>, string]>([
    [{}, '每天'],
    [{ interval: 3 }, '每 3 天'],
    [{ freq: 'weekly', byWeekdays: [1, 4], timeOfDay: '09:00' }, '每周一、周四 09:00'],
    [{ freq: 'weekly', interval: 2, byWeekdays: [6] }, '每 2 周的周六'],
    [{ freq: 'monthly', byMonthDay: 31 }, '每月 31 日'],
    [{ freq: 'yearly', startDate: '2024-02-29' }, '每年 2 月 29 日'],
    [{ end: { type: 'count', count: 5 } }, '每天，共 5 次'],
  ])('describes %j', (input, text) => {
    expect(describeRecurrence(rule(input))).toBe(text);
  });
});

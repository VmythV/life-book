import { describe, expect, it } from 'vitest';

import {
  effectiveOccurrences,
  nextPendingOccurrence,
  recentOccurrences,
  rescheduleIssue,
  type StoredOccurrence,
} from './occurrences';
import { recurrenceRuleSchema } from './recurrence';

const weekly = recurrenceRuleSchema.parse({
  startDate: '2026-10-01',
  freq: 'weekly',
  interval: 1,
  byWeekdays: [1],
  byMonthDay: null,
  timeOfDay: null,
  end: { type: 'never' },
});

describe('effectiveOccurrences', () => {
  it('includes occurrences moved into the range and drops those moved out', () => {
    const stored = new Map<string, StoredOccurrence>([
      // 下周一挪到本周三，本周一挪到下下周。
      ['2026-10-26', { status: 'pending', rescheduledTo: '2026-10-21' }],
      ['2026-10-19', { status: 'pending', rescheduledTo: '2026-11-04' }],
    ]);
    expect(
      effectiveOccurrences(weekly, stored, '2026-10-19', '2026-10-25').map((item) => [
        item.date,
        item.originalDate,
      ]),
    ).toEqual([['2026-10-21', '2026-10-26']]);
  });
});

describe('nextPendingOccurrence', () => {
  it('skips handled occurrences and follows reschedules', () => {
    const stored = new Map<string, StoredOccurrence>([
      ['2026-10-19', { status: 'completed', rescheduledTo: null }],
      ['2026-10-26', { status: 'pending', rescheduledTo: '2026-10-21' }],
    ]);
    expect(nextPendingOccurrence(weekly, stored, '2026-10-19')).toBe('2026-10-21');
  });

  it('ignores an occurrence moved later and a skipped one', () => {
    const stored = new Map<string, StoredOccurrence>([
      ['2026-10-19', { status: 'pending', rescheduledTo: '2026-11-04' }],
      ['2026-10-26', { status: 'skipped', rescheduledTo: null }],
    ]);
    expect(nextPendingOccurrence(weekly, stored, '2026-10-19')).toBe('2026-11-02');
  });

  it('returns the rule date without stored occurrences and null once the rule ends', () => {
    expect(nextPendingOccurrence(weekly, new Map(), '2026-10-20')).toBe('2026-10-26');
    const ending = { ...weekly, end: { type: 'until' as const, until: '2026-10-26' } };
    const stored = new Map<string, StoredOccurrence>([
      ['2026-10-26', { status: 'completed', rescheduledTo: null }],
    ]);
    expect(nextPendingOccurrence(ending, stored, '2026-10-20')).toBeNull();
  });
});

describe('rescheduleIssue', () => {
  it('limits moves to 60 days', () => {
    expect(rescheduleIssue('2026-10-19', '2026-12-18')).toBeNull();
    expect(rescheduleIssue('2026-10-19', '2026-12-19')).toBe('最多改到前后 60 天');
  });
});

describe('recentOccurrences', () => {
  it('keeps the past and the next three dates, including same-day occurrences', () => {
    const items = [
      { date: '2026-10-18', id: 'a' },
      { date: '2026-10-21', id: 'b' },
      { date: '2026-10-22', id: 'c' },
      { date: '2026-10-23', id: 'moved' },
      { date: '2026-10-23', id: 'd' },
      { date: '2026-10-24', id: 'e' },
    ];
    expect(recentOccurrences(items, '2026-10-20').map((item) => item.id)).toEqual([
      'a',
      'b',
      'c',
      'moved',
      'd',
    ]);
    expect(recentOccurrences([], '2026-10-20')).toEqual([]);
  });
});

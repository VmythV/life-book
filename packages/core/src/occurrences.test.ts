import { describe, expect, it } from 'vitest';

import {
  effectiveOccurrences,
  nextPendingDate,
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

describe('nextPendingDate', () => {
  it('skips handled and moved-away occurrences in the listed range', () => {
    expect(
      nextPendingDate(
        weekly,
        [
          { date: '2026-10-19', status: 'completed' },
          { date: '2026-10-28', status: 'pending' },
        ],
        '2026-10-19',
        '2026-11-02',
      ),
    ).toBe('2026-10-28');
  });

  it('falls back to the rule after the listed range or before loading', () => {
    expect(nextPendingDate(weekly, [], '2026-10-19', '2026-11-02')).toBe('2026-11-09');
    expect(nextPendingDate(weekly, undefined, '2026-10-19', '2026-11-02')).toBe(
      '2026-10-19',
    );
  });
});

describe('rescheduleIssue', () => {
  it('limits moves to 60 days', () => {
    expect(rescheduleIssue('2026-10-19', '2026-12-18')).toBeNull();
    expect(rescheduleIssue('2026-10-19', '2026-12-19')).toBe('最多改到前后 60 天');
  });
});

import { describe, expect, it } from 'vitest';

import {
  addDays,
  daysBetween,
  describeLocalDate,
  isValidLocalDate,
  todayIn,
  weekdayOf,
  zonedDateTime,
  zonedTimeToInstant,
} from './dates';

describe('local dates', () => {
  it.each([
    ['2024-02-29', true],
    ['2023-02-29', false],
    ['2026-04-31', false],
    ['2026-13-01', false],
    ['2026-1-01', false],
  ])('validates %s', (value, valid) => {
    expect(isValidLocalDate(value)).toBe(valid);
  });

  it('adds days across months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(daysBetween('2026-10-19', '2026-10-24')).toBe(5);
  });

  it('numbers weekdays from Monday', () => {
    expect(weekdayOf('2026-10-19')).toBe(1);
    expect(weekdayOf('2026-10-25')).toBe(7);
    expect(weekdayOf('1969-12-31')).toBe(3);
  });
});

describe('describeLocalDate', () => {
  it('uses relative words near today and omits the current year', () => {
    expect(describeLocalDate('2026-10-19', '2026-10-19')).toBe('今天');
    expect(describeLocalDate('2026-10-20', '2026-10-19')).toBe('明天');
    expect(describeLocalDate('2026-10-18', '2026-10-19')).toBe('昨天');
    expect(describeLocalDate('2026-10-24', '2026-10-19')).toBe('10月24日 周六');
    expect(describeLocalDate('2027-01-01', '2026-10-19')).toBe('2027年1月1日 周五');
  });
});

describe('time zones', () => {
  it('reads the local date and time in a zone', () => {
    const instant = new Date('2026-10-19T17:30:00Z');
    expect(zonedDateTime(instant, 'Asia/Shanghai')).toEqual({
      date: '2026-10-20',
      time: '01:30',
    });
    expect(todayIn('America/Los_Angeles', instant)).toBe('2026-10-19');
  });

  it('converts a local time to an instant', () => {
    expect(zonedTimeToInstant('2026-10-20', '09:00', 'Asia/Shanghai').toISOString()).toBe(
      '2026-10-20T01:00:00.000Z',
    );
  });

  it('handles daylight saving time', () => {
    // 纽约 2026-03-08 02:00 跳到 03:00，2026-11-01 02:00 回到 01:00。
    expect(
      zonedTimeToInstant('2026-03-07', '09:00', 'America/New_York').toISOString(),
    ).toBe('2026-03-07T14:00:00.000Z');
    expect(
      zonedTimeToInstant('2026-03-09', '09:00', 'America/New_York').toISOString(),
    ).toBe('2026-03-09T13:00:00.000Z');
    expect(
      zonedTimeToInstant('2026-03-08', '02:30', 'America/New_York').toISOString(),
    ).toBe('2026-03-08T07:30:00.000Z');
    expect(
      zonedTimeToInstant('2026-11-01', '01:30', 'America/New_York').toISOString(),
    ).toBe('2026-11-01T05:30:00.000Z');
  });
});

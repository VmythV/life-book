import { describe, expect, it } from 'vitest';

import {
  describeCounter,
  type ImportantDate,
  importantDateOccurrences,
  importantDateSchema,
  nextImportantDate,
} from './important-dates';

const birthday: ImportantDate = {
  kind: 'birthday',
  repeat: 'yearly',
  year: null,
  month: 10,
  day: 24,
  startYear: 1966,
  showCounter: true,
};

describe('importantDateSchema', () => {
  it('requires a year only for one-off dates', () => {
    expect(importantDateSchema.safeParse({ ...birthday, repeat: 'once' }).success).toBe(
      false,
    );
    expect(importantDateSchema.safeParse({ ...birthday, year: 2026 }).success).toBe(
      false,
    );
  });

  it('allows February 29 for yearly dates but checks one-off dates', () => {
    const leap = { ...birthday, month: 2, day: 29 };
    expect(importantDateSchema.safeParse(leap).success).toBe(true);
    expect(
      importantDateSchema.safeParse({ ...leap, repeat: 'once', year: 2027 }).success,
    ).toBe(false);
    expect(
      importantDateSchema.safeParse({ ...birthday, month: 4, day: 31 }).success,
    ).toBe(false);
  });
});

describe('nextImportantDate', () => {
  it('finds this year’s date with the age', () => {
    expect(nextImportantDate(birthday, '2026-10-19')).toEqual({
      date: '2026-10-24',
      daysUntil: 5,
      counter: 60,
    });
  });

  it('moves to next year after the date has passed', () => {
    expect(nextImportantDate(birthday, '2026-10-25')).toMatchObject({
      date: '2027-10-24',
      counter: 61,
    });
  });

  it('counts today as zero days away', () => {
    expect(nextImportantDate(birthday, '2026-10-24')?.daysUntil).toBe(0);
  });

  it('uses February 28 for leap-day dates in common years', () => {
    const leap = { ...birthday, month: 2, day: 29, startYear: null };
    expect(nextImportantDate(leap, '2026-01-01')).toEqual({
      date: '2026-02-28',
      daysUntil: 58,
      counter: null,
    });
  });

  it('returns null for a one-off date in the past', () => {
    const expiry: ImportantDate = {
      ...birthday,
      kind: 'expiry',
      repeat: 'once',
      year: 2026,
      startYear: null,
    };
    expect(nextImportantDate(expiry, '2026-10-25')).toBeNull();
    expect(nextImportantDate(expiry, '2026-10-01')?.daysUntil).toBe(23);
  });

  it('lists occurrences in a range across years', () => {
    expect(importantDateOccurrences(birthday, '2026-10-24', '2027-10-24')).toEqual([
      '2026-10-24',
      '2027-10-24',
    ]);
  });
});

describe('describeCounter', () => {
  it('describes ages and anniversaries', () => {
    expect(describeCounter('birthday', 60)).toBe('60 岁生日');
    expect(describeCounter('anniversary', 10)).toBe('10 周年');
    expect(describeCounter('expiry', 3)).toBeNull();
  });
});

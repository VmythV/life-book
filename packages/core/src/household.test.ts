import { describe, expect, it } from 'vitest';

import {
  computeStockChange,
  createStockTransactionRequestSchema,
  householdItemInputSchema,
  isLowStock,
  lowStockTransition,
} from './household';
import { computeLowStockAlerts } from './reminders';

const parse = (input: unknown) => createStockTransactionRequestSchema.parse(input);

describe('computeStockChange', () => {
  it('adds purchases and subtracts usage without float drift', () => {
    expect(computeStockChange(0.1, parse({ kind: 'purchase', amount: 0.2 }))).toEqual({
      ok: true,
      delta: 0.2,
      quantityAfter: 0.3,
    });
    expect(computeStockChange(3, parse({ kind: 'consume', amount: 1.5 }))).toEqual({
      ok: true,
      delta: -1.5,
      quantityAfter: 1.5,
    });
  });

  it('turns an adjustment target into a delta', () => {
    expect(computeStockChange(5, parse({ kind: 'adjust', quantity: 2 }))).toEqual({
      ok: true,
      delta: -3,
      quantityAfter: 2,
    });
  });

  it('refuses to go below zero', () => {
    expect(computeStockChange(1, parse({ kind: 'lost', amount: 2 }))).toEqual({
      ok: false,
      message: '库存不足，当前只有 1',
    });
  });

  it('requires a positive amount for delta kinds', () => {
    expect(
      createStockTransactionRequestSchema.safeParse({ kind: 'consume', amount: 0 })
        .success,
    ).toBe(false);
  });
});

describe('low stock', () => {
  it('counts quantities at or below the threshold', () => {
    expect(isLowStock(2, 2)).toBe(true);
    expect(isLowStock(2.001, 2)).toBe(false);
    expect(isLowStock(0, null)).toBe(false);
  });

  it('reports entering and leaving low stock once', () => {
    expect(lowStockTransition(false, 1, 2)).toBe('entered');
    expect(lowStockTransition(true, 0, 2)).toBe('none');
    expect(lowStockTransition(true, 3, 2)).toBe('left');
    expect(lowStockTransition(true, 1, null)).toBe('left');
  });

  it('alerts once per low stock period, not earlier than now', () => {
    const since = new Date('2026-10-19T01:00:00Z');
    expect(
      computeLowStockAlerts(
        [
          {
            recordId: '01a15256-d783-72e5-8e2d-150e2e1c6420',
            title: '纸巾',
            lowStockSince: since,
          },
        ],
        new Date('2026-10-19T02:00:00Z'),
      ),
    ).toEqual([
      {
        key: `lowstock:01a15256-d783-72e5-8e2d-150e2e1c6420:${since.toISOString()}`,
        reminderId: null,
        recordId: '01a15256-d783-72e5-8e2d-150e2e1c6420',
        recordType: 'household_item',
        title: '纸巾',
        fireAt: '2026-10-19T02:00:00.000Z',
        occurrenceDate: null,
        originalDate: null,
      },
    ]);
  });
});

describe('householdItemInputSchema', () => {
  it('requires a unit and defaults the opening quantity to zero', () => {
    expect(householdItemInputSchema.safeParse({}).success).toBe(false);
    expect(householdItemInputSchema.parse({ unit: ' 包 ', location: '' })).toEqual({
      unit: '包',
      quantity: 0,
      lowStockThreshold: null,
      location: null,
    });
  });
});

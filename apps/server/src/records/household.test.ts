import {
  type LifeRecord,
  type StockTransactionResult,
  type TodayResponse,
  type UpcomingRemindersResponse,
} from '@life-book/core';
import { describe, expect, it } from 'vitest';

import { registerUser, request, setupTestDatabase, type TestApp } from '../test/harness';

const { createTestApp } = setupTestDatabase();

const NOW = new Date('2026-10-19T02:00:00Z');

async function setup() {
  let now = NOW;
  const app = createTestApp({ now: () => now });
  const { cookie } = await registerUser(app);
  return {
    app,
    cookie,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}

async function createItem(
  app: TestApp,
  cookie: string,
  householdItem: Record<string, unknown> = {
    unit: '包',
    quantity: 3,
    lowStockThreshold: 1,
  },
): Promise<LifeRecord> {
  const response = await request(app, 'POST', '/api/v1/records', {
    cookie,
    body: { type: 'household_item', title: '纸巾', householdItem },
  });
  if (response.status !== 201) {
    throw new Error(`Create failed with ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as LifeRecord;
}

async function move(
  app: TestApp,
  cookie: string,
  id: string,
  body: Record<string, unknown>,
) {
  return request(app, 'POST', `/api/v1/records/${id}/stock-transactions`, {
    cookie,
    body,
  });
}

describe('household items', () => {
  it('records the opening quantity as the first transaction', async () => {
    const { app, cookie } = await setup();
    const record = await createItem(app, cookie);
    expect(record.householdItem).toEqual({
      unit: '包',
      quantity: 3,
      lowStockThreshold: 1,
      location: null,
      isLowStock: false,
      lowStockSince: null,
    });
    const list = await request(
      app,
      'GET',
      `/api/v1/records/${record.id}/stock-transactions`,
      {
        cookie,
      },
    );
    expect(await list.json()).toEqual({
      items: [expect.objectContaining({ kind: 'opening', delta: 3, quantityAfter: 3 })],
    });
  });

  it('applies purchases, usage and adjustments and refuses negative stock', async () => {
    const { app, cookie, advance } = await setup();
    const record = await createItem(app, cookie);

    advance(1000);
    const used = await move(app, cookie, record.id, { kind: 'consume', amount: 1.5 });
    expect(used.status).toBe(201);
    expect(((await used.json()) as StockTransactionResult).item.quantity).toBe(1.5);

    const tooMuch = await move(app, cookie, record.id, { kind: 'lost', amount: 2 });
    expect(tooMuch.status).toBe(400);
    expect(await tooMuch.json()).toMatchObject({
      error: { message: '库存不足，当前只有 1.5' },
    });

    advance(1000);
    const bought = await move(app, cookie, record.id, { kind: 'purchase', amount: 10 });
    const boughtBody = (await bought.json()) as StockTransactionResult;
    expect(boughtBody.item.quantity).toBe(11.5);

    advance(1000);
    const adjusted = await move(app, cookie, record.id, {
      kind: 'adjust',
      quantity: 11,
      note: '数错了',
      correctsId: boughtBody.transaction.id,
    });
    expect(await adjusted.json()).toMatchObject({
      item: { quantity: 11 },
      transaction: { kind: 'adjust', delta: -0.5, correctsId: boughtBody.transaction.id },
    });

    const list = await request(
      app,
      'GET',
      `/api/v1/records/${record.id}/stock-transactions`,
      {
        cookie,
      },
    );
    expect(
      ((await list.json()) as { items: { kind: string }[] }).items.map(
        (item) => item.kind,
      ),
    ).toEqual(['adjust', 'purchase', 'consume', 'opening']);
  });

  it('tracks low stock, shows it in today and alerts once per period', async () => {
    const { app, cookie, advance } = await setup();
    const record = await createItem(app, cookie);

    advance(1000);
    const low = await move(app, cookie, record.id, { kind: 'consume', amount: 2 });
    expect(((await low.json()) as StockTransactionResult).item).toMatchObject({
      isLowStock: true,
      lowStockSince: '2026-10-19T02:00:01.000Z',
    });

    const today = (await (
      await request(app, 'GET', '/api/v1/today', { cookie })
    ).json()) as TodayResponse;
    expect(today.lowStock).toEqual([
      {
        kind: 'low_stock',
        recordId: record.id,
        title: '纸巾',
        quantity: 1,
        unit: '包',
        threshold: 1,
        location: null,
      },
    ]);

    const upcoming = async () =>
      (
        (await (
          await request(app, 'GET', '/api/v1/reminders/upcoming', { cookie })
        ).json()) as UpcomingRemindersResponse
      ).items;
    const alerts = await upcoming();
    expect(alerts).toEqual([
      expect.objectContaining({
        key: `lowstock:${record.id}:2026-10-19T02:00:01.000Z`,
        reminderId: null,
        recordType: 'household_item',
      }),
    ]);

    // 继续变少不会重新开始计时；标记已提醒后不再返回。
    await move(app, cookie, record.id, { kind: 'consume', amount: 1 });
    const notified = await request(
      app,
      'POST',
      `/api/v1/records/${record.id}/low-stock-notified`,
      {
        cookie,
        body: { since: '2026-10-19T02:00:01.000Z' },
      },
    );
    expect(notified.status).toBe(204);
    expect(await upcoming()).toEqual([]);

    // 补货恢复后再变低，是新的一次低库存。
    advance(60_000);
    await move(app, cookie, record.id, { kind: 'purchase', amount: 5 });
    advance(60_000);
    await move(app, cookie, record.id, { kind: 'consume', amount: 5 });
    expect((await upcoming())[0]?.key).toBe(
      `lowstock:${record.id}:2026-10-19T02:02:01.000Z`,
    );
  });

  it('updates the threshold and the low stock state with it', async () => {
    const { app, cookie } = await setup();
    const record = await createItem(app, cookie);
    const response = await request(app, 'PATCH', `/api/v1/records/${record.id}`, {
      cookie,
      body: { version: 1, householdItem: { lowStockThreshold: 5, location: '储物间' } },
    });
    expect(((await response.json()) as LifeRecord).householdItem).toMatchObject({
      quantity: 3,
      lowStockThreshold: 5,
      location: '储物间',
      isLowStock: true,
    });
  });

  it('adds an item to a shopping list once', async () => {
    const { app, cookie } = await setup();
    const record = await createItem(app, cookie);
    const path = `/api/v1/records/${record.id}/add-to-shopping-list`;

    const first = await request(app, 'POST', path, { cookie, body: {} });
    const firstBody = (await first.json()) as { checklistId: string; created: boolean };
    expect(firstBody.created).toBe(true);
    const second = await request(app, 'POST', path, { cookie, body: {} });
    expect(await second.json()).toMatchObject({
      checklistId: firstBody.checklistId,
      created: false,
    });

    const checklist = (await (
      await request(app, 'GET', `/api/v1/records/${firstBody.checklistId}`, { cookie })
    ).json()) as LifeRecord;
    expect(checklist).toMatchObject({
      title: '采购清单',
      checklist: {
        purpose: 'shopping',
        items: [{ title: '纸巾', unit: '包', householdItemId: record.id }],
      },
    });

    // 勾选买到后，再加入会新增一条。
    const itemId = checklist.checklist?.items[0]?.id ?? '';
    await request(
      app,
      'PATCH',
      `/api/v1/records/${firstBody.checklistId}/items/${itemId}`,
      {
        cookie,
        body: { isDone: true },
      },
    );
    const third = await request(app, 'POST', path, { cookie, body: {} });
    expect(await third.json()).toMatchObject({ created: true });
  });

  it('rejects reminders and keeps items private', async () => {
    const { app, cookie } = await setup();
    const withReminder = await request(app, 'POST', '/api/v1/records', {
      cookie,
      body: {
        type: 'household_item',
        title: 'x',
        householdItem: { unit: '个' },
        reminders: [{ kind: 'absolute', fireAt: '2026-10-20T00:00:00Z' }],
      },
    });
    expect(withReminder.status).toBe(400);

    const record = await createItem(app, cookie);
    const bob = await registerUser(app, 'bob');
    for (const [method, url, body] of [
      ['GET', `/api/v1/records/${record.id}/stock-transactions`, undefined],
      [
        'POST',
        `/api/v1/records/${record.id}/stock-transactions`,
        { kind: 'consume', amount: 1 },
      ],
      ['POST', `/api/v1/records/${record.id}/add-to-shopping-list`, {}],
    ] as const) {
      const response = await request(app, method, url, {
        cookie: bob.cookie,
        ...(body === undefined ? {} : { body }),
      });
      expect(response.status, `${method} ${url}`).toBe(404);
    }
  });
});

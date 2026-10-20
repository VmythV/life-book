import { type LifeRecord, type TodayResponse } from '@life-book/core';
import { describe, expect, it } from 'vitest';

import {
  createTestUser,
  request,
  setupTestDatabase,
  type TestApp,
} from '../test/harness';

const { createTestApp } = setupTestDatabase();

// 上海时间 2026-10-19（周一）10:00。
const NOW = new Date('2026-10-19T02:00:00Z');

async function setup() {
  let now = NOW;
  const app = createTestApp({ now: () => now });
  const { cookie } = await createTestUser(app);
  return {
    app,
    cookie,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}

async function createChecklist(
  app: TestApp,
  cookie: string,
  checklist: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
): Promise<LifeRecord> {
  const response = await request(app, 'POST', '/api/v1/records', {
    cookie,
    body: { type: 'checklist', title: '出差行李', checklist, ...extra },
  });
  if (response.status !== 201) {
    throw new Error(`Create failed with ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as LifeRecord;
}

describe('checklists', () => {
  it('creates a checklist with grouped items in order', async () => {
    const { app, cookie } = await setup();
    const record = await createChecklist(app, cookie, {
      dueAt: '2026-10-20T20:00:00+08:00',
      items: [
        { title: '护照' },
        { title: '充电器', groupName: '电子' },
        { title: '鸡蛋', quantity: 1.5, unit: 'kg' },
      ],
    });

    expect(record.checklist).toEqual({
      purpose: 'general',
      dueAt: '2026-10-20T12:00:00.000Z',
      sourceTemplateId: null,
      items: [
        expect.objectContaining({
          title: '护照',
          groupName: null,
          sortOrder: 0,
          isDone: false,
        }),
        expect.objectContaining({ title: '充电器', groupName: '电子', sortOrder: 1 }),
        expect.objectContaining({
          title: '鸡蛋',
          quantity: 1.5,
          unit: 'kg',
          sortOrder: 2,
        }),
      ],
    });
  });

  it('adds, checks, edits and deletes items', async () => {
    const { app, cookie, advance } = await setup();
    const record = await createChecklist(app, cookie);
    const path = `/api/v1/records/${record.id}/items`;

    const created = await request(app, 'POST', path, { cookie, body: { title: '牙刷' } });
    expect(created.status).toBe(201);
    const item = (await created.json()) as { id: string; sortOrder: number };
    expect(item.sortOrder).toBe(0);

    advance(60_000);
    const checked = await request(app, 'PATCH', `${path}/${item.id}`, {
      cookie,
      body: { isDone: true, title: '电动牙刷' },
    });
    expect(await checked.json()).toMatchObject({
      title: '电动牙刷',
      isDone: true,
      doneAt: '2026-10-19T02:01:00.000Z',
    });

    // 再次勾选保留第一次的完成时间。
    advance(60_000);
    const again = await request(app, 'PATCH', `${path}/${item.id}`, {
      cookie,
      body: { isDone: true },
    });
    expect(await again.json()).toMatchObject({ doneAt: '2026-10-19T02:01:00.000Z' });

    const unchecked = await request(app, 'PATCH', `${path}/${item.id}`, {
      cookie,
      body: { isDone: false },
    });
    expect(await unchecked.json()).toMatchObject({ isDone: false, doneAt: null });

    const deleted = await request(app, 'DELETE', `${path}/${item.id}`, { cookie });
    expect(deleted.status).toBe(204);
    const missing = await request(app, 'DELETE', `${path}/${item.id}`, { cookie });
    expect(missing.status).toBe(404);

    const updated = await request(app, 'GET', `/api/v1/records/${record.id}`, { cookie });
    expect(await updated.json()).toMatchObject({
      version: 1,
      updatedAt: '2026-10-19T02:02:00.000Z',
      checklist: { items: [] },
    });
  });

  it('completes and reopens all items at once', async () => {
    const { app, cookie } = await setup();
    const record = await createChecklist(app, cookie, {
      items: [{ title: 'a' }, { title: 'b' }],
    });
    const path = `/api/v1/records/${record.id}/items/complete-all`;

    const done = await request(app, 'POST', path, { cookie, body: {} });
    const doneRecord = (await done.json()) as LifeRecord;
    expect(doneRecord.checklist?.items.every((item) => item.isDone)).toBe(true);

    const reopened = await request(app, 'POST', path, { cookie, body: { done: false } });
    const reopenedRecord = (await reopened.json()) as LifeRecord;
    expect(reopenedRecord.checklist?.items.some((item) => item.isDone)).toBe(false);
  });

  it('keeps fields that a partial update leaves out', async () => {
    const { app, cookie } = await setup();
    const record = await createChecklist(app, cookie, {
      purpose: 'shopping',
      dueAt: '2026-10-20T12:00:00Z',
      items: [
        { title: '鸡蛋', groupName: '冷藏', notes: '散养', quantity: 12, unit: '个' },
      ],
    });
    const item = record.checklist?.items[0];

    const checked = await request(
      app,
      'PATCH',
      `/api/v1/records/${record.id}/items/${item?.id}`,
      { cookie, body: { isDone: true } },
    );
    expect(await checked.json()).toMatchObject({
      isDone: true,
      groupName: '冷藏',
      notes: '散养',
      quantity: 12,
      unit: '个',
    });

    const moved = await request(app, 'PATCH', `/api/v1/records/${record.id}`, {
      cookie,
      body: { version: record.version, checklist: { dueAt: null } },
    });
    expect(await moved.json()).toMatchObject({
      checklist: { purpose: 'shopping', dueAt: null },
    });
  });

  it('updates the due time through the record and validates reminder kinds', async () => {
    const { app, cookie } = await setup();
    const record = await createChecklist(app, cookie);

    const updated = await request(app, 'PATCH', `/api/v1/records/${record.id}`, {
      cookie,
      body: {
        version: 1,
        checklist: { purpose: 'shopping', dueAt: '2026-10-19T12:00:00Z' },
        reminders: [{ kind: 'absolute', fireAt: '2026-10-19T10:00:00Z' }],
      },
    });
    expect(await updated.json()).toMatchObject({
      checklist: { purpose: 'shopping', dueAt: '2026-10-19T12:00:00.000Z' },
      reminders: [{ kind: 'absolute' }],
    });

    const relative = await request(app, 'PATCH', `/api/v1/records/${record.id}`, {
      cookie,
      body: {
        version: 2,
        reminders: [{ kind: 'relative', daysBefore: 0, timeOfDay: null }],
      },
    });
    expect(relative.status).toBe(400);
  });

  it('shows due checklists in today and stops reminding once complete', async () => {
    const { app, cookie } = await setup();
    const record = await createChecklist(
      app,
      cookie,
      { dueAt: '2026-10-19T12:00:00Z', items: [{ title: 'a' }] },
      { reminders: [{ kind: 'absolute', fireAt: '2026-10-19T10:00:00Z' }] },
    );

    const today = (await (
      await request(app, 'GET', '/api/v1/today', { cookie })
    ).json()) as TodayResponse;
    expect(today.today).toEqual([
      {
        kind: 'checklist',
        recordId: record.id,
        title: '出差行李',
        date: '2026-10-19',
        time: '20:00',
        dueAt: '2026-10-19T12:00:00.000Z',
        done: 0,
        total: 1,
      },
    ]);
    const before = await request(app, 'GET', '/api/v1/reminders/upcoming', { cookie });
    expect(((await before.json()) as { items: unknown[] }).items).toHaveLength(1);

    await request(app, 'POST', `/api/v1/records/${record.id}/items/complete-all`, {
      cookie,
      body: {},
    });
    const after = await request(app, 'GET', '/api/v1/reminders/upcoming', { cookie });
    expect(((await after.json()) as { items: unknown[] }).items).toEqual([]);
  });

  it('finds checklists by item title', async () => {
    const { app, cookie } = await setup();
    const record = await createChecklist(app, cookie, { items: [{ title: '防晒霜' }] });
    const response = await request(app, 'GET', '/api/v1/records?q=防晒', { cookie });
    expect(((await response.json()) as { items: { id: string }[] }).items).toEqual([
      expect.objectContaining({ id: record.id }),
    ]);
  });

  it('hides items of other users and of non-checklist records', async () => {
    const { app, cookie } = await setup();
    const record = await createChecklist(app, cookie, { items: [{ title: 'a' }] });
    const itemId = record.checklist?.items[0]?.id ?? '';
    const bob = await createTestUser(app, 'bob');
    const path = `/api/v1/records/${record.id}/items`;

    for (const [method, url, body] of [
      ['POST', path, { title: 'x' }],
      ['PATCH', `${path}/${itemId}`, { isDone: true }],
      ['DELETE', `${path}/${itemId}`, undefined],
      ['POST', `${path}/complete-all`, {}],
    ] as const) {
      const response = await request(app, method, url, {
        cookie: bob.cookie,
        ...(body === undefined ? {} : { body }),
      });
      expect(response.status, `${method} ${url}`).toBe(404);
    }

    const memo = await request(app, 'POST', '/api/v1/records', {
      cookie,
      body: { type: 'memo', title: 'm' },
    });
    const { id: memoId } = (await memo.json()) as { id: string };
    const onMemo = await request(app, 'POST', `/api/v1/records/${memoId}/items`, {
      cookie,
      body: { title: 'x' },
    });
    expect(onMemo.status).toBe(404);
  });
});

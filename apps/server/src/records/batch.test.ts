import { type LifeRecord } from '@life-book/core';
import { describe, expect, it } from 'vitest';

import { registerUser, request, setupTestDatabase, type TestApp } from '../test/harness';

const { createTestApp } = setupTestDatabase();

async function memo(app: TestApp, cookie: string, title: string): Promise<string> {
  const response = await request(app, 'POST', '/api/v1/records', {
    cookie,
    body: { type: 'memo', title },
  });
  return ((await response.json()) as { id: string }).id;
}

async function get(app: TestApp, cookie: string, id: string): Promise<LifeRecord> {
  return (await (
    await request(app, 'GET', `/api/v1/records/${id}`, { cookie })
  ).json()) as LifeRecord;
}

describe('POST /api/v1/records/batch', () => {
  it('archives, deletes and restores several records at once', async () => {
    const app = createTestApp();
    const { cookie } = await registerUser(app);
    const ids = [await memo(app, cookie, 'a'), await memo(app, cookie, 'b')];

    const archived = await request(app, 'POST', '/api/v1/records/batch', {
      cookie,
      body: { ids, action: 'archive' },
    });
    expect(await archived.json()).toEqual({ updated: 2 });
    // 已经归档的不会再改动。
    const again = await request(app, 'POST', '/api/v1/records/batch', {
      cookie,
      body: { ids, action: 'archive' },
    });
    expect(await again.json()).toEqual({ updated: 0 });
    expect(await get(app, cookie, ids[0] ?? '')).toMatchObject({ version: 2 });

    await request(app, 'POST', '/api/v1/records/batch', {
      cookie,
      body: { ids, action: 'delete' },
    });
    const restored = await request(app, 'POST', '/api/v1/records/batch', {
      cookie,
      body: { ids: [ids[0]], action: 'restore' },
    });
    expect(await restored.json()).toEqual({ updated: 1 });
    expect((await get(app, cookie, ids[1] ?? '')).deletedAt).not.toBeNull();
  });

  it('sets the category and adds tags without removing existing ones', async () => {
    const app = createTestApp();
    const { cookie } = await registerUser(app);
    const category = await request(app, 'POST', '/api/v1/categories', {
      cookie,
      body: { name: '证件' },
    });
    const { id: categoryId } = (await category.json()) as { id: string };
    const tagA = (await (
      await request(app, 'POST', '/api/v1/tags', { cookie, body: { name: 'a' } })
    ).json()) as { id: string };
    const tagB = (await (
      await request(app, 'POST', '/api/v1/tags', { cookie, body: { name: 'b' } })
    ).json()) as { id: string };
    const first = await memo(app, cookie, 'x');
    await request(app, 'PATCH', `/api/v1/records/${first}`, {
      cookie,
      body: { version: 1, tagIds: [tagA.id] },
    });
    const second = await memo(app, cookie, 'y');

    await request(app, 'POST', '/api/v1/records/batch', {
      cookie,
      body: { ids: [first, second], action: 'setCategory', categoryId },
    });
    await request(app, 'POST', '/api/v1/records/batch', {
      cookie,
      body: { ids: [first, second], action: 'addTags', tagIds: [tagA.id, tagB.id] },
    });
    expect(await get(app, cookie, first)).toMatchObject({
      categoryId,
      tagIds: [tagA.id, tagB.id],
    });
    expect(await get(app, cookie, second)).toMatchObject({
      categoryId,
      tagIds: expect.arrayContaining([tagA.id, tagB.id]),
    });
  });

  it('validates the action payload and skips other users’ records', async () => {
    const app = createTestApp();
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');
    const id = await memo(app, alice.cookie, 'x');

    const missing = await request(app, 'POST', '/api/v1/records/batch', {
      cookie: alice.cookie,
      body: { ids: [id], action: 'addTags' },
    });
    expect(missing.status).toBe(400);

    const foreign = await request(app, 'POST', '/api/v1/records/batch', {
      cookie: bob.cookie,
      body: { ids: [id], action: 'delete' },
    });
    expect(await foreign.json()).toEqual({ updated: 0 });
    expect((await get(app, alice.cookie, id)).deletedAt).toBeNull();
  });
});

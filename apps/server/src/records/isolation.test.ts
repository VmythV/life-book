import { describe, expect, it } from 'vitest';

import { registerUser, request, setupTestDatabase } from '../test/harness';

const { createTestApp } = setupTestDatabase();

/** 每个记录接口都验证：访问别人的数据一律返回 404，列表里也看不到。 */
describe('user isolation', () => {
  it('hides every record of another user', async () => {
    const app = createTestApp({ now: () => new Date('2026-10-19T02:00:00Z') });
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');

    const created = await request(app, 'POST', '/api/v1/records', {
      cookie: alice.cookie,
      body: {
        type: 'recurring',
        title: '浇水',
        recurring: {
          startDate: '2026-10-01',
          freq: 'daily',
          interval: 1,
          byWeekdays: null,
          byMonthDay: null,
          timeOfDay: null,
          end: { type: 'never' },
        },
        reminders: [{ kind: 'relative', daysBefore: 0, timeOfDay: null }],
      },
    });
    const { id } = (await created.json()) as { id: string };
    const path = `/api/v1/records/${id}`;

    const attempts: [string, string, unknown?][] = [
      ['GET', path],
      ['PATCH', path, { version: 1, title: 'hacked' }],
      ['POST', `${path}/archive`],
      ['POST', `${path}/unarchive`],
      ['DELETE', path],
      ['POST', `${path}/restore`],
      ['DELETE', `${path}/permanent`],
      ['GET', `${path}/occurrences?from=2026-10-01&to=2026-10-19`],
      ['PUT', `${path}/occurrences/2026-10-19`, { status: 'completed' }],
      ['DELETE', `${path}/occurrences/2026-10-19`],
    ];
    for (const [method, url, body] of attempts) {
      const response = await request(app, method, url, {
        cookie: bob.cookie,
        ...(body === undefined ? {} : { body }),
      });
      expect(response.status, `${method} ${url}`).toBe(404);
    }

    const list = await request(app, 'GET', '/api/v1/records', { cookie: bob.cookie });
    expect(await list.json()).toEqual({ items: [], nextCursor: null });
    const today = await request(app, 'GET', '/api/v1/today', { cookie: bob.cookie });
    expect(await today.json()).toMatchObject({ overdue: [], today: [] });
    const reminders = await request(app, 'GET', '/api/v1/reminders/upcoming', {
      cookie: bob.cookie,
    });
    expect(await reminders.json()).toEqual({ items: [] });

    // alice 的记录没有被改动。
    const own = await request(app, 'GET', path, { cookie: alice.cookie });
    expect(await own.json()).toMatchObject({
      title: '浇水',
      version: 1,
      deletedAt: null,
    });
  });

  it('keeps categories and tags per user', async () => {
    const app = createTestApp();
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');
    const category = await request(app, 'POST', '/api/v1/categories', {
      cookie: alice.cookie,
      body: { name: '证件' },
    });
    const { id: categoryId } = (await category.json()) as { id: string };

    const list = await request(app, 'GET', '/api/v1/categories', { cookie: bob.cookie });
    expect(await list.json()).toEqual({ items: [] });
    const use = await request(app, 'POST', '/api/v1/records', {
      cookie: bob.cookie,
      body: { type: 'memo', title: 'x', categoryId },
    });
    expect(use.status).toBe(400);

    // 同名分类在不同用户之间互不影响。
    const own = await request(app, 'POST', '/api/v1/categories', {
      cookie: bob.cookie,
      body: { name: '证件' },
    });
    expect(own.status).toBe(201);
  });

  it('requires a session for every new endpoint', async () => {
    const app = createTestApp();
    for (const url of [
      '/api/v1/records',
      '/api/v1/categories',
      '/api/v1/tags',
      '/api/v1/today',
      '/api/v1/reminders/upcoming',
    ]) {
      const response = await request(app, 'GET', url);
      expect(response.status, url).toBe(401);
    }
  });
});

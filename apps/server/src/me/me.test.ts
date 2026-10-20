import { describe, expect, it } from 'vitest';

import { registerUser, request, setupTestDatabase } from '../test/harness';

const { createTestApp } = setupTestDatabase();

describe('GET /api/v1/me', () => {
  it('returns the current user with default settings', async () => {
    const app = createTestApp();
    const { cookie, userId } = await registerUser(app, 'alice');
    const response = await request(app, 'GET', '/api/v1/me', { cookie });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: {
        id: userId,
        username: 'alice',
        displayName: null,
        createdAt: expect.any(String),
      },
      settings: {
        timezone: 'Asia/Shanghai',
        defaultReminderTime: '09:00',
        weekStartsOn: 1,
      },
    });
  });

  it('uses the time zone given at registration', async () => {
    const app = createTestApp();
    const register = await request(app, 'POST', '/api/v1/auth/register', {
      body: { username: 'bob', password: 'correct horse', timezone: 'Europe/Berlin' },
      tokenMode: true,
    });
    const { token } = (await register.json()) as { token: string };
    const response = await request(app, 'GET', '/api/v1/me', { token });

    expect(await response.json()).toMatchObject({
      settings: { timezone: 'Europe/Berlin' },
    });
  });

  it('only ever returns the signed-in user', async () => {
    const app = createTestApp();
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');

    const response = await request(app, 'GET', '/api/v1/me', { cookie: bob.cookie });
    const body = (await response.json()) as { user: { id: string } };
    expect(body.user.id).toBe(bob.userId);
    expect(body.user.id).not.toBe(alice.userId);
  });
});

describe('PATCH /api/v1/me/settings', () => {
  it('updates only the given fields', async () => {
    const app = createTestApp();
    const { cookie } = await registerUser(app);
    const response = await request(app, 'PATCH', '/api/v1/me/settings', {
      cookie,
      body: { defaultReminderTime: '20:30' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      timezone: 'Asia/Shanghai',
      defaultReminderTime: '20:30',
      weekStartsOn: 1,
    });
  });

  it.each([
    { timezone: 'Mars/Olympus' },
    { defaultReminderTime: '25:00' },
    { weekStartsOn: 0 },
  ])('rejects %j', async (body) => {
    const app = createTestApp();
    const { cookie } = await registerUser(app);
    const response = await request(app, 'PATCH', '/api/v1/me/settings', { cookie, body });
    expect(response.status).toBe(400);
  });
});

describe('GET /api/v1/me/export', () => {
  it('exports all data of the user as a JSON attachment', async () => {
    const app = createTestApp();
    const { cookie } = await registerUser(app, 'alice');
    await request(app, 'POST', '/api/v1/tags', { cookie, body: { name: '家' } });
    const memo = await request(app, 'POST', '/api/v1/records', {
      cookie,
      body: { type: 'memo', title: '护照' },
    });
    const { id } = (await memo.json()) as { id: string };
    await request(app, 'DELETE', `/api/v1/records/${id}`, { cookie });
    await request(app, 'POST', '/api/v1/records', {
      cookie,
      body: {
        type: 'household_item',
        title: '纸巾',
        householdItem: { unit: '包', quantity: 2 },
      },
    });
    // 别人的数据不会被导出。
    const bob = await registerUser(app, 'bob');
    await request(app, 'POST', '/api/v1/records', {
      cookie: bob.cookie,
      body: { type: 'memo', title: 'bob 的备忘' },
    });

    const response = await request(app, 'GET', '/api/v1/me/export', { cookie });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="life-book-alice-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    const body = (await response.json()) as {
      format: string;
      user: { username: string };
      tags: { name: string }[];
      records: { title: string; deletedAt: string | null }[];
      stockTransactions: { kind: string }[];
    };
    expect(body).toMatchObject({
      format: 'life-book-export',
      user: { username: 'alice' },
    });
    expect(body.tags.map((tag) => tag.name)).toEqual(['家']);
    expect(body.records.map((record) => record.title)).toEqual(['护照', '纸巾']);
    expect(body.records[0]?.deletedAt).not.toBeNull();
    expect(body.stockTransactions.map((transaction) => transaction.kind)).toEqual([
      'opening',
    ]);
    expect(JSON.stringify(body)).not.toContain('passwordHash');
  });
});

describe('DELETE /api/v1/me', () => {
  it('requires the password and then deletes everything', async () => {
    const app = createTestApp();
    const { cookie } = await registerUser(app, 'alice', 'correct horse');
    await request(app, 'POST', '/api/v1/records', {
      cookie,
      body: { type: 'memo', title: '护照' },
    });

    const wrong = await request(app, 'DELETE', '/api/v1/me', {
      cookie,
      body: { password: 'wrong' },
    });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ error: { code: 'WRONG_PASSWORD' } });

    const deleted = await request(app, 'DELETE', '/api/v1/me', {
      cookie,
      body: { password: 'correct horse' },
    });
    expect(deleted.status).toBe(204);
    const after = await request(app, 'GET', '/api/v1/me', { cookie });
    expect(after.status).toBe(401);

    // 用户名可以重新注册，得到的是全新的空账号。
    const again = await registerUser(app, 'alice');
    const list = await request(app, 'GET', '/api/v1/records', { cookie: again.cookie });
    expect(await list.json()).toEqual({ items: [], nextCursor: null });
  });
});

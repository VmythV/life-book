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

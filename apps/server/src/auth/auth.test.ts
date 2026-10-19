import { describe, expect, it } from 'vitest';

import { registerUser, request, sessionCookie, setupTestDatabase } from '../test/harness';

const { createTestApp } = setupTestDatabase();

describe('POST /api/v1/auth/register', () => {
  it('creates the user, normalizes the username and starts a cookie session', async () => {
    const app = createTestApp();
    const response = await request(app, 'POST', '/api/v1/auth/register', {
      body: { username: ' Alice ', password: 'correct horse', displayName: '爱丽丝' },
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ user: { username: 'alice', displayName: '爱丽丝' } });
    expect(body).not.toHaveProperty('token');
    const setCookie = response.headers.getSetCookie().join('; ');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');

    const me = await request(app, 'GET', '/api/v1/me', {
      cookie: sessionCookie(response),
    });
    expect(me.status).toBe(200);
  });

  it('returns a bearer token instead of a cookie in token mode', async () => {
    const app = createTestApp();
    const response = await request(app, 'POST', '/api/v1/auth/register', {
      body: { username: 'bob', password: 'correct horse' },
      tokenMode: true,
    });

    expect(response.status).toBe(201);
    expect(response.headers.getSetCookie()).toEqual([]);
    const { token } = (await response.json()) as { token: string };
    const me = await request(app, 'GET', '/api/v1/me', { token });
    expect(me.status).toBe(200);
  });

  it('rejects a username that is already taken, ignoring case', async () => {
    const app = createTestApp();
    await registerUser(app, 'alice');
    const response = await request(app, 'POST', '/api/v1/auth/register', {
      body: { username: 'ALICE', password: 'another password' },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'USERNAME_TAKEN' } });
  });

  it('rejects invalid input with field errors', async () => {
    const app = createTestApp();
    const response = await request(app, 'POST', '/api/v1/auth/register', {
      body: { username: 'a b', password: 'short' },
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { code: string; details: { fieldErrors: Record<string, unknown> } };
    };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(body.error.details.fieldErrors).sort()).toEqual([
      'password',
      'username',
    ]);
  });

  it('rejects a body that is not JSON', async () => {
    const app = createTestApp();
    const response = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(response.status).toBe(400);
  });
});

describe('POST /api/v1/auth/login', () => {
  it('logs in with the right password, ignoring username case', async () => {
    const app = createTestApp();
    await registerUser(app, 'alice', 'correct horse');
    const response = await request(app, 'POST', '/api/v1/auth/login', {
      body: { username: 'Alice', password: 'correct horse' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user: { username: 'alice' } });
    expect(sessionCookie(response)).toMatch(/^lb_session=.+/);
  });

  it.each([
    ['a wrong password', 'alice', 'wrong password'],
    ['an unknown username', 'nobody', 'correct horse'],
  ])('gives the same answer for %s', async (_case, username, password) => {
    const app = createTestApp();
    await registerUser(app, 'alice', 'correct horse');
    const response = await request(app, 'POST', '/api/v1/auth/login', {
      body: { username, password },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' },
    });
  });

  it('blocks a username after 10 failed attempts', async () => {
    const app = createTestApp();
    await registerUser(app, 'alice', 'correct horse');
    const attempt = (password: string) =>
      request(app, 'POST', '/api/v1/auth/login', {
        body: { username: 'alice', password },
      });

    for (let index = 0; index < 10; index += 1) {
      expect((await attempt('wrong password')).status).toBe(401);
    }
    expect((await attempt('correct horse')).status).toBe(429);
  });
});

describe('sessions', () => {
  it('requires a session for protected routes', async () => {
    const app = createTestApp();
    const response = await request(app, 'GET', '/api/v1/me');
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('rejects an unknown token', async () => {
    const app = createTestApp();
    const response = await request(app, 'GET', '/api/v1/me', { token: 'made-up' });
    expect(response.status).toBe(401);
  });

  it('ends the session on logout', async () => {
    const app = createTestApp();
    const { cookie } = await registerUser(app);

    const logout = await request(app, 'POST', '/api/v1/auth/logout', { cookie });
    expect(logout.status).toBe(204);
    expect(logout.headers.getSetCookie().join('; ')).toMatch(/lb_session=;/);

    const me = await request(app, 'GET', '/api/v1/me', { cookie });
    expect(me.status).toBe(401);
  });

  it('expires a session after 30 days without use', async () => {
    const start = new Date('2026-10-01T00:00:00Z');
    const { cookie } = await registerUser(createTestApp({ now: () => start }));

    const later = new Date('2026-10-31T00:00:01Z');
    const response = await request(
      createTestApp({ now: () => later }),
      'GET',
      '/api/v1/me',
      {
        cookie,
      },
    );
    expect(response.status).toBe(401);
  });

  it('extends a session that is still in use', async () => {
    const start = new Date('2026-10-01T00:00:00Z');
    const { cookie } = await registerUser(createTestApp({ now: () => start }));

    const day20 = new Date('2026-10-21T00:00:00Z');
    const renewed = await request(
      createTestApp({ now: () => day20 }),
      'GET',
      '/api/v1/me',
      {
        cookie,
      },
    );
    expect(renewed.status).toBe(200);
    expect(renewed.headers.getSetCookie().join('; ')).toContain('lb_session=');

    const day40 = new Date('2026-11-10T00:00:00Z');
    const stillValid = await request(
      createTestApp({ now: () => day40 }),
      'GET',
      '/api/v1/me',
      {
        cookie,
      },
    );
    expect(stillValid.status).toBe(200);
  });
});

describe('POST /api/v1/auth/change-password', () => {
  it('changes the password and signs out other sessions only', async () => {
    const app = createTestApp();
    const { cookie: current } = await registerUser(app, 'alice', 'correct horse');
    const otherLogin = await request(app, 'POST', '/api/v1/auth/login', {
      body: { username: 'alice', password: 'correct horse' },
    });
    const other = sessionCookie(otherLogin);

    const response = await request(app, 'POST', '/api/v1/auth/change-password', {
      cookie: current,
      body: { currentPassword: 'correct horse', newPassword: 'battery staple' },
    });
    expect(response.status).toBe(204);

    expect((await request(app, 'GET', '/api/v1/me', { cookie: current })).status).toBe(
      200,
    );
    expect((await request(app, 'GET', '/api/v1/me', { cookie: other })).status).toBe(401);

    const login = (password: string) =>
      request(app, 'POST', '/api/v1/auth/login', {
        body: { username: 'alice', password },
      });
    expect((await login('correct horse')).status).toBe(401);
    expect((await login('battery staple')).status).toBe(200);
  });

  it('rejects a wrong current password without ending the session', async () => {
    const app = createTestApp();
    const { cookie } = await registerUser(app, 'alice', 'correct horse');
    const response = await request(app, 'POST', '/api/v1/auth/change-password', {
      cookie,
      body: { currentPassword: 'not it', newPassword: 'battery staple' },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'WRONG_PASSWORD' } });
    expect((await request(app, 'GET', '/api/v1/me', { cookie })).status).toBe(200);
  });
});

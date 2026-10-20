import { describe, expect, it } from 'vitest';

import {
  createTestUser,
  FAST_SCRYPT_PARAMS,
  request,
  sessionCookie,
  setupTestDatabase,
} from '../test/harness';
import { createUser, UsernameTakenError } from '../users/create-user';

const { createTestApp, db } = setupTestDatabase();

describe('createUser', () => {
  it('normalizes the username and keeps the display name', async () => {
    const user = await createUser(
      db,
      { username: ' Alice ', password: 'correct horse', displayName: '爱丽丝' },
      { now: new Date(), passwordParams: FAST_SCRYPT_PARAMS },
    );
    expect(user).toMatchObject({ username: 'alice', displayName: '爱丽丝' });
  });

  it('rejects a username that is already taken, ignoring case', async () => {
    const options = { now: new Date(), passwordParams: FAST_SCRYPT_PARAMS };
    await createUser(db, { username: 'alice', password: 'correct horse' }, options);
    await expect(
      createUser(db, { username: 'ALICE', password: 'another password' }, options),
    ).rejects.toBeInstanceOf(UsernameTakenError);
  });

  it('rejects invalid input', async () => {
    await expect(
      createUser(db, { username: 'a b', password: 'short' }, { now: new Date() }),
    ).rejects.toThrow();
  });

  it('is the only way to create accounts: the register endpoint is gone', async () => {
    const app = createTestApp();
    const response = await request(app, 'POST', '/api/v1/auth/register', {
      body: { username: 'mallory', password: 'correct horse' },
    });
    expect(response.status).toBe(404);
  });
});

describe('POST /api/v1/auth/login', () => {
  it('logs in with the right password, ignoring username case', async () => {
    const app = createTestApp();
    await createTestUser(app, 'alice', 'correct horse');
    const response = await request(app, 'POST', '/api/v1/auth/login', {
      body: { username: 'Alice', password: 'correct horse' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user: { username: 'alice' } });
    expect(sessionCookie(response)).toMatch(/^lb_session=.+/);
    const setCookie = response.headers.getSetCookie().join('; ');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
  });

  it('returns a bearer token instead of a cookie in token mode', async () => {
    const app = createTestApp();
    await createTestUser(app, 'bob', 'correct horse');
    const response = await request(app, 'POST', '/api/v1/auth/login', {
      body: { username: 'bob', password: 'correct horse' },
      tokenMode: true,
    });

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([]);
    const { token } = (await response.json()) as { token: string };
    const me = await request(app, 'GET', '/api/v1/me', { token });
    expect(me.status).toBe(200);
  });

  it('rejects a body that is not JSON', async () => {
    const app = createTestApp();
    const response = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(response.status).toBe(400);
  });

  it.each([
    ['a wrong password', 'alice', 'wrong password'],
    ['an unknown username', 'nobody', 'correct horse'],
  ])('gives the same answer for %s', async (_case, username, password) => {
    const app = createTestApp();
    await createTestUser(app, 'alice', 'correct horse');
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
    await createTestUser(app, 'alice', 'correct horse');
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
    const { cookie } = await createTestUser(app);

    const logout = await request(app, 'POST', '/api/v1/auth/logout', { cookie });
    expect(logout.status).toBe(204);
    expect(logout.headers.getSetCookie().join('; ')).toMatch(/lb_session=;/);

    const me = await request(app, 'GET', '/api/v1/me', { cookie });
    expect(me.status).toBe(401);
  });

  it('expires a session after 30 days without use', async () => {
    const start = new Date('2026-10-01T00:00:00Z');
    const { cookie } = await createTestUser(createTestApp({ now: () => start }));

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
    const { cookie } = await createTestUser(createTestApp({ now: () => start }));

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
    const { cookie: current } = await createTestUser(app, 'alice', 'correct horse');
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
    const { cookie } = await createTestUser(app, 'alice', 'correct horse');
    const response = await request(app, 'POST', '/api/v1/auth/change-password', {
      cookie,
      body: { currentPassword: 'not it', newPassword: 'battery staple' },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'WRONG_PASSWORD' } });
    expect((await request(app, 'GET', '/api/v1/me', { cookie })).status).toBe(200);
  });
});

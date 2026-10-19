import { describe, expect, it, vi } from 'vitest';

import { ApiError, createApiClient } from './client';

const user = {
  id: '01a15256-d783-72e5-8e2d-150e2e1c647e',
  username: 'alice',
  displayName: null,
  createdAt: '2026-10-19T04:06:25.223Z',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createApiClient', () => {
  it('sends the bearer token and client mode header in token mode', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        jsonResponse(200, {
          user,
          settings: {
            timezone: 'Asia/Shanghai',
            defaultReminderTime: '09:00',
            weekStartsOn: 1,
          },
        }),
      ),
    );
    const client = createApiClient({
      baseUrl: 'http://192.168.1.2:8787',
      auth: { mode: 'token', getToken: () => 'secret-token' },
      fetch,
    });

    const me = await client.me.get();

    expect(me.user.username).toBe('alice');
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('http://192.168.1.2:8787/api/v1/me');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer secret-token');
    expect(headers.get('x-lifebook-client')).toBe('token');
    expect(init?.credentials).toBe('omit');
  });

  it('includes cookies and no token in cookie mode', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(jsonResponse(200, { user })),
    );
    const client = createApiClient({ baseUrl: '', auth: { mode: 'cookie' }, fetch });

    await client.auth.login({ username: 'alice', password: 'correct horse' });

    const [, init] = fetch.mock.calls[0] ?? [];
    expect(init?.credentials).toBe('include');
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
    expect(init?.body).toBe(
      JSON.stringify({ username: 'alice', password: 'correct horse' }),
    );
  });

  it('turns error responses into ApiError and reports lost sessions', async () => {
    const onUnauthenticated = vi.fn();
    const client = createApiClient({
      baseUrl: '',
      auth: { mode: 'cookie' },
      fetch: () =>
        Promise.resolve(
          jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: '请先登录' } }),
        ),
      onUnauthenticated,
    });

    const error = await client.me.get().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
      message: '请先登录',
    });
    expect(onUnauthenticated).toHaveBeenCalledOnce();
  });

  it('does not treat wrong credentials as a lost session', async () => {
    const onUnauthenticated = vi.fn();
    const client = createApiClient({
      baseUrl: '',
      auth: { mode: 'cookie' },
      fetch: () =>
        Promise.resolve(
          jsonResponse(401, {
            error: { code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' },
          }),
        ),
      onUnauthenticated,
    });

    await expect(
      client.auth.login({ username: 'a', password: 'b' }),
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  it('reports network failures with a dedicated code', async () => {
    const client = createApiClient({
      baseUrl: '',
      auth: { mode: 'cookie' },
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    });

    await expect(client.me.get()).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
    });
  });

  it('rejects responses that do not match the contract', async () => {
    const client = createApiClient({
      baseUrl: '',
      auth: { mode: 'cookie' },
      fetch: () => Promise.resolve(jsonResponse(200, { unexpected: true })),
    });

    await expect(client.me.get()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

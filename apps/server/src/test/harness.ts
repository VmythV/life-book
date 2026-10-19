import { CLIENT_MODE_HEADER, TOKEN_CLIENT_MODE } from '@life-book/core';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach } from 'vitest';

import { createApp } from '../app';
import { type ScryptParams } from '../auth/password';
import { connectDatabase } from '../db/client';
import { loadEnv } from '../env';
import { type AppDeps } from '../http/context';

/** 测试用的低强度参数，只为加快测试，不能用于生产。 */
export const FAST_SCRYPT_PARAMS: ScryptParams = { N: 2 ** 10, r: 8, p: 1 };

export type TestApp = ReturnType<typeof createApp>;

/** 在 describe 外调用：连接测试库，并在每个测试前清空数据。 */
export function setupTestDatabase() {
  const connection = connectDatabase(loadEnv().TEST_DATABASE_URL);

  beforeEach(async () => {
    await connection.db.execute(sql`truncate table users cascade`);
  });
  afterAll(async () => {
    await connection.close();
  });

  return {
    db: connection.db,
    createTestApp(overrides: Partial<AppDeps> = {}): TestApp {
      return createApp({
        db: connection.db,
        passwordParams: FAST_SCRYPT_PARAMS,
        secureCookies: false,
        now: () => new Date(),
        getClientIp: () => 'test-client',
        logRequests: false,
        ...overrides,
      });
    },
  };
}

export interface RequestOptions {
  body?: unknown;
  cookie?: string;
  token?: string;
  tokenMode?: boolean;
}

export function request(
  app: TestApp,
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<Response> {
  const headers = new Headers();
  if (options.body !== undefined) {
    headers.set('content-type', 'application/json');
  }
  if (options.cookie !== undefined) {
    headers.set('cookie', options.cookie);
  }
  if (options.token !== undefined) {
    headers.set('authorization', `Bearer ${options.token}`);
  }
  if (options.tokenMode === true) {
    headers.set(CLIENT_MODE_HEADER, TOKEN_CLIENT_MODE);
  }
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }),
  );
}

/** 从响应中取出 `name=value`，可直接作为下一次请求的 Cookie。 */
export function sessionCookie(response: Response): string {
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith('lb_session='));
  if (cookie === undefined) {
    throw new Error('Response did not set the session cookie.');
  }
  return cookie.split(';')[0] ?? '';
}

export async function registerUser(
  app: TestApp,
  username = 'alice',
  password = 'correct horse',
): Promise<{ cookie: string; userId: string }> {
  const response = await request(app, 'POST', '/api/v1/auth/register', {
    body: { username, password },
  });
  if (response.status !== 201) {
    throw new Error(`Register failed with ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as { user: { id: string } };
  return { cookie: sessionCookie(response), userId: body.user.id };
}

import { CLIENT_MODE_HEADER, TOKEN_CLIENT_MODE } from '@life-book/core';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach } from 'vitest';

import { createApp } from '../app';
import { type ScryptParams } from '../auth/password';
import { connectDatabase, type Database } from '../db/client';
import { loadEnv } from '../env';
import { type AppDeps } from '../http/context';
import { createUser } from '../users/create-user';

/** 测试用的低强度参数，只为加快测试，不能用于生产。 */
export const FAST_SCRYPT_PARAMS: ScryptParams = { N: 2 ** 10, r: 8, p: 1 };

export type TestApp = ReturnType<typeof createApp>;

/** 在 describe 外调用：连接测试库，并在每个测试前清空数据。 */
let testDb: Database | undefined;

export function setupTestDatabase() {
  const connection = connectDatabase(loadEnv().TEST_DATABASE_URL);
  testDb = connection.db;

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

/** 直接在测试库里建账号（应用没有注册入口），再通过登录接口拿到会话 Cookie。 */
export async function createTestUser(
  app: TestApp,
  username = 'alice',
  password = 'correct horse',
): Promise<{ cookie: string; userId: string }> {
  if (testDb === undefined) {
    throw new Error('Call setupTestDatabase() before createTestUser().');
  }
  const user = await createUser(
    testDb,
    { username, password },
    { now: new Date(), passwordParams: FAST_SCRYPT_PARAMS },
  );
  const response = await request(app, 'POST', '/api/v1/auth/login', {
    body: { username, password },
  });
  if (response.status !== 200) {
    throw new Error(`Login failed with ${response.status}: ${await response.text()}`);
  }
  return { cookie: sessionCookie(response), userId: user.id };
}

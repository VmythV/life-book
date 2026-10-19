import {
  type AuthResponse,
  changePasswordRequestSchema,
  CLIENT_MODE_HEADER,
  DEFAULT_TIME_ZONE,
  loginRequestSchema,
  registerRequestSchema,
  TOKEN_CLIENT_MODE,
} from '@life-book/core';
import { eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';

import { isUniqueViolation } from '../db/client';
import { userSettings, users } from '../db/schema';
import { type AppDeps, type AppEnv } from '../http/context';
import { ApiError } from '../http/errors';
import { readJson } from '../http/validate';
import { toUserDto } from '../users/mappers';
import { clearSessionCookie, requireAuth, setSessionCookie } from './middleware';
import { hashPassword, verifyPassword } from './password';
import { RateLimiter } from './rate-limit';
import { createSession, deleteOtherSessions, deleteSession } from './sessions';

const MINUTE_MS = 60 * 1000;

const tooManyRequests = () =>
  new ApiError(429, 'TOO_MANY_REQUESTS', '尝试次数过多，请稍后再试');

export function authRoutes(deps: AppDeps) {
  const registerLimiter = new RateLimiter(20, 60 * MINUTE_MS);
  const passwordLimiter = new RateLimiter(10, 15 * MINUTE_MS);
  // 用户名不存在时也做一次同样耗时的校验，避免通过响应时间判断用户名是否存在。
  let dummyHash: Promise<string> | undefined;
  const verifyAgainstDummy = async (password: string) => {
    dummyHash ??= hashPassword('dummy-password', deps.passwordParams);
    await verifyPassword(password, await dummyHash);
    return false;
  };

  async function respondWithSession(
    c: Context<AppEnv>,
    user: typeof users.$inferSelect,
    status: 200 | 201,
  ) {
    const tokenMode = c.req.header(CLIENT_MODE_HEADER) === TOKEN_CLIENT_MODE;
    const { token, expiresAt } = await createSession(deps.db, {
      userId: user.id,
      userAgent: c.req.header('user-agent') ?? null,
      now: deps.now(),
    });
    if (!tokenMode) {
      setSessionCookie(c, token, expiresAt, deps.secureCookies);
    }
    const body: AuthResponse = { user: toUserDto(user), ...(tokenMode ? { token } : {}) };
    return c.json(body, status);
  }

  return new Hono<AppEnv>()
    .post('/register', async (c) => {
      const now = deps.now();
      const ip = deps.getClientIp(c);
      if (registerLimiter.isLimited(ip, now)) {
        throw tooManyRequests();
      }
      registerLimiter.hit(ip, now);

      const input = await readJson(c, registerRequestSchema);
      const passwordHash = await hashPassword(input.password, deps.passwordParams);
      try {
        const user = await deps.db.transaction(async (tx) => {
          const [created] = await tx
            .insert(users)
            .values({
              username: input.username,
              displayName: input.displayName ?? null,
              passwordHash,
              createdAt: now,
              updatedAt: now,
            })
            .returning();
          if (created === undefined) {
            throw new Error('Insert into users returned no row.');
          }
          await tx.insert(userSettings).values({
            userId: created.id,
            timezone: input.timezone ?? DEFAULT_TIME_ZONE,
            updatedAt: now,
          });
          return created;
        });
        return await respondWithSession(c, user, 201);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ApiError(409, 'USERNAME_TAKEN', '该用户名已被使用');
        }
        throw error;
      }
    })
    .post('/login', async (c) => {
      const now = deps.now();
      const input = await readJson(c, loginRequestSchema);
      const limitKey = `login:${deps.getClientIp(c)}:${input.username}`;
      if (passwordLimiter.isLimited(limitKey, now)) {
        throw tooManyRequests();
      }

      const [user] = await deps.db
        .select()
        .from(users)
        .where(eq(users.username, input.username));
      const valid =
        user === undefined
          ? await verifyAgainstDummy(input.password)
          : await verifyPassword(input.password, user.passwordHash);
      if (user === undefined || !valid) {
        passwordLimiter.hit(limitKey, now);
        throw new ApiError(401, 'INVALID_CREDENTIALS', '用户名或密码错误');
      }
      passwordLimiter.reset(limitKey);
      return respondWithSession(c, user, 200);
    })
    .post('/logout', requireAuth(deps), async (c) => {
      const auth = c.get('auth');
      await deleteSession(deps.db, auth.sessionId);
      if (auth.mode === 'cookie') {
        clearSessionCookie(c);
      }
      return c.body(null, 204);
    })
    .post('/change-password', requireAuth(deps), async (c) => {
      const now = deps.now();
      const auth = c.get('auth');
      const limitKey = `change-password:${auth.userId}`;
      if (passwordLimiter.isLimited(limitKey, now)) {
        throw tooManyRequests();
      }

      const input = await readJson(c, changePasswordRequestSchema);
      const [user] = await deps.db.select().from(users).where(eq(users.id, auth.userId));
      if (user === undefined) {
        throw new ApiError(401, 'UNAUTHENTICATED', '请先登录');
      }
      if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
        passwordLimiter.hit(limitKey, now);
        throw new ApiError(400, 'WRONG_PASSWORD', '当前密码不正确');
      }
      passwordLimiter.reset(limitKey);

      const passwordHash = await hashPassword(input.newPassword, deps.passwordParams);
      await deps.db
        .update(users)
        .set({ passwordHash, updatedAt: now })
        .where(eq(users.id, auth.userId));
      await deleteOtherSessions(deps.db, auth.userId, auth.sessionId);
      return c.body(null, 204);
    });
}

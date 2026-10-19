import { type Context, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

import { type AppDeps, type AppEnv } from '../http/context';
import { unauthenticated } from '../http/errors';
import { findActiveSession } from './sessions';

export const SESSION_COOKIE = 'lb_session';

export function setSessionCookie(
  c: Context,
  token: string,
  expiresAt: Date,
  secure: boolean,
): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure,
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

function readBearerToken(c: Context): string | undefined {
  const match = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '');
  return match?.[1];
}

/** 校验会话并把当前用户放进上下文；`user_id` 只能从这里取得。 */
export function requireAuth(deps: AppDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const bearer = readBearerToken(c);
    const token = bearer ?? getCookie(c, SESSION_COOKIE);
    if (token === undefined) {
      throw unauthenticated();
    }
    const session = await findActiveSession(deps.db, token, deps.now());
    if (session === null) {
      throw unauthenticated();
    }
    const mode = bearer === undefined ? 'cookie' : 'token';
    if (session.renewed && mode === 'cookie') {
      setSessionCookie(c, token, session.expiresAt, deps.secureCookies);
    }
    c.set('auth', { userId: session.userId, sessionId: session.id, mode });
    await next();
  };
}

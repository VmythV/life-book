import { type Context } from 'hono';

import { type ScryptParams } from '../auth/password';
import { type Database } from '../db/client';

export interface AppDeps {
  db: Database;
  passwordParams: ScryptParams;
  /** 部署到 HTTPS 后为 true，Cookie 只通过 HTTPS 发送。 */
  secureCookies: boolean;
  now: () => Date;
  /** 用于限流的客户端地址。 */
  getClientIp: (c: Context) => string;
  logRequests: boolean;
}

export interface AuthContext {
  userId: string;
  sessionId: string;
  /** cookie：Web 端；token：手机端通过 Authorization 头携带令牌。 */
  mode: 'cookie' | 'token';
}

export interface AppEnv {
  Variables: {
    auth: AuthContext;
  };
}

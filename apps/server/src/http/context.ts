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
  /** 构建好的 Web 页面目录；设置后同一个端口也提供 Web，局域网里的电脑和手机浏览器都能直接打开。 */
  webDistDir?: string | undefined;
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

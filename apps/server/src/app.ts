import { Hono } from 'hono';
import { logger } from 'hono/logger';

import { authRoutes } from './auth/routes';
import { type AppDeps, type AppEnv } from './http/context';
import { ApiError, errorBody } from './http/errors';
import { meRoutes } from './me/routes';

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  if (deps.logRequests) {
    app.use(logger());
  }

  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json(errorBody(error.code, error.message, error.details), error.status);
    }
    console.error(error);
    return c.json(errorBody('INTERNAL_ERROR', '服务器内部错误'), 500);
  });
  app.notFound((c) => c.json(errorBody('NOT_FOUND', '接口不存在'), 404));

  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.route('/api/v1/auth', authRoutes(deps));
  app.route('/api/v1/me', meRoutes(deps));

  return app;
}

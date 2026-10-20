import { Hono } from 'hono';
import { logger } from 'hono/logger';

import { authRoutes } from './auth/routes';
import { type AppDeps, type AppEnv } from './http/context';
import { ApiError, errorBody } from './http/errors';
import { meRoutes } from './me/routes';
import { checklistItemRoutes } from './records/checklist-routes';
import { householdRoutes } from './records/household-routes';
import { recordRoutes } from './records/routes';
import { reminderRoutes, todayRoutes } from './schedule/routes';
import { categoryRoutes, tagRoutes } from './taxonomy/routes';
import { templateRoutes } from './templates/routes';

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
  app.route('/api/v1/records', recordRoutes(deps));
  app.route('/api/v1/records', checklistItemRoutes(deps));
  app.route('/api/v1/records', householdRoutes(deps));
  app.route('/api/v1/categories', categoryRoutes(deps));
  app.route('/api/v1/tags', tagRoutes(deps));
  app.route('/api/v1/templates', templateRoutes(deps));
  app.route('/api/v1/today', todayRoutes(deps));
  app.route('/api/v1/reminders', reminderRoutes(deps));

  return app;
}

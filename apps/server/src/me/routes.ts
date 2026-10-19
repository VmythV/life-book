import { type MeResponse, updateSettingsRequestSchema } from '@life-book/core';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { requireAuth } from '../auth/middleware';
import { userSettings, users } from '../db/schema';
import { type AppDeps, type AppEnv } from '../http/context';
import { unauthenticated } from '../http/errors';
import { readJson } from '../http/validate';
import { toSettingsDto, toUserDto } from '../users/mappers';

export function meRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .use(requireAuth(deps))
    .get('/', async (c) => {
      const { userId } = c.get('auth');
      const [row] = await deps.db
        .select({ user: users, settings: userSettings })
        .from(users)
        .innerJoin(userSettings, eq(userSettings.userId, users.id))
        .where(eq(users.id, userId));
      if (row === undefined) {
        throw unauthenticated();
      }
      const body: MeResponse = {
        user: toUserDto(row.user),
        settings: toSettingsDto(row.settings),
      };
      return c.json(body);
    })
    .patch('/settings', async (c) => {
      const { userId } = c.get('auth');
      const input = await readJson(c, updateSettingsRequestSchema);
      const [row] = await deps.db
        .update(userSettings)
        .set({
          ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
          ...(input.defaultReminderTime === undefined
            ? {}
            : { defaultReminderTime: input.defaultReminderTime }),
          ...(input.weekStartsOn === undefined
            ? {}
            : { weekStartsOn: input.weekStartsOn }),
          updatedAt: deps.now(),
        })
        .where(eq(userSettings.userId, userId))
        .returning();
      if (row === undefined) {
        throw unauthenticated();
      }
      return c.json(toSettingsDto(row));
    });
}

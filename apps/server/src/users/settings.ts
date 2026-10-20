import { type UserSettings } from '@life-book/core';
import { eq } from 'drizzle-orm';

import { type Executor } from '../db/client';
import { userSettings } from '../db/schema';
import { unauthenticated } from '../http/errors';
import { toSettingsDto } from './mappers';

export async function loadSettings(db: Executor, userId: string): Promise<UserSettings> {
  const [row] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  if (row === undefined) {
    throw unauthenticated();
  }
  return toSettingsDto(row);
}

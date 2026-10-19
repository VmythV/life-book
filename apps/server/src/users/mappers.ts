import { type User, type UserSettings } from '@life-book/core';

import { type userSettings, type users } from '../db/schema';

export function toUserDto(row: typeof users.$inferSelect): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toSettingsDto(row: typeof userSettings.$inferSelect): UserSettings {
  return {
    timezone: row.timezone,
    // PostgreSQL time 列返回 HH:mm:ss，API 只用到分钟。
    defaultReminderTime: row.defaultReminderTime.slice(0, 5),
    weekStartsOn: row.weekStartsOn,
  };
}

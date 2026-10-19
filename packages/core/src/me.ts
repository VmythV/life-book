import { z } from 'zod';

import { userSchema } from './auth';
import { localTimeSchema, timeZoneSchema } from './time';

export const userSettingsSchema = z.object({
  timezone: timeZoneSchema,
  defaultReminderTime: localTimeSchema,
  /** 1 = 周一，7 = 周日。 */
  weekStartsOn: z.number().int().min(1).max(7),
});
export type UserSettings = z.infer<typeof userSettingsSchema>;

export const meResponseSchema = z.object({
  user: userSchema,
  settings: userSettingsSchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const updateSettingsRequestSchema = userSettingsSchema.partial();
export type UpdateSettingsRequest = z.input<typeof updateSettingsRequestSchema>;

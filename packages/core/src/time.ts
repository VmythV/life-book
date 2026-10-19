import { z } from 'zod';

export const DEFAULT_TIME_ZONE = 'Asia/Shanghai';

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const timeZoneSchema = z
  .string()
  .min(1)
  .refine(isValidTimeZone, { message: '无效的时区' });

/** 一天中的时刻，格式 `HH:mm`。 */
export const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: '时间格式应为 HH:mm' });

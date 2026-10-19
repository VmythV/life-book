import { z } from 'zod';

import { timeZoneSchema } from './time';

export const USERNAME_PATTERN = /^[a-z0-9_]{3,32}$/;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** 用户名不区分大小写：去掉首尾空格并转为小写后再校验。 */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(USERNAME_PATTERN, { message: '用户名为 3～32 位字母、数字或下划线' });

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, { message: `密码至少 ${PASSWORD_MIN_LENGTH} 位` })
  .max(PASSWORD_MAX_LENGTH, { message: `密码最多 ${PASSWORD_MAX_LENGTH} 位` });

export const displayNameSchema = z.string().trim().min(1).max(50);

export const registerRequestSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  displayName: displayNameSchema.optional(),
  timezone: timeZoneSchema.optional(),
});
export type RegisterRequest = z.input<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  // 登录时只做规范化，不按注册规则校验，统一由“用户名或密码错误”回应。
  username: z.string().trim().toLowerCase().min(1).max(64),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.input<typeof loginRequestSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: passwordSchema,
});
export type ChangePasswordRequest = z.input<typeof changePasswordRequestSchema>;

export const userSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  displayName: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type User = z.infer<typeof userSchema>;

/**
 * 注册和登录的响应。`token` 只在客户端声明为令牌模式（手机端）时返回；
 * Web 端改用 httpOnly Cookie，响应中不含令牌。
 */
export const authResponseSchema = z.object({
  user: userSchema,
  token: z.string().optional(),
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

/** 客户端通过该请求头声明使用 Bearer 令牌而不是 Cookie。 */
export const CLIENT_MODE_HEADER = 'x-lifebook-client';
export const TOKEN_CLIENT_MODE = 'token';

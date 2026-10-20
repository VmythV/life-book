import { existsSync } from 'node:fs';

import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .default('postgres://lifebook:lifebook@localhost:5432/life_book'),
  TEST_DATABASE_URL: z
    .string()
    .default('postgres://lifebook:lifebook@localhost:5432/life_book_test'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOST: z.string().default('0.0.0.0'),
  /** 设置后同时提供构建好的 Web 页面，如 `../web/dist`。 */
  WEB_DIST_DIR: z.string().optional(),
  SECURE_COOKIES: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type Env = z.infer<typeof envSchema>;

/** 读取当前目录下可选的 `.env`，再用默认值补齐本地开发配置。 */
export function loadEnv(): Env {
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }
  return envSchema.parse(process.env);
}

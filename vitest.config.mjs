import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    clearMocks: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['packages/**/*.test.ts', 'apps/{web,mobile}/**/*.test.{ts,tsx}'],
        },
      },
      {
        // 服务端集成测试连接真实的 PostgreSQL，先执行 pnpm db:up。
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          include: ['apps/server/**/*.test.ts'],
          globalSetup: ['apps/server/src/test/global-setup.ts'],
          fileParallelism: false,
        },
      },
    ],
  },
});

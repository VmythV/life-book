import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    clearMocks: true,
    environment: 'node',
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'],
  },
});

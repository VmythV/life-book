import { afterAll, beforeAll, vi } from 'vitest';

const originalFetch = globalThis.fetch;

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('Unit tests are not allowed to access the network.');
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
});

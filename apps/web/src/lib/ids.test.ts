import { afterEach, describe, expect, it, vi } from 'vitest';

import { newId } from './ids';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns distinct v4 UUIDs', () => {
    const ids = Array.from({ length: 50 }, newId);
    for (const id of ids) {
      expect(id).toMatch(UUID_V4);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('works where crypto.randomUUID is unavailable (plain http on a LAN address)', () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    expect(newId()).toMatch(UUID_V4);
  });
});

import { FixedClock, FixedIdGenerator, FixedRandomSource } from '@life-book/test-support';
import { describe, expect, it } from 'vitest';

import { createScaffoldSnapshot } from './create-scaffold-snapshot';

describe('createScaffoldSnapshot', () => {
  it('[ARCH-009] uses only explicitly injected deterministic sources', () => {
    const clock = new FixedClock('2000-01-01T00:00:00.000Z');
    const ids = new FixedIdGenerator('synthetic-diagnostic-0001');
    const random = new FixedRandomSource(0.42);
    const sources = {
      nextDiagnosticId: () => ids.next(),
      nextUnitInterval: () => random.nextUnitInterval(),
      nowIsoString: () => clock.now(),
    };

    const first = createScaffoldSnapshot(sources);
    const second = createScaffoldSnapshot(sources);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first).toEqual({
      kind: 'created',
      snapshot: {
        diagnosticId: 'synthetic-diagnostic-0001',
        entropyBucket: 4,
        generatedAt: '2000-01-01T00:00:00.000Z',
        kind: 'm0_scaffold_snapshot',
      },
    });
  });

  it('rejects an invalid injected random value without reading a global fallback', () => {
    const result = createScaffoldSnapshot({
      nextDiagnosticId: () => 'synthetic-diagnostic-0002',
      nextUnitInterval: () => 1,
      nowIsoString: () => '2000-01-01T00:00:00.000Z',
    });

    expect(result).toEqual({ code: 'invalid_fixed_source', kind: 'rejected' });
  });
});

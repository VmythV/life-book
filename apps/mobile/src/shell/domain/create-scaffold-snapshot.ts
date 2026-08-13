export interface ScaffoldDeterministicSources {
  nextDiagnosticId(): string;
  nextUnitInterval(): number;
  nowIsoString(): string;
}

export interface ScaffoldSnapshot {
  readonly diagnosticId: string;
  readonly entropyBucket: number;
  readonly generatedAt: string;
  readonly kind: 'm0_scaffold_snapshot';
}

export type CreateScaffoldSnapshotResult =
  | { readonly kind: 'created'; readonly snapshot: ScaffoldSnapshot }
  | { readonly code: 'invalid_fixed_source'; readonly kind: 'rejected' };

export function createScaffoldSnapshot(
  sources: ScaffoldDeterministicSources,
): CreateScaffoldSnapshotResult {
  const diagnosticId = sources.nextDiagnosticId();
  const generatedAt = sources.nowIsoString();
  const randomValue = sources.nextUnitInterval();

  if (
    diagnosticId.length === 0 ||
    generatedAt.length === 0 ||
    !Number.isFinite(randomValue) ||
    randomValue < 0 ||
    randomValue >= 1
  ) {
    return { code: 'invalid_fixed_source', kind: 'rejected' };
  }

  return {
    kind: 'created',
    snapshot: {
      diagnosticId,
      entropyBucket: Math.floor(randomValue * 10),
      generatedAt,
      kind: 'm0_scaffold_snapshot',
    },
  };
}

import { createScaffoldSnapshot } from '../domain/create-scaffold-snapshot';
import type {
  ScaffoldCapabilityAvailability,
  ScaffoldCapabilityPort,
  ScaffoldSourcesPort,
  ScaffoldStatusRepositoryPort,
} from '../ports/scaffold-ports';

export interface ScaffoldStatusViewModel {
  readonly capabilities: readonly ScaffoldCapabilityAvailability[];
  readonly diagnosticId: string;
  readonly productName: string;
  readonly stage: 'm0_scaffold';
}

export type BuildScaffoldStatusResult =
  | { readonly kind: 'ready'; readonly viewModel: ScaffoldStatusViewModel }
  | { readonly code: 'invalid_fixed_source'; readonly kind: 'blocked' };

export function buildScaffoldStatus(
  productName: string,
  sources: ScaffoldSourcesPort,
  repositoryFactory: (snapshot: {
    readonly diagnosticId: string;
    readonly entropyBucket: number;
    readonly generatedAt: string;
    readonly kind: 'm0_scaffold_snapshot';
  }) => ScaffoldStatusRepositoryPort,
  capabilities: readonly ScaffoldCapabilityPort[],
): BuildScaffoldStatusResult {
  const snapshotResult = createScaffoldSnapshot(sources);
  if (snapshotResult.kind === 'rejected') {
    return { code: snapshotResult.code, kind: 'blocked' };
  }

  const repository = repositoryFactory(snapshotResult.snapshot);
  const snapshot = repository.read();

  return {
    kind: 'ready',
    viewModel: {
      capabilities: capabilities.map((capability) => capability.inspect()),
      diagnosticId: snapshot.diagnosticId,
      productName,
      stage: 'm0_scaffold',
    },
  };
}

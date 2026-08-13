import type { ScaffoldSnapshot } from '../domain/create-scaffold-snapshot';

export type ScaffoldCapability =
  'network' | 'persistence' | 'product_notifications' | 'telemetry' | 'updates';

export interface ScaffoldConfigPort {
  read(): unknown;
}

export interface ScaffoldSourcesPort {
  nextDiagnosticId(): string;
  nextUnitInterval(): number;
  nowIsoString(): string;
}

export interface ScaffoldStatusRepositoryPort {
  read(): ScaffoldSnapshot;
}

export type ScaffoldCapabilityAvailability = {
  readonly capability: ScaffoldCapability;
  readonly kind: 'unavailable';
  readonly reason: 'stage_not_active';
};

export interface ScaffoldCapabilityPort {
  inspect(): ScaffoldCapabilityAvailability;
}

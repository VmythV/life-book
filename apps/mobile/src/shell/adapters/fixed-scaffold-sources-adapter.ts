import type { ScaffoldSourcesPort } from '../ports/scaffold-ports';

export class FixedScaffoldSourcesAdapter implements ScaffoldSourcesPort {
  public nextDiagnosticId(): string {
    return 'synthetic-m0-diagnostic';
  }

  public nextUnitInterval(): number {
    return 0.5;
  }

  public nowIsoString(): string {
    return '2000-01-01T00:00:00.000Z';
  }
}

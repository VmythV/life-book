import type { ScaffoldSnapshot } from '../domain/create-scaffold-snapshot';
import type { ScaffoldStatusRepositoryPort } from '../ports/scaffold-ports';

export class InMemoryScaffoldStatusAdapter implements ScaffoldStatusRepositoryPort {
  public constructor(private readonly snapshot: ScaffoldSnapshot) {}

  public read(): ScaffoldSnapshot {
    return this.snapshot;
  }
}

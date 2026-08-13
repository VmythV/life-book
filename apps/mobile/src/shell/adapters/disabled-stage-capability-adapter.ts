import type {
  ScaffoldCapability,
  ScaffoldCapabilityAvailability,
  ScaffoldCapabilityPort,
} from '../ports/scaffold-ports';

export class DisabledStageCapabilityAdapter implements ScaffoldCapabilityPort {
  public constructor(private readonly capability: ScaffoldCapability) {}

  public inspect(): ScaffoldCapabilityAvailability {
    return {
      capability: this.capability,
      kind: 'unavailable',
      reason: 'stage_not_active',
    };
  }
}

export const PRIVACY_CANARY = 'synthetic-private-content-never-log' as const;

export class FixedClock<TValue> {
  public constructor(private readonly value: TValue) {}

  public now(): TValue {
    return this.value;
  }
}

export class FixedIdGenerator<TValue> {
  public constructor(private readonly value: TValue) {}

  public next(): TValue {
    return this.value;
  }
}

export class FixedRandomSource {
  public constructor(private readonly value: number) {
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError('Fixed random values must be finite and in [0, 1).');
    }
  }

  public nextUnitInterval(): number {
    return this.value;
  }
}

export class FaultSwitch {
  private active = false;

  public enable(): void {
    this.active = true;
  }

  public disable(): void {
    this.active = false;
  }

  public inspect(): { kind: 'clear' } | { kind: 'fault_injected' } {
    return this.active ? { kind: 'fault_injected' } : { kind: 'clear' };
  }
}

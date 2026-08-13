const CAPABILITY_KEYS = [
  'network',
  'persistence',
  'productNotifications',
  'telemetry',
  'updates',
] as const;

type ScaffoldCapabilityConfigKey = (typeof CAPABILITY_KEYS)[number];

export interface ScaffoldConfig {
  readonly capabilities: Readonly<Record<ScaffoldCapabilityConfigKey, false>>;
  readonly productName: string;
  readonly stage: 'm0_scaffold';
}

export type ParseScaffoldConfigResult =
  | { readonly config: ScaffoldConfig; readonly kind: 'valid' }
  | {
      readonly code:
        | 'capability_must_be_disabled'
        | 'invalid_capabilities'
        | 'invalid_product_name'
        | 'invalid_root'
        | 'invalid_stage'
        | 'unknown_key';
      readonly kind: 'invalid';
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

export function parseScaffoldConfig(raw: unknown): ParseScaffoldConfigResult {
  if (!isRecord(raw)) {
    return { code: 'invalid_root', kind: 'invalid' };
  }

  if (!hasOnlyKeys(raw, ['capabilities', 'productName', 'stage'])) {
    return { code: 'unknown_key', kind: 'invalid' };
  }

  if (raw.stage !== 'm0_scaffold') {
    return { code: 'invalid_stage', kind: 'invalid' };
  }

  if (typeof raw.productName !== 'string' || raw.productName.trim().length === 0) {
    return { code: 'invalid_product_name', kind: 'invalid' };
  }

  if (!isRecord(raw.capabilities)) {
    return { code: 'invalid_capabilities', kind: 'invalid' };
  }

  if (!hasOnlyKeys(raw.capabilities, CAPABILITY_KEYS)) {
    return { code: 'unknown_key', kind: 'invalid' };
  }

  for (const key of CAPABILITY_KEYS) {
    if (raw.capabilities[key] !== false) {
      return { code: 'capability_must_be_disabled', kind: 'invalid' };
    }
  }

  return {
    config: {
      capabilities: {
        network: false,
        persistence: false,
        productNotifications: false,
        telemetry: false,
        updates: false,
      },
      productName: raw.productName,
      stage: raw.stage,
    },
    kind: 'valid',
  };
}

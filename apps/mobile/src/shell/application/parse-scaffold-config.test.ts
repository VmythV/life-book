import { describe, expect, it } from 'vitest';

import { parseScaffoldConfig } from './parse-scaffold-config';

const validConfig = {
  capabilities: {
    network: false,
    persistence: false,
    productNotifications: false,
    telemetry: false,
    updates: false,
  },
  productName: '生活有谱',
  stage: 'm0_scaffold',
};

describe('parseScaffoldConfig', () => {
  it('accepts the exact M0 fail-closed configuration', () => {
    expect(parseScaffoldConfig(validConfig)).toEqual({
      config: validConfig,
      kind: 'valid',
    });
  });

  it('rejects enabling a gated capability', () => {
    expect(
      parseScaffoldConfig({
        ...validConfig,
        capabilities: { ...validConfig.capabilities, persistence: true },
      }),
    ).toEqual({ code: 'capability_must_be_disabled', kind: 'invalid' });
  });

  it('rejects unknown configuration keys', () => {
    expect(
      parseScaffoldConfig({ ...validConfig, endpoint: 'https://invalid.example' }),
    ).toEqual({
      code: 'unknown_key',
      kind: 'invalid',
    });
  });
});

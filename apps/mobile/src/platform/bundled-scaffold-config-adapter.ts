import type { ScaffoldConfigPort } from '../shell/public';

export class BundledScaffoldConfigAdapter implements ScaffoldConfigPort {
  public read(): unknown {
    return {
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
  }
}

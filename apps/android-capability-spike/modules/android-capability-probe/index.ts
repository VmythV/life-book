import { requireNativeModule } from 'expo';

export type ExactAlarmCapability = 'not_required' | 'exact' | 'approximate_only';

export interface AndroidPlatformState {
  readonly deviceLocked: boolean;
  readonly deviceSecure: boolean;
  readonly exactAlarmCapability: ExactAlarmCapability;
  readonly notificationsEnabled: boolean;
  readonly sdkInt: number;
}

interface AndroidCapabilityProbeNativeModule {
  getPlatformState(): AndroidPlatformState;
  setSecureScreen(enabled: boolean): Promise<void>;
}

export const androidCapabilityProbe =
  requireNativeModule<AndroidCapabilityProbeNativeModule>('AndroidCapabilityProbe');

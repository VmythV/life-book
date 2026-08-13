import * as SecureStore from 'expo-secure-store';

import {
  syntheticBackgroundMarkerKey,
  syntheticLifecycleService,
} from '../background/synthetic-notification-task';

const syntheticLaunchCountKey = 'capability_spike_launch_count';

const options: SecureStore.SecureStoreOptions = {
  keychainService: syntheticLifecycleService,
};

function parseLaunchCount(value: string | null): number {
  if (value === null || !/^(?:0|[1-9][0-9]{0,4})$/u.test(value)) {
    return 0;
  }
  return Number(value);
}

export async function recordSyntheticLaunch(): Promise<number> {
  const current = parseLaunchCount(
    await SecureStore.getItemAsync(syntheticLaunchCountKey, options),
  );
  const next = current >= 99_999 ? 1 : current + 1;
  await SecureStore.setItemAsync(syntheticLaunchCountKey, String(next), options);
  return next;
}

export async function readSyntheticBackgroundMarker(): Promise<boolean> {
  return (
    (await SecureStore.getItemAsync(syntheticBackgroundMarkerKey, options)) === 'observed'
  );
}

export async function clearSyntheticLifecycleMarkers(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(syntheticLaunchCountKey, options),
    SecureStore.deleteItemAsync(syntheticBackgroundMarkerKey, options),
  ]);
}

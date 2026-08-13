import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { androidCapabilityProbe } from '../../modules/android-capability-probe';
import {
  CapabilityProbeError,
  type CapabilityProbeResult,
} from '../domain/capability-probe';

export async function runPlatformCapabilityProbe(): Promise<CapabilityProbeResult> {
  await androidCapabilityProbe.setSecureScreen(true);
  const state = androidCapabilityProbe.getPlatformState();
  if (state.sdkInt < 29 || typeof state.deviceLocked !== 'boolean') {
    throw new CapabilityProbeError('platform_state_invalid');
  }
  return {
    detail: `API ${String(state.sdkInt)}; secure-window enabled; exact=${state.exactAlarmCapability}`,
  };
}

export async function runDocumentPickerCancellationProbe(): Promise<string> {
  const result = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: false,
    type: 'text/plain',
  });
  if (result.canceled) {
    return 'PASS: system document picker returned explicit cancellation';
  }
  for (const asset of result.assets) {
    const selected = new File(asset.uri);
    if (selected.exists && selected.uri.startsWith(Paths.cache.uri)) {
      selected.delete();
    }
  }
  return 'PASS: a synthetic-compatible file was selected and cache copy removed';
}

export async function runShareCancellationProbe(): Promise<string> {
  if (!(await Sharing.isAvailableAsync())) {
    return 'BLOCKED: Android share sheet is unavailable';
  }
  const file = new File(Paths.cache, 'capability-spike-share.txt');
  file.create({ overwrite: true });
  file.write('Synthetic capability probe. No life data.');
  try {
    await Sharing.shareAsync(file.uri, {
      dialogTitle: 'Synthetic capability spike',
      mimeType: 'text/plain',
    });
    return 'PASS: Android share sheet returned after selection or cancellation';
  } finally {
    if (file.exists) {
      file.delete();
    }
  }
}

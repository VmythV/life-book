import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

import { androidCapabilityProbe } from '../../modules/android-capability-probe';
import {
  CapabilityProbeError,
  type CapabilityProbeResult,
} from '../domain/capability-probe';

const syntheticKey = 'capability_spike_device_key';
const syntheticService = 'capability_spike_keystore_service';
const authenticatedKey = 'capability_spike_authenticated_key';
const authenticatedService = 'capability_spike_authenticated_service';
const credentialChangeKey = 'capability_spike_credential_change_key';
const credentialChangeService = 'capability_spike_credential_change_service';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function runKeystoreCapabilityProbe(): Promise<CapabilityProbeResult> {
  const available = await SecureStore.isAvailableAsync();
  if (!available) {
    throw new CapabilityProbeError('keystore_round_trip_failed');
  }

  const value = bytesToHex(await Crypto.getRandomBytesAsync(32));
  const options: SecureStore.SecureStoreOptions = {
    keychainService: syntheticService,
  };

  try {
    await SecureStore.setItemAsync(syntheticKey, value, options);
    const restored = await SecureStore.getItemAsync(syntheticKey, options);
    if (restored !== value) {
      throw new CapabilityProbeError('keystore_round_trip_failed');
    }
    await SecureStore.deleteItemAsync(syntheticKey, options);
    const deleted = await SecureStore.getItemAsync(syntheticKey, options);
    if (deleted !== null) {
      throw new CapabilityProbeError('keystore_round_trip_failed');
    }
  } finally {
    await SecureStore.deleteItemAsync(syntheticKey, options).catch(() => undefined);
  }

  const state = androidCapabilityProbe.getPlatformState();
  return {
    detail: `Android Keystore round-trip/delete; deviceSecure=${String(state.deviceSecure)}; biometric=${String(SecureStore.canUseBiometricAuthentication())}`,
  };
}

export async function runAuthenticationCancellationProbe(): Promise<string> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  if (!hasHardware || !enrolled) {
    return 'BLOCKED: enroll a fingerprint on this Android device first';
  }

  const pending = LocalAuthentication.authenticateAsync({
    biometricsSecurityLevel: 'strong',
    disableDeviceFallback: true,
    promptDescription: 'Synthetic cancellation probe; no life data is accessed.',
    promptMessage: 'Capability spike authentication',
  });
  const timer = setTimeout(() => {
    void LocalAuthentication.cancelAuthenticate();
  }, 500);
  const result = await pending.finally(() => clearTimeout(timer));
  if (
    !result.success &&
    ['app_cancel', 'system_cancel', 'user_cancel'].includes(result.error)
  ) {
    return `PASS: authentication returned controlled ${result.error}`;
  }
  return result.success
    ? 'FAIL: authentication completed before the cancellation request'
    : `BLOCKED: authentication returned controlled ${result.error}`;
}

export async function runAuthenticatedKeystoreProbe(): Promise<string> {
  if (!SecureStore.canUseBiometricAuthentication()) {
    return 'BLOCKED: secure biometric authentication is not enrolled';
  }

  const value = bytesToHex(await Crypto.getRandomBytesAsync(32));
  const options: SecureStore.SecureStoreOptions = {
    authenticationPrompt: 'Authenticate for the synthetic Keystore probe.',
    keychainService: authenticatedService,
    requireAuthentication: true,
  };

  try {
    await SecureStore.setItemAsync(authenticatedKey, value, options);
    const restored = await SecureStore.getItemAsync(authenticatedKey, options);
    if (restored !== value) {
      return 'FAIL: authenticated Keystore value was unavailable or changed';
    }
    return 'PASS: authenticated Keystore wrap and unwrap completed';
  } catch {
    return 'BLOCKED: authentication was cancelled, locked, or invalidated';
  } finally {
    await SecureStore.deleteItemAsync(authenticatedKey, {
      keychainService: authenticatedService,
    }).catch(() => undefined);
  }
}

export async function stageCredentialChangeProbe(): Promise<string> {
  if (!SecureStore.canUseBiometricAuthentication()) {
    return 'BLOCKED: secure biometric authentication is not enrolled';
  }

  await SecureStore.setItemAsync(
    credentialChangeKey,
    bytesToHex(await Crypto.getRandomBytesAsync(32)),
    {
      authenticationPrompt: 'Authenticate to stage the credential-change probe.',
      keychainService: credentialChangeService,
      requireAuthentication: true,
    },
  );
  return 'PASS: staged an authentication-bound synthetic key';
}

export async function verifyCredentialChangeBehaviorProbe(): Promise<string> {
  const cleanupOptions: SecureStore.SecureStoreOptions = {
    keychainService: credentialChangeService,
  };
  try {
    const restored = await SecureStore.getItemAsync(credentialChangeKey, {
      ...cleanupOptions,
      authenticationPrompt: 'Verify credential-change behavior.',
      requireAuthentication: true,
    });
    return restored === null
      ? 'PASS: credential change invalidated the authentication-bound key'
      : 'PASS: credential change preserved the key; callers must not assume invalidation';
  } catch {
    return 'PASS: credential change made the authentication-bound key unavailable';
  } finally {
    await SecureStore.deleteItemAsync(credentialChangeKey, cleanupOptions).catch(
      () => undefined,
    );
  }
}

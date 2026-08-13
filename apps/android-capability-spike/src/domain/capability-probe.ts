export type AutomaticCapabilityId =
  'sqlcipher' | 'encrypted_file' | 'keystore' | 'notification' | 'platform';

export type CapabilityProbeState =
  | { readonly kind: 'pending' }
  | { readonly kind: 'running' }
  | {
      readonly detail: string;
      readonly kind: 'passed';
    }
  | {
      readonly code: CapabilityFailureCode;
      readonly kind: 'failed';
    };

export type CapabilityFailureCode =
  | 'cancel_cleanup_failed'
  | 'ciphertext_authentication_failed'
  | 'database_cleanup_failed'
  | 'database_migration_failed'
  | 'database_reopen_failed'
  | 'database_transaction_failed'
  | 'database_wrong_key_accepted'
  | 'exact_alarm_state_invalid'
  | 'file_cleanup_failed'
  | 'file_round_trip_failed'
  | 'keystore_round_trip_failed'
  | 'notification_cancel_failed'
  | 'notification_schedule_failed'
  | 'platform_state_invalid'
  | 'probe_unexpected_failure'
  | 'sqlcipher_unavailable';

export interface CapabilityProbeResult {
  readonly detail: string;
}

export class CapabilityProbeError extends Error {
  public constructor(public readonly code: CapabilityFailureCode) {
    super(code);
    this.name = 'CapabilityProbeError';
  }
}

export function capabilityFailureCode(error: unknown): CapabilityFailureCode {
  return error instanceof CapabilityProbeError ? error.code : 'probe_unexpected_failure';
}

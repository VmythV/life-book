export type CapabilityDiagnosticCode =
  | 'automatic_probe_finished'
  | 'automatic_probe_started'
  | 'deep_link_received'
  | 'notification_response_received'
  | 'synthetic_error_captured';

export type CapabilityDiagnosticOutcome = 'failed' | 'observed' | 'passed';

export interface CapabilityDiagnosticEvent {
  readonly code: CapabilityDiagnosticCode;
  readonly outcome: CapabilityDiagnosticOutcome;
}

const events: CapabilityDiagnosticEvent[] = [];

export function recordCapabilityDiagnostic(event: CapabilityDiagnosticEvent): void {
  events.push(Object.freeze({ ...event }));
  if (events.length > 32) {
    events.shift();
  }
  console.info(`[capability-spike] ${event.code} ${event.outcome}`);
}

export function readCapabilityDiagnostics(): readonly CapabilityDiagnosticEvent[] {
  return events.map((event) => ({ ...event }));
}

export function captureSyntheticDiagnosticError(): void {
  try {
    throw new Error('CAPABILITY_SPIKE_SYNTHETIC_ERROR');
  } catch {
    recordCapabilityDiagnostic({
      code: 'synthetic_error_captured',
      outcome: 'observed',
    });
  }
}

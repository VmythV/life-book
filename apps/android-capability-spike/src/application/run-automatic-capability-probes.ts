import { runEncryptedFileCapabilityProbe } from '../adapters/encrypted-file-capability-adapter';
import { runKeystoreCapabilityProbe } from '../adapters/keystore-capability-adapter';
import { runNotificationCapabilityProbe } from '../adapters/notification-capability-adapter';
import { runPlatformCapabilityProbe } from '../adapters/platform-capability-adapter';
import { runSqlcipherCapabilityProbe } from '../adapters/sqlcipher-capability-adapter';
import {
  capabilityFailureCode,
  type AutomaticCapabilityId,
  type CapabilityProbeResult,
  type CapabilityProbeState,
} from '../domain/capability-probe';
import { recordCapabilityDiagnostic } from '../diagnostics/capability-diagnostic-log';

type CapabilityRunner = () => Promise<CapabilityProbeResult>;

const orderedRunners: readonly [AutomaticCapabilityId, CapabilityRunner][] = [
  ['sqlcipher', runSqlcipherCapabilityProbe],
  ['encrypted_file', runEncryptedFileCapabilityProbe],
  ['keystore', runKeystoreCapabilityProbe],
  ['notification', runNotificationCapabilityProbe],
  ['platform', runPlatformCapabilityProbe],
];

export type ProbeStateSink = (
  id: AutomaticCapabilityId,
  state: CapabilityProbeState,
) => void;

export async function runAutomaticCapabilityProbes(
  update: ProbeStateSink,
): Promise<void> {
  for (const [id, runner] of orderedRunners) {
    update(id, { kind: 'running' });
    recordCapabilityDiagnostic({
      code: 'automatic_probe_started',
      outcome: 'observed',
    });
    try {
      const result = await runner();
      update(id, { detail: result.detail, kind: 'passed' });
      recordCapabilityDiagnostic({
        code: 'automatic_probe_finished',
        outcome: 'passed',
      });
    } catch (error) {
      update(id, { code: capabilityFailureCode(error), kind: 'failed' });
      recordCapabilityDiagnostic({
        code: 'automatic_probe_finished',
        outcome: 'failed',
      });
    }
  }
}

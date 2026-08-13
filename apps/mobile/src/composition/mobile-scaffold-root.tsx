import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BundledScaffoldConfigAdapter } from '../platform/bundled-scaffold-config-adapter';
import { DisabledStageCapabilityAdapter } from '../shell/adapters/disabled-stage-capability-adapter';
import { FixedScaffoldSourcesAdapter } from '../shell/adapters/fixed-scaffold-sources-adapter';
import { InMemoryScaffoldStatusAdapter } from '../shell/adapters/in-memory-scaffold-status-adapter';
import {
  buildScaffoldStatus,
  parseScaffoldConfig,
  ScaffoldConfigurationErrorScreen,
  ScaffoldNavigation,
  type ScaffoldCapability,
} from '../shell/public';

const SCAFFOLD_CAPABILITIES: readonly ScaffoldCapability[] = [
  'persistence',
  'product_notifications',
  'network',
  'telemetry',
  'updates',
];

export function MobileScaffoldRoot() {
  return (
    <SafeAreaProvider>
      <MobileScaffoldContent />
    </SafeAreaProvider>
  );
}

function MobileScaffoldContent() {
  const configPort = new BundledScaffoldConfigAdapter();
  const configResult = parseScaffoldConfig(configPort.read());

  if (configResult.kind === 'invalid') {
    return <ScaffoldConfigurationErrorScreen diagnosticCode={configResult.code} />;
  }

  const sources = new FixedScaffoldSourcesAdapter();
  const capabilities = SCAFFOLD_CAPABILITIES.map(
    (capability) => new DisabledStageCapabilityAdapter(capability),
  );
  const statusResult = buildScaffoldStatus(
    configResult.config.productName,
    sources,
    (snapshot) => new InMemoryScaffoldStatusAdapter(snapshot),
    capabilities,
  );

  if (statusResult.kind === 'blocked') {
    return <ScaffoldConfigurationErrorScreen diagnosticCode={statusResult.code} />;
  }

  return <ScaffoldNavigation viewModel={statusResult.viewModel} />;
}

import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type AppStateStatus,
} from 'react-native';

import { androidCapabilityProbe } from '../modules/android-capability-probe';
import {
  runAuthenticatedKeystoreProbe,
  runAuthenticationCancellationProbe,
  stageCredentialChangeProbe,
  verifyCredentialChangeBehaviorProbe,
} from './adapters/keystore-capability-adapter';
import {
  clearSyntheticLifecycleMarkers,
  readSyntheticBackgroundMarker,
  recordSyntheticLaunch,
} from './adapters/lifecycle-capability-adapter';
import {
  requestSyntheticNotificationPermission,
  scheduleInteractiveNotificationProbe,
} from './adapters/notification-capability-adapter';
import {
  runDocumentPickerCancellationProbe,
  runShareCancellationProbe,
} from './adapters/platform-capability-adapter';
import { runAutomaticCapabilityProbes } from './application/run-automatic-capability-probes';
import {
  captureSyntheticDiagnosticError,
  readCapabilityDiagnostics,
  recordCapabilityDiagnostic,
} from './diagnostics/capability-diagnostic-log';
import type {
  AutomaticCapabilityId,
  CapabilityProbeState,
} from './domain/capability-probe';

const capabilityLabels: Readonly<Record<AutomaticCapabilityId, string>> = {
  encrypted_file: 'Encrypted file',
  keystore: 'Keystore',
  notification: 'Notification',
  platform: 'Platform/lifecycle',
  sqlcipher: 'SQLCipher',
};

const initialProbeStates: Readonly<Record<AutomaticCapabilityId, CapabilityProbeState>> =
  {
    encrypted_file: { kind: 'pending' },
    keystore: { kind: 'pending' },
    notification: { kind: 'pending' },
    platform: { kind: 'pending' },
    sqlcipher: { kind: 'pending' },
  };

type ManualProbeId =
  | 'auth_cancel'
  | 'auth_keystore'
  | 'credential_change_behavior'
  | 'credential_change_stage'
  | 'diagnostics'
  | 'document_picker'
  | 'lifecycle_cleanup'
  | 'notification_interactive'
  | 'notification_permission'
  | 'share';

type ManualProbeStates = Partial<Readonly<Record<ManualProbeId, string>>>;

function probeSummary(
  states: Readonly<Record<AutomaticCapabilityId, CapabilityProbeState>>,
): 'FAIL' | 'PASS' | 'PENDING' | 'RUNNING' {
  const values = Object.values(states);
  if (values.some((state) => state.kind === 'failed')) {
    return 'FAIL';
  }
  if (values.every((state) => state.kind === 'passed')) {
    return 'PASS';
  }
  return values.some((state) => state.kind === 'running') ? 'RUNNING' : 'PENDING';
}

function ProbeRow({
  id,
  state,
}: {
  readonly id: AutomaticCapabilityId;
  readonly state: CapabilityProbeState;
}) {
  const status = state.kind.toUpperCase();
  const detail =
    state.kind === 'passed'
      ? state.detail
      : state.kind === 'failed'
        ? state.code
        : state.kind === 'running'
          ? 'Executing isolated native checks…'
          : 'Not run';
  return (
    <View
      accessibilityLabel={`${capabilityLabels[id]} ${status}`}
      style={styles.probeRow}
    >
      <View style={styles.probeHeading}>
        <Text style={styles.probeLabel}>{capabilityLabels[id]}</Text>
        <Text
          style={[
            styles.badge,
            state.kind === 'passed'
              ? styles.badgePassed
              : state.kind === 'failed'
                ? styles.badgeFailed
                : styles.badgePending,
          ]}
        >
          {status}
        </Text>
      </View>
      <Text selectable style={styles.probeDetail}>
        {detail}
      </Text>
    </View>
  );
}

function ActionButton({
  disabled = false,
  label,
  onPress,
}: {
  readonly disabled?: boolean;
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        disabled && styles.actionDisabled,
        pressed && !disabled && styles.actionPressed,
      ]}
    >
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

export function AndroidCapabilitySpikeApp() {
  const [probeStates, setProbeStates] = useState(initialProbeStates);
  const [manualStates, setManualStates] = useState<ManualProbeStates>({});
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const [deepLink, setDeepLink] = useState('none');
  const [launchCount, setLaunchCount] = useState<number | undefined>();
  const [backgroundTaskObserved, setBackgroundTaskObserved] = useState(false);
  const [reduceMotion, setReduceMotion] = useState<boolean | undefined>();
  const [running, setRunning] = useState(false);
  const autorunConsumed = useRef(false);
  const { fontScale } = useWindowDimensions();

  const summary = useMemo(() => probeSummary(probeStates), [probeStates]);

  const updateProbe = useCallback(
    (id: AutomaticCapabilityId, state: CapabilityProbeState) => {
      setProbeStates((current) => ({ ...current, [id]: state }));
    },
    [],
  );

  const runAutomatic = useCallback(async () => {
    if (running) {
      return;
    }
    setRunning(true);
    setProbeStates(initialProbeStates);
    try {
      await runAutomaticCapabilityProbes(updateProbe);
    } finally {
      setRunning(false);
    }
  }, [running, updateProbe]);

  const handleUrl = useCallback(
    (url: string) => {
      const safeKind = url.startsWith('lifebook-capability-spike://probe/')
        ? (url.slice('lifebook-capability-spike://probe/'.length).split(/[?#]/u, 1)[0] ??
          'root')
        : 'rejected';
      setDeepLink(safeKind.length > 0 ? safeKind : 'root');
      recordCapabilityDiagnostic({ code: 'deep_link_received', outcome: 'observed' });
      if (safeKind === 'autorun' && !autorunConsumed.current) {
        autorunConsumed.current = true;
        void runAutomatic();
      }
    },
    [runAutomatic],
  );

  useEffect(() => {
    void androidCapabilityProbe.setSecureScreen(true);
    void recordSyntheticLaunch().then(setLaunchCount);
    void readSyntheticBackgroundMarker().then(setBackgroundTaskObserved);
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const appStateSubscription = AppState.addEventListener('change', setAppState);
    const appStateRefresh = setTimeout(() => setAppState(AppState.currentState), 0);
    const reduceMotionSubscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    const linkSubscription = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    void Linking.getInitialURL().then((url) => {
      if (url !== null) {
        handleUrl(url);
      }
    });
    const notificationSubscription =
      Notifications.addNotificationResponseReceivedListener(() => {
        setManualStates((current) => ({
          ...current,
          notification_interactive:
            'PASS: notification tap/action response reached the application',
        }));
        recordCapabilityDiagnostic({
          code: 'notification_response_received',
          outcome: 'observed',
        });
        void readSyntheticBackgroundMarker().then(setBackgroundTaskObserved);
      });

    return () => {
      clearTimeout(appStateRefresh);
      appStateSubscription.remove();
      linkSubscription.remove();
      notificationSubscription.remove();
      reduceMotionSubscription.remove();
    };
  }, [handleUrl]);

  const runManual = useCallback((id: ManualProbeId, runner: () => Promise<string>) => {
    setManualStates((current) => ({ ...current, [id]: 'RUNNING' }));
    void runner()
      .then((result) => {
        setManualStates((current) => ({ ...current, [id]: result }));
      })
      .catch(() => {
        setManualStates((current) => ({
          ...current,
          [id]: 'FAIL: controlled probe returned an unexpected error',
        }));
      });
  }, []);

  if (appState !== 'active') {
    return (
      <View accessibilityLabel="Sensitive content hidden" style={styles.privacyCover}>
        <Text style={styles.privacyTitle}>Capability spike hidden</Text>
        <Text style={styles.privacyBody}>
          Android secure-window protection is active.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={styles.title}>
        Android capability spike
      </Text>
      <Text style={styles.body}>
        Removable synthetic feasibility app. It is not linked into the product APK and
        never creates a formal schema, product reminder, or user record.
      </Text>

      <View accessibilityLiveRegion="polite" style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>AUTOMATIC PROBES</Text>
        <Text style={styles.summaryValue}>{summary}</Text>
        <Text style={styles.summaryMeta}>
          launch={launchCount === undefined ? 'loading' : String(launchCount)} ·
          backgroundTask={backgroundTaskObserved ? 'observed' : 'not_observed'}
        </Text>
      </View>

      <ActionButton
        disabled={running}
        label={running ? 'Automatic probes are running…' : 'Run all automatic probes'}
        onPress={() => void runAutomatic()}
      />

      {(Object.keys(capabilityLabels) as AutomaticCapabilityId[]).map((id) => (
        <ProbeRow id={id} key={id} state={probeStates[id]} />
      ))}

      <Text accessibilityRole="header" style={styles.sectionTitle}>
        Interactive Android checks
      </Text>
      <Text style={styles.body}>
        These buttons intentionally open system UI so refusal and cancellation remain
        observable instead of being mocked.
      </Text>

      <ActionButton
        label="Request notification permission"
        onPress={() =>
          runManual('notification_permission', requestSyntheticNotificationPermission)
        }
      />
      <ActionButton
        label="Schedule tap/action notification"
        onPress={() =>
          runManual('notification_interactive', scheduleInteractiveNotificationProbe)
        }
      />
      <ActionButton
        label="Run authentication cancellation"
        onPress={() => runManual('auth_cancel', runAuthenticationCancellationProbe)}
      />
      <ActionButton
        label="Run authenticated Keystore"
        onPress={() => runManual('auth_keystore', runAuthenticatedKeystoreProbe)}
      />
      <ActionButton
        label="Stage credential-change key"
        onPress={() => runManual('credential_change_stage', stageCredentialChangeProbe)}
      />
      <ActionButton
        label="Verify credential-change behavior"
        onPress={() =>
          runManual('credential_change_behavior', verifyCredentialChangeBehaviorProbe)
        }
      />
      <ActionButton
        label="Open document picker"
        onPress={() => runManual('document_picker', runDocumentPickerCancellationProbe)}
      />
      <ActionButton
        label="Open Android share sheet"
        onPress={() => runManual('share', runShareCancellationProbe)}
      />
      <ActionButton
        label="Capture content-free diagnostic error"
        onPress={() => {
          captureSyntheticDiagnosticError();
          setManualStates((current) => ({
            ...current,
            diagnostics: `PASS: ${String(readCapabilityDiagnostics().length)} allowlisted diagnostic events`,
          }));
        }}
      />
      <ActionButton
        label="Clear synthetic lifecycle markers"
        onPress={() =>
          runManual('lifecycle_cleanup', async () => {
            await clearSyntheticLifecycleMarkers();
            setLaunchCount(0);
            setBackgroundTaskObserved(false);
            return 'PASS: synthetic lifecycle markers removed';
          })
        }
      />

      {Object.entries(manualStates).map(([id, state]) => (
        <Text
          accessibilityLiveRegion="polite"
          key={id}
          selectable
          style={styles.manualResult}
        >
          {id}: {state}
        </Text>
      ))}

      <View style={styles.environmentCard}>
        <Text style={styles.environmentTitle}>Observable environment</Text>
        <Text style={styles.environmentText}>deepLink={deepLink}</Text>
        <Text style={styles.environmentText}>fontScale={fontScale.toFixed(2)}</Text>
        <Text style={styles.environmentText}>
          reduceMotion={reduceMotion === undefined ? 'loading' : String(reduceMotion)}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: 'center',
    backgroundColor: '#185adb',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  actionDisabled: {
    backgroundColor: '#98a2b3',
  },
  actionPressed: {
    opacity: 0.78,
  },
  actionText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  badge: {
    borderRadius: 999,
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeFailed: {
    backgroundColor: '#fee4e2',
    color: '#b42318',
  },
  badgePassed: {
    backgroundColor: '#dcfae6',
    color: '#067647',
  },
  badgePending: {
    backgroundColor: '#eaecf0',
    color: '#344054',
  },
  body: {
    color: '#344054',
    fontSize: 17,
    lineHeight: 25,
  },
  environmentCard: {
    backgroundColor: '#eef4ff',
    borderRadius: 16,
    gap: 6,
    padding: 18,
  },
  environmentText: {
    color: '#344054',
    fontFamily: 'monospace',
    fontSize: 14,
  },
  environmentTitle: {
    color: '#172b4d',
    fontSize: 17,
    fontWeight: '700',
  },
  manualResult: {
    backgroundColor: '#f2f4f7',
    borderRadius: 10,
    color: '#344054',
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 19,
    padding: 12,
  },
  privacyBody: {
    color: '#475467',
    fontSize: 17,
  },
  privacyCover: {
    alignItems: 'center',
    backgroundColor: '#f2f4f7',
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    padding: 24,
  },
  privacyTitle: {
    color: '#101828',
    fontSize: 24,
    fontWeight: '700',
  },
  probeDetail: {
    color: '#475467',
    fontSize: 14,
    lineHeight: 21,
  },
  probeHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  probeLabel: {
    color: '#101828',
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
  },
  probeRow: {
    backgroundColor: '#ffffff',
    borderColor: '#d0d5dd',
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
    padding: 18,
  },
  screen: {
    backgroundColor: '#f7f9fc',
    gap: 14,
    padding: 24,
    paddingBottom: 64,
  },
  sectionTitle: {
    color: '#172b4d',
    fontSize: 22,
    fontWeight: '700',
    marginTop: 14,
  },
  summaryCard: {
    alignItems: 'center',
    backgroundColor: '#172b4d',
    borderRadius: 18,
    gap: 4,
    padding: 20,
  },
  summaryLabel: {
    color: '#b9cdfa',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  summaryMeta: {
    color: '#d0d5dd',
    fontSize: 12,
    textAlign: 'center',
  },
  summaryValue: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '800',
  },
  title: {
    color: '#172b4d',
    fontSize: 30,
    fontWeight: '800',
  },
});

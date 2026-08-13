import * as Notifications from 'expo-notifications';

import { androidCapabilityProbe } from '../../modules/android-capability-probe';
import {
  CapabilityProbeError,
  type CapabilityProbeResult,
} from '../domain/capability-probe';

export const notificationChannelId = 'synthetic_capability_spike';
export const notificationCategoryId = 'synthetic_capability';
export const notificationActionId = 'acknowledge_synthetic';

async function configureSyntheticNotifications(): Promise<void> {
  await Notifications.setNotificationChannelAsync(notificationChannelId, {
    description: 'Synthetic, removable capability-spike notifications only.',
    enableVibrate: false,
    importance: Notifications.AndroidImportance.HIGH,
    name: 'Synthetic capability spike',
    sound: null,
  });
  await Notifications.setNotificationCategoryAsync(notificationCategoryId, [
    {
      buttonTitle: 'Acknowledge synthetic probe',
      identifier: notificationActionId,
      options: {
        opensAppToForeground: true,
      },
    },
  ]);
}

export async function requestSyntheticNotificationPermission(): Promise<string> {
  const permission = await Notifications.requestPermissionsAsync();
  return permission.granted
    ? 'PASS: notification permission is granted'
    : 'BLOCKED: notification permission is denied';
}

export async function runNotificationCapabilityProbe(): Promise<CapabilityProbeResult> {
  await configureSyntheticNotifications();
  const platformState = androidCapabilityProbe.getPlatformState();
  if (
    !['not_required', 'exact', 'approximate_only'].includes(
      platformState.exactAlarmCapability,
    )
  ) {
    throw new CapabilityProbeError('exact_alarm_state_invalid');
  }

  const identifier = await Notifications.scheduleNotificationAsync({
    content: {
      body: 'Synthetic schedule/cancel probe. No life data.',
      categoryIdentifier: notificationCategoryId,
      data: { kind: 'synthetic_capability_probe' },
      sound: false,
      title: 'Life Book capability spike',
    },
    trigger: {
      channelId: notificationChannelId,
      seconds: 120,
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
    },
  });
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  if (!scheduled.some((candidate) => candidate.identifier === identifier)) {
    throw new CapabilityProbeError('notification_schedule_failed');
  }

  await Notifications.cancelScheduledNotificationAsync(identifier);
  const afterCancel = await Notifications.getAllScheduledNotificationsAsync();
  if (afterCancel.some((candidate) => candidate.identifier === identifier)) {
    throw new CapabilityProbeError('notification_cancel_failed');
  }

  return {
    detail: `category/request schedule+cancel; alarm=${platformState.exactAlarmCapability}; enabled=${String(platformState.notificationsEnabled)}`,
  };
}

export async function scheduleInteractiveNotificationProbe(): Promise<string> {
  await configureSyntheticNotifications();
  const identifier = await Notifications.scheduleNotificationAsync({
    content: {
      body: 'Tap or use the synthetic action; no life data is present.',
      categoryIdentifier: notificationCategoryId,
      data: { kind: 'synthetic_interactive_probe' },
      sound: false,
      title: 'Interactive capability probe',
    },
    trigger: {
      channelId: notificationChannelId,
      seconds: 5,
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
    },
  });
  return `PASS: scheduled synthetic request ${identifier.slice(0, 8)}…`;
}

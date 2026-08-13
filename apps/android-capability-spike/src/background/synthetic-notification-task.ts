import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';

export const syntheticBackgroundTaskName = 'life-book-synthetic-notification-task';
export const syntheticBackgroundMarkerKey = 'capability_spike_background_marker';
export const syntheticLifecycleService = 'capability_spike_lifecycle_service';

if (!TaskManager.isTaskDefined(syntheticBackgroundTaskName)) {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(
    syntheticBackgroundTaskName,
    async () => {
      await SecureStore.setItemAsync(syntheticBackgroundMarkerKey, 'observed', {
        keychainService: syntheticLifecycleService,
      });
      return Notifications.BackgroundNotificationTaskResult.NoData;
    },
  );
}

void Notifications.registerTaskAsync(syntheticBackgroundTaskName).catch(() => undefined);

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

import { queryKeys } from '@life-book/api-client';
import {
  daysBetween,
  describeDaysUntil,
  describeLocalDate,
  formatLocalDate,
  type UpcomingReminder,
  zonedDateTime,
} from '@life-book/core';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import { api, queryClient, setAfterRecordsChanged } from './api';

/** iOS 最多保留 64 条待发通知，留出余量给“稍后提醒”。 */
const MAX_SCHEDULED = 60;
const LOOKAHEAD_DAYS = 14;
const SNOOZE_MINUTES = 10;
const CHANNEL_ID = 'reminders';

const CATEGORY_OCCURRENCE = 'occurrence';
const CATEGORY_REMINDER = 'reminder';
const ACTION_COMPLETE = 'complete';
const ACTION_SNOOZE = 'snooze';

interface ReminderData extends Record<string, unknown> {
  source: 'life-book';
  key: string;
  recordId: string;
  recordType: string;
  occurrenceDate: string | null;
  /** 重复日常的原定日期，“完成”用它定位实例。 */
  originalDate: string | null;
}

function isReminderData(value: unknown): value is ReminderData {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { source?: unknown }).source === 'life-book'
  );
}

/** 应用启动时调用：前台也显示通知，注册通知按钮和安卓的通知渠道。 */
export async function setupNotifications(): Promise<void> {
  Notifications.setNotificationHandler({
    handleNotification: () =>
      Promise.resolve({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: '提醒',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  // 按钮需要运行代码（调用接口、重新排通知），应用被关掉时只有打开应用才能执行。
  await Notifications.setNotificationCategoryAsync(CATEGORY_OCCURRENCE, [
    { identifier: ACTION_COMPLETE, buttonTitle: '完成' },
    { identifier: ACTION_SNOOZE, buttonTitle: `${SNOOZE_MINUTES} 分钟后提醒` },
  ]);
  await Notifications.setNotificationCategoryAsync(CATEGORY_REMINDER, [
    { identifier: ACTION_SNOOZE, buttonTitle: `${SNOOZE_MINUTES} 分钟后提醒` },
  ]);
  setAfterRecordsChanged(() => void syncNotifications());
}

export type NotificationPermission = 'granted' | 'denied' | 'undetermined';

export async function getNotificationPermission(): Promise<NotificationPermission> {
  const { status } = await Notifications.getPermissionsAsync();
  return status === Notifications.PermissionStatus.GRANTED
    ? 'granted'
    : status === Notifications.PermissionStatus.DENIED
      ? 'denied'
      : 'undetermined';
}

/** 第一次设置提醒时调用；已经拒绝过的不会再弹窗，直接返回 denied。 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  const current = await getNotificationPermission();
  if (current !== 'undetermined') {
    return current;
  }
  await Notifications.requestPermissionsAsync();
  const result = await getNotificationPermission();
  if (result === 'granted') {
    void syncNotifications();
  }
  return result;
}

function notificationBody(item: UpcomingReminder, timeZone: string): string {
  if (item.recordType === 'household_item') {
    return '快用完了，记得补充';
  }
  if (item.occurrenceDate === null) {
    return item.recordType === 'checklist' ? '清单提醒' : '备忘提醒';
  }
  const fireDate = zonedDateTime(new Date(item.fireAt), timeZone).date;
  if (item.recordType === 'important_date') {
    const days = daysBetween(fireDate, item.occurrenceDate);
    return days === 0
      ? '就是今天'
      : `${describeDaysUntil(days)}（${formatLocalDate(item.occurrenceDate)}）`;
  }
  return item.occurrenceDate === fireDate
    ? '今天要做'
    : `${describeLocalDate(item.occurrenceDate, fireDate)}要做`;
}

let syncing: Promise<void> | null = null;

/**
 * 从服务端拉取未来的提醒，重新排最近的 60 条本地通知。
 * 启动、回到前台和修改记录后调用；没有通知权限时什么也不做。
 * 失败（如断网）时保留已排好的通知，下次回到前台再同步，所以不会抛出。
 */
export function syncNotifications(): Promise<void> {
  syncing ??= doSync()
    .catch(() => undefined)
    .finally(() => {
      syncing = null;
    });
  return syncing;
}

async function doSync(): Promise<void> {
  if ((await getNotificationPermission()) !== 'granted') {
    return;
  }
  const [me, upcoming] = await Promise.all([
    queryClient.fetchQuery({ queryKey: queryKeys.me, queryFn: () => api.me.get() }),
    api.reminders.upcoming(LOOKAHEAD_DAYS),
  ]);
  queryClient.setQueryData(queryKeys.upcomingReminders, upcoming);
  const timeZone = me.settings.timezone;

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const wanted = upcoming.items.slice(0, MAX_SCHEDULED);
  const wantedKeys = new Set(wanted.map((item) => item.key));
  // 稍后提醒是本机临时排的；低库存提醒排好后服务端就不再返回。两者都保留到自己触发。
  const isLocalOnly = (identifier: string) =>
    identifier.endsWith(':snooze') || identifier.startsWith('lowstock:');

  for (const request of scheduled) {
    if (!isLocalOnly(request.identifier) && !wantedKeys.has(request.identifier)) {
      await Notifications.cancelScheduledNotificationAsync(request.identifier);
    }
  }
  for (const item of wanted) {
    const data: ReminderData = {
      source: 'life-book',
      key: item.key,
      recordId: item.recordId,
      recordType: item.recordType,
      occurrenceDate: item.occurrenceDate,
      originalDate: item.originalDate,
    };
    // 同一个 identifier 再排一次会覆盖旧的，标题或时间变了也能更新。
    await Notifications.scheduleNotificationAsync({
      identifier: item.key,
      content: {
        title: item.title,
        body: notificationBody(item, timeZone),
        data,
        categoryIdentifier:
          item.recordType === 'recurring' ? CATEGORY_OCCURRENCE : CATEGORY_REMINDER,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        // 低库存提醒的时间可能就是现在，稍微往后放一点，避免排到过去。
        date: new Date(Math.max(Date.parse(item.fireAt), Date.now() + 5000)),
        channelId: CHANNEL_ID,
      },
    });
    if (item.reminderId === null && item.recordType === 'household_item') {
      // 键的格式是 lowstock:{记录 ID}:{低库存开始时间}；排好后这次低库存不再重复提醒。
      const since = item.key.split(':').slice(2).join(':');
      await api.household.lowStockNotified(item.recordId, since).catch(() => undefined);
    }
  }
}

/** 退出登录时取消全部通知。 */
export async function cancelAllNotifications(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/** 处理用户点击通知或通知上的按钮。 */
export async function handleNotificationResponse(
  response: Notifications.NotificationResponse,
): Promise<void> {
  const content = response.notification.request.content;
  const data: unknown = content.data;
  if (!isReminderData(data)) {
    return;
  }
  if (response.actionIdentifier === ACTION_SNOOZE) {
    await Notifications.scheduleNotificationAsync({
      identifier: `${data.key}:snooze`,
      content: {
        title: content.title ?? '',
        body: content.body ?? '',
        data,
        ...(content.categoryIdentifier === null
          ? {}
          : { categoryIdentifier: content.categoryIdentifier }),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(Date.now() + SNOOZE_MINUTES * 60_000),
        channelId: CHANNEL_ID,
      },
    });
    return;
  }
  // 改期后的实例要用原定日期定位；旧版本排的通知没有原定日期，就用发生日期。
  const originalDate = data.originalDate ?? data.occurrenceDate;
  if (response.actionIdentifier === ACTION_COMPLETE && originalDate !== null) {
    await api.occurrences.set(data.recordId, originalDate, { status: 'completed' });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.today }),
      queryClient.invalidateQueries({ queryKey: queryKeys.records }),
    ]);
    return;
  }
  router.push({ pathname: '/record/[id]', params: { id: data.recordId } });
}

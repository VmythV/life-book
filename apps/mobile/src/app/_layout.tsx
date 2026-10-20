import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import * as Notifications from 'expo-notifications';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { queryClient } from '../lib/api';
import {
  cancelAllNotifications,
  handleNotificationResponse,
  setupNotifications,
  syncNotifications,
} from '../lib/notifications';
import { installOnlineManager } from '../lib/online';
import { persistOptions } from '../lib/persist';
import { session, useSession } from '../lib/session';
import { useTheme } from '../lib/theme';

/** 冷启动时的那次点击可能同时由监听器和 getLastNotificationResponse 报告，按 ID 去重。 */
const handledResponses = new Set<string>();

function handleOnce(response: Notifications.NotificationResponse): void {
  const id = `${response.notification.request.identifier}|${response.actionIdentifier}|${response.notification.date}`;
  if (handledResponses.has(id)) {
    return;
  }
  handledResponses.add(id);
  void handleNotificationResponse(response).catch((error: unknown) => {
    console.warn('Failed to handle notification response', error);
  });
}

export default function RootLayout() {
  const state = useSession();
  const theme = useTheme();
  const signedIn = state.status === 'signedIn';

  useEffect(() => {
    void session.load();
    void setupNotifications();
    return installOnlineManager();
  }, []);

  useEffect(() => {
    if (state.status === 'signedOut') {
      void cancelAllNotifications();
      return;
    }
    if (!signedIn) {
      return;
    }
    // 登录后：处理冷启动时点击的通知，监听之后的点击，并在回到前台时重新排通知。
    const last = Notifications.getLastNotificationResponse();
    if (last !== null) {
      handleOnce(last);
      Notifications.clearLastNotificationResponse();
    }
    const responses = Notifications.addNotificationResponseReceivedListener(handleOnce);
    void syncNotifications();
    const appState = AppState.addEventListener('change', (status) => {
      if (status === 'active') {
        void syncNotifications();
      }
    });
    return () => {
      responses.remove();
      appState.remove();
    };
  }, [signedIn, state.status]);

  // 读取安全存储里的令牌很快，期间不渲染任何页面，避免登录页一闪而过。
  if (state.status === 'loading') {
    return null;
  }

  const header = {
    headerShown: true,
    headerStyle: { backgroundColor: theme.color.surface },
    headerTintColor: theme.color.textPrimary,
    headerShadowVisible: false,
    headerBackTitle: '返回',
  } as const;

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <SafeAreaProvider>
        <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.color.canvas },
          }}
        >
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="record/new" options={{ ...header, title: '新建' }} />
            <Stack.Screen
              name="record/[id]/index"
              options={{ ...header, title: '详情' }}
            />
            <Stack.Screen
              name="record/[id]/item/[itemId]"
              options={{ ...header, title: '编辑项目' }}
            />
            <Stack.Screen name="trash" options={{ ...header, title: '回收站' }} />
            <Stack.Screen
              name="record/[id]/edit"
              options={{ ...header, title: '编辑' }}
            />
          </Stack.Protected>
          <Stack.Protected guard={state.status === 'signedOut'}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
        </Stack>
      </SafeAreaProvider>
    </PersistQueryClientProvider>
  );
}

import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { queryClient } from '../lib/api';
import { session, useSession } from '../lib/session';
import { useTheme } from '../lib/theme';

export default function RootLayout() {
  const state = useSession();
  const theme = useTheme();

  useEffect(() => {
    void session.load();
  }, []);

  // 读取安全存储里的令牌很快，期间不渲染任何页面，避免登录页一闪而过。
  if (state.status === 'loading') {
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.color.canvas },
          }}
        >
          <Stack.Protected guard={state.status === 'signedIn'}>
            <Stack.Screen name="(tabs)" />
          </Stack.Protected>
          <Stack.Protected guard={state.status === 'signedOut'}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
        </Stack>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

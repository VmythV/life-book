import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';

/** 让 TanStack Query 知道网络和前后台状态：恢复网络或回到前台时自动刷新。 */
export function installOnlineManager(): () => void {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      setOnline(state.isConnected !== false);
    }),
  );
  const subscription = AppState.addEventListener('change', (status) => {
    if (Platform.OS !== 'web') {
      focusManager.setFocused(status === 'active');
    }
  });
  return () => subscription.remove();
}

/** 当前是否联网；离线时界面只读，并提示正在显示缓存。 */
export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (listener) => onlineManager.subscribe(listener),
    () => onlineManager.isOnline(),
  );
}

import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

const API_PORT = 8787;
const SERVER_URL_KEY = 'life-book.server-url';

/**
 * 默认的服务端地址：优先使用构建时的 LIFE_BOOK_API_URL；开发构建取 Metro 所在电脑的局域网地址，
 * 这样模拟器和同一 Wi-Fi 下的真机都能访问本机服务端。
 */
function resolveDefaultUrl(): string {
  const configured: unknown = Constants.expoConfig?.extra?.apiUrl;
  if (typeof configured === 'string' && configured !== '') {
    return configured;
  }
  const host = Constants.expoConfig?.hostUri?.split(':')[0] ?? 'localhost';
  return `http://${host}:${API_PORT}`;
}

export const defaultServerUrl = resolveDefaultUrl();

let current = defaultServerUrl;
const listeners = new Set<() => void>();

/**
 * 当前使用的服务端地址。用户可以在登录页改成别的地址（如电脑换了局域网 IP），
 * 修改保存在本机，启动时先于会话读取。
 */
export const server = {
  url(): string {
    return current;
  },
  async load(): Promise<void> {
    const saved = await SecureStore.getItemAsync(SERVER_URL_KEY);
    if (saved !== null) {
      setUrl(saved);
    }
  },
  /** 保存新的地址；传 `null` 恢复默认。 */
  async save(url: string | null): Promise<void> {
    if (url === null || url === defaultServerUrl) {
      await SecureStore.deleteItemAsync(SERVER_URL_KEY);
      setUrl(defaultServerUrl);
    } else {
      await SecureStore.setItemAsync(SERVER_URL_KEY, url);
      setUrl(url);
    }
  },
};

function setUrl(url: string): void {
  current = url;
  for (const listener of listeners) {
    listener();
  }
}

export function useServerUrl(): string {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}

/** 地址是否能连上本服务：请求 `/health`，5 秒超时。 */
export async function checkServer(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${url}/health`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

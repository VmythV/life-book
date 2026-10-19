import { createApiClient, isApiError, queryKeys } from '@life-book/api-client';
import { QueryClient, queryOptions } from '@tanstack/react-query';
import Constants from 'expo-constants';

import { session } from './session';

const API_PORT = 8787;

/**
 * 服务端地址：优先使用 LIFE_BOOK_API_URL；开发时默认取 Metro 所在电脑的局域网地址，
 * 这样模拟器和同一 Wi-Fi 下的真机都能访问本机服务端。
 */
function resolveApiUrl(): string {
  const configured: unknown = Constants.expoConfig?.extra?.apiUrl;
  if (typeof configured === 'string' && configured !== '') {
    return configured;
  }
  const host = Constants.expoConfig?.hostUri?.split(':')[0] ?? 'localhost';
  return `http://${host}:${API_PORT}`;
}

export const apiUrl = resolveApiUrl();

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) =>
        failureCount < 2 &&
        (!isApiError(error) || error.status === 0 || error.status >= 500),
      staleTime: 30_000,
    },
  },
});

export const api = createApiClient({
  baseUrl: apiUrl,
  auth: { mode: 'token', getToken: () => session.getToken() },
  // 先退出再清缓存：等正在失败的请求结束后再清，避免把它变成“已取消”。
  onUnauthenticated: () => {
    void session.signOut().then(() => queryClient.clear());
  },
});

export const meQuery = queryOptions({
  queryKey: queryKeys.me,
  queryFn: () => api.me.get(),
});

import { createApiClient, isApiError } from '@life-book/api-client';
import { QueryClient } from '@tanstack/react-query';

let handleUnauthenticated: () => void = () => undefined;

/** 由路由在启动时注册：会话失效后跳转到登录页。 */
export function setUnauthenticatedHandler(handler: () => void): void {
  handleUnauthenticated = handler;
}

// 开发时由 Vite 代理 /api，所以与页面同源。
export const api = createApiClient({
  baseUrl: '',
  auth: { mode: 'cookie' },
  onUnauthenticated: () => handleUnauthenticated(),
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 只重试网络错误和服务端 5xx，业务错误重试也不会成功。
      retry: (failureCount, error) =>
        failureCount < 2 &&
        (!isApiError(error) || error.status === 0 || error.status >= 500),
      staleTime: 30_000,
    },
  },
});

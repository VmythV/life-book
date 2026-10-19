import './styles.css';

import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { queryClient, setUnauthenticatedHandler } from './api';
import { router } from './router';
import { installTheme } from './theme';

installTheme();

// 页面使用中会话失效（例如在别处修改了密码）时回到登录页。
// 路由加载过程中的 401 由路由守卫自己 redirect；这里若同时清缓存，会把守卫正在等待的查询取消掉。
// 跳转完成后再清缓存，避免取消仍在进行中的请求。
setUnauthenticatedHandler(() => {
  const { location, isLoading } = router.state;
  if (isLoading || location.pathname === '/login') {
    return;
  }
  void router
    .navigate({ to: '/login', search: { redirect: location.href } })
    .then(() => queryClient.clear());
});

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Missing #root element.');
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

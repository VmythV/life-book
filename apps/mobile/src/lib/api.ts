import { createApiClient, isApiError, queryKeys } from '@life-book/api-client';
import { type RecordListQuery } from '@life-book/core';
import {
  infiniteQueryOptions,
  QueryClient,
  queryOptions,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback } from 'react';

import { server } from './server';
import { session } from './session';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) =>
        failureCount < 2 &&
        (!isApiError(error) || error.status === 0 || error.status >= 500),
      staleTime: 30_000,
      // 离线时显示持久化的缓存；缓存保留 7 天。
      gcTime: 7 * 24 * 60 * 60 * 1000,
    },
  },
});

export const api = createApiClient({
  baseUrl: () => server.url(),
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

export const todayQuery = queryOptions({
  queryKey: queryKeys.todayOn(undefined),
  queryFn: () => api.today.get(),
});

export const calendarQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: queryKeys.calendar(from, to),
    queryFn: () => api.calendar.get(from, to),
  });

export const recordQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.record(id),
    queryFn: () => api.records.get(id),
  });

export const recordListQuery = (query: RecordListQuery) =>
  infiniteQueryOptions({
    queryKey: queryKeys.recordList(query),
    queryFn: ({ pageParam }) =>
      api.records.list({
        ...query,
        ...(pageParam === null ? {} : { cursor: pageParam }),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  });

export const occurrencesQuery = (id: string, from: string, to: string) =>
  queryOptions({
    queryKey: queryKeys.occurrences(id, from, to),
    queryFn: () => api.occurrences.list(id, from, to),
  });

export const stockTransactionsQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.stockTransactions(id),
    queryFn: () => api.household.transactions(id),
  });

export const templatesQuery = queryOptions({
  queryKey: queryKeys.templates,
  queryFn: () => api.templates.list(),
});

export const categoriesQuery = queryOptions({
  queryKey: queryKeys.categories,
  queryFn: () => api.categories.list(),
  staleTime: 5 * 60_000,
});

export const tagsQuery = queryOptions({
  queryKey: queryKeys.tags,
  queryFn: () => api.tags.list(),
  staleTime: 5 * 60_000,
});

let afterRecordsChanged: () => void = () => undefined;

/** 由通知模块注册：记录变化后重新排通知。 */
export function setAfterRecordsChanged(callback: () => void): void {
  afterRecordsChanged = callback;
}

/** 记录或实例变化后，刷新记录、今天和提醒相关的查询，并重新排通知。 */
export function useInvalidateRecords() {
  const client = useQueryClient();
  return useCallback(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.records }),
      client.invalidateQueries({ queryKey: queryKeys.today }),
      client.invalidateQueries({ queryKey: queryKeys.upcomingReminders }),
    ]);
    afterRecordsChanged();
  }, [client]);
}

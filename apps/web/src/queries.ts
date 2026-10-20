import { queryKeys } from '@life-book/api-client';
import { type RecordListQuery } from '@life-book/core';
import {
  infiniteQueryOptions,
  queryOptions,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback } from 'react';

import { api } from './api';

export const meQuery = queryOptions({
  queryKey: queryKeys.me,
  queryFn: () => api.me.get(),
});

export const todayQuery = queryOptions({
  queryKey: queryKeys.todayOn(undefined),
  queryFn: () => api.today.get(),
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

/** 记录或实例变化后，刷新记录、今天和提醒相关的查询。 */
export function useInvalidateRecords() {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.records }),
        queryClient.invalidateQueries({ queryKey: queryKeys.today }),
        queryClient.invalidateQueries({ queryKey: queryKeys.upcomingReminders }),
      ]),
    [queryClient],
  );
}

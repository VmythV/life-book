import { queryKeys } from '@life-book/api-client';
import { queryOptions } from '@tanstack/react-query';

import { api } from './api';

export const meQuery = queryOptions({
  queryKey: queryKeys.me,
  queryFn: () => api.me.get(),
});

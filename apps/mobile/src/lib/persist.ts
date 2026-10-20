import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { type PersistQueryClientOptions } from '@tanstack/react-query-persist-client';

import { queryClient } from './api';

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'life-book.query-cache',
  throttleTime: 2000,
});

/** 查询缓存写入本机，离线或刚打开应用时先显示上次的内容。 */
export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  // 发版后数据结构可能变化，改这个值即可丢弃旧缓存。
  buster: '3',
};

/** 退出登录时清空内存和本机的缓存，避免下一个账号看到上一个账号的数据。 */
export async function clearPersistedCache(): Promise<void> {
  queryClient.clear();
  await persister.removeClient();
}

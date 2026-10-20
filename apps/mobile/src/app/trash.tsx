import { describeError } from '@life-book/api-client';
import { displayTitle, RECORD_TYPE_LABELS, describeTrashExpiry } from '@life-book/core';
import { useInfiniteQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';

import {
  Badge,
  EmptyState,
  ErrorBanner,
  InfoBanner,
  Row,
  Screen,
  Section,
  SmallButton,
} from '../components/ui';
import { recordListQuery } from '../lib/api';

/** 回收站：点开记录可以恢复或永久删除。 */
export default function TrashScreen() {
  const list = useInfiniteQuery(recordListQuery({ status: 'trash' }));
  const records = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Screen
      edges={['left', 'right']}
      refreshing={list.isRefetching}
      onRefresh={() => void list.refetch()}
    >
      <Stack.Screen options={{ title: '回收站' }} />
      <InfoBanner message="回收站里的记录保留 30 天，之后会自动永久删除。" />
      {list.isError && records.length === 0 ? (
        <ErrorBanner message={describeError(list.error)} />
      ) : null}
      {list.isSuccess && records.length === 0 ? (
        <EmptyState title="回收站是空的" />
      ) : null}
      {records.length === 0 ? null : (
        <Section title={`${records.length} 条记录`}>
          {records.map((record, index) => (
            <Row
              key={record.id}
              first={index === 0}
              title={displayTitle(record)}
              subtitle={
                record.deletedAt === null
                  ? undefined
                  : describeTrashExpiry(record.deletedAt, new Date())
              }
              onPress={() =>
                router.push({ pathname: '/record/[id]', params: { id: record.id } })
              }
              right={<Badge label={RECORD_TYPE_LABELS[record.type]} />}
            />
          ))}
        </Section>
      )}
      {list.hasNextPage ? (
        <SmallButton label="加载更多" onPress={() => void list.fetchNextPage()} />
      ) : null}
    </Screen>
  );
}

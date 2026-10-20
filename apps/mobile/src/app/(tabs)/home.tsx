import { describeError } from '@life-book/api-client';
import { displayTitle, type LifeRecord } from '@life-book/core';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';

import {
  Badge,
  EmptyState,
  ErrorBanner,
  Fab,
  InfoBanner,
  Row,
  Screen,
  Section,
  SmallButton,
  Title,
} from '../../components/ui';
import { api, recordListQuery, useInvalidateRecords } from '../../lib/api';
import { useIsOnline } from '../../lib/online';

const NO_LOCATION = '未指定位置';

/** 按存放位置分组；低库存的排在每组前面。 */
function groupByLocation(records: LifeRecord[]): [string, LifeRecord[]][] {
  const groups = new Map<string, LifeRecord[]>();
  for (const record of records) {
    const location = record.householdItem?.location ?? NO_LOCATION;
    groups.set(location, [...(groups.get(location) ?? []), record]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) =>
      a === NO_LOCATION ? 1 : b === NO_LOCATION ? -1 : a.localeCompare(b),
    )
    .map(([location, list]) => [
      location,
      list.sort(
        (a, b) =>
          Number(b.householdItem?.isLowStock ?? false) -
            Number(a.householdItem?.isLowStock ?? false) ||
          displayTitle(a).localeCompare(displayTitle(b)),
      ),
    ]);
}

export default function HomeScreen() {
  const online = useIsOnline();
  const list = useInfiniteQuery(recordListQuery({ type: 'household_item', limit: 100 }));
  const records = list.data?.pages.flatMap((page) => page.items) ?? [];
  const lowCount = records.filter((record) => record.householdItem?.isLowStock).length;

  return (
    <Screen
      refreshing={list.isRefetching}
      onRefresh={() => void list.refetch()}
      overlay={
        <Fab
          label="新建家庭物品"
          onPress={() =>
            router.push({ pathname: '/record/new', params: { type: 'household_item' } })
          }
        />
      }
    >
      <Title
        caption={
          records.length === 0
            ? undefined
            : `共 ${records.length} 件物品${lowCount > 0 ? `，${lowCount} 件需要补充` : ''}`
        }
      >
        家中
      </Title>
      {online ? null : <InfoBanner message="没有网络，显示的是上次同步的内容。" />}
      {list.isError && records.length === 0 ? (
        <ErrorBanner message={describeError(list.error)} />
      ) : null}
      {list.isSuccess && records.length === 0 ? (
        <EmptyState
          title="还没有家庭物品"
          message="记下抽纸、洗衣液、大米这些常用的东西，快用完时会提醒。"
        />
      ) : null}
      {groupByLocation(records).map(([location, items]) => (
        <Section key={location} title={location}>
          {items.map((record, index) => (
            <HomeItemRow
              key={record.id}
              record={record}
              first={index === 0}
              readOnly={!online}
            />
          ))}
        </Section>
      ))}
      {list.hasNextPage ? (
        <SmallButton label="加载更多" onPress={() => void list.fetchNextPage()} />
      ) : null}
    </Screen>
  );
}

function HomeItemRow({
  record,
  first,
  readOnly,
}: {
  record: LifeRecord;
  first: boolean;
  readOnly: boolean;
}) {
  const invalidate = useInvalidateRecords();
  const move = useMutation({
    mutationFn: (kind: 'consume' | 'purchase') =>
      api.household.addTransaction(record.id, { kind, amount: 1 }),
    onSettled: invalidate,
  });
  const item = record.householdItem;
  if (item === null) {
    return null;
  }
  return (
    <Row
      first={first}
      title={displayTitle(record)}
      subtitle={[
        `${item.quantity} ${item.unit}`,
        item.lowStockThreshold === null ? null : `最低 ${item.lowStockThreshold}`,
        move.isError ? describeError(move.error) : null,
      ]
        .filter((part) => part !== null)
        .join(' · ')}
      onPress={() => router.push({ pathname: '/record/[id]', params: { id: record.id } })}
      right={
        <>
          {item.isLowStock ? <Badge label="低库存" tone="warning" /> : null}
          <SmallButton
            label="−1"
            disabled={readOnly || move.isPending || item.quantity < 1}
            onPress={() => move.mutate('consume')}
          />
          <SmallButton
            label="+1"
            disabled={readOnly || move.isPending}
            onPress={() => move.mutate('purchase')}
          />
        </>
      }
    />
  );
}

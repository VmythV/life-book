import { describeError } from '@life-book/api-client';
import { displayTitle, type LifeRecord } from '@life-book/core';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { api } from '../api';
import { Alert, Badge, Button, EmptyState } from '../components/ui';
import { recordListQuery, useInvalidateRecords } from '../queries';

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

export function HomePage() {
  const list = useInfiniteQuery(recordListQuery({ type: 'household_item', limit: 100 }));
  const records = list.data?.pages.flatMap((page) => page.items) ?? [];
  const lowCount = records.filter((record) => record.householdItem?.isLowStock).length;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">家中</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {records.length === 0
              ? '记下家里常用的东西，快用完时会提醒。'
              : `共 ${records.length} 件物品${lowCount > 0 ? `，${lowCount} 件需要补充` : ''}`}
          </p>
        </div>
        <Link
          to="/book/new"
          search={{ type: 'household_item' }}
          className="inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-on-primary hover:bg-primary-hover"
        >
          新建物品
        </Link>
      </header>
      {list.isPending ? <p className="text-sm text-fg-muted">正在加载…</p> : null}
      {list.isError ? <Alert>{describeError(list.error)}</Alert> : null}
      {list.isSuccess && records.length === 0 ? (
        <EmptyState title="还没有家庭物品">例如抽纸、洗衣液、大米、电池。</EmptyState>
      ) : null}
      {groupByLocation(records).map(([location, items]) => (
        <section key={location}>
          <h2 className="mb-2 text-lg font-semibold">{location}</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {items.map((record) => (
              <HomeItemRow key={record.id} record={record} />
            ))}
          </ul>
        </section>
      ))}
      {list.hasNextPage ? (
        <Button
          variant="secondary"
          loading={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          加载更多
        </Button>
      ) : null}
    </div>
  );
}

function HomeItemRow({ record }: { record: LifeRecord }) {
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
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <Link
          to="/book"
          search={{ id: record.id }}
          className="font-semibold hover:underline"
        >
          {displayTitle(record)}
        </Link>
        <p className="mt-0.5 text-xs text-fg-muted">
          {item.lowStockThreshold === null
            ? '没有设置最低库存'
            : `最低 ${item.lowStockThreshold}`}
        </p>
        {move.isError ? (
          <p className="mt-1 text-xs text-danger">{describeError(move.error)}</p>
        ) : null}
      </div>
      {item.isLowStock ? <Badge tone="warning">低库存</Badge> : null}
      <span className="w-20 text-right font-semibold">
        {item.quantity}{' '}
        <span className="text-xs font-normal text-fg-muted">{item.unit}</span>
      </span>
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="secondary"
          aria-label={`${displayTitle(record)} 用掉 1`}
          disabled={move.isPending || item.quantity < 1}
          onClick={() => move.mutate('consume')}
        >
          −1
        </Button>
        <Button
          size="sm"
          variant="secondary"
          aria-label={`${displayTitle(record)} 买入 1`}
          disabled={move.isPending}
          onClick={() => move.mutate('purchase')}
        >
          +1
        </Button>
      </div>
    </li>
  );
}

import { describeError } from '@life-book/api-client';
import {
  type BatchRequest,
  describeRecordSummary,
  displayTitle,
  creatableRecordTypes,
  RECORD_TYPE_LABELS,
  type RecordListQuery,
  type RecordType,
  todayIn,
} from '@life-book/core';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';

import { NewRecordMenu } from '../components/new-record-menu';
import { Alert, Badge, Button, EmptyState } from '../components/ui';
import { api } from '../api';
import {
  categoriesQuery,
  meQuery,
  recordListQuery,
  tagsQuery,
  useInvalidateRecords,
} from '../queries';
import { RecordDetail } from './record-detail';

// 字段允许显式设为 undefined，便于在跳转时清除某个筛选条件。
export interface BookSearch {
  id?: string | undefined;
  type?: RecordType | undefined;
  categoryId?: string | undefined;
  tagId?: string | undefined;
  q?: string | undefined;
  status?: 'active' | 'archived' | 'trash' | undefined;
}

const STATUS_LABELS = { active: '全部', archived: '已归档', trash: '回收站' } as const;

/**
 * 不合法的参数显式设为 undefined：父路由不校验查询参数，原始值会和这里的结果合并，
 * 只是不返回某个键的话，原始值（如 `?type=foo`）还会留在 search 里。
 */
export function validateBookSearch(search: Record<string, unknown>): BookSearch {
  const text = (value: unknown) =>
    typeof value === 'string' && value !== '' ? value : undefined;
  const type = text(search.type);
  const status = text(search.status);
  return {
    id: text(search.id),
    type:
      type !== undefined && (creatableRecordTypes as readonly string[]).includes(type)
        ? (type as RecordType)
        : undefined,
    categoryId: text(search.categoryId),
    tagId: text(search.tagId),
    q: text(search.q),
    status: status === 'archived' || status === 'trash' ? status : undefined,
  };
}

export function BookPage() {
  const search = useSearch({ from: '/app/book' });
  const navigate = useNavigate({ from: '/book' });
  const { data: me } = useSuspenseQuery(meQuery);
  const today = todayIn(me.settings.timezone);

  const setFilter = useCallback(
    (patch: Partial<BookSearch>) =>
      void navigate({
        search: (current) => {
          const next: Record<string, unknown> = { ...current, ...patch };
          delete next.id;
          return validateBookSearch(next);
        },
        replace: true,
      }),
    [navigate],
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between gap-4">
        <h1 className="text-3xl font-semibold">生活簿</h1>
        <NewRecordMenu />
      </header>
      <div className="grid gap-6 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className={search.id === undefined ? '' : 'hidden md:block'}>
          <Filters search={search} onChange={setFilter} />
          {search.status === 'trash' ? (
            <p className="mb-3 text-xs text-fg-subtle">
              回收站里的记录保留 30 天，之后会自动永久删除。
            </p>
          ) : null}
          <RecordList search={search} today={today} timeZone={me.settings.timezone} />
        </div>
        <div className={search.id === undefined ? 'hidden md:block' : ''}>
          {search.id === undefined ? (
            <EmptyState title="选择一条记录查看详情" />
          ) : (
            <div className="flex flex-col gap-3">
              <Link
                to="/book"
                search={{ ...search, id: undefined }}
                className="text-sm font-semibold text-link md:hidden"
              >
                ← 返回列表
              </Link>
              <RecordDetail
                key={search.id}
                id={search.id}
                today={today}
                timeZone={me.settings.timezone}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Filters({
  search,
  onChange,
}: {
  search: BookSearch;
  onChange: (patch: Partial<BookSearch>) => void;
}) {
  const categories = useQuery(categoriesQuery);
  const tags = useQuery(tagsQuery);
  const [text, setText] = useState(search.q ?? '');

  // 输入停顿 300 毫秒后再搜索。
  useEffect(() => {
    if (text === (search.q ?? '')) {
      return;
    }
    const timer = setTimeout(() => onChange({ q: text.trim() }), 300);
    return () => clearTimeout(timer);
  }, [text, search.q, onChange]);

  const chip = (selected: boolean) =>
    `h-8 rounded-full border px-3 text-xs font-semibold whitespace-nowrap ${selected ? 'border-primary bg-primary text-on-primary' : 'border-line text-fg-muted hover:bg-surface-subtle'}`;

  return (
    <div className="mb-4 flex flex-col gap-3">
      <input
        type="search"
        aria-label="搜索"
        placeholder="搜索标题和内容"
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="h-11 rounded-lg border border-line bg-surface px-3 text-base text-fg placeholder:text-fg-subtle"
      />
      <div className="flex flex-wrap gap-2" role="group" aria-label="类型">
        <button
          type="button"
          className={chip(search.type === undefined)}
          onClick={() => onChange({ type: undefined })}
        >
          全部类型
        </button>
        {creatableRecordTypes.map((type) => (
          <button
            key={type}
            type="button"
            className={chip(search.type === type)}
            onClick={() => onChange({ type })}
          >
            {RECORD_TYPE_LABELS[type]}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <select
          aria-label="分类"
          value={search.categoryId ?? ''}
          onChange={(event) => onChange({ categoryId: event.target.value || undefined })}
          className="h-9 min-w-0 rounded-lg border border-line bg-surface px-2 text-sm"
        >
          <option value="">所有分类</option>
          {(categories.data?.items ?? []).map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <select
          aria-label="标签"
          value={search.tagId ?? ''}
          onChange={(event) => onChange({ tagId: event.target.value || undefined })}
          className="h-9 min-w-0 rounded-lg border border-line bg-surface px-2 text-sm"
        >
          <option value="">所有标签</option>
          {(tags.data?.items ?? []).map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </select>
        <select
          aria-label="状态"
          value={search.status ?? 'active'}
          onChange={(event) =>
            onChange({
              status:
                event.target.value === 'active'
                  ? undefined
                  : (event.target.value as 'archived' | 'trash'),
            })
          }
          className="h-9 min-w-0 rounded-lg border border-line bg-surface px-2 text-sm"
        >
          {(Object.keys(STATUS_LABELS) as (keyof typeof STATUS_LABELS)[]).map(
            (status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ),
          )}
        </select>
      </div>
    </div>
  );
}

function RecordList({
  search,
  today,
  timeZone,
}: {
  search: BookSearch;
  today: string;
  timeZone: string;
}) {
  const query: RecordListQuery = {
    ...(search.type === undefined ? {} : { type: search.type }),
    ...(search.categoryId === undefined ? {} : { categoryId: search.categoryId }),
    ...(search.tagId === undefined ? {} : { tagId: search.tagId }),
    ...(search.q === undefined ? {} : { q: search.q }),
    ...(search.status === undefined ? {} : { status: search.status }),
  };
  const list = useInfiniteQuery(recordListQuery(query));
  const records = list.data?.pages.flatMap((page) => page.items) ?? [];
  // 已选的记录跨筛选条件保留（如边输入搜索词边勾选）；批量操作只针对当前列表里看得到的。
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const chosen = records
    .filter((record) => selected.has(record.id))
    .map((record) => record.id);
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  if (list.isPending) {
    return <p className="text-sm text-fg-muted">正在加载…</p>;
  }
  if (list.isError) {
    return <Alert>{describeError(list.error)}</Alert>;
  }
  if (records.length === 0) {
    const filtered = Object.keys(query).length > 0;
    return (
      <EmptyState title={filtered ? '没有符合条件的记录' : '还没有记录'}>
        {filtered ? '换个条件试试。' : '点击右上角的“新建”开始记录。'}
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {chosen.length === 0 ? null : (
        <BatchBar
          ids={chosen}
          trash={search.status === 'trash'}
          archived={search.status === 'archived'}
          onDone={() => setSelected(new Set())}
        />
      )}
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {records.map((record) => {
          const summary = describeRecordSummary(record, today, timeZone);
          return (
            <li key={record.id} className="flex items-stretch">
              <label className="flex cursor-pointer items-center pl-4">
                <input
                  type="checkbox"
                  aria-label={`选择 ${displayTitle(record)}`}
                  checked={selected.has(record.id)}
                  onChange={() => toggle(record.id)}
                  className="size-4 accent-(--color-primary)"
                />
              </label>
              <Link
                to="/book"
                search={{ ...search, id: record.id }}
                className="block min-w-0 flex-1 px-3 py-3 hover:bg-surface-subtle"
                activeOptions={{ includeSearch: true }}
                activeProps={{ className: 'bg-surface-subtle' }}
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {displayTitle(record)}
                  </span>
                  {record.isPinned ? <Badge tone="warning">置顶</Badge> : null}
                  <Badge>{RECORD_TYPE_LABELS[record.type]}</Badge>
                </div>
                {summary === '' ? null : (
                  <p className="mt-0.5 truncate text-xs text-fg-muted">{summary}</p>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
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

/** 选中多条记录后的批量操作。 */
function BatchBar({
  ids,
  trash,
  archived,
  onDone,
}: {
  ids: string[];
  trash: boolean;
  archived: boolean;
  onDone: () => void;
}) {
  const invalidate = useInvalidateRecords();
  const categories = useQuery(categoriesQuery);
  const tags = useQuery(tagsQuery);
  const batch = useMutation({
    mutationFn: (input: Omit<BatchRequest, 'ids'>) =>
      api.records.batch({ ...input, ids }),
    onSuccess: onDone,
    onSettled: invalidate,
  });
  const select =
    'h-8 min-w-0 rounded-lg border border-line bg-surface px-2 text-xs text-fg';

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-primary bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">已选 {ids.length} 条</span>
        {trash ? (
          <Button
            size="sm"
            disabled={batch.isPending}
            onClick={() => batch.mutate({ action: 'restore' })}
          >
            恢复
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={batch.isPending}
              onClick={() => batch.mutate({ action: archived ? 'unarchive' : 'archive' })}
            >
              {archived ? '取消归档' : '归档'}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={batch.isPending}
              onClick={() => batch.mutate({ action: 'delete' })}
            >
              删除
            </Button>
            <select
              aria-label="批量设置分类"
              value=""
              disabled={batch.isPending}
              onChange={(event) =>
                batch.mutate({
                  action: 'setCategory',
                  categoryId: event.target.value === 'none' ? null : event.target.value,
                })
              }
              className={select}
            >
              <option value="">设为分类…</option>
              <option value="none">无分类</option>
              {(categories.data?.items ?? []).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <select
              aria-label="批量添加标签"
              value=""
              disabled={batch.isPending || (tags.data?.items.length ?? 0) === 0}
              onChange={(event) =>
                batch.mutate({ action: 'addTags', tagIds: [event.target.value] })
              }
              className={select}
            >
              <option value="">加标签…</option>
              {(tags.data?.items ?? []).map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          </>
        )}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onDone}>
          取消选择
        </Button>
      </div>
      {batch.isError ? <Alert>{describeError(batch.error)}</Alert> : null}
    </div>
  );
}

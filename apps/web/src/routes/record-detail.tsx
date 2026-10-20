import { describeError, queryKeys } from '@life-book/api-client';
import {
  addDays,
  CHECKLIST_PURPOSE_LABELS,
  type ChecklistItem,
  checklistProgress,
  describeQuantity,
  groupChecklistItems,
  describeCounter,
  describeDaysUntil,
  describeLocalDate,
  describeRecurrence,
  describeReminder,
  displayTitle,
  formatLocalDate,
  type HandledOccurrenceStatus,
  type DeltaStockKind,
  IMPORTANT_DATE_KIND_LABELS,
  type LifeRecord,
  nextImportantDate,
  type Occurrence,
  RECORD_TYPE_LABELS,
  type ChecklistItemDraft,
  describeTrashExpiry,
  toChecklistItemDraft,
  type UpdateChecklistItemRequest,
  validateChecklistItemDraft,
  recentOccurrences,
  STOCK_KIND_LABELS,
  zonedDateTime,
} from '@life-book/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type FormEvent, type ReactNode, useState } from 'react';

import { api } from '../api';
import { RescheduleControl } from '../components/reschedule';
import { Alert, Badge, Button } from '../components/ui';
import {
  categoriesQuery,
  occurrencesQuery,
  recordQuery,
  stockTransactionsQuery,
  tagsQuery,
  useInvalidateRecords,
} from '../queries';

export function RecordDetail({
  id,
  today,
  timeZone,
}: {
  id: string;
  today: string;
  timeZone: string;
}) {
  const record = useQuery(recordQuery(id));

  if (record.isPending) {
    return <p className="text-sm text-fg-muted">正在加载…</p>;
  }
  if (record.isError) {
    return <Alert>{describeError(record.error)}</Alert>;
  }
  return <RecordDetailContent record={record.data} today={today} timeZone={timeZone} />;
}

function RecordDetailContent({
  record,
  today,
  timeZone,
}: {
  record: LifeRecord;
  today: string;
  timeZone: string;
}) {
  const categories = useQuery(categoriesQuery);
  const tags = useQuery(tagsQuery);
  const category = categories.data?.items.find((item) => item.id === record.categoryId);
  const tagNames = record.tagIds.flatMap((tagId) => {
    const tag = tags.data?.items.find((item) => item.id === tagId);
    return tag === undefined ? [] : [tag.name];
  });
  const trashed = record.deletedAt !== null;

  return (
    <article className="flex flex-col gap-5 rounded-2xl border border-line bg-surface p-5 md:p-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{RECORD_TYPE_LABELS[record.type]}</Badge>
          {record.isPinned ? <Badge tone="warning">置顶</Badge> : null}
          {record.archivedAt !== null ? <Badge>已归档</Badge> : null}
          {record.deletedAt === null ? null : (
            <Badge tone="danger">
              在回收站，{describeTrashExpiry(record.deletedAt, new Date())}
            </Badge>
          )}
        </div>
        <h2 className="text-2xl font-semibold break-words">{displayTitle(record)}</h2>
      </header>

      <RecordActions record={record} />

      {record.recurring !== null ? (
        <DetailSection title="重复">
          <p>{describeRecurrence(record.recurring)}</p>
          <p className="mt-1 text-sm text-fg-muted">
            <NextOccurrence record={record} today={today} />
          </p>
          {trashed ? null : <RecentOccurrences recordId={record.id} today={today} />}
        </DetailSection>
      ) : null}

      {record.checklist !== null ? (
        <ChecklistSection
          record={record}
          today={today}
          timeZone={timeZone}
          readOnly={trashed}
        />
      ) : null}

      {record.householdItem !== null ? (
        <HouseholdSection record={record} timeZone={timeZone} readOnly={trashed} />
      ) : null}

      {record.importantDate !== null ? (
        <DetailSection title="日期">
          {(() => {
            const value = record.importantDate;
            const next = nextImportantDate(value, today);
            const counter = value.showCounter
              ? describeCounter(value.kind, next?.counter ?? null)
              : null;
            return (
              <>
                <p>
                  {IMPORTANT_DATE_KIND_LABELS[value.kind]} ·{' '}
                  {value.repeat === 'yearly'
                    ? `每年 ${value.month} 月 ${value.day} 日`
                    : `${value.year ?? ''} 年 ${value.month} 月 ${value.day} 日`}
                </p>
                <p className="mt-1 text-sm text-fg-muted">
                  {next === null
                    ? '已过去'
                    : [
                        formatLocalDate(next.date, { withYear: true }),
                        describeDaysUntil(next.daysUntil),
                        counter,
                      ]
                        .filter((part) => part !== null)
                        .join(' · ')}
                </p>
              </>
            );
          })()}
        </DetailSection>
      ) : null}

      {record.notes === null ? null : (
        <DetailSection title={record.type === 'memo' ? '内容' : '说明'}>
          <p className="leading-relaxed break-words whitespace-pre-wrap">
            {record.notes}
          </p>
        </DetailSection>
      )}

      {record.type === 'household_item' ? null : (
        <DetailSection title="提醒">
          {record.reminders.length === 0 ? (
            <p className="text-sm text-fg-muted">没有设置提醒</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {record.reminders.map((reminder) => (
                <li key={reminder.id}>{describeReminder(reminder, timeZone)}</li>
              ))}
            </ul>
          )}
        </DetailSection>
      )}

      {category === undefined && tagNames.length === 0 ? null : (
        <DetailSection title="整理">
          <div className="flex flex-wrap gap-2">
            {category === undefined ? null : <Badge tone="info">{category.name}</Badge>}
            {tagNames.map((name) => (
              <Badge key={name}>#{name}</Badge>
            ))}
          </div>
        </DetailSection>
      )}

      <p className="text-xs text-fg-subtle">
        创建于 {formatTimestamp(record.createdAt, timeZone)} · 修改于{' '}
        {formatTimestamp(record.updatedAt, timeZone)}
      </p>
    </article>
  );
}

function formatTimestamp(value: string, timeZone: string): string {
  const { date, time } = zonedDateTime(new Date(value), timeZone);
  return `${formatLocalDate(date, { withYear: true })} ${time}`;
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-fg-subtle">
        {title}
      </h3>
      {children}
    </section>
  );
}

function RecordActions({ record }: { record: LifeRecord }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const invalidate = useInvalidateRecords();
  const action = useMutation({
    mutationFn: async (
      kind: 'pin' | 'archive' | 'unarchive' | 'remove' | 'restore' | 'purge' | 'template',
    ) => {
      switch (kind) {
        case 'template':
          return api.checklistItems.saveAsTemplate(record.id);
        case 'pin':
          return api.records.update(record.id, {
            version: record.version,
            isPinned: !record.isPinned,
          });
        case 'archive':
          return api.records.archive(record.id);
        case 'unarchive':
          return api.records.unarchive(record.id);
        case 'remove':
          return api.records.remove(record.id);
        case 'restore':
          return api.records.restore(record.id);
        case 'purge':
          return api.records.removePermanently(record.id);
      }
    },
    onSuccess: async (_result, kind) => {
      if (kind === 'template') {
        await queryClient.invalidateQueries({ queryKey: queryKeys.templates });
        setNotice('已另存为模板，可以在“清单模板”里修改。');
      }
      if (kind === 'purge' || kind === 'remove') {
        await navigate({
          to: '/book',
          search: (current) => ({ ...current, id: undefined }),
        });
      }
    },
    onSettled: invalidate,
  });
  const busy = action.isPending;

  if (record.deletedAt !== null) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => action.mutate('restore')}>
            恢复
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm('永久删除后无法恢复，确定吗？')) {
                action.mutate('purge');
              }
            }}
          >
            永久删除
          </Button>
        </div>
        {action.isError ? <Alert>{describeError(action.error)}</Alert> : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Link
          to="/book/$id/edit"
          params={{ id: record.id }}
          className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-on-primary hover:bg-primary-hover"
        >
          编辑
        </Link>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => action.mutate('pin')}
        >
          {record.isPinned ? '取消置顶' : '置顶'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() =>
            action.mutate(record.archivedAt === null ? 'archive' : 'unarchive')
          }
        >
          {record.archivedAt === null ? '归档' : '取消归档'}
        </Button>
        {record.type === 'checklist' ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => action.mutate('template')}
          >
            另存为模板
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="danger"
          disabled={busy}
          onClick={() => action.mutate('remove')}
        >
          删除
        </Button>
      </div>
      {action.isError ? <Alert>{describeError(action.error)}</Alert> : null}
      {notice === null ? null : (
        <p
          role="status"
          className="rounded-lg bg-info-container px-4 py-3 text-sm text-info"
        >
          {notice}
        </p>
      )}
    </div>
  );
}

const OCCURRENCE_LABELS: Record<Occurrence['status'], string> = {
  pending: '待完成',
  overdue: '逾期',
  completed: '已完成',
  skipped: '已跳过',
};
const OCCURRENCE_TONES = {
  pending: 'neutral',
  overdue: 'warning',
  completed: 'success',
  skipped: 'neutral',
} as const;

/** 过去两周和接下来的几次实例，可以直接完成、跳过或撤销。 */
function RecentOccurrences({ recordId, today }: { recordId: string; today: string }) {
  const from = addDays(today, -14);
  const to = addDays(today, 14);
  const list = useQuery(occurrencesQuery(recordId, from, to));
  const invalidate = useInvalidateRecords();
  const setStatus = useMutation({
    mutationFn: ({
      date,
      status,
    }: {
      date: string;
      status: HandledOccurrenceStatus | null;
    }) =>
      status === null
        ? api.occurrences.undo(recordId, date)
        : api.occurrences.set(recordId, date, { status }).then(() => undefined),
    onSettled: invalidate,
  });

  if (list.data === undefined) {
    return null;
  }
  const items = recentOccurrences(list.data.items, today);
  if (items.length === 0) {
    return <p className="mt-3 text-sm text-fg-muted">前后两周没有安排。</p>;
  }
  return (
    <div className="mt-3">
      {setStatus.isError ? <Alert>{describeError(setStatus.error)}</Alert> : null}
      <ul className="divide-y divide-line rounded-xl border border-line">
        {items.map((item) => {
          const handled = item.status === 'completed' || item.status === 'skipped';
          return (
            <li
              key={item.originalDate}
              className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"
            >
              <span className={`flex-1 ${item.date === today ? 'font-semibold' : ''}`}>
                {describeLocalDate(item.date, today)}
                {item.date === item.originalDate ? null : (
                  <span className="ml-2 text-xs text-fg-muted">
                    原定 {describeLocalDate(item.originalDate, today)}
                  </span>
                )}
              </span>
              <Badge tone={OCCURRENCE_TONES[item.status]}>
                {OCCURRENCE_LABELS[item.status]}
              </Badge>
              {handled ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={setStatus.isPending}
                  onClick={() =>
                    setStatus.mutate({ date: item.originalDate, status: null })
                  }
                >
                  撤销
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={setStatus.isPending}
                    onClick={() =>
                      setStatus.mutate({ date: item.originalDate, status: 'completed' })
                    }
                  >
                    完成
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={setStatus.isPending}
                    onClick={() =>
                      setStatus.mutate({ date: item.originalDate, status: 'skipped' })
                    }
                  >
                    跳过
                  </Button>
                  <RescheduleControl
                    recordId={recordId}
                    originalDate={item.originalDate}
                    date={item.date}
                  />
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 清单：分组显示项目，直接勾选、添加和删除。 */
function ChecklistSection({
  record,
  today,
  timeZone,
  readOnly,
}: {
  record: LifeRecord;
  today: string;
  timeZone: string;
  readOnly: boolean;
}) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateRecords();
  const [title, setTitle] = useState('');
  const [groupName, setGroupName] = useState('');
  const checklist = record.checklist;
  const items = checklist?.items ?? [];
  const progress = checklistProgress(items);

  // 勾选时先更新界面，失败后由重新加载纠正。
  const toggle = useMutation({
    mutationFn: (item: ChecklistItem) =>
      api.checklistItems.update(record.id, item.id, { isDone: !item.isDone }),
    onMutate: (item) => {
      queryClient.setQueryData<LifeRecord>(queryKeys.record(record.id), (current) =>
        current?.checklist == null
          ? current
          : {
              ...current,
              checklist: {
                ...current.checklist,
                items: current.checklist.items.map((other) =>
                  other.id === item.id ? { ...other, isDone: !item.isDone } : other,
                ),
              },
            },
      );
    },
    onSettled: invalidate,
  });
  const add = useMutation({
    mutationFn: () => api.checklistItems.create(record.id, { title, groupName }),
    onSuccess: () => setTitle(''),
    onSettled: invalidate,
  });
  const remove = useMutation({
    mutationFn: (itemId: string) => api.checklistItems.remove(record.id, itemId),
    onSettled: invalidate,
  });
  const completeAll = useMutation({
    mutationFn: (done: boolean) => api.checklistItems.completeAll(record.id, { done }),
    onSettled: invalidate,
  });
  const error = toggle.error ?? add.error ?? remove.error ?? completeAll.error;

  if (checklist === null) {
    return null;
  }
  const due =
    checklist.dueAt === null ? null : zonedDateTime(new Date(checklist.dueAt), timeZone);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (title.trim() !== '') {
      add.mutate();
    }
  }

  return (
    <DetailSection title="清单">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={progress.isComplete ? 'success' : 'neutral'}>
          {progress.total === 0
            ? '还没有项目'
            : progress.isComplete
              ? '已全部完成'
              : `${progress.done}/${progress.total}`}
        </Badge>
        <Badge>{CHECKLIST_PURPOSE_LABELS[checklist.purpose]}</Badge>
        {due === null ? null : (
          <span className="text-sm text-fg-muted">
            截止 {describeLocalDate(due.date, today)} {due.time}
          </span>
        )}
        {readOnly || progress.total === 0 ? null : (
          <Button
            size="sm"
            variant="secondary"
            className="ml-auto"
            disabled={completeAll.isPending}
            onClick={() => completeAll.mutate(!progress.isComplete)}
          >
            {progress.isComplete ? '全部取消勾选' : '全部完成'}
          </Button>
        )}
      </div>
      {error === null ? null : (
        <div className="mt-2">
          <Alert>{describeError(error)}</Alert>
        </div>
      )}
      <div className="mt-3 flex flex-col gap-3">
        {groupChecklistItems(items).map((group) => (
          <div key={group.name ?? ''}>
            {group.name === null ? null : (
              <p className="mb-1 text-xs font-semibold text-fg-subtle">{group.name}</p>
            )}
            <ul className="divide-y divide-line rounded-xl border border-line">
              {group.items.map((item) => (
                <ChecklistItemRow
                  key={item.id}
                  recordId={record.id}
                  item={item}
                  readOnly={readOnly}
                  removing={remove.isPending}
                  onToggle={() => toggle.mutate(item)}
                  onRemove={() => remove.mutate(item.id)}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
      {readOnly ? null : (
        <form onSubmit={submit} className="mt-3 flex gap-2">
          <input
            aria-label="新项目"
            placeholder="添加项目，回车保存"
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm text-fg placeholder:text-fg-subtle"
          />
          <input
            aria-label="新项目的分组"
            placeholder="分组（可选）"
            value={groupName}
            maxLength={30}
            onChange={(event) => setGroupName(event.target.value)}
            className="h-9 w-28 rounded-lg border border-line bg-surface px-3 text-sm text-fg placeholder:text-fg-subtle"
          />
          <Button type="submit" size="sm" loading={add.isPending}>
            添加
          </Button>
        </form>
      )}
    </DetailSection>
  );
}

/** 清单里的一项：勾选、删除，点“编辑”后就地修改名称、分组、数量和单位。 */
function ChecklistItemRow({
  recordId,
  item,
  readOnly,
  removing,
  onToggle,
  onRemove,
}: {
  recordId: string;
  item: ChecklistItem;
  readOnly: boolean;
  removing: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const invalidate = useInvalidateRecords();
  const [draft, setDraft] = useState<ChecklistItemDraft | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (input: UpdateChecklistItemRequest) =>
      api.checklistItems.update(recordId, item.id, input),
    onSuccess: () => setDraft(null),
    onSettled: invalidate,
  });
  const error = invalid ?? (save.isError ? describeError(save.error) : null);
  const inputClass =
    'h-8 min-w-0 rounded-lg border border-line bg-surface px-2 text-sm text-fg placeholder:text-fg-subtle';

  if (draft !== null) {
    const change = (patch: Partial<ChecklistItemDraft>) =>
      setDraft({ ...draft, ...patch });
    return (
      <li className="px-3 py-2">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const result = validateChecklistItemDraft(draft);
            setInvalid(result.error);
            if (result.data !== null) {
              save.mutate(result.data);
            }
          }}
        >
          <input
            aria-label="项目名称"
            value={draft.title}
            maxLength={200}
            autoFocus
            onChange={(event) => change({ title: event.target.value })}
            className={`${inputClass} flex-1 basis-40`}
          />
          <input
            aria-label="分组"
            placeholder="分组"
            value={draft.groupName}
            maxLength={30}
            onChange={(event) => change({ groupName: event.target.value })}
            className={`${inputClass} w-24`}
          />
          <input
            aria-label="数量"
            placeholder="数量"
            inputMode="decimal"
            value={draft.quantity}
            onChange={(event) => change({ quantity: event.target.value })}
            className={`${inputClass} w-20`}
          />
          <input
            aria-label="单位"
            placeholder="单位"
            value={draft.unit}
            maxLength={10}
            onChange={(event) => change({ unit: event.target.value })}
            className={`${inputClass} w-16`}
          />
          <Button type="submit" size="sm" loading={save.isPending}>
            保存
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
            取消
          </Button>
        </form>
        {error === null ? null : <p className="mt-1 text-xs text-danger">{error}</p>}
      </li>
    );
  }

  const quantity = describeQuantity(item.quantity, item.unit);
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <input
        type="checkbox"
        aria-label={item.title}
        checked={item.isDone}
        disabled={readOnly}
        onChange={onToggle}
        className="size-4 accent-(--color-primary)"
      />
      <span
        className={`min-w-0 flex-1 break-words ${item.isDone ? 'text-fg-subtle line-through' : ''}`}
      >
        {item.title}
        {quantity === null ? null : (
          <span className="ml-2 text-xs text-fg-muted">{quantity}</span>
        )}
      </span>
      {readOnly ? null : (
        <>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`编辑 ${item.title}`}
            onClick={() => {
              save.reset();
              setInvalid(null);
              setDraft(toChecklistItemDraft(item));
            }}
          >
            编辑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`删除 ${item.title}`}
            disabled={removing}
            onClick={onRemove}
          >
            删除
          </Button>
        </>
      )}
    </li>
  );
}

const STOCK_ACTIONS: DeltaStockKind[] = ['purchase', 'consume', 'discard', 'lost'];

/** 家庭物品：当前数量、买入/使用等操作、最近的流水和“加入采购清单”。 */
function HouseholdSection({
  record,
  timeZone,
  readOnly,
}: {
  record: LifeRecord;
  timeZone: string;
  readOnly: boolean;
}) {
  const invalidate = useInvalidateRecords();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('1');
  const [target, setTarget] = useState('');
  const [notice, setNotice] = useState<ReactNode>(null);
  const transactions = useQuery(stockTransactionsQuery(record.id));
  const refresh = async () => {
    await invalidate();
    await queryClient.invalidateQueries({
      queryKey: queryKeys.stockTransactions(record.id),
    });
  };

  const move = useMutation({
    mutationFn: (kind: DeltaStockKind | 'adjust') =>
      kind === 'adjust'
        ? api.household.addTransaction(record.id, {
            kind,
            quantity: target.trim() === '' ? Number.NaN : Number(target),
          })
        : api.household.addTransaction(record.id, {
            kind,
            amount: amount.trim() === '' ? Number.NaN : Number(amount),
          }),
    onSuccess: () => {
      setTarget('');
      setNotice(null);
    },
    onSettled: refresh,
  });
  const shop = useMutation({
    mutationFn: () => api.household.addToShoppingList(record.id),
    onSuccess: (result) =>
      setNotice(
        <>
          {result.created ? '已加入' : '已经在'}
          <Link
            to="/book"
            search={{ id: result.checklistId }}
            className="mx-1 font-semibold underline"
          >
            采购清单
          </Link>
          里。
        </>,
      ),
    onSettled: invalidate,
  });
  const error = move.error ?? shop.error;
  const item = record.householdItem;
  if (item === null) {
    return null;
  }

  return (
    <DetailSection title="库存">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-3xl font-semibold">
          {item.quantity}
          <span className="ml-1 text-base font-normal text-fg-muted">{item.unit}</span>
        </span>
        {item.isLowStock ? <Badge tone="warning">低库存</Badge> : null}
        <span className="text-sm text-fg-muted">
          {[
            item.lowStockThreshold === null
              ? '没有设置最低库存'
              : `最低 ${item.lowStockThreshold}`,
            item.location,
          ]
            .filter((part) => part !== null)
            .join(' · ')}
        </span>
      </div>
      {error === null ? null : (
        <div className="mt-2">
          <Alert>{describeError(error)}</Alert>
        </div>
      )}
      {notice === null ? null : (
        <p
          role="status"
          className="mt-2 rounded-lg bg-info-container px-4 py-3 text-sm text-info"
        >
          {notice}
        </p>
      )}
      {readOnly ? null : (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="数量"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="h-8 w-20 rounded-lg border border-line bg-surface px-2 text-sm text-fg"
            />
            <span className="text-sm text-fg-muted">{item.unit}</span>
            {STOCK_ACTIONS.map((kind) => (
              <Button
                key={kind}
                size="sm"
                variant={
                  kind === 'purchase' || kind === 'consume' ? 'secondary' : 'ghost'
                }
                disabled={move.isPending}
                onClick={() => move.mutate(kind)}
              >
                {STOCK_KIND_LABELS[kind]}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="调整为"
              inputMode="decimal"
              placeholder="实际数量"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className="h-8 w-24 rounded-lg border border-line bg-surface px-2 text-sm text-fg placeholder:text-fg-subtle"
            />
            <Button
              size="sm"
              variant="ghost"
              disabled={move.isPending || target.trim() === ''}
              onClick={() => move.mutate('adjust')}
            >
              调整为实际数量
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              disabled={shop.isPending}
              onClick={() => shop.mutate()}
            >
              加入采购清单
            </Button>
          </div>
        </div>
      )}
      {transactions.data === undefined || transactions.data.items.length === 0 ? null : (
        <div className="mt-4">
          <p className="mb-1 text-xs font-semibold text-fg-subtle">最近的变化</p>
          <ul className="divide-y divide-line rounded-xl border border-line text-sm">
            {transactions.data.items.slice(0, 10).map((transaction) => {
              const when = zonedDateTime(new Date(transaction.occurredAt), timeZone);
              return (
                <li key={transaction.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="w-10 font-semibold">
                    {STOCK_KIND_LABELS[transaction.kind]}
                  </span>
                  <span
                    className={transaction.delta < 0 ? 'text-danger' : 'text-success'}
                  >
                    {transaction.delta > 0 ? '+' : ''}
                    {transaction.delta}
                  </span>
                  <span className="text-fg-muted">→ {transaction.quantityAfter}</span>
                  <span className="ml-auto text-xs text-fg-subtle">
                    {formatLocalDate(when.date)} {when.time}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </DetailSection>
  );
}

/** “下次：……”：服务端已按改期和处理状态算好。 */
function NextOccurrence({ record, today }: { record: LifeRecord; today: string }) {
  if (record.recurring === null) {
    return null;
  }
  const next = record.nextOccurrenceDate;
  return <>{next === null ? '已结束' : `下次：${describeLocalDate(next, today)}`}</>;
}

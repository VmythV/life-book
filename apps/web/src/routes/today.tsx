import { describeError } from '@life-book/api-client';
import {
  describeCounter,
  describeDaysUntil,
  describeLocalDate,
  formatLocalDate,
  type ChecklistCard,
  type HandledOccurrenceStatus,
  IMPORTANT_DATE_KIND_LABELS,
  type ImportantDateCard,
  type LowStockCard,
  isChecklistComplete,
  type MemoReminderCard,
  type OccurrenceCard,
  type OverdueCard,
  type TodayCard,
} from '@life-book/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode } from 'react';

import { api } from '../api';
import { NewRecordMenu } from '../components/new-record-menu';
import { RescheduleControl } from '../components/reschedule';
import { Alert, Badge, Button, EmptyState } from '../components/ui';
import { todayQuery, useInvalidateRecords } from '../queries';

export function TodayPage() {
  const today = useQuery(todayQuery);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm text-fg-muted">
            {today.data === undefined ? '\u00a0' : formatLocalDate(today.data.date)}
          </p>
          <h1 className="mt-1 text-3xl font-semibold">今天</h1>
        </div>
        <NewRecordMenu />
      </header>

      {today.isPending ? <p className="text-sm text-fg-muted">正在加载…</p> : null}
      {today.isError ? <Alert>{describeError(today.error)}</Alert> : null}
      {today.data === undefined ? null : (
        <TodayContent
          date={today.data.date}
          overdue={today.data.overdue}
          items={today.data.today}
          upcomingDates={today.data.upcomingDates}
          lowStock={today.data.lowStock}
        />
      )}
    </div>
  );
}

function TodayContent({
  date,
  overdue,
  items,
  upcomingDates,
  lowStock,
}: {
  date: string;
  lowStock: LowStockCard[];
  overdue: OverdueCard[];
  items: TodayCard[];
  upcomingDates: ImportantDateCard[];
}) {
  if (
    overdue.length === 0 &&
    items.length === 0 &&
    upcomingDates.length === 0 &&
    lowStock.length === 0
  ) {
    return (
      <EmptyState title="今天没有需要处理的事">
        新建重复日常、重要日期、清单或带提醒的备忘后，会在这里出现；家庭物品快用完时也会出现在这里。
      </EmptyState>
    );
  }
  return (
    <>
      {overdue.length === 0 ? null : (
        <Section title="逾期" hint="过去 30 天内没有处理的事">
          {overdue.map((card) =>
            card.kind === 'occurrence' ? (
              <OccurrenceRow
                key={`${card.recordId}:${card.originalDate}`}
                card={card}
                today={date}
              />
            ) : (
              <ChecklistRow key={card.recordId} card={card} today={date} />
            ),
          )}
        </Section>
      )}
      <Section title="今天">
        {items.length === 0 ? (
          <p className="px-4 py-3 text-sm text-fg-muted">今天没有安排。</p>
        ) : (
          items.map((card) =>
            card.kind === 'occurrence' ? (
              <OccurrenceRow
                key={`${card.recordId}:${card.originalDate}`}
                card={card}
                today={date}
              />
            ) : card.kind === 'checklist' ? (
              <ChecklistRow key={card.recordId} card={card} today={date} />
            ) : (
              <MemoReminderRow key={card.reminderId} card={card} />
            ),
          )
        )}
      </Section>
      {upcomingDates.length === 0 ? null : (
        <Section title="近期重要日期" hint="未来 7 天">
          {upcomingDates.map((card) => (
            <ImportantDateRow key={card.recordId} card={card} today={date} />
          ))}
        </Section>
      )}
      {lowStock.length === 0 ? null : (
        <Section title="家里要补" hint="库存不高于最低库存的物品">
          {lowStock.map((card) => (
            <LowStockRow key={card.recordId} card={card} />
          ))}
        </Section>
      )}
    </>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {hint === undefined ? null : (
          <span className="text-xs text-fg-subtle">{hint}</span>
        )}
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {children}
      </ul>
    </section>
  );
}

function RecordLink({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Link to="/book" search={{ id }} className="font-semibold hover:underline">
      {children}
    </Link>
  );
}

const STATUS_LABELS: Record<HandledOccurrenceStatus, string> = {
  completed: '已完成',
  skipped: '已跳过',
};

function OccurrenceRow({ card, today }: { card: OccurrenceCard; today: string }) {
  const invalidate = useInvalidateRecords();
  const setStatus = useMutation({
    mutationFn: (status: HandledOccurrenceStatus | null) =>
      status === null
        ? api.occurrences.undo(card.recordId, card.originalDate)
        : api.occurrences
            .set(card.recordId, card.originalDate, { status })
            .then(() => undefined),
    onSettled: invalidate,
  });
  const handled = card.status === 'completed' || card.status === 'skipped';

  const meta = [
    card.status === 'overdue' ? describeLocalDate(card.date, today) : null,
    card.time ?? '全天',
    card.date === card.originalDate
      ? null
      : `原定 ${describeLocalDate(card.originalDate, today)}`,
    card.moreCount > 0 ? `还有 ${card.moreCount} 次未处理` : null,
  ].filter((part) => part !== null);

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className={`min-w-0 flex-1 ${handled ? 'text-fg-subtle line-through' : ''}`}>
        <RecordLink id={card.recordId}>{card.title}</RecordLink>
        <p className="mt-0.5 text-xs text-fg-muted no-underline">{meta.join(' · ')}</p>
        {setStatus.isError ? (
          <p className="mt-1 text-xs text-danger">{describeError(setStatus.error)}</p>
        ) : null}
      </div>
      {handled ? (
        <div className="flex items-center gap-2">
          <Badge tone={card.status === 'completed' ? 'success' : 'neutral'}>
            {STATUS_LABELS[card.status as HandledOccurrenceStatus]}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            disabled={setStatus.isPending}
            onClick={() => setStatus.mutate(null)}
          >
            撤销
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={setStatus.isPending}
            onClick={() => setStatus.mutate('completed')}
          >
            完成
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={setStatus.isPending}
            onClick={() => setStatus.mutate('skipped')}
          >
            跳过
          </Button>
          <RescheduleControl
            recordId={card.recordId}
            originalDate={card.originalDate}
            date={card.date}
          />
        </div>
      )}
    </li>
  );
}

function ChecklistRow({ card, today }: { card: ChecklistCard; today: string }) {
  const complete = isChecklistComplete(card.done, card.total);
  const due =
    card.date === today
      ? `${card.time} 截止`
      : `${describeLocalDate(card.date, today)} ${card.time} 截止`;
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className={`min-w-0 flex-1 ${complete ? 'text-fg-subtle line-through' : ''}`}>
        <RecordLink id={card.recordId}>{card.title}</RecordLink>
        <p className="mt-0.5 text-xs text-fg-muted">
          {due} · {card.total === 0 ? '还没有项目' : `${card.done}/${card.total}`}
        </p>
      </div>
      <Badge tone={complete ? 'success' : 'info'}>{complete ? '已完成' : '清单'}</Badge>
    </li>
  );
}

function MemoReminderRow({ card }: { card: MemoReminderCard }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <RecordLink id={card.recordId}>{card.title}</RecordLink>
        <p className="mt-0.5 text-xs text-fg-muted">{card.time} 提醒</p>
      </div>
      <Badge tone="info">备忘</Badge>
    </li>
  );
}

function ImportantDateRow({ card, today }: { card: ImportantDateCard; today: string }) {
  const counter = describeCounter(card.dateKind, card.counter);
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <RecordLink id={card.recordId}>{card.title}</RecordLink>
        <p className="mt-0.5 text-xs text-fg-muted">
          {[
            describeLocalDate(card.date, today),
            IMPORTANT_DATE_KIND_LABELS[card.dateKind],
            counter,
          ]
            .filter((part) => part !== null)
            .join(' · ')}
        </p>
      </div>
      <Badge tone={card.daysUntil === 0 ? 'warning' : 'neutral'}>
        {describeDaysUntil(card.daysUntil)}
      </Badge>
    </li>
  );
}

function LowStockRow({ card }: { card: LowStockCard }) {
  const invalidate = useInvalidateRecords();
  const shop = useMutation({
    mutationFn: () => api.household.addToShoppingList(card.recordId),
    onSettled: invalidate,
  });
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <RecordLink id={card.recordId}>{card.title}</RecordLink>
        <p className="mt-0.5 text-xs text-fg-muted">
          {[`剩 ${card.quantity} ${card.unit}`, `最低 ${card.threshold}`, card.location]
            .filter((part) => part !== null)
            .join(' · ')}
        </p>
      </div>
      {shop.isSuccess ? (
        <Badge tone="success">
          {shop.data.created ? '已加入采购清单' : '已在采购清单里'}
        </Badge>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          disabled={shop.isPending}
          onClick={() => shop.mutate()}
        >
          加入采购清单
        </Button>
      )}
    </li>
  );
}

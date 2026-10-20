import { describeError } from '@life-book/api-client';
import {
  describeLocalDate,
  type ChecklistCard,
  type HandledOccurrenceStatus,
  isChecklistComplete,
  type MemoReminderCard,
  type OccurrenceCard,
} from '@life-book/core';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode } from 'react';

import { api } from '../api';
import { useInvalidateRecords } from '../queries';
import { RescheduleControl } from './reschedule';
import { Badge, Button } from './ui';

// “今天”和日历共用的事项行。

export function Section({
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

export function RecordLink({ id, children }: { id: string; children: ReactNode }) {
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

export function OccurrenceRow({ card, today }: { card: OccurrenceCard; today: string }) {
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

export function ChecklistRow({ card, today }: { card: ChecklistCard; today: string }) {
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

export function MemoReminderRow({ card }: { card: MemoReminderCard }) {
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

import { describeError } from '@life-book/api-client';
import {
  describeLocalDate,
  type ChecklistCard,
  type HandledOccurrenceStatus,
  isChecklistComplete,
  type OccurrenceCard,
} from '@life-book/core';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';

import { api, useInvalidateRecords } from '../lib/api';
import { Badge, Row, SmallButton } from './ui';

// “今天”和日历共用的事项行。

export const openRecord = (id: string) =>
  router.push({ pathname: '/record/[id]', params: { id } });

export function ChecklistRow({
  card,
  today,
  first,
  onOpen = openRecord,
}: {
  card: ChecklistCard;
  today: string;
  first: boolean;
  /** 点这一行时；在弹出的卡片里要先关掉卡片再打开详情。 */
  onOpen?: (id: string) => void;
}) {
  const complete = isChecklistComplete(card.done, card.total);
  const due =
    card.date === today
      ? `${card.time} 截止`
      : `${describeLocalDate(card.date, today)} ${card.time} 截止`;
  return (
    <Row
      first={first}
      title={card.title}
      subtitle={`${due} · ${card.total === 0 ? '还没有项目' : `${card.done}/${card.total}`}`}
      dimmed={complete}
      onPress={() => onOpen(card.recordId)}
      right={
        <Badge
          label={complete ? '已完成' : '清单'}
          tone={complete ? 'success' : 'info'}
        />
      }
    />
  );
}

export function OccurrenceRow({
  card,
  today,
  first,
  readOnly,
  onOpen = openRecord,
}: {
  card: OccurrenceCard;
  today: string;
  first: boolean;
  readOnly: boolean;
  onOpen?: (id: string) => void;
}) {
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
  const busy = setStatus.isPending || readOnly;
  const subtitle = [
    card.status === 'overdue' ? describeLocalDate(card.date, today) : null,
    card.time ?? '全天',
    card.date === card.originalDate
      ? null
      : `原定 ${describeLocalDate(card.originalDate, today)}`,
    card.moreCount > 0 ? `还有 ${card.moreCount} 次未处理` : null,
    setStatus.isError ? describeError(setStatus.error) : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');

  return (
    <Row
      first={first}
      title={card.title}
      subtitle={subtitle}
      dimmed={handled}
      onPress={() => onOpen(card.recordId)}
      right={
        handled ? (
          <>
            <Badge
              label={card.status === 'completed' ? '已完成' : '已跳过'}
              tone={card.status === 'completed' ? 'success' : 'neutral'}
            />
            <SmallButton
              label="撤销"
              variant="ghost"
              disabled={busy}
              onPress={() => setStatus.mutate(null)}
            />
          </>
        ) : (
          <>
            <SmallButton
              label="完成"
              variant="primary"
              disabled={busy}
              onPress={() => setStatus.mutate('completed')}
            />
            <SmallButton
              label="跳过"
              variant="ghost"
              disabled={busy}
              onPress={() => setStatus.mutate('skipped')}
            />
          </>
        )
      }
    />
  );
}

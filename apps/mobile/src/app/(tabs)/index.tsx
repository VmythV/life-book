import { describeError } from '@life-book/api-client';
import {
  describeCounter,
  describeDaysUntil,
  describeLocalDate,
  formatLocalDate,
  type ChecklistCard,
  type HandledOccurrenceStatus,
  isChecklistComplete,
  type LowStockCard,
  IMPORTANT_DATE_KIND_LABELS,
  type OccurrenceCard,
} from '@life-book/core';
import { useMutation, useQuery } from '@tanstack/react-query';
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
import { api, todayQuery, useInvalidateRecords } from '../../lib/api';
import { useIsOnline } from '../../lib/online';

const openRecord = (id: string) =>
  router.push({ pathname: '/record/[id]', params: { id } });

export default function TodayScreen() {
  const today = useQuery(todayQuery);
  const online = useIsOnline();
  const data = today.data;

  return (
    <Screen
      refreshing={today.isRefetching}
      onRefresh={() => void today.refetch()}
      overlay={<Fab label="新建" onPress={() => router.push('/record/new')} />}
    >
      <Title caption={data === undefined ? ' ' : formatLocalDate(data.date)}>今天</Title>
      {online ? null : (
        <InfoBanner message="没有网络，显示的是上次同步的内容，暂时不能修改。" />
      )}
      {today.isError && data === undefined ? (
        <ErrorBanner message={describeError(today.error)} />
      ) : null}
      {today.isPending ? <InfoBanner message="正在加载…" /> : null}
      {data === undefined ? null : data.overdue.length === 0 &&
        data.today.length === 0 &&
        data.upcomingDates.length === 0 &&
        data.lowStock.length === 0 ? (
        <EmptyState
          title="今天没有需要处理的事"
          message="点右下角的“+”新建重复日常、重要日期、清单、备忘或家庭物品。"
        />
      ) : (
        <>
          {data.overdue.length === 0 ? null : (
            <Section title="逾期" hint="过去 30 天内没有处理的事">
              {data.overdue.map((card, index) =>
                card.kind === 'occurrence' ? (
                  <OccurrenceRow
                    key={`${card.recordId}:${card.originalDate}`}
                    card={card}
                    today={data.date}
                    first={index === 0}
                    readOnly={!online}
                  />
                ) : (
                  <ChecklistRow
                    key={card.recordId}
                    card={card}
                    today={data.date}
                    first={index === 0}
                  />
                ),
              )}
            </Section>
          )}
          <Section title="今天">
            {data.today.length === 0 ? (
              <Row first title="今天没有安排" />
            ) : (
              data.today.map((card, index) =>
                card.kind === 'occurrence' ? (
                  <OccurrenceRow
                    key={`${card.recordId}:${card.originalDate}`}
                    card={card}
                    today={data.date}
                    first={index === 0}
                    readOnly={!online}
                  />
                ) : card.kind === 'checklist' ? (
                  <ChecklistRow
                    key={card.recordId}
                    card={card}
                    today={data.date}
                    first={index === 0}
                  />
                ) : (
                  <Row
                    key={card.reminderId}
                    first={index === 0}
                    title={card.title}
                    subtitle={`${card.time} 提醒`}
                    onPress={() => openRecord(card.recordId)}
                    right={<Badge label="备忘" tone="info" />}
                  />
                ),
              )
            )}
          </Section>
          {data.upcomingDates.length === 0 ? null : (
            <Section title="近期重要日期" hint="未来 7 天">
              {data.upcomingDates.map((card, index) => (
                <Row
                  key={card.recordId}
                  first={index === 0}
                  title={card.title}
                  subtitle={[
                    describeLocalDate(card.date, data.date),
                    IMPORTANT_DATE_KIND_LABELS[card.dateKind],
                    describeCounter(card.dateKind, card.counter),
                  ]
                    .filter((part) => part !== null)
                    .join(' · ')}
                  onPress={() => openRecord(card.recordId)}
                  right={
                    <Badge
                      label={describeDaysUntil(card.daysUntil)}
                      tone={card.daysUntil === 0 ? 'warning' : 'neutral'}
                    />
                  }
                />
              ))}
            </Section>
          )}
          {data.lowStock.length === 0 ? null : (
            <Section title="家里要补">
              {data.lowStock.map((card, index) => (
                <LowStockRow
                  key={card.recordId}
                  card={card}
                  first={index === 0}
                  readOnly={!online}
                />
              ))}
            </Section>
          )}
        </>
      )}
    </Screen>
  );
}

function ChecklistRow({
  card,
  today,
  first,
}: {
  card: ChecklistCard;
  today: string;
  first: boolean;
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
      onPress={() => openRecord(card.recordId)}
      right={
        <Badge
          label={complete ? '已完成' : '清单'}
          tone={complete ? 'success' : 'info'}
        />
      }
    />
  );
}

function OccurrenceRow({
  card,
  today,
  first,
  readOnly,
}: {
  card: OccurrenceCard;
  today: string;
  first: boolean;
  readOnly: boolean;
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
      onPress={() => openRecord(card.recordId)}
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

function LowStockRow({
  card,
  first,
  readOnly,
}: {
  card: LowStockCard;
  first: boolean;
  readOnly: boolean;
}) {
  const invalidate = useInvalidateRecords();
  const shop = useMutation({
    mutationFn: () => api.household.addToShoppingList(card.recordId),
    onSettled: invalidate,
  });
  return (
    <Row
      first={first}
      title={card.title}
      subtitle={[
        `剩 ${card.quantity} ${card.unit}`,
        `最低 ${card.threshold}`,
        card.location,
      ]
        .filter((part) => part !== null)
        .join(' · ')}
      onPress={() => openRecord(card.recordId)}
      right={
        shop.isSuccess ? (
          <Badge
            label={shop.data.created ? '已加入采购' : '已在采购清单'}
            tone="success"
          />
        ) : (
          <SmallButton
            label="加入采购"
            disabled={readOnly || shop.isPending}
            onPress={() => shop.mutate()}
          />
        )
      }
    />
  );
}

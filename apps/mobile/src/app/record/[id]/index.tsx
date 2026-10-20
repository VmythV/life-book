import { describeError, queryKeys } from '@life-book/api-client';
import Ionicons from '@expo/vector-icons/Ionicons';
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
  describeTrashExpiry,
  recentOccurrences,
  STOCK_KIND_LABELS,
  todayIn,
  zonedDateTime,
} from '@life-book/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { RescheduleButtons } from '../../../components/reschedule';
import {
  Badge,
  BodyText,
  Button,
  Card,
  ErrorBanner,
  InfoBanner,
  Row,
  Screen,
  Section,
  SmallButton,
} from '../../../components/ui';
import {
  api,
  categoriesQuery,
  meQuery,
  occurrencesQuery,
  recordQuery,
  stockTransactionsQuery,
  tagsQuery,
  useInvalidateRecords,
} from '../../../lib/api';
import { useIsOnline } from '../../../lib/online';
import { useTheme } from '../../../lib/theme';

export default function RecordDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const record = useQuery(recordQuery(id));
  const me = useQuery(meQuery);

  return (
    <Screen
      edges={['left', 'right']}
      refreshing={record.isRefetching}
      onRefresh={() => void record.refetch()}
    >
      <Stack.Screen
        options={{
          title:
            record.data === undefined ? '详情' : RECORD_TYPE_LABELS[record.data.type],
        }}
      />
      {record.isError && record.data === undefined ? (
        <ErrorBanner message={describeError(record.error)} />
      ) : null}
      {record.data === undefined || me.data === undefined ? (
        record.isError ? null : (
          <BodyText muted>正在加载…</BodyText>
        )
      ) : (
        <RecordDetail record={record.data} timeZone={me.data.settings.timezone} />
      )}
    </Screen>
  );
}

function RecordDetail({ record, timeZone }: { record: LifeRecord; timeZone: string }) {
  const theme = useTheme();
  const today = todayIn(timeZone);
  const online = useIsOnline();
  const categories = useQuery(categoriesQuery);
  const tags = useQuery(tagsQuery);
  const category = categories.data?.items.find((item) => item.id === record.categoryId);
  const tagNames = record.tagIds.flatMap((tagId) => {
    const tag = tags.data?.items.find((item) => item.id === tagId);
    return tag === undefined ? [] : [tag.name];
  });

  return (
    <View style={styles.stack}>
      <View style={styles.badges}>
        {record.isPinned ? <Badge label="置顶" tone="warning" /> : null}
        {record.archivedAt !== null ? <Badge label="已归档" /> : null}
        {record.deletedAt === null ? null : (
          <Badge
            label={`在回收站，${describeTrashExpiry(record.deletedAt, new Date())}`}
            tone="danger"
          />
        )}
      </View>
      <Text
        accessibilityRole="header"
        style={[theme.type['type.title.2'], { color: theme.color.textPrimary }]}
      >
        {displayTitle(record)}
      </Text>
      {online ? null : <InfoBanner message="没有网络，暂时不能修改。" />}

      {record.recurring !== null ? (
        <DetailCard title="重复">
          <BodyText>{describeRecurrence(record.recurring)}</BodyText>
          <BodyText muted>
            <NextOccurrence record={record} today={today} />
          </BodyText>
        </DetailCard>
      ) : null}
      {record.recurring !== null && record.deletedAt === null ? (
        <RecentOccurrences recordId={record.id} today={today} readOnly={!online} />
      ) : null}

      {record.checklist !== null ? (
        <ChecklistSection
          record={record}
          today={today}
          timeZone={timeZone}
          readOnly={!online || record.deletedAt !== null}
        />
      ) : null}

      {record.householdItem !== null ? (
        <HouseholdSection
          record={record}
          timeZone={timeZone}
          readOnly={!online || record.deletedAt !== null}
        />
      ) : null}

      {record.importantDate !== null ? (
        <DetailCard title="日期">
          {(() => {
            const value = record.importantDate;
            const next = nextImportantDate(value, today);
            const counter = value.showCounter
              ? describeCounter(value.kind, next?.counter ?? null)
              : null;
            return (
              <>
                <BodyText>
                  {IMPORTANT_DATE_KIND_LABELS[value.kind]} ·{' '}
                  {value.repeat === 'yearly'
                    ? `每年 ${value.month} 月 ${value.day} 日`
                    : `${value.year ?? ''} 年 ${value.month} 月 ${value.day} 日`}
                </BodyText>
                <BodyText muted>
                  {next === null
                    ? '已过去'
                    : [
                        formatLocalDate(next.date, { withYear: true }),
                        describeDaysUntil(next.daysUntil),
                        counter,
                      ]
                        .filter((part) => part !== null)
                        .join(' · ')}
                </BodyText>
              </>
            );
          })()}
        </DetailCard>
      ) : null}

      {record.notes === null ? null : (
        <DetailCard title={record.type === 'memo' ? '内容' : '说明'}>
          <Text
            selectable
            style={[theme.type['type.body'], { color: theme.color.textPrimary }]}
          >
            {record.notes}
          </Text>
        </DetailCard>
      )}

      {record.type === 'household_item' ? null : (
        <DetailCard title="提醒">
          {record.reminders.length === 0 ? (
            <BodyText muted>没有设置提醒</BodyText>
          ) : (
            record.reminders.map((reminder) => (
              <BodyText key={reminder.id}>
                {describeReminder(reminder, timeZone)}
              </BodyText>
            ))
          )}
        </DetailCard>
      )}

      {category === undefined && tagNames.length === 0 ? null : (
        <DetailCard title="整理">
          <View style={styles.badges}>
            {category === undefined ? null : <Badge label={category.name} tone="info" />}
            {tagNames.map((name) => (
              <Badge key={name} label={`#${name}`} />
            ))}
          </View>
        </DetailCard>
      )}

      <RecordActions record={record} disabled={!online} />
    </View>
  );
}

function DetailCard({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <Card>
      <Text style={[theme.type['type.caption'], { color: theme.color.textTertiary }]}>
        {title}
      </Text>
      {children}
    </Card>
  );
}

type ActionKind =
  'pin' | 'archive' | 'unarchive' | 'remove' | 'restore' | 'purge' | 'template';

function RecordActions({ record, disabled }: { record: LifeRecord; disabled: boolean }) {
  const invalidate = useInvalidateRecords();
  const queryClient = useQueryClient();
  const action = useMutation({
    mutationFn: async (kind: ActionKind) => {
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
    onSuccess: (_result, kind) => {
      if (kind === 'template') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.templates });
        Alert.alert('已另存为模板', '新建清单时可以选择这个模板。');
      }
      if (kind === 'remove' || kind === 'purge') {
        router.back();
      }
    },
    onSettled: invalidate,
  });
  const busy = action.isPending || disabled;

  if (record.deletedAt !== null) {
    return (
      <View style={styles.stack}>
        {action.isError ? <ErrorBanner message={describeError(action.error)} /> : null}
        <Button label="恢复" disabled={busy} onPress={() => action.mutate('restore')} />
        <Button
          label="永久删除"
          variant="danger"
          disabled={busy}
          onPress={() =>
            Alert.alert('永久删除', '删除后无法恢复，确定吗？', [
              { text: '取消', style: 'cancel' },
              {
                text: '永久删除',
                style: 'destructive',
                onPress: () => action.mutate('purge'),
              },
            ])
          }
        />
      </View>
    );
  }
  return (
    <View style={styles.stack}>
      {action.isError ? <ErrorBanner message={describeError(action.error)} /> : null}
      <Button
        label="编辑"
        disabled={busy}
        onPress={() =>
          router.push({ pathname: '/record/[id]/edit', params: { id: record.id } })
        }
      />
      <View style={styles.actionRow}>
        <View style={styles.actionCell}>
          <Button
            label={record.isPinned ? '取消置顶' : '置顶'}
            variant="secondary"
            disabled={busy}
            onPress={() => action.mutate('pin')}
          />
        </View>
        <View style={styles.actionCell}>
          <Button
            label={record.archivedAt === null ? '归档' : '取消归档'}
            variant="secondary"
            disabled={busy}
            onPress={() =>
              action.mutate(record.archivedAt === null ? 'archive' : 'unarchive')
            }
          />
        </View>
      </View>
      {record.type === 'checklist' ? (
        <Button
          label="另存为模板"
          variant="secondary"
          disabled={busy}
          onPress={() => action.mutate('template')}
        />
      ) : null}
      <Button
        label="删除"
        variant="danger"
        disabled={busy}
        onPress={() =>
          Alert.alert('删除', '记录会移到回收站，可以恢复。', [
            { text: '取消', style: 'cancel' },
            {
              text: '删除',
              style: 'destructive',
              onPress: () => action.mutate('remove'),
            },
          ])
        }
      />
    </View>
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

function RecentOccurrences({
  recordId,
  today,
  readOnly,
}: {
  recordId: string;
  today: string;
  readOnly: boolean;
}) {
  const list = useQuery(
    occurrencesQuery(recordId, addDays(today, -14), addDays(today, 14)),
  );
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
    return null;
  }
  const busy = setStatus.isPending || readOnly;
  return (
    <Section title="最近">
      {setStatus.isError ? (
        <ErrorBanner message={describeError(setStatus.error)} />
      ) : null}
      {items.map((item, index) => {
        const handled = item.status === 'completed' || item.status === 'skipped';
        return (
          <Row
            key={item.originalDate}
            first={index === 0}
            title={describeLocalDate(item.date, today)}
            subtitle={[
              OCCURRENCE_LABELS[item.status],
              item.date === item.originalDate
                ? null
                : `原定 ${describeLocalDate(item.originalDate, today)}`,
            ]
              .filter((part) => part !== null)
              .join(' · ')}
            right={
              handled ? (
                <>
                  <Badge
                    label={OCCURRENCE_LABELS[item.status]}
                    tone={OCCURRENCE_TONES[item.status]}
                  />
                  <SmallButton
                    label="撤销"
                    variant="ghost"
                    disabled={busy}
                    onPress={() =>
                      setStatus.mutate({ date: item.originalDate, status: null })
                    }
                  />
                </>
              ) : (
                <>
                  <SmallButton
                    label="完成"
                    disabled={busy}
                    onPress={() =>
                      setStatus.mutate({ date: item.originalDate, status: 'completed' })
                    }
                  />
                  <SmallButton
                    label="跳过"
                    variant="ghost"
                    disabled={busy}
                    onPress={() =>
                      setStatus.mutate({ date: item.originalDate, status: 'skipped' })
                    }
                  />
                  <RescheduleButtons
                    recordId={recordId}
                    originalDate={item.originalDate}
                    date={item.date}
                    today={today}
                    disabled={busy}
                  />
                </>
              )
            }
          />
        );
      })}
    </Section>
  );
}

/** 清单：分组显示项目，点一下勾选，可以添加和删除。 */
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
  const theme = useTheme();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateRecords();
  const [title, setTitle] = useState('');
  const items = record.checklist?.items ?? [];
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
    mutationFn: () => api.checklistItems.create(record.id, { title }),
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

  if (record.checklist === null) {
    return null;
  }
  const due =
    record.checklist.dueAt === null
      ? null
      : zonedDateTime(new Date(record.checklist.dueAt), timeZone);

  return (
    <View style={styles.stack}>
      <View style={styles.badges}>
        <Badge
          label={
            progress.total === 0
              ? '还没有项目'
              : progress.isComplete
                ? '已全部完成'
                : `${progress.done}/${progress.total}`
          }
          tone={progress.isComplete ? 'success' : 'neutral'}
        />
        <Badge label={CHECKLIST_PURPOSE_LABELS[record.checklist.purpose]} />
        {due === null ? null : (
          <Badge
            label={`截止 ${describeLocalDate(due.date, today)} ${due.time}`}
            tone="info"
          />
        )}
      </View>
      {error === null ? null : <ErrorBanner message={describeError(error)} />}
      {groupChecklistItems(items).map((group) => (
        <Section key={group.name ?? ''} title={group.name ?? '项目'}>
          {group.items.map((item, index) => {
            const quantity = describeQuantity(item.quantity, item.unit);
            return (
              <View
                key={item.id}
                style={[
                  styles.itemRow,
                  index === 0
                    ? null
                    : {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: theme.color.borderDefault,
                      },
                ]}
              >
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: item.isDone, disabled: readOnly }}
                  accessibilityLabel={item.title}
                  disabled={readOnly}
                  onPress={() => toggle.mutate(item)}
                  style={styles.itemMain}
                >
                  <Ionicons
                    name={item.isDone ? 'checkbox' : 'square-outline'}
                    size={24}
                    color={
                      item.isDone ? theme.color.actionPrimary : theme.color.textTertiary
                    }
                  />
                  <Text
                    style={[
                      theme.type['type.body'],
                      styles.itemTitle,
                      {
                        color: item.isDone
                          ? theme.color.textTertiary
                          : theme.color.textPrimary,
                        textDecorationLine: item.isDone ? 'line-through' : 'none',
                      },
                    ]}
                  >
                    {item.title}
                    {quantity === null ? '' : `  ${quantity}`}
                  </Text>
                </Pressable>
                {readOnly ? null : (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`编辑 ${item.title}`}
                      hitSlop={8}
                      onPress={() =>
                        router.push({
                          pathname: '/record/[id]/item/[itemId]',
                          params: { id: record.id, itemId: item.id },
                        })
                      }
                    >
                      <Ionicons
                        name="create-outline"
                        size={20}
                        color={theme.color.textTertiary}
                      />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`删除 ${item.title}`}
                      hitSlop={8}
                      onPress={() => remove.mutate(item.id)}
                    >
                      <Ionicons name="close" size={20} color={theme.color.textTertiary} />
                    </Pressable>
                  </>
                )}
              </View>
            );
          })}
        </Section>
      ))}
      {readOnly ? null : (
        <>
          <View style={styles.addRow}>
            <TextInput
              accessibilityLabel="新项目"
              placeholder="添加项目"
              placeholderTextColor={theme.color.textTertiary}
              value={title}
              maxLength={200}
              returnKeyType="done"
              onChangeText={setTitle}
              onSubmitEditing={() => {
                if (title.trim() !== '') {
                  add.mutate();
                }
              }}
              style={[
                theme.type['type.body'],
                styles.addInput,
                {
                  color: theme.color.textPrimary,
                  borderColor: theme.color.borderDefault,
                  backgroundColor: theme.color.surface,
                },
              ]}
            />
            <SmallButton
              label="添加"
              variant="primary"
              disabled={add.isPending || title.trim() === ''}
              onPress={() => add.mutate()}
            />
          </View>
          {progress.total === 0 ? null : (
            <SmallButton
              label={progress.isComplete ? '全部取消勾选' : '全部完成'}
              disabled={completeAll.isPending}
              onPress={() => completeAll.mutate(!progress.isComplete)}
            />
          )}
        </>
      )}
    </View>
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
  const theme = useTheme();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateRecords();
  const [amount, setAmount] = useState('1');
  const [target, setTarget] = useState('');
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
    onSuccess: () => setTarget(''),
    onSettled: refresh,
  });
  const shop = useMutation({
    mutationFn: () => api.household.addToShoppingList(record.id),
    onSuccess: (result) =>
      Alert.alert(result.created ? '已加入采购清单' : '已经在采购清单里', undefined, [
        { text: '好', style: 'cancel' },
        {
          text: '查看清单',
          onPress: () =>
            router.push({ pathname: '/record/[id]', params: { id: result.checklistId } }),
        },
      ]),
    onSettled: invalidate,
  });
  const error = move.error ?? shop.error;
  const item = record.householdItem;
  if (item === null) {
    return null;
  }
  const inputStyle = [
    theme.type['type.body'],
    styles.amountInput,
    {
      color: theme.color.textPrimary,
      borderColor: theme.color.borderDefault,
      backgroundColor: theme.color.surface,
    },
  ];

  return (
    <Card>
      <Text style={[theme.type['type.caption'], { color: theme.color.textTertiary }]}>
        库存
      </Text>
      <View style={styles.quantityRow}>
        <Text style={[theme.type['type.display'], { color: theme.color.textPrimary }]}>
          {item.quantity}
        </Text>
        <BodyText muted>{item.unit}</BodyText>
        {item.isLowStock ? <Badge label="低库存" tone="warning" /> : null}
      </View>
      <BodyText muted>
        {[
          item.lowStockThreshold === null
            ? '没有设置最低库存'
            : `最低 ${item.lowStockThreshold}`,
          item.location,
        ]
          .filter((part) => part !== null)
          .join(' · ')}
      </BodyText>
      {error === null ? null : <ErrorBanner message={describeError(error)} />}
      {readOnly ? null : (
        <>
          <View style={styles.addRow}>
            <TextInput
              accessibilityLabel="数量"
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
              style={inputStyle}
            />
            <BodyText muted>{item.unit}</BodyText>
          </View>
          <View style={styles.badges}>
            {STOCK_ACTIONS.map((kind) => (
              <SmallButton
                key={kind}
                label={STOCK_KIND_LABELS[kind]}
                variant={
                  kind === 'purchase' || kind === 'consume' ? 'secondary' : 'ghost'
                }
                disabled={move.isPending}
                onPress={() => move.mutate(kind)}
              />
            ))}
          </View>
          <View style={styles.addRow}>
            <TextInput
              accessibilityLabel="调整为"
              keyboardType="decimal-pad"
              placeholder="实际数量"
              placeholderTextColor={theme.color.textTertiary}
              value={target}
              onChangeText={setTarget}
              style={inputStyle}
            />
            <SmallButton
              label="调整为实际数量"
              variant="ghost"
              disabled={move.isPending || target.trim() === ''}
              onPress={() => move.mutate('adjust')}
            />
          </View>
          <SmallButton
            label="加入采购清单"
            disabled={shop.isPending}
            onPress={() => shop.mutate()}
          />
        </>
      )}
      {(transactions.data?.items ?? []).slice(0, 5).map((transaction) => {
        const when = zonedDateTime(new Date(transaction.occurredAt), timeZone);
        return (
          <View key={transaction.id} style={styles.historyRow}>
            <BodyText bold>{STOCK_KIND_LABELS[transaction.kind]}</BodyText>
            <Text
              style={[
                theme.type['type.body'],
                {
                  color:
                    transaction.delta < 0
                      ? theme.color.stateDangerForeground
                      : theme.color.stateSuccessForeground,
                },
              ]}
            >
              {transaction.delta > 0 ? '+' : ''}
              {transaction.delta} → {transaction.quantityAfter}
            </Text>
            <Text
              style={[
                theme.type['type.caption'],
                styles.historyTime,
                { color: theme.color.textTertiary },
              ]}
            >
              {formatLocalDate(when.date)} {when.time}
            </Text>
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  actionRow: { flexDirection: 'row', gap: 12 },
  actionCell: { flex: 1 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  itemMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemTitle: { flex: 1 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  quantityRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  amountInput: {
    width: 110,
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
  },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  historyTime: { marginLeft: 'auto' },
  addInput: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
});

/** “下次：……”：服务端已按改期和处理状态算好。 */
function NextOccurrence({ record, today }: { record: LifeRecord; today: string }) {
  if (record.recurring === null) {
    return null;
  }
  const next = record.nextOccurrenceDate;
  return <>{next === null ? '已结束' : `下次：${describeLocalDate(next, today)}`}</>;
}

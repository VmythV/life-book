import { describeError } from '@life-book/api-client';
import {
  CALENDAR_BLOCK_MINUTES,
  CALENDAR_VIEW_LABELS,
  type CalendarItem,
  type CalendarView,
  calendarItemKey,
  calendarItemRecordType,
  calendarItemTime,
  calendarRange,
  calendarViews,
  DEFAULT_TIME_ZONE,
  datesBetween,
  describeCalendarRange,
  describeCounter,
  formatLocalDate,
  groupCalendarItems,
  IMPORTANT_DATE_KIND_LABELS,
  isHandledCalendarItem,
  isPastCalendarItem,
  layoutTimedItems,
  type LocalDate,
  makeLocalDate,
  minutesOfDay,
  parseLocalDate,
  RECORD_TYPE_LABELS,
  shiftCalendarAnchor,
  WEEKDAY_HEADERS,
  weekdayOf,
  zonedDateTime,
} from '@life-book/core';
import { type LifeBookTheme } from '@life-book/design-tokens';
import Ionicons from '@expo/vector-icons/Ionicons';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChecklistRow, OccurrenceRow, openRecord } from '../../components/agenda';
import {
  Badge,
  Button,
  ErrorBanner,
  Fab,
  InfoBanner,
  Row,
  Screen,
  SmallButton,
  Title,
} from '../../components/ui';
import { calendarQuery, meQuery } from '../../lib/api';
import { useIsOnline } from '../../lib/online';
import { useTheme } from '../../lib/theme';

const STEP_LABELS: Record<CalendarView, [string, string]> = {
  day: ['前一天', '后一天'],
  week: ['上一周', '下一周'],
  month: ['上个月', '下个月'],
};

/** 时间轴上一小时的高度和左侧时刻栏的宽度。 */
const HOUR_HEIGHT = 44;
const GUTTER = 44;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** 用户时区的当前日期和时刻，每 30 秒更新一次。 */
function useNow(timeZone: string): { date: LocalDate; time: string } {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return zonedDateTime(now, timeZone);
}

/** “GMT+8”：时间轴左上角标明按哪个时区显示。 */
function offsetLabel(timeZone: string): string {
  try {
    return (
      new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
        .formatToParts(new Date())
        .find((part) => part.type === 'timeZoneName')?.value ?? ''
    );
  } catch {
    // 个别引擎不支持 shortOffset，不显示即可。
    return '';
  }
}

type SelectItem = (item: CalendarItem) => void;

export default function CalendarScreen() {
  const theme = useTheme();
  const online = useIsOnline();
  const me = useQuery(meQuery);
  const timeZone = me.data?.settings.timezone ?? DEFAULT_TIME_ZONE;
  const now = useNow(timeZone);
  const [view, setView] = useState<CalendarView>('month');
  // 没选过日期时跟着今天走，过了午夜自动换到新的一天。
  const [picked, setPicked] = useState<LocalDate | null>(null);
  const anchor = picked ?? now.date;
  const range = calendarRange(view, anchor);
  const calendar = useQuery({
    ...calendarQuery(range.from, range.to),
    // 翻页时先留着上一页，避免整块闪一下。
    placeholderData: keepPreviousData,
  });
  const today = calendar.data?.today ?? now.date;
  const items = useMemo(() => calendar.data?.items ?? [], [calendar.data]);
  const groups = useMemo(() => groupCalendarItems(items), [items]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // 完成、跳过后数据会刷新：按 key 找最新的那一项。
  const selected =
    selectedKey === null
      ? undefined
      : items.find((item) => calendarItemKey(item) === selectedKey);
  const [previousLabel, nextLabel] = STEP_LABELS[view];
  const openDay = (date: LocalDate) => {
    setView('day');
    setPicked(date);
  };
  const pickDate = () => {
    const { year, month, day } = parseLocalDate(anchor);
    DateTimePickerAndroid.open({
      value: new Date(year, month - 1, day),
      mode: 'date',
      onValueChange: (_event: unknown, date: Date) =>
        setPicked(makeLocalDate(date.getFullYear(), date.getMonth() + 1, date.getDate())),
    });
  };
  const titleText = describeCalendarRange(view, anchor, today);
  const titleColor =
    view === 'day' && anchor === today
      ? theme.color.actionPrimary
      : theme.color.textPrimary;

  return (
    <Screen
      refreshing={calendar.isRefetching}
      onRefresh={() => void calendar.refetch()}
      overlay={<Fab label="新建" onPress={() => router.push('/record/new')} />}
    >
      <View style={styles.header}>
        <Title>日历</Title>
        <View
          accessibilityRole="tablist"
          style={[styles.segments, { borderColor: theme.color.borderDefault }]}
        >
          {calendarViews.map((option) => {
            const isSelected = option === view;
            return (
              <Pressable
                key={option}
                accessibilityRole="tab"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`按${CALENDAR_VIEW_LABELS[option]}查看`}
                onPress={() => setView(option)}
                style={[
                  styles.segment,
                  isSelected
                    ? { backgroundColor: theme.color.stateSuccessContainer }
                    : null,
                ]}
              >
                <Text
                  style={[
                    theme.type['type.label'],
                    {
                      color: isSelected
                        ? theme.color.actionPrimary
                        : theme.color.textSecondary,
                    },
                  ]}
                >
                  {CALENDAR_VIEW_LABELS[option]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {online ? null : (
        <InfoBanner message="没有网络，显示的是上次同步的内容，暂时不能修改。" />
      )}

      <View style={styles.toolbar}>
        <SmallButton label="今天" onPress={() => setPicked(null)} />
        <StepButton
          label={previousLabel}
          icon="chevron-back"
          onPress={() => setPicked(shiftCalendarAnchor(view, anchor, -1))}
        />
        <StepButton
          label={nextLabel}
          icon="chevron-forward"
          onPress={() => setPicked(shiftCalendarAnchor(view, anchor, 1))}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${titleText}，选择日期`}
          disabled={Platform.OS !== 'android'}
          onPress={pickDate}
          style={styles.rangeTitle}
        >
          <Text
            numberOfLines={1}
            style={[
              theme.type['type.label.large'],
              styles.rangeText,
              { color: titleColor },
            ]}
          >
            {titleText}
          </Text>
          {Platform.OS === 'android' ? (
            <Ionicons name="chevron-down" size={14} color={theme.color.textSecondary} />
          ) : null}
        </Pressable>
      </View>

      {calendar.isError && calendar.data === undefined ? (
        <ErrorBanner message={describeError(calendar.error)} />
      ) : null}

      {view === 'month' ? (
        <MonthGrid
          dates={datesBetween(range.from, range.to)}
          month={parseLocalDate(anchor).month}
          today={today}
          nowTime={now.time}
          groups={groups}
          onOpenDay={openDay}
        />
      ) : (
        <TimeGrid
          dates={datesBetween(range.from, range.to)}
          today={today}
          nowTime={now.time}
          timeZone={timeZone}
          groups={groups}
          onOpenDay={view === 'week' ? openDay : null}
          onSelect={(item) => setSelectedKey(calendarItemKey(item))}
        />
      )}

      {selected === undefined ? null : (
        <ItemSheet
          item={selected}
          today={today}
          readOnly={!online}
          onClose={() => setSelectedKey(null)}
        />
      )}
    </Screen>
  );
}

function StepButton({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: 'chevron-back' | 'chevron-forward';
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.stepButton,
        pressed ? { backgroundColor: theme.color.surfaceSubtle } : null,
      ]}
    >
      <Ionicons name={icon} size={20} color={theme.color.textSecondary} />
    </Pressable>
  );
}

// ---- 事项的颜色 ----

const isOverdue = (item: CalendarItem) =>
  item.kind === 'occurrence' && item.status === 'overdue';

/** 事项的前景色和底色：按类型区分，逾期的标红。 */
function itemColors(item: CalendarItem, theme: LifeBookTheme): [string, string] {
  if (isOverdue(item)) {
    return [theme.color.stateDangerForeground, theme.color.stateDangerContainer];
  }
  switch (item.kind) {
    case 'occurrence':
      return [theme.color.stateInfoForeground, theme.color.stateInfoContainer];
    case 'important_date':
      return [theme.color.stateWarningForeground, theme.color.stateWarningContainer];
    case 'checklist':
      return [theme.color.stateSuccessForeground, theme.color.stateSuccessContainer];
    case 'memo_reminder':
      return [theme.color.textSecondary, theme.color.surfaceSubtle];
  }
}

function itemLabel(item: CalendarItem): string {
  return [
    item.title,
    calendarItemTime(item) ?? '全天',
    RECORD_TYPE_LABELS[calendarItemRecordType(item)],
    isOverdue(item) ? '逾期' : null,
    isHandledCalendarItem(item) ? '已处理' : null,
  ]
    .filter((part) => part !== null)
    .join('，');
}

/** 小色块：月视图的事项、时间轴上的全天事项。已经过去的变淡，已处理的划掉。 */
function ItemChip({
  item,
  today,
  nowTime,
  onPress,
}: {
  item: CalendarItem;
  today: LocalDate;
  nowTime: string;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const [foreground, background] = itemColors(item, theme);
  const content = (
    <Text
      numberOfLines={1}
      style={[
        styles.chipText,
        {
          color: foreground,
          textDecorationLine: isHandledCalendarItem(item) ? 'line-through' : 'none',
        },
      ]}
    >
      {item.title}
    </Text>
  );
  const style = [
    styles.chip,
    {
      backgroundColor: background,
      borderLeftColor: foreground,
      opacity: isPastCalendarItem(item, today, nowTime) ? 0.55 : 1,
    },
  ];
  return onPress === undefined ? (
    <View style={style}>{content}</View>
  ) : (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={itemLabel(item)}
      onPress={onPress}
      style={style}
    >
      {content}
    </Pressable>
  );
}

// ---- 月视图 ----

/** 格子太窄，点一天直接进入日视图，在那里看和操作每一项。 */
function MonthGrid({
  dates,
  month,
  today,
  nowTime,
  groups,
  onOpenDay,
}: {
  dates: LocalDate[];
  month: number;
  today: LocalDate;
  nowTime: string;
  groups: ReadonlyMap<LocalDate, CalendarItem[]>;
  onOpenDay: (date: LocalDate) => void;
}) {
  const theme = useTheme();
  const visibleLimit = 3;
  const todayWeekday = dates.includes(today) ? weekdayOf(today) : null;
  const weeks: LocalDate[][] = [];
  for (let index = 0; index < dates.length; index += 7) {
    weeks.push(dates.slice(index, index + 7));
  }

  return (
    <View
      style={[
        styles.grid,
        { backgroundColor: theme.color.surface, borderColor: theme.color.borderDefault },
      ]}
    >
      <View style={styles.week}>
        {WEEKDAY_HEADERS.map((weekday, index) => (
          <Text
            key={weekday}
            importantForAccessibility="no"
            style={[
              theme.type['type.caption'],
              styles.weekday,
              {
                color:
                  todayWeekday === index + 1
                    ? theme.color.actionPrimary
                    : theme.color.textSecondary,
              },
            ]}
          >
            {weekday}
          </Text>
        ))}
      </View>
      {weeks.map((week) => (
        <View
          key={week[0]}
          style={[
            styles.week,
            styles.monthRow,
            { borderTopColor: theme.color.borderDefault },
          ]}
        >
          {week.map((date) => {
            const dayItems = groups.get(date) ?? [];
            const { month: dateMonth, day } = parseLocalDate(date);
            const isToday = date === today;
            return (
              <Pressable
                key={date}
                accessibilityRole="button"
                accessibilityLabel={[
                  formatLocalDate(date),
                  isToday ? '今天' : null,
                  dayItems.length === 0 ? '没有安排' : `${dayItems.length} 项`,
                  '按日查看',
                ]
                  .filter((part) => part !== null)
                  .join('，')}
                onPress={() => onOpenDay(date)}
                style={({ pressed }) => [
                  styles.monthCell,
                  isToday || pressed
                    ? { backgroundColor: theme.color.surfaceSubtle }
                    : null,
                ]}
              >
                <View
                  style={[
                    styles.dayNumber,
                    isToday ? { backgroundColor: theme.color.actionPrimary } : null,
                  ]}
                >
                  <Text
                    style={[
                      theme.type['type.label'],
                      {
                        color: isToday
                          ? theme.color.actionOnPrimary
                          : dateMonth !== month
                            ? theme.color.textTertiary
                            : theme.color.textPrimary,
                      },
                    ]}
                  >
                    {day}
                  </Text>
                </View>
                {dayItems.slice(0, visibleLimit).map((item) => (
                  <ItemChip
                    key={calendarItemKey(item)}
                    item={item}
                    today={today}
                    nowTime={nowTime}
                  />
                ))}
                {dayItems.length > visibleLimit ? (
                  <Text style={[styles.more, { color: theme.color.textSecondary }]}>
                    +{dayItems.length - visibleLimit}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ---- 日视图和周视图的时间轴 ----

function TimeGrid({
  dates,
  today,
  nowTime,
  timeZone,
  groups,
  onOpenDay,
  onSelect,
}: {
  dates: LocalDate[];
  today: LocalDate;
  nowTime: string;
  timeZone: string;
  groups: ReadonlyMap<LocalDate, CalendarItem[]>;
  /** 周视图点日期标题进入日视图；日视图为 `null`。 */
  onOpenDay: ((date: LocalDate) => void) | null;
  onSelect: SelectItem;
}) {
  const theme = useTheme();
  const { height } = useWindowDimensions();
  const scroller = useRef<ScrollView>(null);
  const todayIndex = dates.indexOf(today);
  const nowMinutes = minutesOfDay(nowTime);
  const allDay = dates.map((date) =>
    (groups.get(date) ?? []).filter((item) => calendarItemTime(item) === null),
  );
  const showAllDay = onOpenDay === null || allDay.some((list) => list.length > 0);
  // 只在翻页或切换视图时滚动一次，数据刷新时保持用户自己滚到的位置。
  const rangeKey = `${dates[0]}:${dates.length}`;
  const scrolledFor = useRef<string | null>(null);

  // 滚到现在之前两个多小时；不含今天时滚到最早的事项，没有事项就从 7 点开始。
  useEffect(() => {
    if (scroller.current === null || scrolledFor.current === rangeKey) {
      return;
    }
    scrolledFor.current = rangeKey;
    let minutes = 7 * 60;
    if (todayIndex !== -1) {
      minutes = nowMinutes - 150;
    } else {
      const times = dates.flatMap((date) =>
        (groups.get(date) ?? []).flatMap((item) => {
          const time = calendarItemTime(item);
          return time === null ? [] : [minutesOfDay(time)];
        }),
      );
      if (times.length > 0) {
        minutes = Math.min(minutes, Math.min(...times) - 60);
      }
    }
    scroller.current.scrollTo({
      y: Math.max(0, (minutes / 60) * HOUR_HEIGHT),
      animated: false,
    });
  }, [rangeKey, todayIndex, nowMinutes, dates, groups]);

  const border = { borderColor: theme.color.borderDefault };
  return (
    <View
      style={[
        styles.grid,
        styles.timeGrid,
        { backgroundColor: theme.color.surface },
        border,
      ]}
    >
      <View style={[styles.week, styles.gridHeader, border]}>
        <View style={styles.gutterHeader}>
          <Text style={[styles.tiny, { color: theme.color.textTertiary }]}>
            {offsetLabel(timeZone)}
          </Text>
        </View>
        {dates.map((date, index) => {
          const isToday = date === today;
          const color = isToday
            ? theme.color.actionPrimary
            : date < today
              ? theme.color.textTertiary
              : theme.color.textPrimary;
          return (
            <View key={date} style={[styles.dayHeader, border]}>
              {onOpenDay === null ? null : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${formatLocalDate(date)}${isToday ? '，今天' : ''}，按日查看`}
                  onPress={() => onOpenDay(date)}
                  style={styles.dayHeaderButton}
                >
                  <Text style={[theme.type['type.caption'], { color }]}>
                    {WEEKDAY_HEADERS[weekdayOf(date) - 1]}
                  </Text>
                  <Text style={[theme.type['type.title.3'], { color }]}>
                    {parseLocalDate(date).day}
                  </Text>
                </Pressable>
              )}
              {showAllDay ? (
                <View style={styles.allDay}>
                  {(allDay[index] ?? []).map((item) => (
                    <ItemChip
                      key={calendarItemKey(item)}
                      item={item}
                      today={today}
                      nowTime={nowTime}
                      onPress={() => onSelect(item)}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>

      <ScrollView
        ref={scroller}
        nestedScrollEnabled
        style={{ height: Math.max(320, height - 330) }}
      >
        <View style={[styles.week, { height: 24 * HOUR_HEIGHT }]}>
          <View style={{ width: GUTTER }}>
            {HOURS.slice(1).map((hour) =>
              // 离现在不到一刻钟的整点让给现在的时刻，免得叠在一起。
              todayIndex !== -1 && Math.abs(hour * 60 - nowMinutes) < 15 ? null : (
                <Text
                  key={hour}
                  style={[
                    styles.hourLabel,
                    { top: hour * HOUR_HEIGHT - 7, color: theme.color.textTertiary },
                  ]}
                >
                  {String(hour).padStart(2, '0')}:00
                </Text>
              ),
            )}
            {todayIndex === -1 ? null : (
              <Text
                style={[
                  styles.hourLabel,
                  {
                    top: (nowMinutes / 60) * HOUR_HEIGHT - 7,
                    color: theme.color.stateDangerForeground,
                    fontWeight: '600',
                  },
                ]}
              >
                {nowTime}
              </Text>
            )}
          </View>
          {dates.map((date, index) => (
            <DayColumn
              key={date}
              today={today}
              nowTime={nowTime}
              items={groups.get(date) ?? []}
              // 现在的红线：今天之前的几天变淡，今天及以后是实线，今天那一列起点有圆点。
              nowLine={
                todayIndex === -1
                  ? null
                  : index < todayIndex
                    ? 'past'
                    : index === todayIndex
                      ? 'today'
                      : 'future'
              }
              onSelect={onSelect}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function DayColumn({
  today,
  nowTime,
  items,
  nowLine,
  onSelect,
}: {
  today: LocalDate;
  nowTime: string;
  items: CalendarItem[];
  nowLine: 'past' | 'today' | 'future' | null;
  onSelect: SelectItem;
}) {
  const theme = useTheme();
  const blocks = layoutTimedItems(items);
  const nowTop = (minutesOfDay(nowTime) / 60) * HOUR_HEIGHT;
  return (
    <View style={[styles.column, { borderLeftColor: theme.color.borderDefault }]}>
      {HOURS.slice(1).map((hour) => (
        <View
          key={hour}
          style={[
            styles.hourLine,
            { top: hour * HOUR_HEIGHT, backgroundColor: theme.color.borderDefault },
          ]}
        />
      ))}
      {blocks.map(({ item, start, column, columns }) => {
        const [foreground, background] = itemColors(item, theme);
        return (
          <Pressable
            key={calendarItemKey(item)}
            accessibilityRole="button"
            accessibilityLabel={itemLabel(item)}
            onPress={() => onSelect(item)}
            style={[
              styles.block,
              {
                top: (start / 60) * HOUR_HEIGHT + 1,
                height: (CALENDAR_BLOCK_MINUTES / 60) * HOUR_HEIGHT - 2,
                left: `${(column / columns) * 100}%`,
                width: `${100 / columns}%`,
              },
            ]}
          >
            <View
              style={[
                styles.blockInner,
                {
                  backgroundColor: background,
                  borderLeftColor: foreground,
                  opacity: isPastCalendarItem(item, today, nowTime) ? 0.55 : 1,
                },
              ]}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.blockText,
                  {
                    color: foreground,
                    textDecorationLine: isHandledCalendarItem(item)
                      ? 'line-through'
                      : 'none',
                  },
                ]}
              >
                {item.title}
              </Text>
            </View>
          </Pressable>
        );
      })}
      {nowLine === null ? null : (
        <View
          pointerEvents="none"
          accessibilityLabel={nowLine === 'today' ? `现在 ${nowTime}` : undefined}
          style={[
            styles.nowLine,
            {
              top: nowTop - (nowLine === 'past' ? 0.5 : 1),
              height: nowLine === 'past' ? 1 : 2,
              backgroundColor: theme.color.stateDangerForeground,
              opacity: nowLine === 'past' ? 0.3 : 1,
            },
          ]}
        />
      )}
      {nowLine === 'today' ? (
        <View
          pointerEvents="none"
          style={[
            styles.nowDot,
            { top: nowTop - 5, backgroundColor: theme.color.stateDangerForeground },
          ]}
        />
      ) : null}
    </View>
  );
}

// ---- 点中事项后从底部弹出的卡片 ----

function ItemSheet({
  item,
  today,
  readOnly,
  onClose,
}: {
  item: CalendarItem;
  today: LocalDate;
  readOnly: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // 先关掉卡片再打开详情，否则卡片会盖在详情页上面。
  const open = (id: string) => {
    onClose();
    openRecord(id);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="关闭"
        onPress={onClose}
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.color.overlayScrim }]}
      />
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: theme.color.surfaceRaised,
            paddingBottom: 16 + insets.bottom,
          },
        ]}
      >
        <View style={styles.sheetHeader}>
          <Text
            style={[theme.type['type.caption'], { color: theme.color.textSecondary }]}
          >
            {formatLocalDate(item.date)} ·{' '}
            {RECORD_TYPE_LABELS[calendarItemRecordType(item)]}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭"
            onPress={onClose}
            hitSlop={10}
          >
            <Ionicons name="close" size={22} color={theme.color.textSecondary} />
          </Pressable>
        </View>
        <View style={[styles.sheetBody, { borderColor: theme.color.borderDefault }]}>
          <SheetRow item={item} today={today} readOnly={readOnly} onOpen={open} />
        </View>
        <Button
          label="查看详情"
          variant="secondary"
          onPress={() => open(item.recordId)}
        />
      </View>
    </Modal>
  );
}

function SheetRow({
  item,
  today,
  readOnly,
  onOpen,
}: {
  item: CalendarItem;
  today: LocalDate;
  readOnly: boolean;
  onOpen: (id: string) => void;
}) {
  switch (item.kind) {
    case 'occurrence':
      return (
        <OccurrenceRow
          card={item}
          today={today}
          first
          readOnly={readOnly}
          onOpen={onOpen}
        />
      );
    case 'checklist':
      return <ChecklistRow card={item} today={today} first onOpen={onOpen} />;
    case 'memo_reminder':
      return (
        <Row
          first
          title={item.title}
          subtitle={`${item.time} 提醒`}
          onPress={() => onOpen(item.recordId)}
          right={<Badge label="备忘" tone="info" />}
        />
      );
    case 'important_date':
      return (
        <Row
          first
          title={item.title}
          subtitle={[
            '全天',
            IMPORTANT_DATE_KIND_LABELS[item.dateKind],
            describeCounter(item.dateKind, item.counter),
          ]
            .filter((part) => part !== null)
            .join(' · ')}
          onPress={() => onOpen(item.recordId)}
          right={<Badge label="重要日期" tone="warning" />}
        />
      );
  }
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  segments: { flexDirection: 'row', borderWidth: 1, borderRadius: 12, padding: 2 },
  segment: {
    minHeight: 34,
    minWidth: 46,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: -8 },
  stepButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rangeTitle: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: 4,
  },
  rangeText: { flexShrink: 1 },
  grid: { borderWidth: 1, borderRadius: 16, overflow: 'hidden', marginTop: -8 },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', paddingVertical: 6 },
  monthRow: { borderTopWidth: StyleSheet.hairlineWidth },
  monthCell: { flex: 1, minHeight: 84, padding: 2, gap: 2, overflow: 'hidden' },
  dayNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  chip: { borderLeftWidth: 2, borderRadius: 3, paddingHorizontal: 2, paddingVertical: 1 },
  chipText: { fontSize: 10, lineHeight: 13, fontWeight: '600' },
  more: { fontSize: 10, lineHeight: 12, paddingLeft: 2 },
  timeGrid: { paddingBottom: 0 },
  gridHeader: { borderBottomWidth: StyleSheet.hairlineWidth },
  gutterHeader: { width: GUTTER, justifyContent: 'flex-end', paddingBottom: 4 },
  tiny: { fontSize: 9, textAlign: 'center' },
  dayHeader: {
    flex: 1,
    minWidth: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 1,
    paddingTop: 6,
    paddingBottom: 4,
    gap: 2,
  },
  dayHeaderButton: { alignItems: 'center' },
  allDay: { gap: 2, minHeight: 16 },
  hourLabel: {
    position: 'absolute',
    right: 4,
    fontSize: 10,
    lineHeight: 14,
    fontVariant: ['tabular-nums'],
  },
  column: { flex: 1, borderLeftWidth: StyleSheet.hairlineWidth },
  hourLine: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth },
  block: { position: 'absolute', paddingHorizontal: 1 },
  blockInner: {
    flex: 1,
    borderLeftWidth: 3,
    borderRadius: 4,
    paddingHorizontal: 3,
    justifyContent: 'center',
  },
  blockText: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
  nowLine: { position: 'absolute', left: 0, right: 0 },
  nowDot: { position: 'absolute', left: -5, width: 10, height: 10, borderRadius: 5 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
    paddingHorizontal: 16,
    gap: 12,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetBody: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
});

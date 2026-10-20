import { describeError } from '@life-book/api-client';
import {
  CALENDAR_VIEW_LABELS,
  type CalendarItem,
  type CalendarView,
  calendarItemKey,
  calendarItemTime,
  calendarRange,
  calendarViews,
  DEFAULT_TIME_ZONE,
  datesBetween,
  describeCalendarRange,
  describeCounter,
  describeLocalDate,
  formatLocalDate,
  groupCalendarItems,
  IMPORTANT_DATE_KIND_LABELS,
  type LocalDate,
  parseLocalDate,
  shiftCalendarAnchor,
  WEEKDAY_HEADERS,
  zonedDateTime,
} from '@life-book/core';
import Ionicons from '@expo/vector-icons/Ionicons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ChecklistRow, OccurrenceRow, openRecord } from '../../components/agenda';
import {
  Badge,
  ErrorBanner,
  Fab,
  InfoBanner,
  Row,
  Screen,
  Section,
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

/** 用户时区的当前日期和时刻，每 30 秒更新一次。 */
function useNow(timeZone: string): { date: LocalDate; time: string } {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return zonedDateTime(now, timeZone);
}

export default function CalendarScreen() {
  const theme = useTheme();
  const online = useIsOnline();
  const me = useQuery(meQuery);
  const now = useNow(me.data?.settings.timezone ?? DEFAULT_TIME_ZONE);
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
  const groups = useMemo(
    () => groupCalendarItems(calendar.data?.items ?? []),
    [calendar.data],
  );
  const [previousLabel, nextLabel] = STEP_LABELS[view];

  return (
    <Screen
      refreshing={calendar.isRefetching}
      onRefresh={() => void calendar.refetch()}
      overlay={<Fab label="新建" onPress={() => router.push('/record/new')} />}
    >
      <Title caption={`现在 ${formatLocalDate(now.date)} ${now.time}`}>日历</Title>
      {online ? null : (
        <InfoBanner message="没有网络，显示的是上次同步的内容，暂时不能修改。" />
      )}

      <View
        accessibilityRole="tablist"
        style={[styles.segments, { borderColor: theme.color.borderDefault }]}
      >
        {calendarViews.map((option) => {
          const selected = option === view;
          return (
            <Pressable
              key={option}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={`按${CALENDAR_VIEW_LABELS[option]}查看`}
              onPress={() => setView(option)}
              style={[
                styles.segment,
                selected ? { backgroundColor: theme.color.actionPrimary } : null,
              ]}
            >
              <Text
                style={[
                  theme.type['type.label'],
                  {
                    color: selected
                      ? theme.color.actionOnPrimary
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

      <View style={styles.toolbar}>
        <StepButton
          label={previousLabel}
          icon="chevron-back"
          onPress={() => setPicked(shiftCalendarAnchor(view, anchor, -1))}
        />
        <Text
          accessibilityRole="header"
          style={[
            theme.type['type.title.3'],
            styles.rangeTitle,
            { color: theme.color.textPrimary },
          ]}
        >
          {describeCalendarRange(view, anchor)}
        </Text>
        <StepButton
          label={nextLabel}
          icon="chevron-forward"
          onPress={() => setPicked(shiftCalendarAnchor(view, anchor, 1))}
        />
        <SmallButton
          label="回到今天"
          disabled={anchor === today}
          onPress={() => setPicked(null)}
        />
      </View>

      {calendar.isError && calendar.data === undefined ? (
        <ErrorBanner message={describeError(calendar.error)} />
      ) : null}

      {view === 'day' ? null : (
        <DayGrid
          dates={datesBetween(range.from, range.to)}
          month={view === 'month' ? parseLocalDate(anchor).month : null}
          selected={anchor}
          today={today}
          groups={groups}
          onSelect={setPicked}
        />
      )}

      <DayAgenda
        date={anchor}
        today={today}
        nowTime={now.time}
        items={groups.get(anchor) ?? []}
        loading={calendar.isPending}
        readOnly={!online}
      />
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
      hitSlop={8}
      style={({ pressed }) => [
        styles.stepButton,
        pressed ? { backgroundColor: theme.color.surfaceSubtle } : null,
      ]}
    >
      <Ionicons name={icon} size={20} color={theme.color.textSecondary} />
    </Pressable>
  );
}

/** 月视图和周视图的格子：有事项的日期下面有圆点，点一天在下面显示当天的事项。 */
function DayGrid({
  dates,
  month,
  selected,
  today,
  groups,
  onSelect,
}: {
  dates: LocalDate[];
  /** 月视图要突出的月份；不在这个月的日期显示得淡一些。周视图为 `null`。 */
  month: number | null;
  selected: LocalDate;
  today: LocalDate;
  groups: ReadonlyMap<LocalDate, CalendarItem[]>;
  onSelect: (date: LocalDate) => void;
}) {
  const theme = useTheme();
  const dotColor = (item: CalendarItem) => {
    if (item.kind === 'occurrence' && item.status === 'overdue') {
      return theme.color.stateDangerForeground;
    }
    switch (item.kind) {
      case 'occurrence':
        return theme.color.stateInfoForeground;
      case 'important_date':
        return theme.color.stateWarningForeground;
      case 'checklist':
        return theme.color.stateSuccessForeground;
      case 'memo_reminder':
        return theme.color.textTertiary;
    }
  };
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
        {WEEKDAY_HEADERS.map((weekday) => (
          <Text
            key={weekday}
            importantForAccessibility="no"
            style={[
              theme.type['type.caption'],
              styles.weekday,
              { color: theme.color.textSecondary },
            ]}
          >
            {weekday}
          </Text>
        ))}
      </View>
      {weeks.map((week) => (
        <View key={week[0]} style={styles.week}>
          {week.map((date) => {
            const items = groups.get(date) ?? [];
            const { month: dateMonth, day } = parseLocalDate(date);
            const outside = month !== null && dateMonth !== month;
            const isToday = date === today;
            const isSelected = date === selected;
            return (
              <Pressable
                key={date}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={[
                  formatLocalDate(date),
                  isToday ? '今天' : null,
                  items.length === 0 ? '没有安排' : `${items.length} 项`,
                ]
                  .filter((part) => part !== null)
                  .join('，')}
                onPress={() => onSelect(date)}
                style={[
                  styles.day,
                  month === null ? styles.weekDay : null,
                  isSelected
                    ? { borderColor: theme.color.actionPrimary }
                    : { borderColor: 'transparent' },
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
                          : outside
                            ? theme.color.textTertiary
                            : theme.color.textPrimary,
                      },
                    ]}
                  >
                    {day}
                  </Text>
                </View>
                <View style={styles.dots}>
                  {items.slice(0, 4).map((item) => {
                    const done =
                      item.kind === 'occurrence' &&
                      (item.status === 'completed' || item.status === 'skipped');
                    return (
                      <View
                        key={calendarItemKey(item)}
                        style={[
                          styles.dot,
                          { backgroundColor: dotColor(item), opacity: done ? 0.35 : 1 },
                        ]}
                      />
                    );
                  })}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/** 某一天的事项，可以直接完成或跳过；点一行看详情。今天的列表里标出现在的时刻。 */
function DayAgenda({
  date,
  today,
  nowTime,
  items,
  loading,
  readOnly,
}: {
  date: LocalDate;
  today: LocalDate;
  nowTime: string;
  items: CalendarItem[];
  loading: boolean;
  readOnly: boolean;
}) {
  const theme = useTheme();
  const title = formatLocalDate(date, {
    withYear: parseLocalDate(date).year !== parseLocalDate(today).year,
  });
  const relative = describeLocalDate(date, today);
  // 现在的时刻插在第一个还没到的定时事项前面；全天的事项总在前面。
  let nowIndex: number | null = null;
  if (date === today) {
    const index = items.findIndex((item) => {
      const time = calendarItemTime(item);
      return time !== null && time > nowTime;
    });
    nowIndex = index === -1 ? items.length : index;
  }
  const nowMarker = (
    <View
      key="now"
      accessibilityLabel={`现在 ${nowTime}`}
      style={[
        styles.nowMarker,
        nowIndex === 0
          ? null
          : {
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: theme.color.borderDefault,
            },
      ]}
    >
      <Text
        style={[
          theme.type['type.caption'],
          { color: theme.color.stateDangerForeground, fontWeight: '600' },
        ]}
      >
        现在 {nowTime}
      </Text>
      <View
        style={[styles.nowLine, { backgroundColor: theme.color.stateDangerForeground }]}
      />
    </View>
  );

  return (
    <Section title={title} {...(relative === title ? {} : { hint: relative })}>
      {items.length === 0 ? (
        <Row first title={loading ? '正在加载…' : '这一天没有安排'} />
      ) : null}
      {items.map((item, index) => (
        <Fragment key={calendarItemKey(item)}>
          {index === nowIndex ? nowMarker : null}
          <AgendaRow
            item={item}
            today={today}
            first={index === 0 && nowIndex !== 0}
            readOnly={readOnly}
          />
        </Fragment>
      ))}
      {items.length > 0 && nowIndex === items.length ? nowMarker : null}
    </Section>
  );
}

function AgendaRow({
  item,
  today,
  first,
  readOnly,
}: {
  item: CalendarItem;
  today: LocalDate;
  first: boolean;
  readOnly: boolean;
}) {
  switch (item.kind) {
    case 'occurrence':
      return (
        <OccurrenceRow card={item} today={today} first={first} readOnly={readOnly} />
      );
    case 'checklist':
      return <ChecklistRow card={item} today={today} first={first} />;
    case 'memo_reminder':
      return (
        <Row
          first={first}
          title={item.title}
          subtitle={`${item.time} 提醒`}
          onPress={() => openRecord(item.recordId)}
          right={<Badge label="备忘" tone="info" />}
        />
      );
    case 'important_date':
      return (
        <Row
          first={first}
          title={item.title}
          subtitle={[
            '全天',
            IMPORTANT_DATE_KIND_LABELS[item.dateKind],
            describeCounter(item.dateKind, item.counter),
          ]
            .filter((part) => part !== null)
            .join(' · ')}
          onPress={() => openRecord(item.recordId)}
          right={<Badge label="重要日期" tone="warning" />}
        />
      );
  }
}

const styles = StyleSheet.create({
  segments: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 12,
    padding: 2,
  },
  segment: {
    minHeight: 36,
    minWidth: 56,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: -8 },
  rangeTitle: { flexShrink: 1, textAlign: 'center' },
  stepButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: { borderWidth: 1, borderRadius: 16, padding: 6, gap: 2, marginTop: -8 },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', paddingVertical: 6 },
  day: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    paddingVertical: 4,
    gap: 4,
    borderWidth: 2,
    borderRadius: 10,
  },
  weekDay: { minHeight: 60 },
  dayNumber: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dots: { flexDirection: 'row', gap: 3, minHeight: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  nowMarker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  nowLine: { flex: 1, height: 1 },
});

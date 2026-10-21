import { describeError } from '@life-book/api-client';
import {
  CALENDAR_BLOCK_MINUTES,
  CALENDAR_VIEW_LABELS,
  type CalendarImportantDate,
  type CalendarItem,
  type CalendarView,
  calendarItemKey,
  calendarItemRecordType,
  calendarItemTime,
  calendarRange,
  calendarViews,
  datesBetween,
  describeCalendarRange,
  describeCounter,
  describeMonthCellDate,
  formatLocalDate,
  groupCalendarItems,
  IMPORTANT_DATE_KIND_LABELS,
  isHandledCalendarItem,
  isPastCalendarItem,
  isValidLocalDate,
  layoutTimedItems,
  type LocalDate,
  minutesOfDay,
  parseLocalDate,
  RECORD_TYPE_LABELS,
  shiftCalendarAnchor,
  WEEKDAY_HEADERS,
  weekdayOf,
  zonedDateTime,
} from '@life-book/core';
import { keepPreviousData, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  ChecklistRow,
  MemoReminderRow,
  OccurrenceRow,
  RecordLink,
} from '../components/agenda';
import { NewRecordMenu } from '../components/new-record-menu';
import { Alert, Badge } from '../components/ui';
import { calendarQuery, meQuery } from '../queries';

// 字段允许显式设为 undefined：不合法的参数要盖掉原始值，见 validateBookSearch。
export interface CalendarSearch {
  view?: CalendarView | undefined;
  /** 要看的日期；不填即今天。 */
  date?: LocalDate | undefined;
}

export function validateCalendarSearch(search: Record<string, unknown>): CalendarSearch {
  return {
    view: (calendarViews as readonly unknown[]).includes(search.view)
      ? (search.view as CalendarView)
      : undefined,
    date:
      typeof search.date === 'string' && isValidLocalDate(search.date)
        ? search.date
        : undefined,
  };
}

const STEP_LABELS: Record<CalendarView, [string, string]> = {
  day: ['前一天', '后一天'],
  week: ['上一周', '下一周'],
  month: ['上个月', '下个月'],
};

/** 时间轴上一小时的高度（像素）。 */
const HOUR_HEIGHT = 48;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
/** 时间轴左侧时刻那一栏的宽度。 */
const GUTTER = '3.5rem';

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
  return (
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
      .formatToParts(new Date())
      .find((part) => part.type === 'timeZoneName')?.value ?? ''
  );
}

type SelectItem = (item: CalendarItem, element: HTMLElement) => void;

interface Selection {
  key: string;
  /** 点中的元素的位置，卡片显示在它旁边。 */
  anchor: DOMRect;
}

export function CalendarPage() {
  const search = useSearch({ from: '/app/calendar' });
  const navigate = useNavigate({ from: '/calendar' });
  const { data: me } = useSuspenseQuery(meQuery);
  const timeZone = me.settings.timezone;
  const now = useNow(timeZone);
  const view = search.view ?? 'month';
  const anchor = search.date ?? now.date;
  const range = calendarRange(view, anchor);
  const calendar = useQuery({
    ...calendarQuery(range.from, range.to),
    // 翻页时先留着上一页，避免整块闪一下。
    placeholderData: keepPreviousData,
  });
  const today = calendar.data?.today ?? now.date;
  const items = useMemo(() => calendar.data?.items ?? [], [calendar.data]);
  const groups = useMemo(() => groupCalendarItems(items), [items]);
  const [selection, setSelection] = useState<Selection | null>(null);
  // 完成、改期后数据会刷新：按 key 找最新的那一项；改期到别的范围找不到时卡片自然关掉。
  const selected =
    selection === null
      ? undefined
      : items.find((item) => calendarItemKey(item) === selection.key);

  const go = (next: CalendarSearch) => {
    setSelection(null);
    void navigate({
      search: (prev) => validateCalendarSearch({ ...prev, ...next }),
      replace: true,
    });
  };
  const openDay = (date: LocalDate) => go({ view: 'day', date });
  const select: SelectItem = (item, element) =>
    setSelection({ key: calendarItemKey(item), anchor: element.getBoundingClientRect() });
  const [previousLabel, nextLabel] = STEP_LABELS[view];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="sr-only">日历</h1>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <button
          type="button"
          onClick={() => go({ date: undefined })}
          className="h-9 rounded-lg border border-line-strong bg-surface px-4 text-sm font-semibold hover:bg-surface-subtle"
        >
          今天
        </button>
        <div className="flex items-center">
          <StepButton
            label={previousLabel}
            onClick={() => go({ date: shiftCalendarAnchor(view, anchor, -1) })}
          >
            ‹
          </StepButton>
          <StepButton
            label={nextLabel}
            onClick={() => go({ date: shiftCalendarAnchor(view, anchor, 1) })}
          >
            ›
          </StepButton>
        </div>
        <label
          className={`relative inline-flex cursor-pointer items-center gap-1 text-lg font-semibold ${
            view === 'day' && anchor === today ? 'text-primary' : ''
          }`}
        >
          <span aria-live="polite">{describeCalendarRange(view, anchor, today)}</span>
          <span aria-hidden="true" className="text-sm text-fg-muted">
            ▾
          </span>
          <input
            type="date"
            aria-label="跳到日期"
            value={anchor}
            onChange={(event) => {
              if (isValidLocalDate(event.target.value)) {
                go({ date: event.target.value });
              }
            }}
            onClick={(event) => {
              try {
                event.currentTarget.showPicker();
              } catch {
                // 不支持 showPicker 的浏览器，点在输入框上也会弹出选择器。
              }
            }}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
        {calendar.isFetching ? (
          <span className="text-xs text-fg-subtle">正在加载…</span>
        ) : null}
        <div className="ml-auto flex items-center gap-3">
          <div
            role="group"
            aria-label="视图"
            className="inline-flex rounded-lg border border-line bg-surface p-0.5"
          >
            {calendarViews.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={option === view}
                onClick={() => go({ view: option })}
                className={`h-8 w-14 rounded-md text-sm font-semibold ${
                  option === view
                    ? 'bg-success-container text-primary'
                    : 'text-fg-muted hover:bg-surface-subtle'
                }`}
              >
                {CALENDAR_VIEW_LABELS[option]}
              </button>
            ))}
          </div>
          <NewRecordMenu />
        </div>
      </div>

      {calendar.isError ? <Alert>{describeError(calendar.error)}</Alert> : null}

      {view === 'month' ? (
        <MonthView
          dates={datesBetween(range.from, range.to)}
          month={parseLocalDate(anchor).month}
          today={today}
          nowTime={now.time}
          groups={groups}
          onOpenDay={openDay}
          onSelect={select}
        />
      ) : (
        <TimeGrid
          dates={datesBetween(range.from, range.to)}
          today={today}
          nowTime={now.time}
          timeZone={timeZone}
          groups={groups}
          onOpenDay={view === 'week' ? openDay : null}
          onSelect={select}
        />
      )}

      {selection === null || selected === undefined ? null : (
        <ItemCard
          item={selected}
          today={today}
          anchor={selection.anchor}
          onClose={() => setSelection(null)}
        />
      )}
    </div>
  );
}

function StepButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-9 place-items-center rounded-lg text-xl text-fg-muted hover:bg-surface-subtle"
    >
      {children}
    </button>
  );
}

// ---- 事项的样式 ----

const KIND_BLOCK: Record<CalendarItem['kind'], string> = {
  occurrence: 'border-info bg-info-container text-info',
  important_date: 'border-warning bg-warning-container text-warning',
  checklist: 'border-success bg-success-container text-success',
  memo_reminder: 'border-fg-subtle bg-surface-subtle text-fg-muted',
};

const KIND_DOT: Record<CalendarItem['kind'], string> = {
  occurrence: 'bg-info',
  important_date: 'bg-warning',
  checklist: 'bg-success',
  memo_reminder: 'bg-fg-subtle',
};

const isOverdue = (item: CalendarItem) =>
  item.kind === 'occurrence' && item.status === 'overdue';

/** 逾期的标红；已完成、已跳过的划掉；已经过去的变淡。 */
function itemTone(item: CalendarItem, today: LocalDate, nowTime: string) {
  return {
    block: isOverdue(item)
      ? 'border-danger bg-danger-container text-danger'
      : KIND_BLOCK[item.kind],
    dot: isOverdue(item) ? 'bg-danger' : KIND_DOT[item.kind],
    state: `${isHandledCalendarItem(item) ? 'line-through' : ''} ${
      isPastCalendarItem(item, today, nowTime) ? 'opacity-55' : ''
    }`,
  };
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

/** 全天事项：带左边色条的横条。 */
function AllDayBar({
  item,
  today,
  nowTime,
  onSelect,
}: {
  item: CalendarItem;
  today: LocalDate;
  nowTime: string;
  onSelect: SelectItem;
}) {
  const tone = itemTone(item, today, nowTime);
  return (
    <button
      type="button"
      aria-label={itemLabel(item)}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(item, event.currentTarget);
      }}
      className={`block w-full truncate rounded border-l-2 px-0.5 py-0.5 text-left text-[10px] font-semibold sm:border-l-[3px] sm:px-1.5 sm:text-xs ${tone.block} ${tone.state}`}
    >
      {item.title}
    </button>
  );
}

// ---- 月视图 ----

function MonthView({
  dates,
  month,
  today,
  nowTime,
  groups,
  onOpenDay,
  onSelect,
}: {
  dates: LocalDate[];
  month: number;
  today: LocalDate;
  nowTime: string;
  groups: ReadonlyMap<LocalDate, CalendarItem[]>;
  onOpenDay: (date: LocalDate) => void;
  onSelect: SelectItem;
}) {
  const visibleLimit = 3;
  const todayWeekday = dates.includes(today) ? weekdayOf(today) : null;
  const weeks: LocalDate[][] = [];
  for (let index = 0; index < dates.length; index += 7) {
    weeks.push(dates.slice(index, index + 7));
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="grid grid-cols-7" aria-hidden="true">
        {WEEKDAY_HEADERS.map((weekday, index) => (
          <div
            key={weekday}
            className={`px-2 py-2 text-xs font-semibold sm:px-3 sm:text-sm ${
              todayWeekday === index + 1 ? 'text-primary' : 'text-fg-muted'
            }`}
          >
            <span className="hidden sm:inline">周</span>
            {weekday}
          </div>
        ))}
      </div>
      {weeks.map((week, weekIndex) => (
        <div key={week[0]} className="grid grid-cols-7 border-t border-line">
          {week.map((date, dayIndex) => {
            const items = groups.get(date) ?? [];
            const outside = parseLocalDate(date).month !== month;
            const isToday = date === today;
            return (
              // 点格子的空白处也进入日视图；键盘用户用日期按钮。
              <div
                key={date}
                onClick={() => onOpenDay(date)}
                className={`flex min-h-24 min-w-0 cursor-pointer flex-col gap-0.5 p-1 sm:min-h-32 sm:p-1.5 ${
                  isToday ? 'bg-surface-subtle' : 'hover:bg-surface-subtle/60'
                }`}
              >
                <button
                  type="button"
                  aria-label={`${formatLocalDate(date)}${isToday ? '，今天' : ''}，${
                    items.length === 0 ? '没有安排' : `${items.length} 项`
                  }，按日查看`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenDay(date);
                  }}
                  className={`self-start rounded-full text-sm font-semibold sm:text-base ${
                    isToday
                      ? 'grid size-7 place-items-center bg-primary text-on-primary'
                      : `px-1 ${outside ? 'text-fg-subtle' : ''}`
                  }`}
                >
                  {isToday ? (
                    parseLocalDate(date).day
                  ) : (
                    <>
                      <span className="sm:hidden">{parseLocalDate(date).day}</span>
                      <span className="hidden sm:inline">
                        {describeMonthCellDate(date, weekIndex === 0 && dayIndex === 0)}
                      </span>
                    </>
                  )}
                </button>
                {items
                  .slice(0, visibleLimit)
                  .map((item) =>
                    calendarItemTime(item) === null ? (
                      <AllDayBar
                        key={calendarItemKey(item)}
                        item={item}
                        today={today}
                        nowTime={nowTime}
                        onSelect={onSelect}
                      />
                    ) : (
                      <TimedLine
                        key={calendarItemKey(item)}
                        item={item}
                        today={today}
                        nowTime={nowTime}
                        onSelect={onSelect}
                      />
                    ),
                  )}
                {items.length > visibleLimit ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenDay(date);
                    }}
                    className="self-start px-1 text-[10px] text-fg-muted hover:underline sm:text-xs"
                  >
                    <span className="sm:hidden">+{items.length - visibleLimit}</span>
                    <span className="hidden sm:inline">
                      还有 {items.length - visibleLimit} 项
                    </span>
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** 月视图里的定时事项：“• 15:00 标题”。 */
function TimedLine({
  item,
  today,
  nowTime,
  onSelect,
}: {
  item: CalendarItem;
  today: LocalDate;
  nowTime: string;
  onSelect: SelectItem;
}) {
  const tone = itemTone(item, today, nowTime);
  return (
    <button
      type="button"
      aria-label={itemLabel(item)}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(item, event.currentTarget);
      }}
      className={`flex min-w-0 items-center gap-1 rounded px-0.5 py-0.5 text-left text-[10px] hover:bg-surface-subtle sm:px-1 sm:text-xs ${tone.state}`}
    >
      <span className={`hidden size-1.5 shrink-0 rounded-full sm:block ${tone.dot}`} />
      <span className="hidden shrink-0 text-fg-muted tabular-nums sm:inline">
        {calendarItemTime(item)}
      </span>
      <span className={`truncate font-semibold ${isOverdue(item) ? 'text-danger' : ''}`}>
        {item.title}
      </span>
    </button>
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
  const scroller = useRef<HTMLDivElement>(null);
  const columns = `${GUTTER} repeat(${dates.length}, minmax(0, 1fr))`;
  const todayIndex = dates.indexOf(today);
  const nowTop = (minutesOfDay(nowTime) / 60) * HOUR_HEIGHT;
  const allDay = dates.map((date) =>
    (groups.get(date) ?? []).filter((item) => calendarItemTime(item) === null),
  );
  const hasAllDay = allDay.some((list) => list.length > 0);
  // 只在翻页或切换视图时滚动一次，数据刷新时保持用户自己滚到的位置。
  const rangeKey = `${dates[0]}:${dates.length}`;
  const scrolledFor = useRef<string | null>(null);

  // 滚到现在之前两个多小时；不含今天时滚到最早的事项，没有事项就从 7 点开始。
  useEffect(() => {
    const element = scroller.current;
    if (element === null || scrolledFor.current === rangeKey) {
      return;
    }
    scrolledFor.current = rangeKey;
    let minutes = 7 * 60;
    if (todayIndex !== -1) {
      minutes = minutesOfDay(nowTime) - 150;
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
    element.scrollTop = Math.max(0, (minutes / 60) * HOUR_HEIGHT);
  }, [rangeKey, todayIndex, nowTime, dates, groups]);

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="grid border-b border-line" style={{ gridTemplateColumns: columns }}>
        <div className="flex items-end justify-center pb-1.5 text-[10px] font-semibold text-fg-subtle">
          {offsetLabel(timeZone)}
        </div>
        {dates.map((date, index) => {
          const isToday = date === today;
          const tone = isToday ? 'text-primary' : date < today ? 'text-fg-subtle' : '';
          return (
            <div
              key={date}
              className="min-w-0 border-l border-line px-0.5 pt-2 pb-1.5 sm:px-1.5"
            >
              {onOpenDay === null ? null : (
                <button
                  type="button"
                  aria-label={`${formatLocalDate(date)}${isToday ? '，今天' : ''}，按日查看`}
                  onClick={() => onOpenDay(date)}
                  className={`flex w-full flex-col items-start rounded-lg px-1 text-left hover:bg-surface-subtle ${tone}`}
                >
                  <span className="text-xs sm:text-sm">
                    <span className="hidden sm:inline">周</span>
                    {WEEKDAY_HEADERS[weekdayOf(date) - 1]}
                  </span>
                  <span className="text-lg font-semibold sm:text-2xl">
                    {parseLocalDate(date).day}
                  </span>
                </button>
              )}
              {hasAllDay || onOpenDay === null ? (
                <div className="mt-1 flex min-h-6 flex-col gap-0.5">
                  {(allDay[index] ?? []).map((item) => (
                    <AllDayBar
                      key={calendarItemKey(item)}
                      item={item}
                      today={today}
                      nowTime={nowTime}
                      onSelect={onSelect}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div ref={scroller} className="max-h-[calc(100vh-13rem)] min-h-80 overflow-y-auto">
        <div
          className="relative grid"
          style={{ gridTemplateColumns: columns, height: 24 * HOUR_HEIGHT }}
        >
          <div className="relative" aria-hidden="true">
            {HOURS.slice(1).map((hour) =>
              // 离现在不到一刻钟的整点让给现在的时刻，免得叠在一起。
              todayIndex !== -1 &&
              Math.abs(hour * 60 - minutesOfDay(nowTime)) < 15 ? null : (
                <span
                  key={hour}
                  className="absolute right-2 -translate-y-1/2 text-[11px] text-fg-subtle tabular-nums"
                  style={{ top: hour * HOUR_HEIGHT }}
                >
                  {String(hour).padStart(2, '0')}:00
                </span>
              ),
            )}
            {todayIndex === -1 ? null : (
              <span
                className="absolute right-2 z-10 -translate-y-1/2 bg-surface text-[11px] font-semibold text-danger tabular-nums"
                style={{ top: nowTop }}
              >
                {nowTime}
              </span>
            )}
          </div>
          {dates.map((date) => (
            <DayColumn
              key={date}
              date={date}
              today={today}
              nowTime={nowTime}
              items={groups.get(date) ?? []}
              onSelect={onSelect}
            />
          ))}
          {todayIndex === -1 ? null : (
            <NowLine
              top={nowTop}
              dayCount={dates.length}
              todayIndex={todayIndex}
              label={`现在 ${nowTime}`}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function DayColumn({
  date,
  today,
  nowTime,
  items,
  onSelect,
}: {
  date: LocalDate;
  today: LocalDate;
  nowTime: string;
  items: CalendarItem[];
  onSelect: SelectItem;
}) {
  const blocks = layoutTimedItems(items);
  const blockHeight = (CALENDAR_BLOCK_MINUTES / 60) * HOUR_HEIGHT - 2;
  return (
    <div
      className="relative border-l border-line"
      style={{
        // 每小时一条横线。
        backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_HEIGHT - 1}px, var(--color-line) ${HOUR_HEIGHT - 1}px, var(--color-line) ${HOUR_HEIGHT}px)`,
      }}
    >
      <span className="sr-only">{formatLocalDate(date)}</span>
      {blocks.map(({ item, start, column, columns }) => {
        const tone = itemTone(item, today, nowTime);
        return (
          <button
            key={calendarItemKey(item)}
            type="button"
            aria-label={itemLabel(item)}
            onClick={(event) => onSelect(item, event.currentTarget)}
            className={`absolute overflow-hidden rounded border-l-[3px] px-1.5 text-left text-xs leading-[22px] hover:z-10 hover:shadow-md ${tone.block} ${tone.state}`}
            style={{
              top: (start / 60) * HOUR_HEIGHT + 1,
              height: blockHeight,
              left: `calc(${(column / columns) * 100}% + 2px)`,
              width: `calc(${100 / columns}% - 4px)`,
            }}
          >
            <span className="block truncate">
              <span className="font-semibold">{item.title}</span>{' '}
              <span className="opacity-80 tabular-nums">{calendarItemTime(item)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** 现在的时刻：今天及以后的部分是实线，之前几天的部分变淡；今天那一列的起点有个圆点。 */
function NowLine({
  top,
  dayCount,
  todayIndex,
  label,
}: {
  top: number;
  dayCount: number;
  todayIndex: number;
  label: string;
}) {
  const columnLeft = (index: number) =>
    `calc(${GUTTER} + (100% - ${GUTTER}) * ${index / dayCount})`;
  return (
    <div
      role="img"
      aria-label={label}
      className="pointer-events-none absolute inset-x-0 z-20"
      style={{ top }}
    >
      {todayIndex === 0 ? null : (
        <div
          className="absolute h-px bg-danger opacity-30"
          style={{
            left: columnLeft(0),
            width: `calc((100% - ${GUTTER}) * ${todayIndex / dayCount})`,
          }}
        />
      )}
      <div
        className="absolute right-0 h-0.5 -translate-y-1/4 bg-danger"
        style={{ left: columnLeft(todayIndex) }}
      />
      <div
        className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-danger"
        style={{ left: columnLeft(todayIndex) }}
      />
    </div>
  );
}

// ---- 点中事项后的卡片 ----

function ItemCard({
  item,
  today,
  anchor,
  onClose,
}: {
  item: CalendarItem;
  today: LocalDate;
  anchor: DOMRect;
  onClose: () => void;
}) {
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (card.current !== null && !card.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [onClose]);

  useEffect(() => {
    card.current?.focus();
  }, []);

  // 宽屏放在点中的事项旁边（右边放不下就放左边），窄屏从底部弹出。
  const width = 352;
  const wide = window.innerWidth >= 640;
  const left =
    anchor.right + 8 + width <= window.innerWidth
      ? anchor.right + 8
      : Math.max(8, anchor.left - 8 - width);
  const top = Math.min(Math.max(8, anchor.top - 8), window.innerHeight - 260);

  return (
    <div
      ref={card}
      role="dialog"
      aria-label={item.title}
      tabIndex={-1}
      className={`fixed z-40 rounded-2xl border border-line bg-surface-raised shadow-xl outline-none ${
        wide ? '' : 'inset-x-2 bottom-2'
      }`}
      style={wide ? { left, top, width } : undefined}
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <span className="text-xs text-fg-muted">
          {formatLocalDate(item.date)} ·{' '}
          {RECORD_TYPE_LABELS[calendarItemRecordType(item)]}
        </span>
        <button
          type="button"
          aria-label="关闭"
          onClick={onClose}
          className="grid size-7 place-items-center rounded-full text-fg-muted hover:bg-surface-subtle"
        >
          ×
        </button>
      </div>
      <ul>
        <CardRow item={item} today={today} />
      </ul>
      <div className="border-t border-line px-4 py-2.5">
        <Link
          to="/book"
          search={{ id: item.recordId }}
          className="text-sm font-semibold text-link hover:underline"
        >
          查看详情
        </Link>
      </div>
    </div>
  );
}

function CardRow({ item, today }: { item: CalendarItem; today: LocalDate }) {
  switch (item.kind) {
    case 'occurrence':
      return <OccurrenceRow card={item} today={today} />;
    case 'checklist':
      return <ChecklistRow card={item} today={today} />;
    case 'memo_reminder':
      return <MemoReminderRow card={item} />;
    case 'important_date':
      return <ImportantDateRow item={item} />;
  }
}

function ImportantDateRow({ item }: { item: CalendarImportantDate }) {
  const counter = describeCounter(item.dateKind, item.counter);
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <RecordLink id={item.recordId}>{item.title}</RecordLink>
        <p className="mt-0.5 text-xs text-fg-muted">
          {['全天', IMPORTANT_DATE_KIND_LABELS[item.dateKind], counter]
            .filter((part) => part !== null)
            .join(' · ')}
        </p>
      </div>
      <Badge tone="warning">重要日期</Badge>
    </li>
  );
}

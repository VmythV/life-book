import { describeError } from '@life-book/api-client';
import {
  CALENDAR_VIEW_LABELS,
  type CalendarImportantDate,
  type CalendarItem,
  type CalendarView,
  calendarItemKey,
  calendarItemTime,
  calendarRange,
  calendarViews,
  datesBetween,
  describeCalendarRange,
  describeCounter,
  describeLocalDate,
  formatLocalDate,
  groupCalendarItems,
  IMPORTANT_DATE_KIND_LABELS,
  isValidLocalDate,
  type LocalDate,
  parseLocalDate,
  shiftCalendarAnchor,
  WEEKDAY_HEADERS,
  zonedDateTime,
} from '@life-book/core';
import { keepPreviousData, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Fragment, useEffect, useMemo, useState } from 'react';

import {
  ChecklistRow,
  MemoReminderRow,
  OccurrenceRow,
  RecordLink,
  Section,
} from '../components/agenda';
import { NewRecordMenu } from '../components/new-record-menu';
import { Alert, Badge, Button } from '../components/ui';
import { calendarQuery, meQuery } from '../queries';

// 字段允许显式设为 undefined：不合法的参数要盖掉原始值，见 validateBookSearch。
export interface CalendarSearch {
  view?: CalendarView | undefined;
  /** 要看的日期；月视图和周视图里是选中的那天。不填即今天。 */
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

/** 用户时区的当前日期和时刻，每 30 秒更新一次。 */
function useNow(timeZone: string): { date: LocalDate; time: string } {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return zonedDateTime(now, timeZone);
}

export function CalendarPage() {
  const search = useSearch({ from: '/app/calendar' });
  const navigate = useNavigate({ from: '/calendar' });
  const { data: me } = useSuspenseQuery(meQuery);
  const now = useNow(me.settings.timezone);
  const view = search.view ?? 'month';
  const anchor = search.date ?? now.date;
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
  const go = (next: CalendarSearch) =>
    void navigate({
      search: (prev) => validateCalendarSearch({ ...prev, ...next }),
      replace: true,
    });
  const [previousLabel, nextLabel] = STEP_LABELS[view];

  const agenda = (
    <DayAgenda
      date={anchor}
      today={today}
      nowTime={now.time}
      items={groups.get(anchor) ?? []}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm text-fg-muted">
            现在 {formatLocalDate(now.date)} {now.time}
          </p>
          <h1 className="mt-1 text-3xl font-semibold">日历</h1>
        </div>
        <NewRecordMenu />
      </header>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
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
              className={`h-9 rounded-md px-4 text-sm font-semibold ${
                option === view
                  ? 'bg-primary text-on-primary'
                  : 'text-fg-muted hover:bg-surface-subtle'
              }`}
            >
              {CALENDAR_VIEW_LABELS[option]}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label={previousLabel}
            title={previousLabel}
            onClick={() => go({ date: shiftCalendarAnchor(view, anchor, -1) })}
          >
            ‹
          </Button>
          <h2 className="text-lg font-semibold" aria-live="polite">
            {describeCalendarRange(view, anchor)}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            aria-label={nextLabel}
            title={nextLabel}
            onClick={() => go({ date: shiftCalendarAnchor(view, anchor, 1) })}
          >
            ›
          </Button>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={anchor === today}
          onClick={() => go({ date: undefined })}
        >
          回到今天
        </Button>
        {calendar.isFetching ? (
          <span className="text-xs text-fg-subtle">正在加载…</span>
        ) : null}
      </div>

      {calendar.isError ? <Alert>{describeError(calendar.error)}</Alert> : null}

      {view === 'day' ? (
        agenda
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <DayGrid
            dates={datesBetween(range.from, range.to)}
            month={view === 'month' ? parseLocalDate(anchor).month : null}
            selected={anchor}
            today={today}
            groups={groups}
            onSelect={(date) => go({ date })}
          />
          {agenda}
        </div>
      )}
    </div>
  );
}

const KIND_CHIP: Record<CalendarItem['kind'], string> = {
  occurrence: 'bg-info-container text-info',
  important_date: 'bg-warning-container text-warning',
  checklist: 'bg-success-container text-success',
  memo_reminder: 'bg-surface-subtle text-fg-muted',
};

const KIND_DOT: Record<CalendarItem['kind'], string> = {
  occurrence: 'bg-info',
  important_date: 'bg-warning',
  checklist: 'bg-success',
  memo_reminder: 'bg-fg-subtle',
};

const isDone = (item: CalendarItem) =>
  item.kind === 'occurrence' &&
  (item.status === 'completed' || item.status === 'skipped');
const isOverdue = (item: CalendarItem) =>
  item.kind === 'occurrence' && item.status === 'overdue';

/** 月视图和周视图的格子：点一天在旁边（窄屏在下面）显示当天的事项。 */
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
  const chipLimit = month === null ? 8 : 3;
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-line">
      <div className="grid grid-cols-7 gap-px" aria-hidden="true">
        {WEEKDAY_HEADERS.map((weekday) => (
          <div
            key={weekday}
            className="bg-surface py-2 text-center text-xs font-semibold text-fg-muted"
          >
            {weekday}
          </div>
        ))}
      </div>
      <div className="mt-px grid grid-cols-7 gap-px">
        {dates.map((date) => {
          const items = groups.get(date) ?? [];
          const { month: dateMonth, day } = parseLocalDate(date);
          const outside = month !== null && dateMonth !== month;
          const isToday = date === today;
          const isSelected = date === selected;
          const label = [
            formatLocalDate(date),
            isToday ? '今天' : null,
            items.length === 0 ? '没有安排' : `${items.length} 项`,
          ]
            .filter((part) => part !== null)
            .join('，');
          return (
            <button
              key={date}
              type="button"
              aria-label={label}
              aria-pressed={isSelected}
              onClick={() => onSelect(date)}
              className={`flex min-w-0 flex-col items-stretch gap-1 p-1 text-left focus-visible:z-10 sm:p-1.5 ${
                month === null ? 'min-h-20 md:min-h-56' : 'min-h-16 md:min-h-28'
              } ${outside ? 'bg-surface-subtle text-fg-subtle' : 'bg-surface'} ${
                isSelected ? 'ring-2 ring-primary ring-inset' : 'hover:bg-surface-subtle'
              }`}
            >
              <span className="flex items-center justify-center md:justify-start">
                <span
                  className={`grid size-7 place-items-center rounded-full text-sm font-semibold ${
                    isToday ? 'bg-primary text-on-primary' : ''
                  }`}
                >
                  {day === 1 && month === null ? `${dateMonth}/${day}` : day}
                </span>
              </span>
              {items.length === 0 ? null : (
                <>
                  <span className="flex flex-wrap justify-center gap-0.5 md:hidden">
                    {items.slice(0, 4).map((item) => (
                      <span
                        key={calendarItemKey(item)}
                        className={`size-1.5 rounded-full ${
                          isOverdue(item) ? 'bg-danger' : KIND_DOT[item.kind]
                        } ${isDone(item) ? 'opacity-40' : ''}`}
                      />
                    ))}
                  </span>
                  <span className="hidden flex-col gap-0.5 md:flex">
                    {items.slice(0, chipLimit).map((item) => (
                      <span
                        key={calendarItemKey(item)}
                        className={`rounded px-1.5 py-0.5 text-xs ${month === null ? 'break-words' : 'truncate'} ${
                          isOverdue(item)
                            ? 'bg-danger-container text-danger'
                            : KIND_CHIP[item.kind]
                        } ${isDone(item) ? 'line-through opacity-60' : ''}`}
                      >
                        {/* 月视图的格子窄，只放标题；时刻在当天的列表里看。 */}
                        {month !== null || calendarItemTime(item) === null
                          ? item.title
                          : `${calendarItemTime(item)} ${item.title}`}
                      </span>
                    ))}
                    {items.length > chipLimit ? (
                      <span className="px-1.5 text-xs text-fg-muted">
                        还有 {items.length - chipLimit} 项
                      </span>
                    ) : null}
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 某一天的事项，可以直接完成、跳过或改期；点标题看详情。今天的列表里标出现在的时刻。 */
function DayAgenda({
  date,
  today,
  nowTime,
  items,
}: {
  date: LocalDate;
  today: LocalDate;
  nowTime: string;
  items: CalendarItem[];
}) {
  const title = formatLocalDate(date, {
    withYear: parseLocalDate(date).year !== parseLocalDate(today).year,
  });
  const relative = describeLocalDate(date, today);
  // 现在的时刻插在第一个还没到的定时事项前面；全天的事项总在前面。
  const nowIndex =
    date === today
      ? (() => {
          const index = items.findIndex((item) => {
            const time = calendarItemTime(item);
            return time !== null && time > nowTime;
          });
          return index === -1 ? items.length : index;
        })()
      : null;
  const nowMarker = (
    <li
      key="now"
      className="flex items-center gap-2 px-4 py-1.5 text-xs font-semibold text-danger"
    >
      <span>现在 {nowTime}</span>
      <span className="h-px flex-1 bg-danger" />
    </li>
  );

  return (
    <Section title={title} {...(relative === title ? {} : { hint: relative })}>
      {items.length === 0 ? (
        <li className="px-4 py-3 text-sm text-fg-muted">这一天没有安排。</li>
      ) : null}
      {items.map((item, index) => (
        <Fragment key={calendarItemKey(item)}>
          {index === nowIndex ? nowMarker : null}
          <AgendaRow item={item} today={today} />
        </Fragment>
      ))}
      {items.length > 0 && nowIndex === items.length ? nowMarker : null}
    </Section>
  );
}

function AgendaRow({ item, today }: { item: CalendarItem; today: LocalDate }) {
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

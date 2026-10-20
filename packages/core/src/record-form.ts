import { type ChecklistPurpose } from './checklists';
import {
  type LocalDate,
  parseLocalDate,
  weekdayOf,
  zonedDateTime,
  zonedTimeToInstant,
} from './dates';
import { type importantDateKinds } from './important-dates';
import { type CreatableRecordType } from './record-types';
import { type CreateRecordRequest, type LifeRecord } from './records';
import { type RecurrenceFreq } from './recurrence';
import { type ReminderInput } from './reminders';

/**
 * Web 和手机共用的记录表单模型：表单里全部用字符串保存输入，
 * 提交时再转换成接口请求体，数值和日期的合法性交给 `createRecordRequestSchema` 校验。
 */
export type RecordFormFreq = RecurrenceFreq;

export type RecordFormReminder =
  | { kind: 'relative'; daysBefore: string; timeOfDay: string }
  | { kind: 'absolute'; date: string; time: string };

export interface RecordFormState {
  title: string;
  notes: string;
  categoryId: string;
  tagIds: string[];
  isPinned: boolean;
  recurring: {
    startDate: string;
    freq: RecordFormFreq;
    interval: string;
    byWeekdays: number[];
    byMonthDay: string;
    timeOfDay: string;
    endType: 'never' | 'until' | 'count';
    until: string;
    count: string;
  };
  importantDate: {
    kind: (typeof importantDateKinds)[number];
    repeat: 'once' | 'yearly';
    date: string;
    startYear: string;
    showCounter: boolean;
  };
  checklist: {
    purpose: ChecklistPurpose;
    /** 截止日期和时刻；日期为空表示没有截止时间，只填日期时截止到当天 23:59。 */
    dueDate: string;
    dueTime: string;
    /** 只在新建时一起提交；之后在详情里直接增删改项目。 */
    items: RecordFormChecklistItem[];
  };
  householdItem: {
    unit: string;
    /** 新建时的期初数量；之后数量只能通过库存流水改变。 */
    quantity: string;
    lowStockThreshold: string;
    location: string;
  };
  reminders: RecordFormReminder[];
}

export interface RecordFormChecklistItem {
  groupName: string;
  title: string;
  quantity: string;
  unit: string;
}

/** 新建时的默认值；编辑时从记录转换。 */
export function initialRecordFormState(
  type: CreatableRecordType,
  today: LocalDate,
  timeZone: string,
  record?: LifeRecord,
): RecordFormState {
  const rule = record?.recurring;
  const date = record?.importantDate;
  const checklist = record?.checklist;
  const household = record?.householdItem;
  const due =
    checklist?.dueAt === undefined || checklist.dueAt === null
      ? null
      : zonedDateTime(new Date(checklist.dueAt), timeZone);
  const { day } = parseLocalDate(today);
  return {
    title: record?.title ?? '',
    notes: record?.notes ?? '',
    categoryId: record?.categoryId ?? '',
    tagIds: record?.tagIds ?? [],
    isPinned: record?.isPinned ?? false,
    recurring: {
      startDate: rule?.startDate ?? today,
      freq: rule?.freq ?? 'daily',
      interval: String(rule?.interval ?? 1),
      byWeekdays: rule?.byWeekdays ?? [weekdayOf(today)],
      byMonthDay: String(rule?.byMonthDay ?? day),
      timeOfDay: rule?.timeOfDay ?? '',
      endType: rule?.end.type ?? 'never',
      until: rule?.end.type === 'until' ? rule.end.until : '',
      count: rule?.end.type === 'count' ? String(rule.end.count) : '10',
    },
    importantDate: {
      kind: date?.kind ?? 'birthday',
      repeat: date?.repeat ?? 'yearly',
      date:
        date === undefined || date === null
          ? today
          : `${String(date.year ?? parseLocalDate(today).year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`,
      startYear:
        date?.startYear === undefined || date.startYear === null
          ? ''
          : String(date.startYear),
      showCounter: date?.showCounter ?? true,
    },
    checklist: {
      purpose: checklist?.purpose ?? 'general',
      dueDate: due?.date ?? '',
      dueTime: due?.time ?? '',
      items: [],
    },
    householdItem: {
      unit: household?.unit ?? '',
      quantity:
        household === undefined || household === null ? '' : String(household.quantity),
      lowStockThreshold:
        household?.lowStockThreshold === undefined || household.lowStockThreshold === null
          ? ''
          : String(household.lowStockThreshold),
      location: household?.location ?? '',
    },
    reminders:
      record === undefined
        ? type === 'important_date'
          ? [{ kind: 'relative', daysBefore: '0', timeOfDay: '' }]
          : []
        : record.reminders.map((reminder) => {
            if (reminder.kind === 'absolute') {
              const local = zonedDateTime(new Date(reminder.fireAt), timeZone);
              return { kind: 'absolute', date: local.date, time: local.time };
            }
            return {
              kind: 'relative',
              daysBefore: String(reminder.daysBefore),
              timeOfDay: reminder.timeOfDay ?? '',
            };
          }),
  };
}

const toInt = (value: string) => (value.trim() === '' ? Number.NaN : Number(value));

/** 表单状态转成接口请求体；数值和日期的合法性交给共享 schema 校验。 */
export function toRecordRequest(
  type: CreatableRecordType,
  state: RecordFormState,
  timeZone: string,
): CreateRecordRequest {
  const reminders: ReminderInput[] = state.reminders.map((draft) =>
    draft.kind === 'absolute'
      ? {
          kind: 'absolute',
          // 日期没填时留空，由 schema 报“请填写日期”一类的错误。
          fireAt:
            draft.date === ''
              ? ''
              : zonedTimeToInstant(
                  draft.date,
                  draft.time || '09:00',
                  timeZone,
                ).toISOString(),
        }
      : {
          kind: 'relative',
          daysBefore: toInt(draft.daysBefore),
          timeOfDay: draft.timeOfDay === '' ? null : draft.timeOfDay,
        },
  );
  const base = {
    title: state.title,
    notes: state.notes,
    categoryId: state.categoryId === '' ? null : state.categoryId,
    tagIds: state.tagIds,
    isPinned: state.isPinned,
    reminders,
  };
  if (type === 'recurring') {
    const rule = state.recurring;
    return {
      ...base,
      type,
      recurring: {
        startDate: rule.startDate,
        freq: rule.freq,
        interval: toInt(rule.interval),
        byWeekdays: rule.freq === 'weekly' ? rule.byWeekdays : null,
        byMonthDay: rule.freq === 'monthly' ? toInt(rule.byMonthDay) : null,
        timeOfDay: rule.timeOfDay === '' ? null : rule.timeOfDay,
        end:
          rule.endType === 'until'
            ? { type: 'until', until: rule.until }
            : rule.endType === 'count'
              ? { type: 'count', count: toInt(rule.count) }
              : { type: 'never' },
      },
    };
  }
  if (type === 'important_date') {
    const value = state.importantDate;
    const [year, month, day] = value.date.split('-').map(Number);
    return {
      ...base,
      type,
      importantDate: {
        kind: value.kind,
        repeat: value.repeat,
        year: value.repeat === 'once' ? (year ?? Number.NaN) : null,
        month: month ?? Number.NaN,
        day: day ?? Number.NaN,
        startYear: value.startYear.trim() === '' ? null : toInt(value.startYear),
        showCounter: value.showCounter,
      },
    };
  }
  if (type === 'checklist') {
    const value = state.checklist;
    return {
      ...base,
      type,
      checklist: {
        purpose: value.purpose,
        dueAt:
          value.dueDate === ''
            ? null
            : zonedTimeToInstant(
                value.dueDate,
                value.dueTime || '23:59',
                timeZone,
              ).toISOString(),
        // 空行直接忽略，方便连续添加。
        items: value.items
          .filter((item) => item.title.trim() !== '')
          .map((item) => ({
            groupName: item.groupName,
            title: item.title,
            quantity: item.quantity.trim() === '' ? null : Number(item.quantity),
            unit: item.unit,
          })),
      },
    };
  }
  if (type === 'household_item') {
    const value = state.householdItem;
    const toQuantity = (text: string) => (text.trim() === '' ? Number.NaN : Number(text));
    return {
      ...base,
      type,
      householdItem: {
        unit: value.unit,
        quantity: value.quantity.trim() === '' ? 0 : toQuantity(value.quantity),
        lowStockThreshold:
          value.lowStockThreshold.trim() === ''
            ? null
            : toQuantity(value.lowStockThreshold),
        location: value.location,
      },
    };
  }
  return { ...base, type };
}

export const FREQ_LABELS: Record<RecordFormFreq, string> = {
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
  yearly: '每年',
};

export const INTERVAL_UNITS: Record<RecordFormFreq, string> = {
  daily: '天',
  weekly: '周',
  monthly: '个月',
  yearly: '年',
};

/** 表单是否改过：用来在离开前提醒保存。状态里只有字符串、数字、布尔值和数组，按 JSON 比较即可。 */
export function isRecordFormDirty(
  initial: RecordFormState,
  state: RecordFormState,
): boolean {
  return JSON.stringify(initial) !== JSON.stringify(state);
}

/** 离开有未保存修改的表单时的确认文字。 */
export const DISCARD_CHANGES_MESSAGE = '修改还没有保存，确定要离开吗？';

/** 提醒区还没有提醒时的说明：这类记录什么时候出现在“今天”里。 */
export const TODAY_VISIBILITY_HINTS: Record<CreatableRecordType, string> = {
  recurring: '不设提醒也会出现在“今天”里',
  important_date: '不设提醒也会出现在“今天”里',
  memo: '备忘只在提醒当天出现在“今天”里',
  checklist: '设了截止日期的清单会在当天出现在“今天”里',
  household_item: '低库存时会出现在“今天”里',
};

/** 相对提醒“提前几天”的常用选项。 */
export const DAYS_BEFORE_PRESETS = ['0', '1', '3', '7', '14', '30'];

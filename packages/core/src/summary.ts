import { checklistProgress, describeQuantity } from './checklists';
import { describeLocalDate, type LocalDate, zonedDateTime } from './dates';
import { describeDaysUntil, nextImportantDate } from './important-dates';
import { type LifeRecord } from './records';
import { describeRecurrence } from './recurrence';

/** 列表里每条记录下方的一行说明：重复方式和下次日期、重要日期还有几天、清单进度，或备忘正文开头。 */
export function describeRecordSummary(
  record: LifeRecord,
  today: LocalDate,
  timeZone: string,
): string {
  if (record.householdItem !== null) {
    const item = record.householdItem;
    return [
      `剩 ${describeQuantity(item.quantity, item.unit) ?? item.quantity}`,
      item.isLowStock ? '低库存' : null,
      item.location,
    ]
      .filter((part) => part !== null)
      .join(' · ');
  }
  if (record.checklist !== null) {
    const progress = checklistProgress(record.checklist.items);
    const parts = [
      progress.total === 0
        ? '还没有项目'
        : progress.isComplete
          ? `已完成 ${progress.total} 项`
          : `${progress.done}/${progress.total}`,
    ];
    if (record.checklist.dueAt !== null) {
      const due = zonedDateTime(new Date(record.checklist.dueAt), timeZone);
      parts.push(`截止 ${describeLocalDate(due.date, today)} ${due.time}`);
    }
    return parts.join(' · ');
  }
  if (record.recurring !== null) {
    // 服务端已按改期和处理状态算好下一次。
    const next = record.nextOccurrenceDate;
    const rule = describeRecurrence(record.recurring);
    return next === null
      ? `${rule} · 已结束`
      : `${rule} · 下次 ${describeLocalDate(next, today)}`;
  }
  if (record.importantDate !== null) {
    const next = nextImportantDate(record.importantDate, today);
    if (next === null) {
      return '已过去';
    }
    // 今天和明天本身已经说明了远近。
    return next.daysUntil <= 1
      ? describeLocalDate(next.date, today)
      : `${describeLocalDate(next.date, today)} · ${describeDaysUntil(next.daysUntil)}`;
  }
  // 没有标题的备忘，标题已经取了正文第一行，这里不再重复。
  if (record.title === '') {
    return '';
  }
  return (record.notes ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
}

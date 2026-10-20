import { describeError } from '@life-book/api-client';
import { type LocalDate } from '@life-book/core';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api';
import { useInvalidateRecords } from '../queries';
import { Button } from './ui';

/** “仅本次改期”：选一个新日期；已改期的可以取消，回到原定日期。 */
export function RescheduleControl({
  recordId,
  originalDate,
  date,
}: {
  recordId: string;
  /** 原定日期，接口用它定位这次实例。 */
  originalDate: LocalDate;
  /** 当前的实际日期。 */
  date: LocalDate;
}) {
  const invalidate = useInvalidateRecords();
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState(date);
  const reschedule = useMutation({
    mutationFn: (to: LocalDate | null) =>
      to === null
        ? api.occurrences.cancelReschedule(recordId, originalDate)
        : api.occurrences
            .reschedule(recordId, originalDate, { to })
            .then(() => undefined),
    onSuccess: () => setEditing(false),
    onSettled: invalidate,
  });
  const moved = date !== originalDate;

  if (!editing) {
    return (
      <>
        <Button
          size="sm"
          variant="ghost"
          disabled={reschedule.isPending}
          onClick={() => {
            setTarget(date);
            setEditing(true);
          }}
        >
          改期
        </Button>
        {moved ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={reschedule.isPending}
            onClick={() => reschedule.mutate(null)}
          >
            取消改期
          </Button>
        ) : null}
      </>
    );
  }
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        reschedule.mutate(target);
      }}
    >
      <input
        type="date"
        aria-label="改到哪天"
        value={target}
        onChange={(event) => setTarget(event.target.value)}
        className="h-8 rounded-lg border border-line bg-surface px-2 text-xs text-fg"
      />
      <Button type="submit" size="sm" loading={reschedule.isPending}>
        确定
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
        取消
      </Button>
      {reschedule.isError ? (
        <span className="text-xs text-danger">{describeError(reschedule.error)}</span>
      ) : null}
    </form>
  );
}

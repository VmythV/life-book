import { describeError } from '@life-book/api-client';
import {
  addDays,
  formatLocalDate,
  type LocalDate,
  makeLocalDate,
  parseLocalDate,
} from '@life-book/core';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useMutation } from '@tanstack/react-query';
import { ActionSheetIOS, Alert, Platform } from 'react-native';

import { api, useInvalidateRecords } from '../lib/api';
import { SmallButton } from './ui';

const IOS_CHOICES: [number, string][] = [
  [1, '明天'],
  [2, '后天'],
  [3, '3 天后'],
  [7, '一周后'],
];

/**
 * “仅本次改期”：安卓用系统的日期选择器，iOS 从几个常用日期里选。
 * 已改期的实例另外显示“取消改期”。
 */
export function RescheduleButtons({
  recordId,
  originalDate,
  date,
  today,
  disabled = false,
}: {
  recordId: string;
  /** 原定日期，接口用它定位这次实例。 */
  originalDate: LocalDate;
  /** 当前的实际日期。 */
  date: LocalDate;
  today: LocalDate;
  disabled?: boolean;
}) {
  const invalidate = useInvalidateRecords();
  const reschedule = useMutation({
    mutationFn: (to: LocalDate | null) =>
      to === null
        ? api.occurrences.cancelReschedule(recordId, originalDate)
        : api.occurrences
            .reschedule(recordId, originalDate, { to })
            .then(() => undefined),
    onError: (error) => Alert.alert('没有改成', describeError(error)),
    onSettled: invalidate,
  });

  function open() {
    if (Platform.OS === 'android') {
      const { year, month, day } = parseLocalDate(date);
      DateTimePickerAndroid.open({
        value: new Date(year, month - 1, day),
        mode: 'date',
        onValueChange: (_event, picked) => {
          reschedule.mutate(
            makeLocalDate(picked.getFullYear(), picked.getMonth() + 1, picked.getDate()),
          );
        },
      });
      return;
    }
    const choices = IOS_CHOICES.map(([days, label]) => ({
      to: addDays(today, days),
      label: `${label}（${formatLocalDate(addDays(today, days))}）`,
    }));
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: '改到哪天？',
        message: '只改这一次，以后照常重复。',
        options: [...choices.map((choice) => choice.label), '取消'],
        cancelButtonIndex: choices.length,
      },
      (index) => {
        const choice = choices[index];
        if (choice !== undefined) {
          reschedule.mutate(choice.to);
        }
      },
    );
  }

  const busy = disabled || reschedule.isPending;
  return (
    <>
      <SmallButton label="改期" variant="ghost" disabled={busy} onPress={open} />
      {date === originalDate ? null : (
        <SmallButton
          label="取消改期"
          variant="ghost"
          disabled={busy}
          onPress={() => reschedule.mutate(null)}
        />
      )}
    </>
  );
}

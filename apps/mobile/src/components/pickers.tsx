import { formatLocalDate, makeLocalDate, parseLocalDate } from '@life-book/core';
import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../lib/theme';
import { FieldLabel, SmallButton } from './ui';

// 选择器使用本机时区的 Date；这里只取它的年月日或时分，不涉及时区换算。
function dateToValue(date: Date): string {
  return makeLocalDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function valueToDate(value: string): Date {
  if (value === '') {
    return new Date();
  }
  const { year, month, day } = parseLocalDate(value);
  return new Date(year, month - 1, day);
}

function timeToValue(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function valueToTime(value: string): Date {
  const [hour = 9, minute = 0] = value === '' ? [] : value.split(':').map(Number);
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date;
}

interface PickerFieldProps {
  label: string;
  /** 日期 `YYYY-MM-DD` 或时刻 `HH:mm`；空字符串表示未设置。 */
  value: string;
  onChange: (value: string) => void;
  /** 可以清空时显示的按钮文字，例如“不设时间”。 */
  clearLabel?: string;
  placeholder?: string;
  hint?: string | undefined;
}

function PickerField({
  mode,
  label,
  value,
  onChange,
  clearLabel,
  placeholder = '未设置',
  hint,
}: PickerFieldProps & { mode: 'date' | 'time' }) {
  const theme = useTheme();
  const current = mode === 'date' ? valueToDate(value) : valueToTime(value);
  // 只在用户选定时调用；取消时不改值。
  const handleValueChange = (_event: unknown, date: Date) => {
    onChange(mode === 'date' ? dateToValue(date) : timeToValue(date));
  };
  const display =
    value === ''
      ? placeholder
      : mode === 'date'
        ? formatLocalDate(value, { withYear: true })
        : value;

  return (
    <View style={styles.field}>
      <FieldLabel>{label}</FieldLabel>
      <View style={styles.line}>
        {Platform.OS === 'ios' && value !== '' ? (
          <DateTimePicker
            value={current}
            mode={mode}
            display="compact"
            locale="zh-CN"
            onValueChange={handleValueChange}
          />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${label}：${display}`}
            onPress={() => {
              if (Platform.OS === 'android') {
                DateTimePickerAndroid.open({
                  value: current,
                  mode,
                  is24Hour: true,
                  onValueChange: handleValueChange,
                });
              } else {
                // iOS 未设置时先填一个默认值，随后显示系统的紧凑选择器。
                onChange(mode === 'date' ? dateToValue(current) : timeToValue(current));
              }
            }}
            style={[
              styles.input,
              {
                borderColor: theme.color.borderDefault,
                backgroundColor: theme.color.surface,
              },
            ]}
          >
            <Text
              style={[
                theme.type['type.body'],
                {
                  color:
                    value === '' ? theme.color.textTertiary : theme.color.textPrimary,
                },
              ]}
            >
              {display}
            </Text>
          </Pressable>
        )}
        {clearLabel !== undefined && value !== '' ? (
          <SmallButton label={clearLabel} variant="ghost" onPress={() => onChange('')} />
        ) : null}
      </View>
      {hint === undefined ? null : (
        <Text style={[theme.type['type.caption'], { color: theme.color.textTertiary }]}>
          {hint}
        </Text>
      )}
    </View>
  );
}

export function DateField(props: PickerFieldProps) {
  return <PickerField mode="date" {...props} />;
}

export function TimeField(props: PickerFieldProps) {
  return <PickerField mode="time" {...props} />;
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
});

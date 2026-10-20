import { type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '../lib/theme';

export function Screen({
  children,
  refreshing,
  onRefresh,
  edges = ['top', 'left', 'right'],
  overlay,
}: {
  children: ReactNode;
  /** 传入后支持下拉刷新。 */
  refreshing?: boolean;
  onRefresh?: () => void;
  /** 有导航栏的页面不需要顶部安全区。 */
  edges?: ('top' | 'left' | 'right' | 'bottom')[];
  /** 浮在内容上方的元素，例如“+”按钮。 */
  overlay?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <SafeAreaView
      edges={edges}
      style={[styles.screen, { backgroundColor: theme.color.canvas }]}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh === undefined ? undefined : (
            <RefreshControl
              refreshing={refreshing ?? false}
              onRefresh={onRefresh}
              tintColor={theme.color.textTertiary}
              colors={[theme.color.actionPrimary]}
            />
          )
        }
      >
        {children}
      </ScrollView>
      {overlay}
    </SafeAreaView>
  );
}

export function Title({
  children,
  caption,
}: {
  children: string;
  caption?: string | undefined;
}) {
  const theme = useTheme();
  return (
    <View style={styles.titleBlock}>
      {caption === undefined ? null : (
        <Text
          style={[theme.type['type.body.small'], { color: theme.color.textSecondary }]}
        >
          {caption}
        </Text>
      )}
      <Text
        accessibilityRole="header"
        style={[theme.type['type.title.1'], { color: theme.color.textPrimary }]}
      >
        {children}
      </Text>
    </View>
  );
}

export function Card({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.color.surface, borderColor: theme.color.borderDefault },
      ]}
    >
      {children}
    </View>
  );
}

export function BodyText({
  children,
  muted = false,
  bold = false,
}: {
  children: ReactNode;
  muted?: boolean;
  bold?: boolean;
}) {
  const theme = useTheme();
  return (
    <Text
      style={[
        theme.type[bold ? 'type.label.large' : 'type.body'],
        { color: muted ? theme.color.textSecondary : theme.color.textPrimary },
      ]}
    >
      {children}
    </Text>
  );
}

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
}: ButtonProps) {
  const theme = useTheme();
  const primary = variant === 'primary';
  const textColor = primary
    ? theme.color.actionOnPrimary
    : variant === 'danger'
      ? theme.color.stateDangerForeground
      : theme.color.textPrimary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: loading, disabled: loading || disabled }}
      disabled={loading || disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        (loading || disabled) && primary ? { opacity: 0.6 } : null,
        primary
          ? {
              backgroundColor: pressed
                ? theme.color.actionPrimaryPressed
                : theme.color.actionPrimary,
            }
          : {
              borderWidth: 1,
              borderColor: theme.color.borderStrong,
              backgroundColor: pressed ? theme.color.surfaceSubtle : 'transparent',
            },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text style={[theme.type['type.label.large'], { color: textColor }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

interface TextFieldProps extends TextInputProps {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
}

export function TextField({ label, hint, error, style, ...props }: TextFieldProps) {
  const theme = useTheme();
  const message = error ?? hint;
  return (
    <View style={styles.field}>
      <Text style={[theme.type['type.label'], { color: theme.color.textPrimary }]}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.color.textTertiary}
        style={[
          theme.type['type.body'],
          styles.input,
          {
            color: theme.color.textPrimary,
            backgroundColor: theme.color.surface,
            borderColor:
              error === undefined
                ? theme.color.borderDefault
                : theme.color.stateDangerForeground,
          },
          props.multiline === true ? styles.multiline : null,
          style,
        ]}
        {...props}
      />
      {message === undefined ? null : (
        <Text
          style={[
            theme.type['type.caption'],
            {
              color:
                error === undefined
                  ? theme.color.textTertiary
                  : theme.color.stateDangerForeground,
            },
          ]}
        >
          {message}
        </Text>
      )}
    </View>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="alert"
      style={[styles.banner, { backgroundColor: theme.color.stateDangerContainer }]}
    >
      <Text
        style={[
          theme.type['type.body.small'],
          { color: theme.color.stateDangerForeground },
        ]}
      >
        {message}
      </Text>
    </View>
  );
}

/** 列表行里的小按钮：完成、跳过、撤销。 */
export function SmallButton({
  label,
  onPress,
  variant = 'secondary',
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
}) {
  const theme = useTheme();
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.smallButton,
        primary
          ? {
              backgroundColor: pressed
                ? theme.color.actionPrimaryPressed
                : theme.color.actionPrimary,
            }
          : variant === 'secondary'
            ? {
                borderWidth: 1,
                borderColor: theme.color.borderStrong,
                backgroundColor: pressed ? theme.color.surfaceSubtle : 'transparent',
              }
            : { backgroundColor: pressed ? theme.color.surfaceSubtle : 'transparent' },
        disabled ? { opacity: 0.5 } : null,
      ]}
    >
      <Text
        style={[
          theme.type['type.label'],
          {
            color: primary
              ? theme.color.actionOnPrimary
              : variant === 'ghost'
                ? theme.color.textSecondary
                : theme.color.textPrimary,
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** 可选中的胶囊按钮，用于筛选和单选、多选。 */
export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[
        styles.chip,
        selected
          ? {
              backgroundColor: theme.color.actionPrimary,
              borderColor: theme.color.actionPrimary,
            }
          : {
              borderColor: theme.color.borderDefault,
              backgroundColor: theme.color.surface,
            },
      ]}
    >
      <Text
        style={[
          theme.type['type.label'],
          { color: selected ? theme.color.actionOnPrimary : theme.color.textSecondary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function ChipGroup({ children }: { children: ReactNode }) {
  return <View style={styles.chipGroup}>{children}</View>;
}

type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  const theme = useTheme();
  const colors: Record<BadgeTone, [string, string]> = {
    neutral: [theme.color.surfaceSubtle, theme.color.textSecondary],
    info: [theme.color.stateInfoContainer, theme.color.stateInfoForeground],
    success: [theme.color.stateSuccessContainer, theme.color.stateSuccessForeground],
    warning: [theme.color.stateWarningContainer, theme.color.stateWarningForeground],
    danger: [theme.color.stateDangerContainer, theme.color.stateDangerForeground],
  };
  const [background, foreground] = colors[tone];
  return (
    <View style={[styles.badge, { backgroundColor: background }]}>
      <Text
        style={[theme.type['type.caption'], { color: foreground, fontWeight: '600' }]}
      >
        {label}
      </Text>
    </View>
  );
}

/** 带标题的分组，里面是一列用分隔线隔开的行。 */
export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={[theme.type['type.title.3'], { color: theme.color.textPrimary }]}>
          {title}
        </Text>
        {hint === undefined ? null : (
          <Text style={[theme.type['type.caption'], { color: theme.color.textTertiary }]}>
            {hint}
          </Text>
        )}
      </View>
      <View
        style={[
          styles.sectionBody,
          {
            backgroundColor: theme.color.surface,
            borderColor: theme.color.borderDefault,
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

/** 分组里的一行：左边标题和说明，右边是操作。 */
export function Row({
  title,
  subtitle,
  onPress,
  right,
  first = false,
  dimmed = false,
}: {
  title: string;
  subtitle?: string | undefined;
  onPress?: () => void;
  right?: ReactNode;
  first?: boolean;
  dimmed?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.row,
        first
          ? null
          : {
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: theme.color.borderDefault,
            },
      ]}
    >
      <Pressable
        accessibilityRole={onPress === undefined ? undefined : 'button'}
        onPress={onPress}
        disabled={onPress === undefined}
        style={styles.rowMain}
      >
        <Text
          numberOfLines={2}
          style={[
            theme.type['type.label.large'],
            {
              color: dimmed ? theme.color.textTertiary : theme.color.textPrimary,
              textDecorationLine: dimmed ? 'line-through' : 'none',
            },
          ]}
        >
          {title}
        </Text>
        {subtitle === undefined || subtitle === '' ? null : (
          <Text
            numberOfLines={2}
            style={[theme.type['type.caption'], { color: theme.color.textSecondary }]}
          >
            {subtitle}
          </Text>
        )}
      </Pressable>
      {right === undefined ? null : <View style={styles.rowRight}>{right}</View>}
    </View>
  );
}

export function EmptyState({ title, message }: { title: string; message?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.empty, { borderColor: theme.color.borderDefault }]}>
      <Text style={[theme.type['type.label.large'], { color: theme.color.textPrimary }]}>
        {title}
      </Text>
      {message === undefined ? null : (
        <Text
          style={[
            theme.type['type.body.small'],
            { color: theme.color.textSecondary, textAlign: 'center' },
          ]}
        >
          {message}
        </Text>
      )}
    </View>
  );
}

export function InfoBanner({ message }: { message: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.banner, { backgroundColor: theme.color.stateInfoContainer }]}>
      <Text
        style={[
          theme.type['type.body.small'],
          { color: theme.color.stateInfoForeground },
        ]}
      >
        {message}
      </Text>
    </View>
  );
}

/** 右下角的“+”按钮。 */
export function Fab({ onPress, label }: { onPress: () => void; label: string }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.fab,
        {
          backgroundColor: pressed
            ? theme.color.actionPrimaryPressed
            : theme.color.actionPrimary,
        },
      ]}
    >
      <Ionicons name="add" size={30} color={theme.color.actionOnPrimary} />
    </Pressable>
  );
}

export function SwitchRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.switchRow}>
      <Text
        style={[theme.type['type.body'], { color: theme.color.textPrimary, flex: 1 }]}
      >
        {label}
      </Text>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: theme.color.actionPrimary, false: theme.color.borderStrong }}
      />
    </View>
  );
}

export function FieldLabel({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text style={[theme.type['type.label'], { color: theme.color.textPrimary }]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 20, gap: 20 },
  titleBlock: { gap: 4, marginTop: 8 },
  card: { borderWidth: 1, borderRadius: 16, padding: 20, gap: 8 },
  button: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  field: { gap: 6 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12 },
  multiline: { paddingTop: 12, paddingBottom: 12 },
  banner: { borderRadius: 12, padding: 12 },
  smallButton: {
    minHeight: 34,
    borderRadius: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    minHeight: 34,
    borderRadius: 17,
    borderWidth: 1,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  section: { gap: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  sectionBody: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  // 右侧按钮多、挤得标题不到 120 宽时，按钮换到下一行并靠右。
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowMain: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 120, gap: 2 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto' },
  empty: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 6,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
});

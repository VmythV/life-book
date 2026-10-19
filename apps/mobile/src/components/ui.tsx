import { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '../lib/theme';

export function Screen({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.screen, { backgroundColor: theme.color.canvas }]}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Title({ children, caption }: { children: string; caption?: string }) {
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
  variant?: 'primary' | 'secondary';
  loading?: boolean;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
}: ButtonProps) {
  const theme = useTheme();
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: loading, disabled: loading }}
      disabled={loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
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
        <ActivityIndicator
          color={primary ? theme.color.actionOnPrimary : theme.color.textPrimary}
        />
      ) : (
        <Text
          style={[
            theme.type['type.label.large'],
            { color: primary ? theme.color.actionOnPrimary : theme.color.textPrimary },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  hint?: string;
  error?: string | undefined;
}

export function TextField({ label, hint, error, ...props }: TextFieldProps) {
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
  banner: { borderRadius: 12, padding: 12 },
});

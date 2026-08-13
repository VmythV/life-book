import { createLifeBookTheme } from '@life-book/ui';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, useColorScheme, View, type TextStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface ScaffoldConfigurationErrorScreenProps {
  readonly diagnosticCode: string;
}

export function ScaffoldConfigurationErrorScreen({
  diagnosticCode,
}: ScaffoldConfigurationErrorScreenProps) {
  const systemScheme = useColorScheme();
  const theme = createLifeBookTheme(systemScheme === 'dark' ? 'dark' : 'light');
  const styles = createStyles(theme);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <View accessibilityRole="alert" style={styles.content}>
        <Text accessibilityRole="header" style={styles.title}>
          应用配置不可用
        </Text>
        <Text style={styles.body}>
          为了保护数据，应用没有继续启动。当前版本未创建或读取任何生活记录。
        </Text>
        <Text selectable style={styles.diagnostic}>
          技术详情：{diagnosticCode}
        </Text>
      </View>
    </SafeAreaView>
  );
}

type Theme = ReturnType<typeof createLifeBookTheme>;

function typography(theme: Theme, token: keyof Theme['type']): TextStyle {
  const value = theme.type[token];
  return {
    fontSize: value.fontSize,
    fontWeight: value.fontWeight,
    lineHeight: value.lineHeight,
  };
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    body: {
      ...typography(theme, 'type.body'),
      color: theme.color.textSecondary,
      marginTop: theme.space['space.3'],
    },
    content: {
      flex: 1,
      justifyContent: 'center',
      padding: theme.space['space.4'],
    },
    diagnostic: {
      ...typography(theme, 'type.caption'),
      color: theme.color.textTertiary,
      marginTop: theme.space['space.6'],
    },
    safeArea: {
      backgroundColor: theme.color.canvas,
      flex: 1,
    },
    title: {
      ...typography(theme, 'type.title.2'),
      color: theme.color.textPrimary,
    },
  });
}

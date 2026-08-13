import { createLifeBookTheme } from '@life-book/ui';
import { StatusBar } from 'expo-status-bar';
import {
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
  type TextStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ScaffoldStatusViewModel } from '../application/read-scaffold-status';
import type { ScaffoldCapability } from '../ports/scaffold-ports';

interface ScaffoldScreenProps {
  readonly viewModel: ScaffoldStatusViewModel;
}

const CAPABILITY_LABELS: Readonly<Record<ScaffoldCapability, string>> = {
  network: '在线能力',
  persistence: '本地数据',
  product_notifications: '系统提醒',
  telemetry: '诊断上报',
  updates: '在线更新',
};

export function ScaffoldScreen({ viewModel }: ScaffoldScreenProps) {
  const systemScheme = useColorScheme();
  const theme = createLifeBookTheme(systemScheme === 'dark' ? 'dark' : 'light');
  const styles = createStyles(theme);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
      >
        <View accessibilityElementsHidden style={styles.brandMark}>
          <Text style={styles.brandMarkText}>谱</Text>
        </View>

        <Text accessibilityRole="header" style={styles.title}>
          {viewModel.productName}
        </Text>
        <Text style={styles.slogan}>每件生活小事，都有着落。</Text>

        <View style={styles.summaryCard}>
          <Text style={styles.cardTitle}>工程骨架正在搭建</Text>
          <Text style={styles.body}>
            当前版本只验证应用结构和离线静态界面，不会保存生活记录，也不会安排提醒。
          </Text>
        </View>

        <View style={styles.statusSection}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            当前能力状态
          </Text>
          {viewModel.capabilities.map((availability) => (
            <View key={availability.capability} style={styles.statusRow}>
              <View style={styles.statusCopy}>
                <Text style={styles.statusTitle}>
                  {CAPABILITY_LABELS[availability.capability]}
                </Text>
                <Text style={styles.statusDetail}>尚未进入当前实施阶段</Text>
              </View>
              <View accessibilityLabel="未启用" style={styles.badge}>
                <Text style={styles.badgeText}>未启用</Text>
              </View>
            </View>
          ))}
        </View>

        <Text style={styles.footer}>M0 · 永久工程骨架</Text>
      </ScrollView>
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
    badge: {
      alignSelf: 'flex-start',
      backgroundColor: theme.color.stateInfoContainer,
      borderRadius: theme.radius['radius.sm'],
      paddingHorizontal: theme.space['space.2'],
      paddingVertical: theme.space['space.1'],
    },
    badgeText: {
      ...typography(theme, 'type.label'),
      color: theme.color.stateInfoForeground,
    },
    body: {
      ...typography(theme, 'type.body'),
      color: theme.color.textSecondary,
      marginTop: theme.space['space.2'],
    },
    brandMark: {
      alignItems: 'center',
      alignSelf: 'flex-start',
      backgroundColor: theme.color.brandPrimary,
      borderRadius: theme.radius['radius.lg'],
      height: theme.space['space.12'],
      justifyContent: 'center',
      width: theme.space['space.12'],
    },
    brandMarkText: {
      ...typography(theme, 'type.title.2'),
      color: theme.color.canvas,
    },
    cardTitle: {
      ...typography(theme, 'type.title.3'),
      color: theme.color.textPrimary,
    },
    content: {
      alignSelf: 'center',
      maxWidth: 640,
      paddingBottom: theme.space['space.8'],
      paddingHorizontal: theme.space['space.4'],
      paddingTop: theme.space['space.10'],
      width: '100%',
    },
    footer: {
      ...typography(theme, 'type.caption'),
      color: theme.color.textTertiary,
      marginTop: theme.space['space.8'],
      textAlign: 'center',
    },
    safeArea: {
      backgroundColor: theme.color.canvas,
      flex: 1,
    },
    sectionTitle: {
      ...typography(theme, 'type.title.3'),
      color: theme.color.textPrimary,
      marginBottom: theme.space['space.3'],
    },
    slogan: {
      ...typography(theme, 'type.body.large'),
      color: theme.color.textSecondary,
      marginTop: theme.space['space.1'],
    },
    statusCopy: {
      flex: 1,
      marginRight: theme.space['space.3'],
    },
    statusDetail: {
      ...typography(theme, 'type.body.small'),
      color: theme.color.textSecondary,
      marginTop: theme.space['space.0_5'],
    },
    statusRow: {
      alignItems: 'flex-start',
      borderTopColor: theme.color.borderDefault,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      paddingVertical: theme.space['space.3'],
    },
    statusSection: {
      marginTop: theme.space['space.6'],
    },
    statusTitle: {
      ...typography(theme, 'type.body'),
      color: theme.color.textPrimary,
    },
    summaryCard: {
      backgroundColor: theme.color.surface,
      borderColor: theme.color.borderDefault,
      borderRadius: theme.radius['radius.lg'],
      borderWidth: 1,
      marginTop: theme.space['space.8'],
      padding: theme.space['space.4'],
    },
    title: {
      ...typography(theme, 'type.display'),
      color: theme.color.textPrimary,
      marginTop: theme.space['space.5'],
    },
  });
}

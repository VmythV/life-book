import { createLifeBookTheme } from '@life-book/design-tokens';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

// 占位入口：阶段 1 会替换为 Expo Router、登录和“今天”页面，见 docs/plan.md。
export function AppRoot() {
  const theme = createLifeBookTheme(useColorScheme() === 'dark' ? 'dark' : 'light');

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.color.canvas }]}>
        <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
        <View style={styles.content}>
          <Text style={[styles.title, { color: theme.color.textPrimary }]}>生活有谱</Text>
          <Text style={[styles.slogan, { color: theme.color.textSecondary }]}>
            每件生活小事，都有着落。
          </Text>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
  },
  slogan: {
    fontSize: 16,
  },
});

import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../lib/theme';

export function Brand() {
  const theme = useTheme();
  return (
    <View style={styles.brand}>
      <Text style={[theme.type['type.title.1'], { color: theme.color.brandPrimary }]}>
        生活有谱
      </Text>
      <Text style={[theme.type['type.body.small'], { color: theme.color.textSecondary }]}>
        每件生活小事，都有着落。
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center', gap: 4, marginTop: 48, marginBottom: 16 },
});

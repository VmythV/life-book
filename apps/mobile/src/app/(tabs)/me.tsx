import { describeError } from '@life-book/api-client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { BodyText, Button, Card, ErrorBanner, Screen, Title } from '../../components/ui';
import { api, meQuery, queryClient } from '../../lib/api';
import { session } from '../../lib/session';
import { useTheme } from '../../lib/theme';

export default function MeScreen() {
  const theme = useTheme();
  const me = useQuery(meQuery);

  // 服务端退出失败（如断网）也在本机退出，令牌会在 30 天后自然过期。
  const logout = useMutation({
    mutationFn: api.auth.logout,
    onSettled: async () => {
      await session.signOut();
      queryClient.clear();
    },
  });

  const rows = me.data
    ? [
        { label: '用户名', value: me.data.user.username },
        { label: '显示名称', value: me.data.user.displayName ?? '未设置' },
        { label: '时区', value: me.data.settings.timezone },
      ]
    : [];

  return (
    <Screen>
      <Title>我的</Title>
      {me.isError ? <ErrorBanner message={describeError(me.error)} /> : null}
      <Card>
        {me.isPending ? <BodyText muted>正在加载…</BodyText> : null}
        {rows.map((row) => (
          <View key={row.label} style={styles.row}>
            <Text style={[theme.type['type.body'], { color: theme.color.textSecondary }]}>
              {row.label}
            </Text>
            <Text style={[theme.type['type.body'], { color: theme.color.textPrimary }]}>
              {row.value}
            </Text>
          </View>
        ))}
      </Card>
      <Button
        label="退出登录"
        variant="secondary"
        loading={logout.isPending}
        onPress={() => logout.mutate()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
});

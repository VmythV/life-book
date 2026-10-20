import { describeError, queryKeys } from '@life-book/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';

import { TimeField } from '../../components/pickers';
import {
  BodyText,
  Button,
  Card,
  ErrorBanner,
  InfoBanner,
  Screen,
  SmallButton,
  TextField,
  Title,
} from '../../components/ui';
import { api, meQuery, useInvalidateRecords } from '../../lib/api';
import {
  cancelAllNotifications,
  getNotificationPermission,
  type NotificationPermission,
  requestNotificationPermission,
} from '../../lib/notifications';
import { clearPersistedCache } from '../../lib/persist';
import { session } from '../../lib/session';
import { useTheme } from '../../lib/theme';

const PERMISSION_LABELS: Record<NotificationPermission, string> = {
  granted: '已开启',
  denied: '已关闭',
  undetermined: '尚未开启',
};

export default function MeScreen() {
  const theme = useTheme();
  const me = useQuery(meQuery);
  const queryClient = useQueryClient();
  const invalidateRecords = useInvalidateRecords();
  const [permission, setPermission] = useState<NotificationPermission | null>(null);

  // 用户可能在系统设置里改了权限，每次回到这个页面都重新读取。
  useFocusEffect(
    useCallback(() => {
      void getNotificationPermission().then(setPermission);
    }, []),
  );

  const updateSettings = useMutation({
    mutationFn: api.me.updateSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      // 时区和默认提醒时间会影响“今天”和提醒的计算。
      await invalidateRecords();
    },
  });

  // 服务端退出失败（如断网）也在本机退出，令牌会在 30 天后自然过期。
  const logout = useMutation({
    mutationFn: api.auth.logout,
    onSettled: async () => {
      await cancelAllNotifications();
      await session.signOut();
      await clearPersistedCache();
    },
  });

  const deviceTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const settings = me.data?.settings;
  const rows = me.data
    ? [
        { label: '用户名', value: me.data.user.username },
        { label: '显示名称', value: me.data.user.displayName ?? '未设置' },
      ]
    : [];

  return (
    <Screen>
      <Title>我的</Title>
      {me.isError && me.data === undefined ? (
        <ErrorBanner message={describeError(me.error)} />
      ) : null}
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

      <Card>
        <BodyText bold>通知</BodyText>
        <View style={styles.row}>
          <BodyText muted>状态</BodyText>
          <BodyText>{permission === null ? '…' : PERMISSION_LABELS[permission]}</BodyText>
        </View>
        {permission === 'undetermined' ? (
          <SmallButton
            label="开启通知"
            variant="primary"
            onPress={() => void requestNotificationPermission().then(setPermission)}
          />
        ) : null}
        {permission === 'denied' ? (
          <>
            <InfoBanner message="通知已关闭：记录照常保存，也会出现在“今天”里，但手机不会按时提醒。可以在系统设置中为“生活有谱”开启通知。" />
            <SmallButton
              label="打开系统设置"
              onPress={() => void Linking.openSettings()}
            />
          </>
        ) : null}
      </Card>

      {settings === undefined ? null : (
        <Card>
          <BodyText bold>偏好</BodyText>
          {updateSettings.isError ? (
            <ErrorBanner message={describeError(updateSettings.error)} />
          ) : null}
          <TimeField
            label="默认提醒时间"
            hint="提醒没有指定时间时使用"
            value={settings.defaultReminderTime}
            onChange={(value) => {
              if (value !== '' && value !== settings.defaultReminderTime) {
                updateSettings.mutate({ defaultReminderTime: value });
              }
            }}
          />
          <View style={styles.row}>
            <BodyText muted>时区</BodyText>
            <BodyText>{settings.timezone}</BodyText>
          </View>
          {deviceTimeZone !== settings.timezone ? (
            <SmallButton
              label={`改为本机时区 ${deviceTimeZone}`}
              onPress={() => updateSettings.mutate({ timezone: deviceTimeZone })}
            />
          ) : null}
        </Card>
      )}

      <Button label="回收站" variant="secondary" onPress={() => router.push('/trash')} />
      <DeleteAccountCard />
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
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    gap: 12,
  },
});

/** 删除账号：输入密码并再次确认。导出数据请在 Web 上进行。 */
function DeleteAccountCard() {
  const [password, setPassword] = useState('');
  const remove = useMutation({
    mutationFn: () => api.me.deleteAccount({ password }),
    onSuccess: async () => {
      await cancelAllNotifications();
      await session.signOut();
      await clearPersistedCache();
    },
  });
  return (
    <Card>
      <BodyText bold>删除账号</BodyText>
      <BodyText muted>
        会永久删除这个账号和全部数据，无法恢复。需要备份的话，先在 Web 的设置里导出数据。
      </BodyText>
      {remove.isError ? <ErrorBanner message={describeError(remove.error)} /> : null}
      <TextField
        label="输入密码确认"
        secureTextEntry
        autoComplete="current-password"
        value={password}
        onChangeText={setPassword}
      />
      <Button
        label="删除账号"
        variant="danger"
        loading={remove.isPending}
        disabled={password === ''}
        onPress={() =>
          Alert.alert('删除账号', '账号和全部数据都会被永久删除，确定吗？', [
            { text: '取消', style: 'cancel' },
            { text: '删除', style: 'destructive', onPress: () => remove.mutate() },
          ])
        }
      />
    </Card>
  );
}

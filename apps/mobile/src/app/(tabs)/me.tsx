import { describeError, isApiError, queryKeys } from '@life-book/api-client';
import {
  changePasswordRequestSchema,
  type FieldErrors,
  validateFields,
} from '@life-book/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';

import { TimeField } from '../../components/pickers';
import { ServerAddress } from '../../components/server-address';
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
  backgroundRestrictionTip,
  cancelAllNotifications,
  getNotificationPermission,
  type NotificationPermission,
  requestNotificationPermission,
  scheduleTestNotification,
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
        {permission === 'granted' ? <ReminderCheck /> : null}
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
      <ChangePasswordCard />
      <DeleteAccountCard />
      <ServerAddress />
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

/** 通知已开启时：测试提醒，以及安卓厂商后台限制的设置说明。 */
function ReminderCheck() {
  const [scheduled, setScheduled] = useState(false);
  const tip = backgroundRestrictionTip();
  return (
    <>
      {scheduled ? (
        <InfoBanner message="已安排，1 分钟后会收到一条“测试提醒”。可以锁屏或从最近任务里划掉应用，看看是否仍能收到。" />
      ) : null}
      <SmallButton
        label="测试提醒（1 分钟后）"
        onPress={() => void scheduleTestNotification().then(() => setScheduled(true))}
      />
      {tip === null ? null : (
        <>
          <InfoBanner message={tip} />
          <SmallButton label="打开应用设置" onPress={() => void Linking.openSettings()} />
        </>
      )}
    </>
  );
}

/** 修改密码：成功后其他设备上的登录失效，本机保持登录。 */
function ChangePasswordCard() {
  const empty = { currentPassword: '', newPassword: '', confirmPassword: '' };
  const [values, setValues] = useState(empty);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const changePassword = useMutation({
    mutationFn: api.auth.changePassword,
    onSuccess: () => setValues(empty),
    onError: (error) => {
      if (isApiError(error, 'WRONG_PASSWORD')) {
        setFieldErrors({ currentPassword: error.message });
      }
    },
  });
  const update = (field: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  function submit() {
    changePassword.reset();
    const { data, errors } = validateFields(changePasswordRequestSchema, values);
    const nextErrors: FieldErrors = { ...errors };
    if (values.confirmPassword !== values.newPassword) {
      nextErrors.confirmPassword = '两次输入的密码不一致';
    }
    if (nextErrors.currentPassword !== undefined) {
      nextErrors.currentPassword = '请输入当前密码';
    }
    setFieldErrors(nextErrors);
    if (data !== null && nextErrors.confirmPassword === undefined) {
      changePassword.mutate(data);
    }
  }

  return (
    <Card>
      <BodyText bold>修改密码</BodyText>
      {changePassword.isSuccess ? (
        <InfoBanner message="密码已修改，其他设备上的登录已失效。" />
      ) : null}
      {changePassword.isError && !isApiError(changePassword.error, 'WRONG_PASSWORD') ? (
        <ErrorBanner message={describeError(changePassword.error)} />
      ) : null}
      <TextField
        label="当前密码"
        secureTextEntry
        autoComplete="current-password"
        value={values.currentPassword}
        onChangeText={update('currentPassword')}
        error={fieldErrors.currentPassword}
      />
      <TextField
        label="新密码"
        hint="至少 8 位"
        secureTextEntry
        autoComplete="new-password"
        value={values.newPassword}
        onChangeText={update('newPassword')}
        error={fieldErrors.newPassword}
      />
      <TextField
        label="确认新密码"
        secureTextEntry
        autoComplete="new-password"
        value={values.confirmPassword}
        onChangeText={update('confirmPassword')}
        error={fieldErrors.confirmPassword}
      />
      <Button
        label="修改密码"
        variant="secondary"
        loading={changePassword.isPending}
        onPress={submit}
      />
    </Card>
  );
}

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

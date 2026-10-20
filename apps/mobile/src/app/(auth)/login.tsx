import { describeError } from '@life-book/api-client';
import { type FieldErrors, loginRequestSchema, validateFields } from '@life-book/core';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button, ErrorBanner, Screen, TextField } from '../../components/ui';
import { ServerAddress } from '../../components/server-address';
import { api } from '../../lib/api';
import { session } from '../../lib/session';
import { useTheme } from '../../lib/theme';
import { Brand } from '../../components/brand';

export default function LoginScreen() {
  const theme = useTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const login = useMutation({
    mutationFn: api.auth.login,
    onSuccess: async ({ token }) => {
      if (token !== undefined) {
        await session.signIn(token);
      }
    },
  });

  function submit() {
    const { data, errors } = validateFields(loginRequestSchema, { username, password });
    setFieldErrors(errors ?? {});
    if (data !== null) {
      login.mutate(data);
    }
  }

  return (
    <Screen>
      <Brand />
      <View style={styles.form}>
        <Text
          accessibilityRole="header"
          style={[theme.type['type.title.2'], { color: theme.color.textPrimary }]}
        >
          登录
        </Text>
        {login.isError ? <ErrorBanner message={describeError(login.error)} /> : null}
        <TextField
          label="用户名"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
          value={username}
          onChangeText={setUsername}
          error={fieldErrors.username === undefined ? undefined : '请输入用户名'}
        />
        <TextField
          label="密码"
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={submit}
          error={fieldErrors.password === undefined ? undefined : '请输入密码'}
        />
        <Button label="登录" onPress={submit} loading={login.isPending} />
        <Link
          href="/register"
          style={[theme.type['type.label'], { color: theme.color.textLink }]}
        >
          还没有账号？注册
        </Link>
      </View>
      <ServerAddress />
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16 },
});

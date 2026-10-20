import { describeError, isApiError } from '@life-book/api-client';
import { type FieldErrors, registerRequestSchema, validateFields } from '@life-book/core';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ServerAddress } from '../../components/server-address';
import { Button, ErrorBanner, Screen, TextField } from '../../components/ui';
import { api } from '../../lib/api';
import { session } from '../../lib/session';
import { useTheme } from '../../lib/theme';
import { Brand } from '../../components/brand';

export default function RegisterScreen() {
  const theme = useTheme();
  const [values, setValues] = useState({
    username: '',
    displayName: '',
    password: '',
    confirmPassword: '',
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const register = useMutation({
    mutationFn: api.auth.register,
    onSuccess: async ({ token }) => {
      if (token !== undefined) {
        await session.signIn(token);
      }
    },
    onError: (error) => {
      if (isApiError(error, 'USERNAME_TAKEN')) {
        setFieldErrors({ username: error.message });
      }
    },
  });

  const update = (field: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  function submit() {
    const { data, errors } = validateFields(registerRequestSchema, {
      username: values.username,
      password: values.password,
      ...(values.displayName.trim() === '' ? {} : { displayName: values.displayName }),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    const nextErrors: FieldErrors = { ...errors };
    if (values.confirmPassword !== values.password) {
      nextErrors.confirmPassword = '两次输入的密码不一致';
    }
    setFieldErrors(nextErrors);
    if (data !== null && nextErrors.confirmPassword === undefined) {
      register.mutate(data);
    }
  }

  const showBanner = register.isError && !isApiError(register.error, 'USERNAME_TAKEN');

  return (
    <Screen>
      <Brand />
      <View style={styles.form}>
        <Text
          accessibilityRole="header"
          style={[theme.type['type.title.2'], { color: theme.color.textPrimary }]}
        >
          注册
        </Text>
        {showBanner ? <ErrorBanner message={describeError(register.error)} /> : null}
        <TextField
          label="用户名"
          hint="3～32 位字母、数字或下划线，用于登录"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
          value={values.username}
          onChangeText={update('username')}
          error={fieldErrors.username}
        />
        <TextField
          label="显示名称（可选）"
          hint="在应用里怎么称呼你"
          value={values.displayName}
          onChangeText={update('displayName')}
          error={fieldErrors.displayName}
        />
        <TextField
          label="密码"
          hint="至少 8 位。没有绑定邮箱，请记好密码"
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          value={values.password}
          onChangeText={update('password')}
          error={fieldErrors.password}
        />
        <TextField
          label="确认密码"
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          value={values.confirmPassword}
          onChangeText={update('confirmPassword')}
          onSubmitEditing={submit}
          error={fieldErrors.confirmPassword}
        />
        <Button label="注册并登录" onPress={submit} loading={register.isPending} />
        <Link
          href="/login"
          style={[theme.type['type.label'], { color: theme.color.textLink }]}
        >
          已有账号？登录
        </Link>
      </View>
      <ServerAddress />
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16 },
});

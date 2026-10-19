import { describeError, isApiError, queryKeys } from '@life-book/api-client';
import { type FieldErrors, registerRequestSchema, validateFields } from '@life-book/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useRouter, useSearch } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';

import { api } from '../api';
import { Alert, Button, TextField } from '../components/ui';
import { AuthLayout } from './auth-layout';

export function RegisterPage() {
  const search = useSearch({ from: '/register' });
  const router = useRouter();
  const queryClient = useQueryClient();
  const [values, setValues] = useState({
    username: '',
    displayName: '',
    password: '',
    confirmPassword: '',
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const register = useMutation({
    mutationFn: api.auth.register,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      router.history.push(search.redirect ?? '/');
    },
    onError: (error) => {
      if (isApiError(error, 'USERNAME_TAKEN')) {
        setFieldErrors({ username: error.message });
      }
    },
  });

  const update = (field: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  function submit(event: FormEvent) {
    event.preventDefault();
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

  const showAlert = register.isError && !isApiError(register.error, 'USERNAME_TAKEN');

  return (
    <AuthLayout title="注册">
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        {showAlert ? <Alert>{describeError(register.error)}</Alert> : null}
        <TextField
          label="用户名"
          hint="3～32 位字母、数字或下划线，用于登录"
          autoComplete="username"
          autoCapitalize="none"
          value={values.username}
          onChange={(event) => update('username')(event.target.value)}
          error={fieldErrors.username}
        />
        <TextField
          label="显示名称（可选）"
          hint="在应用里怎么称呼你"
          value={values.displayName}
          onChange={(event) => update('displayName')(event.target.value)}
          error={fieldErrors.displayName}
        />
        <TextField
          label="密码"
          type="password"
          hint="至少 8 位。没有绑定邮箱，请记好密码"
          autoComplete="new-password"
          value={values.password}
          onChange={(event) => update('password')(event.target.value)}
          error={fieldErrors.password}
        />
        <TextField
          label="确认密码"
          type="password"
          autoComplete="new-password"
          value={values.confirmPassword}
          onChange={(event) => update('confirmPassword')(event.target.value)}
          error={fieldErrors.confirmPassword}
        />
        <Button type="submit" loading={register.isPending} className="mt-2">
          注册并登录
        </Button>
        <p className="text-center text-sm text-fg-muted">
          已有账号？
          <Link to="/login" search={search} className="font-semibold text-link">
            登录
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

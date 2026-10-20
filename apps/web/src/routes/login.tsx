import { describeError, queryKeys } from '@life-book/api-client';
import { type FieldErrors, loginRequestSchema, validateFields } from '@life-book/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearch } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';

import { api } from '../api';
import { Alert, Button, TextField } from '../components/ui';
import { AuthLayout } from './auth-layout';

export function LoginPage() {
  const search = useSearch({ from: '/login' });
  const router = useRouter();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const login = useMutation({
    mutationFn: api.auth.login,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      router.history.push(search.redirect ?? '/');
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const { data, errors } = validateFields(loginRequestSchema, { username, password });
    setFieldErrors(errors ?? {});
    if (data !== null) {
      login.mutate(data);
    }
  }

  return (
    <AuthLayout title="登录">
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        {login.isError ? <Alert>{describeError(login.error)}</Alert> : null}
        <TextField
          label="用户名"
          autoComplete="username"
          autoCapitalize="none"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          error={fieldErrors.username === undefined ? undefined : '请输入用户名'}
        />
        <TextField
          label="密码"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldErrors.password === undefined ? undefined : '请输入密码'}
        />
        <Button type="submit" loading={login.isPending} className="mt-2">
          登录
        </Button>
        <p className="text-center text-sm text-fg-muted">
          还没有账号？请联系管理员开通。
        </p>
      </form>
    </AuthLayout>
  );
}

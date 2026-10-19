import { describeError, isApiError } from '@life-book/api-client';
import {
  changePasswordRequestSchema,
  type FieldErrors,
  validateFields,
} from '@life-book/core';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';

import { api } from '../api';
import { Alert, Button, Card, TextField } from '../components/ui';
import { meQuery } from '../queries';

export function SettingsPage() {
  const { data } = useSuspenseQuery(meQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const logout = useMutation({
    mutationFn: api.auth.logout,
    onSettled: async () => {
      queryClient.clear();
      await navigate({ to: '/login' });
    },
  });

  const joinedAt = new Intl.DateTimeFormat('zh-CN', {
    timeZone: data.settings.timezone,
    dateStyle: 'long',
  }).format(new Date(data.user.createdAt));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-semibold">设置</h1>

      <Card title="账号">
        <dl className="grid grid-cols-[6rem_1fr] gap-y-3 text-sm">
          <dt className="text-fg-muted">用户名</dt>
          <dd>{data.user.username}</dd>
          <dt className="text-fg-muted">显示名称</dt>
          <dd>{data.user.displayName ?? '未设置'}</dd>
          <dt className="text-fg-muted">时区</dt>
          <dd>{data.settings.timezone}</dd>
          <dt className="text-fg-muted">注册时间</dt>
          <dd>{joinedAt}</dd>
        </dl>
      </Card>

      <ChangePasswordCard />

      <div>
        <Button
          variant="secondary"
          loading={logout.isPending}
          onClick={() => logout.mutate()}
        >
          退出登录
        </Button>
      </div>
    </div>
  );
}

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

  function submit(event: FormEvent) {
    event.preventDefault();
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
    <Card title="修改密码">
      <form className="flex max-w-sm flex-col gap-4" onSubmit={submit} noValidate>
        {changePassword.isSuccess ? (
          <p
            role="status"
            className="rounded-lg bg-info-container px-4 py-3 text-sm text-info"
          >
            密码已修改，其他设备上的登录已失效。
          </p>
        ) : null}
        {changePassword.isError && !isApiError(changePassword.error, 'WRONG_PASSWORD') ? (
          <Alert>{describeError(changePassword.error)}</Alert>
        ) : null}
        <TextField
          label="当前密码"
          type="password"
          autoComplete="current-password"
          value={values.currentPassword}
          onChange={(event) => update('currentPassword')(event.target.value)}
          error={fieldErrors.currentPassword}
        />
        <TextField
          label="新密码"
          type="password"
          hint="至少 8 位"
          autoComplete="new-password"
          value={values.newPassword}
          onChange={(event) => update('newPassword')(event.target.value)}
          error={fieldErrors.newPassword}
        />
        <TextField
          label="确认新密码"
          type="password"
          autoComplete="new-password"
          value={values.confirmPassword}
          onChange={(event) => update('confirmPassword')(event.target.value)}
          error={fieldErrors.confirmPassword}
        />
        <div>
          <Button type="submit" loading={changePassword.isPending}>
            修改密码
          </Button>
        </div>
      </form>
    </Card>
  );
}

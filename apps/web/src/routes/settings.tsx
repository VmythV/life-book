import { describeError, EXPORT_PATH, isApiError, queryKeys } from '@life-book/api-client';
import {
  changePasswordRequestSchema,
  type FieldErrors,
  updateSettingsRequestSchema,
  validateFields,
} from '@life-book/core';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';

import { api } from '../api';
import { TaxonomyManager } from '../components/taxonomy-manager';
import { Alert, Button, Card, SelectField, TextField } from '../components/ui';
import { meQuery, useInvalidateRecords } from '../queries';

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
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-3xl font-semibold">设置</h1>

      <Card title="账号">
        <dl className="grid grid-cols-[6rem_1fr] gap-y-3 text-sm">
          <dt className="text-fg-muted">用户名</dt>
          <dd>{data.user.username}</dd>
          <dt className="text-fg-muted">显示名称</dt>
          <dd>{data.user.displayName ?? '未设置'}</dd>
          <dt className="text-fg-muted">创建时间</dt>
          <dd>{joinedAt}</dd>
        </dl>
      </Card>

      <PreferencesCard
        key={`${data.settings.timezone}|${data.settings.defaultReminderTime}`}
        timezone={data.settings.timezone}
        defaultReminderTime={data.settings.defaultReminderTime}
      />

      <TaxonomyManager />

      <ChangePasswordCard />

      <DataCard />

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

/** 浏览器支持的全部 IANA 时区；旧浏览器只给出当前时区。 */
function timeZoneOptions(current: string): string[] {
  const zones =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : [];
  return zones.includes(current) ? zones : [current, ...zones];
}

function PreferencesCard({
  timezone,
  defaultReminderTime,
}: {
  timezone: string;
  defaultReminderTime: string;
}) {
  const queryClient = useQueryClient();
  const invalidateRecords = useInvalidateRecords();
  const [values, setValues] = useState({ timezone, defaultReminderTime });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const save = useMutation({
    mutationFn: api.me.updateSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      // 时区和默认提醒时间会影响“今天”和提醒的计算。
      await invalidateRecords();
    },
  });
  const changed =
    values.timezone !== timezone || values.defaultReminderTime !== defaultReminderTime;

  function submit(event: FormEvent) {
    event.preventDefault();
    save.reset();
    const { data, errors } = validateFields(updateSettingsRequestSchema, values);
    setFieldErrors(errors ?? {});
    if (data !== null) {
      save.mutate(data);
    }
  }

  return (
    <Card title="偏好">
      <form className="flex max-w-sm flex-col gap-4" onSubmit={submit} noValidate>
        {save.isError ? <Alert>{describeError(save.error)}</Alert> : null}
        <SelectField
          label="时区"
          hint="“今天”和提醒按这个时区计算"
          value={values.timezone}
          onChange={(event) =>
            setValues((current) => ({ ...current, timezone: event.target.value }))
          }
          error={fieldErrors.timezone}
        >
          {timeZoneOptions(timezone).map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </SelectField>
        <TextField
          label="默认提醒时间"
          type="time"
          hint="提醒没有指定时间时使用"
          value={values.defaultReminderTime}
          onChange={(event) =>
            setValues((current) => ({
              ...current,
              defaultReminderTime: event.target.value,
            }))
          }
          error={fieldErrors.defaultReminderTime}
        />
        <div>
          <Button type="submit" loading={save.isPending} disabled={!changed}>
            保存
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** 导出全部数据，或删除账号。 */
function DataCard() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const remove = useMutation({
    mutationFn: () => api.me.deleteAccount({ password }),
    onSuccess: async () => {
      await navigate({ to: '/login' });
      queryClient.clear();
    },
  });

  return (
    <Card title="数据与账号">
      <div className="flex flex-col gap-6">
        <div>
          <p className="text-sm text-fg-muted">
            导出账号下的全部记录、分类、标签、模板和库存流水（JSON
            文件），包括已归档和回收站里的。
          </p>
          <a
            href={EXPORT_PATH}
            download
            className="mt-3 inline-flex h-11 items-center rounded-lg border border-line-strong px-5 text-sm font-semibold hover:bg-surface-subtle"
          >
            导出数据
          </a>
        </div>
        <form
          className="flex max-w-sm flex-col gap-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (
              password !== '' &&
              window.confirm(
                '删除后账号和全部数据都无法恢复。建议先导出数据。确定删除吗？',
              )
            ) {
              remove.mutate();
            }
          }}
        >
          <p className="text-sm font-semibold text-danger">删除账号</p>
          <p className="text-sm text-fg-muted">
            会永久删除这个账号和它的全部数据，所有设备都会退出登录。
          </p>
          {remove.isError ? <Alert>{describeError(remove.error)}</Alert> : null}
          <TextField
            label="输入密码确认"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <div>
            <Button
              type="submit"
              variant="danger"
              loading={remove.isPending}
              disabled={password === ''}
            >
              删除账号
            </Button>
          </div>
        </form>
      </div>
    </Card>
  );
}

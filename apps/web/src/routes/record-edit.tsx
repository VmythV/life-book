import { describeError, queryKeys } from '@life-book/api-client';
import {
  type CreateRecordRequest,
  initialRecordFormState,
  type CreatableRecordType,
  isCreatableRecordType,
  RECORD_TYPE_LABELS,
  todayIn,
} from '@life-book/core';
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useState } from 'react';

import { api } from '../api';
import { RecordForm } from '../components/record-form';
import { Alert, Button, Card } from '../components/ui';
import { newId } from '../lib/ids';
import { meQuery, recordQuery, templatesQuery, useInvalidateRecords } from '../queries';

export function NewRecordPage() {
  const { type } = useSearch({ from: '/app/book/new' });
  const { data: me } = useSuspenseQuery(meQuery);
  const navigate = useNavigate();
  const invalidate = useInvalidateRecords();
  const timeZone = me.settings.timezone;
  // 客户端生成 ID：网络重试时服务端会返回同一条记录，不会重复创建。
  const [recordId] = useState(newId);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-3xl font-semibold">新建{RECORD_TYPE_LABELS[type]}</h1>
      {type === 'checklist' ? <FromTemplate recordId={recordId} /> : null}
      <RecordForm
        key={type}
        isNew
        type={type}
        initial={initialRecordFormState(type, todayIn(timeZone), timeZone)}
        timeZone={timeZone}
        submitLabel="保存"
        onSubmit={async (request: CreateRecordRequest) => {
          const record = await api.records.create({ ...request, id: recordId });
          await invalidate();
          await navigate({ to: '/book', search: { id: record.id } });
        }}
        onCancel={() => window.history.back()}
      />
    </div>
  );
}

export function EditRecordPage() {
  const { id } = useParams({ from: '/app/book/$id/edit' });
  const { data: me } = useSuspenseQuery(meQuery);
  const record = useQuery(recordQuery(id));
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const invalidate = useInvalidateRecords();
  const timeZone = me.settings.timezone;

  if (record.isPending) {
    return <p className="text-sm text-fg-muted">正在加载…</p>;
  }
  if (record.isError) {
    return <Alert>{describeError(record.error)}</Alert>;
  }
  const current = record.data;
  if (!isCreatableRecordType(current.type)) {
    return <Alert>这种记录暂不支持编辑。</Alert>;
  }
  const type: CreatableRecordType = current.type;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-3xl font-semibold">编辑{RECORD_TYPE_LABELS[type]}</h1>
      <RecordForm
        // 载入最新内容后用新的版本号重建表单。
        key={current.version}
        type={type}
        initial={initialRecordFormState(type, todayIn(timeZone), timeZone, current)}
        timeZone={timeZone}
        submitLabel="保存"
        onSubmit={async (request: CreateRecordRequest) => {
          const { type: _type, id: _id, ...fields } = request;
          await api.records.update(id, { ...fields, version: current.version });
          await invalidate();
          await navigate({ to: '/book', search: { id } });
        }}
        onCancel={() => window.history.back()}
        conflict={
          <Alert>
            <p>这条记录已在其他地方修改过。载入最新内容后，你需要重新修改。</p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              onClick={() =>
                void queryClient.invalidateQueries({ queryKey: queryKeys.record(id) })
              }
            >
              载入最新内容
            </Button>
          </Alert>
        }
      />
    </div>
  );
}

/** 新建清单时可以直接从模板创建。 */
function FromTemplate({ recordId }: { recordId: string }) {
  const templates = useQuery(templatesQuery);
  const navigate = useNavigate();
  const invalidate = useInvalidateRecords();
  const instantiate = useMutation({
    mutationFn: (templateId: string) =>
      api.templates.instantiate(templateId, { id: recordId }),
    onSuccess: async (record) => {
      await invalidate();
      await navigate({ to: '/book', search: { id: record.id } });
    },
  });
  const items = templates.data?.items ?? [];
  if (items.length === 0) {
    return null;
  }
  return (
    <Card title="从模板创建">
      {instantiate.isError ? <Alert>{describeError(instantiate.error)}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        {items.map((template) => (
          <Button
            key={template.id}
            size="sm"
            variant="secondary"
            disabled={instantiate.isPending}
            onClick={() => instantiate.mutate(template.id)}
          >
            {template.title}（{template.items.length} 项）
          </Button>
        ))}
      </div>
      <p className="mt-3 text-xs text-fg-subtle">或者在下面从头填写。</p>
    </Card>
  );
}

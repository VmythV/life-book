import { describeError, queryKeys } from '@life-book/api-client';
import {
  type ChecklistTemplate,
  createTemplateRequestSchema,
  describeQuantity,
  type FieldErrors,
  type RecordFormChecklistItem,
  validateFields,
} from '@life-book/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';

import { api } from '../api';
import { ChecklistItemsEditor } from '../components/record-form';
import { Alert, Badge, Button, EmptyState, TextArea, TextField } from '../components/ui';
import { newId } from '../lib/ids';
import { templatesQuery, useInvalidateRecords } from '../queries';

export interface TemplatesSearch {
  /** 选中的模板 ID；`new` 表示新建。 */
  id?: string | undefined;
}

export function validateTemplatesSearch(
  search: Record<string, unknown>,
): TemplatesSearch {
  return typeof search.id === 'string' && search.id !== '' ? { id: search.id } : {};
}

export function TemplatesPage() {
  const { id } = useSearch({ from: '/app/templates' });
  const templates = useQuery(templatesQuery);
  const items = templates.data?.items ?? [];
  const selected = items.find((template) => template.id === id);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">清单模板</h1>
          <p className="mt-1 text-sm text-fg-muted">
            常用的清单存成模板，下次直接用它新建，例如出差、搬家、每周采购。
          </p>
        </div>
        <Link
          to="/templates"
          search={{ id: 'new' }}
          className="inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-on-primary hover:bg-primary-hover"
        >
          新建模板
        </Link>
      </header>
      <div className="grid gap-6 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className={id === undefined ? '' : 'hidden md:block'}>
          {templates.isPending ? (
            <p className="text-sm text-fg-muted">正在加载…</p>
          ) : null}
          {templates.isError ? <Alert>{describeError(templates.error)}</Alert> : null}
          {templates.isSuccess && items.length === 0 ? (
            <EmptyState title="还没有模板">也可以在清单详情里“另存为模板”。</EmptyState>
          ) : null}
          {items.length === 0 ? null : (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
              {items.map((template) => (
                <li key={template.id}>
                  <Link
                    to="/templates"
                    search={{ id: template.id }}
                    className="block px-4 py-3 hover:bg-surface-subtle"
                    activeOptions={{ includeSearch: true }}
                    activeProps={{ className: 'bg-surface-subtle' }}
                  >
                    <span className="font-semibold">{template.title}</span>
                    <p className="mt-0.5 text-xs text-fg-muted">
                      {template.items.length} 项
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={id === undefined ? 'hidden md:block' : ''}>
          {id === undefined ? (
            <EmptyState title="选择一个模板查看或修改" />
          ) : id === 'new' ? (
            <TemplateEditor key="new" />
          ) : selected === undefined ? (
            templates.isPending ? null : (
              <Alert>模板不存在</Alert>
            )
          ) : (
            <TemplateEditor
              key={`${selected.id}:${selected.updatedAt}`}
              template={selected}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function toRows(template: ChecklistTemplate | undefined): RecordFormChecklistItem[] {
  return (template?.items ?? []).map((item) => ({
    groupName: item.groupName ?? '',
    title: item.title,
    quantity: item.quantity === null ? '' : String(item.quantity),
    unit: item.unit ?? '',
  }));
}

function TemplateEditor({ template }: { template?: ChecklistTemplate }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const invalidateRecords = useInvalidateRecords();
  const [title, setTitle] = useState(template?.title ?? '');
  const [notes, setNotes] = useState(template?.notes ?? '');
  const [rows, setRows] = useState(() => toRows(template));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.templates });

  const save = useMutation({
    mutationFn: (input: Parameters<typeof api.templates.create>[0]) =>
      template === undefined
        ? api.templates.create(input)
        : api.templates.update(template.id, input),
    onSuccess: async (saved) => {
      await refresh();
      await navigate({ to: '/templates', search: { id: saved.id }, replace: true });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.templates.remove(id),
    onSuccess: async () => {
      await refresh();
      await navigate({ to: '/templates', search: {} });
    },
  });
  const instantiate = useMutation({
    mutationFn: (id: string) => api.templates.instantiate(id, { id: newId() }),
    onSuccess: async (record) => {
      await invalidateRecords();
      await navigate({ to: '/book', search: { id: record.id } });
    },
  });
  const error = save.error ?? remove.error ?? instantiate.error;

  function submit(event: FormEvent) {
    event.preventDefault();
    const input = {
      title,
      notes,
      items: rows
        .filter((row) => row.title.trim() !== '')
        .map((row) => ({
          groupName: row.groupName,
          title: row.title,
          quantity: row.quantity.trim() === '' ? null : Number(row.quantity),
          unit: row.unit,
        })),
    };
    const { data, errors } = validateFields(createTemplateRequestSchema, input);
    setFieldErrors(errors ?? {});
    if (data !== null) {
      save.mutate(input);
    }
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 md:p-6"
    >
      <Link
        to="/templates"
        search={{}}
        className="text-sm font-semibold text-link md:hidden"
      >
        ← 返回列表
      </Link>
      {template === undefined ? null : (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            loading={instantiate.isPending}
            onClick={() => instantiate.mutate(template.id)}
          >
            用这个模板新建清单
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={remove.isPending}
            onClick={() => {
              if (
                window.confirm(
                  `删除模板“${template.title}”？已经用它创建的清单不受影响。`,
                )
              ) {
                remove.mutate(template.id);
              }
            }}
          >
            删除模板
          </Button>
        </div>
      )}
      {error === null ? null : <Alert>{describeError(error)}</Alert>}
      <TextField
        label="模板名称"
        value={title}
        maxLength={200}
        onChange={(event) => setTitle(event.target.value)}
        error={fieldErrors.title}
        placeholder="如：出差"
      />
      <TextArea
        label="说明（可选）"
        value={notes}
        rows={2}
        onChange={(event) => setNotes(event.target.value)}
      />
      <ChecklistItemsEditor items={rows} onChange={setRows} />
      {fieldErrors.items === undefined ? null : <Alert>{fieldErrors.items}</Alert>}
      {template === undefined ? null : (
        <p className="text-xs text-fg-subtle">
          共 {template.items.length} 项：
          {template.items
            .slice(0, 5)
            .map((item) =>
              [item.title, describeQuantity(item.quantity, item.unit)]
                .filter(Boolean)
                .join(' '),
            )
            .join('、')}
          {template.items.length > 5 ? '…' : ''}
        </p>
      )}
      <div className="flex gap-3">
        <Button type="submit" loading={save.isPending}>
          {template === undefined ? '创建模板' : '保存'}
        </Button>
        {template === undefined ? null : <Badge>修改模板不会影响已创建的清单</Badge>}
      </div>
    </form>
  );
}

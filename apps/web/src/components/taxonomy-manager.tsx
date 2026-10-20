import { describeError, queryKeys } from '@life-book/api-client';
import { type Taxonomy } from '@life-book/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';

import { api } from '../api';
import { useInvalidateRecords } from '../queries';
import { Alert, Button, Card } from './ui';

type Kind = 'categories' | 'tags';

const LABELS: Record<Kind, string> = { categories: '分类', tags: '标签' };

/** 设置页里管理分类和标签：重命名、删除，分类还可以调整顺序。 */
export function TaxonomyManager() {
  return (
    <Card title="分类和标签">
      <div className="grid gap-6 md:grid-cols-2">
        <TaxonomyList kind="categories" />
        <TaxonomyList kind="tags" />
      </div>
    </Card>
  );
}

function TaxonomyList({ kind }: { kind: Kind }) {
  const queryClient = useQueryClient();
  const invalidateRecords = useInvalidateRecords();
  // 与 categoriesQuery、tagsQuery 使用相同的查询键，缓存共享。
  const list = useQuery({ queryKey: queryKeys[kind], queryFn: () => api[kind].list() });
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [newName, setNewName] = useState('');
  const items = list.data?.items ?? [];
  const label = LABELS[kind];
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys[kind] });
    // 删除后记录的分类和标签会变化。
    await invalidateRecords();
  };

  const create = useMutation({
    mutationFn: (name: string) => api[kind].create({ name }),
    onSuccess: () => setNewName(''),
    onSettled: refresh,
  });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api[kind].update(id, { name }),
    onSuccess: () => setEditing(null),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api[kind].remove(id),
    onSettled: refresh,
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.categories.reorder({ ids }),
    onSettled: refresh,
  });
  const error = create.error ?? rename.error ?? remove.error ?? reorder.error;

  function move(index: number, offset: number) {
    const ids = items.map((item) => item.id);
    const [moved] = ids.splice(index, 1);
    if (moved !== undefined) {
      ids.splice(index + offset, 0, moved);
      reorder.mutate(ids);
    }
  }

  function submitNew(event: FormEvent) {
    event.preventDefault();
    if (newName.trim() !== '') {
      create.mutate(newName);
    }
  }

  function confirmRemove(item: Taxonomy) {
    const message =
      kind === 'categories'
        ? `删除分类“${item.name}”？使用它的记录会变成没有分类。`
        : `删除标签“${item.name}”？会从所有记录上去掉。`;
    if (window.confirm(message)) {
      remove.mutate(item.id);
    }
  }

  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">{label}</h3>
      {error === null ? null : <Alert>{describeError(error)}</Alert>}
      {items.length === 0 ? (
        <p className="text-sm text-fg-muted">还没有{label}。</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {items.map((item, index) => (
            <li key={item.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              {editing?.id === item.id ? (
                <form
                  className="flex flex-1 gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    rename.mutate(editing);
                  }}
                >
                  <input
                    aria-label={`${label}名称`}
                    autoFocus
                    value={editing.name}
                    maxLength={30}
                    onChange={(event) =>
                      setEditing({ id: item.id, name: event.target.value })
                    }
                    className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-fg"
                  />
                  <Button type="submit" size="sm" loading={rename.isPending}>
                    保存
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    取消
                  </Button>
                </form>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  {kind === 'categories' ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`上移 ${item.name}`}
                        disabled={index === 0 || reorder.isPending}
                        onClick={() => move(index, -1)}
                      >
                        ↑
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`下移 ${item.name}`}
                        disabled={index === items.length - 1 || reorder.isPending}
                        onClick={() => move(index, 1)}
                      >
                        ↓
                      </Button>
                    </>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing({ id: item.id, name: item.name })}
                  >
                    重命名
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`删除 ${item.name}`}
                    disabled={remove.isPending}
                    onClick={() => confirmRemove(item)}
                  >
                    删除
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submitNew} className="mt-2 flex gap-2">
        <input
          aria-label={`新${label}`}
          placeholder={`新${label}`}
          value={newName}
          maxLength={30}
          onChange={(event) => setNewName(event.target.value)}
          className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-sm text-fg placeholder:text-fg-subtle"
        />
        <Button type="submit" size="sm" variant="secondary" loading={create.isPending}>
          添加
        </Button>
      </form>
    </section>
  );
}

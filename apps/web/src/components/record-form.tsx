import { describeError, isApiError } from '@life-book/api-client';
import {
  createRecordRequestSchema,
  type CreateRecordRequest,
  DAYS_BEFORE_PRESETS,
  type FieldErrors,
  FREQ_LABELS,
  IMPORTANT_DATE_KIND_LABELS,
  importantDateKinds,
  INTERVAL_UNITS,
  type ChecklistPurpose,
  CHECKLIST_PURPOSE_LABELS,
  checklistPurposes,
  type CreatableRecordType,
  type RecordFormChecklistItem,
  type RecordFormFreq,
  type RecordFormReminder,
  type RecordFormState,
  TODAY_VISIBILITY_HINTS,
  toRecordRequest,
  validateFields,
  weekdayName,
} from '@life-book/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';

import { api } from '../api';
import { categoriesQuery, tagsQuery } from '../queries';
import { Alert, Button, Checkbox, SelectField, TextArea, TextField } from './ui';

export function RecordForm({
  type,
  initial,
  timeZone,
  submitLabel,
  onSubmit,
  onCancel,
  conflict,
  isNew = false,
}: {
  type: CreatableRecordType;
  /** 新建时可以一起填写清单项目；编辑时项目在详情里修改。 */
  isNew?: boolean;
  initial: RecordFormState;
  timeZone: string;
  submitLabel: string;
  onSubmit: (request: CreateRecordRequest) => Promise<unknown>;
  onCancel: () => void;
  /** 保存时版本冲突：提供“载入最新内容”的操作。 */
  conflict?: ReactNode;
}) {
  const [state, setState] = useState(initial);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const submit = useMutation({ mutationFn: onSubmit });

  // 修改某一部分后，清掉这一部分上次提交时的错误。
  const clearError = (field: string) =>
    setFieldErrors((current) => {
      if (current[field] === undefined) {
        return current;
      }
      const { [field]: _removed, ...rest } = current;
      return rest;
    });
  const update = <K extends keyof RecordFormState>(key: K, value: RecordFormState[K]) => {
    clearError(key);
    setState((current) => ({ ...current, [key]: value }));
  };
  const updateRule = (patch: Partial<RecordFormState['recurring']>) => {
    clearError('recurring');
    setState((current) => ({
      ...current,
      recurring: { ...current.recurring, ...patch },
    }));
  };
  const updateChecklist = (patch: Partial<RecordFormState['checklist']>) => {
    clearError('checklist');
    setState((current) => ({
      ...current,
      checklist: { ...current.checklist, ...patch },
    }));
  };
  const updateHousehold = (patch: Partial<RecordFormState['householdItem']>) => {
    clearError('householdItem');
    setState((current) => ({
      ...current,
      householdItem: { ...current.householdItem, ...patch },
    }));
  };
  const updateDate = (patch: Partial<RecordFormState['importantDate']>) => {
    clearError('importantDate');
    setState((current) => ({
      ...current,
      importantDate: { ...current.importantDate, ...patch },
    }));
  };

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const request = toRecordRequest(type, state, timeZone);
    const { data, errors } = validateFields(createRecordRequestSchema, request);
    setFieldErrors(errors ?? {});
    if (data !== null) {
      submit.mutate(request);
    }
  }

  const rule = state.recurring;
  const date = state.importantDate;

  return (
    <form className="flex flex-col gap-6" onSubmit={handleSubmit} noValidate>
      {submit.isError ? (
        isApiError(submit.error, 'VERSION_CONFLICT') && conflict !== undefined ? (
          conflict
        ) : (
          <Alert>{describeError(submit.error)}</Alert>
        )
      ) : null}

      <div className="flex flex-col gap-4">
        <TextField
          label={type === 'memo' ? '标题（可选）' : '标题'}
          value={state.title}
          maxLength={200}
          onChange={(event) => update('title', event.target.value)}
          error={fieldErrors.title}
          placeholder={
            type === 'recurring'
              ? '如：给绿植浇水'
              : type === 'important_date'
                ? '如：妈妈的生日'
                : type === 'checklist'
                  ? '如：出差行李'
                  : type === 'household_item'
                    ? '如：抽纸'
                    : '如：家里 Wi-Fi'
          }
        />
        <TextArea
          label={type === 'memo' ? '内容' : '说明（可选）'}
          value={state.notes}
          onChange={(event) => update('notes', event.target.value)}
          error={fieldErrors.notes}
          rows={type === 'memo' ? 8 : 3}
        />
      </div>

      {type === 'recurring' ? (
        <FormSection title="重复" error={fieldErrors.recurring}>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="频率"
              value={rule.freq}
              onChange={(event) =>
                updateRule({ freq: event.target.value as RecordFormFreq })
              }
            >
              {(Object.keys(FREQ_LABELS) as RecordFormFreq[]).map((freq) => (
                <option key={freq} value={freq}>
                  {FREQ_LABELS[freq]}
                </option>
              ))}
            </SelectField>
            <TextField
              label={`每隔几${INTERVAL_UNITS[rule.freq]}`}
              type="number"
              min={1}
              max={99}
              value={rule.interval}
              onChange={(event) => updateRule({ interval: event.target.value })}
            />
          </div>
          {rule.freq === 'weekly' ? (
            <fieldset>
              <legend className="mb-1.5 text-sm font-semibold">星期</legend>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5, 6, 7].map((weekday) => {
                  const selected = rule.byWeekdays.includes(weekday);
                  return (
                    <button
                      key={weekday}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        updateRule({
                          byWeekdays: selected
                            ? rule.byWeekdays.filter((value) => value !== weekday)
                            : [...rule.byWeekdays, weekday],
                        })
                      }
                      className={`h-9 rounded-full border px-3 text-sm font-semibold ${selected ? 'border-primary bg-primary text-on-primary' : 'border-line text-fg-muted hover:bg-surface-subtle'}`}
                    >
                      {weekdayName(weekday)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            {rule.freq === 'monthly' ? (
              <TextField
                label="每月几号"
                type="number"
                min={1}
                max={31}
                hint="当月没有这一天时，取当月最后一天"
                value={rule.byMonthDay}
                onChange={(event) => updateRule({ byMonthDay: event.target.value })}
              />
            ) : null}
            <TextField
              label={rule.freq === 'yearly' ? '日期' : '开始日期'}
              type="date"
              value={rule.startDate}
              hint={
                rule.freq === 'yearly'
                  ? '每年的这一天；2 月 29 日在平年取 28 日'
                  : undefined
              }
              onChange={(event) => updateRule({ startDate: event.target.value })}
            />
            <TextField
              label="时间（可选）"
              type="time"
              hint="不填表示全天"
              value={rule.timeOfDay}
              onChange={(event) => updateRule({ timeOfDay: event.target.value })}
            />
            <SelectField
              label="结束"
              value={rule.endType}
              onChange={(event) =>
                updateRule({
                  endType: event.target.value as RecordFormState['recurring']['endType'],
                })
              }
            >
              <option value="never">一直重复</option>
              <option value="until">到某天为止</option>
              <option value="count">重复一定次数</option>
            </SelectField>
            {rule.endType === 'until' ? (
              <TextField
                label="结束日期"
                type="date"
                value={rule.until}
                onChange={(event) => updateRule({ until: event.target.value })}
              />
            ) : null}
            {rule.endType === 'count' ? (
              <TextField
                label="次数"
                type="number"
                min={1}
                value={rule.count}
                onChange={(event) => updateRule({ count: event.target.value })}
              />
            ) : null}
          </div>
        </FormSection>
      ) : null}

      {type === 'important_date' ? (
        <FormSection title="日期" error={fieldErrors.importantDate}>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="种类"
              value={date.kind}
              onChange={(event) =>
                updateDate({
                  kind: event.target.value as RecordFormState['importantDate']['kind'],
                })
              }
            >
              {importantDateKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {IMPORTANT_DATE_KIND_LABELS[kind]}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="重复"
              value={date.repeat}
              onChange={(event) =>
                updateDate({ repeat: event.target.value as 'once' | 'yearly' })
              }
            >
              <option value="yearly">每年</option>
              <option value="once">仅一次</option>
            </SelectField>
            <TextField
              label="日期"
              type="date"
              value={date.date}
              hint={date.repeat === 'yearly' ? '每年重复时只看月和日' : undefined}
              onChange={(event) => updateDate({ date: event.target.value })}
            />
            {date.kind === 'birthday' || date.kind === 'anniversary' ? (
              <TextField
                label={date.kind === 'birthday' ? '出生年份（可选）' : '起始年份（可选）'}
                type="number"
                min={1900}
                max={2200}
                hint={date.kind === 'birthday' ? '用于显示年龄' : '用于显示第几周年'}
                value={date.startYear}
                onChange={(event) => updateDate({ startYear: event.target.value })}
              />
            ) : null}
          </div>
          {date.startYear === '' ? null : (
            <Checkbox
              label={date.kind === 'birthday' ? '显示年龄' : '显示第几周年'}
              checked={date.showCounter}
              onChange={(event) => updateDate({ showCounter: event.target.checked })}
            />
          )}
        </FormSection>
      ) : null}

      {type === 'checklist' ? (
        <FormSection title="清单" error={fieldErrors.checklist}>
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField
              label="用途"
              value={state.checklist.purpose}
              onChange={(event) =>
                updateChecklist({ purpose: event.target.value as ChecklistPurpose })
              }
            >
              {checklistPurposes.map((purpose) => (
                <option key={purpose} value={purpose}>
                  {CHECKLIST_PURPOSE_LABELS[purpose]}
                </option>
              ))}
            </SelectField>
            <TextField
              label="截止日期（可选）"
              type="date"
              value={state.checklist.dueDate}
              onChange={(event) => updateChecklist({ dueDate: event.target.value })}
            />
            <TextField
              label="截止时间（可选）"
              type="time"
              hint="不填表示当天结束前"
              disabled={state.checklist.dueDate === ''}
              value={state.checklist.dueTime}
              onChange={(event) => updateChecklist({ dueTime: event.target.value })}
            />
          </div>
          {isNew ? (
            <ChecklistItemsEditor
              items={state.checklist.items}
              onChange={(items) => updateChecklist({ items })}
            />
          ) : (
            <p className="text-sm text-fg-muted">项目在详情里直接添加、勾选和删除。</p>
          )}
        </FormSection>
      ) : null}

      {type === 'household_item' ? (
        <FormSection title="库存" error={fieldErrors.householdItem}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="单位"
              placeholder="如：包、瓶、个、kg"
              value={state.householdItem.unit}
              maxLength={10}
              onChange={(event) => updateHousehold({ unit: event.target.value })}
            />
            {isNew ? (
              <TextField
                label="现有数量"
                inputMode="decimal"
                placeholder="0"
                hint="会记为一条“期初”流水"
                value={state.householdItem.quantity}
                onChange={(event) => updateHousehold({ quantity: event.target.value })}
              />
            ) : null}
            <TextField
              label="最低库存（可选）"
              inputMode="decimal"
              hint="数量不高于它时算低库存，提醒一次"
              value={state.householdItem.lowStockThreshold}
              onChange={(event) =>
                updateHousehold({ lowStockThreshold: event.target.value })
              }
            />
            <TextField
              label="存放位置（可选）"
              placeholder="如：厨房、储物间"
              value={state.householdItem.location}
              maxLength={50}
              onChange={(event) => updateHousehold({ location: event.target.value })}
            />
          </div>
          {isNew ? null : (
            <p className="text-sm text-fg-muted">
              数量在详情里通过买入、使用、调整来改变。
            </p>
          )}
        </FormSection>
      ) : null}

      {type === 'household_item' ? null : (
        <RemindersEditor
          type={type}
          reminders={state.reminders}
          error={fieldErrors.reminders}
          onChange={(reminders) => update('reminders', reminders)}
        />
      )}

      <FormSection title="整理">
        <TaxonomyPicker
          categoryId={state.categoryId}
          tagIds={state.tagIds}
          onCategoryChange={(categoryId) => update('categoryId', categoryId)}
          onTagsChange={(tagIds) => update('tagIds', tagIds)}
        />
        <Checkbox
          label="置顶"
          checked={state.isPinned}
          onChange={(event) => update('isPinned', event.target.checked)}
        />
      </FormSection>

      <div className="flex gap-3">
        <Button type="submit" loading={submit.isPending}>
          {submitLabel}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  );
}

function FormSection({
  title,
  error,
  children,
}: {
  title: string;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-4 rounded-2xl border border-line p-4 md:p-5">
      <legend className="px-1 text-sm font-semibold text-fg-muted">{title}</legend>
      {error === undefined ? null : <Alert>{error}</Alert>}
      {children}
    </fieldset>
  );
}

const emptyItem: RecordFormChecklistItem = {
  groupName: '',
  title: '',
  quantity: '',
  unit: '',
};

/** 新建清单时一次填写多个项目；最后一行有内容时自动补一个空行。 */
export function ChecklistItemsEditor({
  items,
  onChange,
}: {
  items: RecordFormChecklistItem[];
  onChange: (items: RecordFormChecklistItem[]) => void;
}) {
  const rows =
    items.length === 0 || items.at(-1)?.title !== '' ? [...items, emptyItem] : items;
  const replace = (index: number, patch: Partial<RecordFormChecklistItem>) =>
    onChange(rows.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  const input =
    'h-9 min-w-0 rounded-lg border border-line bg-surface px-2 text-sm text-fg placeholder:text-fg-subtle';

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold">项目</p>
      {rows.map((item, index) => (
        <div key={index} className="grid grid-cols-[minmax(0,1fr)_6rem_4rem_4rem] gap-2">
          <input
            aria-label={`项目 ${index + 1}`}
            placeholder="项目名称"
            value={item.title}
            maxLength={200}
            onChange={(event) => replace(index, { title: event.target.value })}
            className={input}
          />
          <input
            aria-label={`项目 ${index + 1} 的分组`}
            placeholder="分组"
            value={item.groupName}
            maxLength={30}
            onChange={(event) => replace(index, { groupName: event.target.value })}
            className={input}
          />
          <input
            aria-label={`项目 ${index + 1} 的数量`}
            placeholder="数量"
            inputMode="decimal"
            value={item.quantity}
            onChange={(event) => replace(index, { quantity: event.target.value })}
            className={input}
          />
          <input
            aria-label={`项目 ${index + 1} 的单位`}
            placeholder="单位"
            value={item.unit}
            maxLength={10}
            onChange={(event) => replace(index, { unit: event.target.value })}
            className={input}
          />
        </div>
      ))}
      <p className="text-xs text-fg-subtle">分组、数量和单位都可以不填。</p>
    </div>
  );
}

function RemindersEditor({
  type,
  reminders,
  error,
  onChange,
}: {
  type: CreatableRecordType;
  reminders: RecordFormReminder[];
  error: string | undefined;
  onChange: (reminders: RecordFormReminder[]) => void;
}) {
  const replace = (index: number, draft: RecordFormReminder) =>
    onChange(reminders.map((current, i) => (i === index ? draft : current)));
  const add = () =>
    onChange([
      ...reminders,
      type === 'memo' || type === 'checklist'
        ? { kind: 'absolute', date: '', time: '09:00' }
        : { kind: 'relative', daysBefore: '0', timeOfDay: '' },
    ]);

  return (
    <FormSection title="提醒" error={error}>
      {reminders.length === 0 ? (
        <p className="text-sm text-fg-muted">
          {TODAY_VISIBILITY_HINTS[type]}；手机上设置提醒后会按时通知。
        </p>
      ) : null}
      {reminders.map((draft, index) => (
        <div key={index} className="flex flex-wrap items-end gap-3">
          {draft.kind === 'absolute' ? (
            <>
              <TextField
                label="日期"
                type="date"
                value={draft.date}
                onChange={(event) =>
                  replace(index, { ...draft, date: event.target.value })
                }
              />
              <TextField
                label="时间"
                type="time"
                value={draft.time}
                onChange={(event) =>
                  replace(index, { ...draft, time: event.target.value })
                }
              />
            </>
          ) : (
            <>
              <SelectField
                label="何时"
                value={draft.daysBefore}
                onChange={(event) =>
                  replace(index, { ...draft, daysBefore: event.target.value })
                }
              >
                {DAYS_BEFORE_PRESETS.map((days) => (
                  <option key={days} value={days}>
                    {days === '0' ? '当天' : `提前 ${days} 天`}
                  </option>
                ))}
              </SelectField>
              <TextField
                label="时间（可选）"
                type="time"
                value={draft.timeOfDay}
                onChange={(event) =>
                  replace(index, { ...draft, timeOfDay: event.target.value })
                }
              />
            </>
          )}
          <Button
            variant="ghost"
            onClick={() => onChange(reminders.filter((_, i) => i !== index))}
          >
            删除
          </Button>
        </div>
      ))}
      {type !== 'memo' && reminders.some((draft) => draft.kind === 'relative') ? (
        <p className="text-xs text-fg-subtle">
          时间不填时，使用{type === 'recurring' ? '重复的时间，再没有则用' : ''}
          设置里的默认提醒时间。
        </p>
      ) : null}
      <div>
        <Button variant="secondary" size="sm" onClick={add}>
          添加提醒
        </Button>
      </div>
    </FormSection>
  );
}

function TaxonomyPicker({
  categoryId,
  tagIds,
  onCategoryChange,
  onTagsChange,
}: {
  categoryId: string;
  tagIds: string[];
  onCategoryChange: (id: string) => void;
  onTagsChange: (ids: string[]) => void;
}) {
  const queryClient = useQueryClient();
  const categories = useQuery(categoriesQuery);
  const tags = useQuery(tagsQuery);
  const [newCategory, setNewCategory] = useState<string | null>(null);
  const [newTag, setNewTag] = useState('');

  const createCategory = useMutation({
    mutationFn: (name: string) => api.categories.create({ name }),
    onSuccess: async (category) => {
      await queryClient.invalidateQueries({ queryKey: categoriesQuery.queryKey });
      onCategoryChange(category.id);
      setNewCategory(null);
    },
  });
  const createTag = useMutation({
    mutationFn: (name: string) => api.tags.create({ name }),
    onSuccess: async (tag) => {
      await queryClient.invalidateQueries({ queryKey: tagsQuery.queryKey });
      if (!tagIds.includes(tag.id)) {
        onTagsChange([...tagIds, tag.id]);
      }
      setNewTag('');
    },
  });

  return (
    <div className="flex flex-col gap-4">
      {newCategory === null ? (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <SelectField
              label="分类"
              value={categoryId}
              onChange={(event) => onCategoryChange(event.target.value)}
            >
              <option value="">无</option>
              {(categories.data?.items ?? []).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </SelectField>
          </div>
          <Button variant="secondary" onClick={() => setNewCategory('')}>
            新建分类
          </Button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <TextField
              label="新分类名称"
              value={newCategory}
              maxLength={30}
              autoFocus
              onChange={(event) => setNewCategory(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (newCategory.trim() !== '') {
                    createCategory.mutate(newCategory);
                  }
                }
              }}
              error={
                createCategory.isError ? describeError(createCategory.error) : undefined
              }
            />
          </div>
          <Button
            loading={createCategory.isPending}
            disabled={newCategory.trim() === ''}
            onClick={() => createCategory.mutate(newCategory)}
          >
            添加
          </Button>
          <Button variant="ghost" onClick={() => setNewCategory(null)}>
            取消
          </Button>
        </div>
      )}

      <div>
        <p className="mb-1.5 text-sm font-semibold">标签</p>
        <div className="flex flex-wrap items-center gap-2">
          {(tags.data?.items ?? []).map((tag) => {
            const selected = tagIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  onTagsChange(
                    selected ? tagIds.filter((id) => id !== tag.id) : [...tagIds, tag.id],
                  )
                }
                className={`h-8 rounded-full border px-3 text-xs font-semibold ${selected ? 'border-primary bg-primary text-on-primary' : 'border-line text-fg-muted hover:bg-surface-subtle'}`}
              >
                {tag.name}
              </button>
            );
          })}
          <input
            aria-label="新标签"
            placeholder="输入新标签后回车"
            value={newTag}
            maxLength={30}
            onChange={(event) => setNewTag(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (newTag.trim() !== '') {
                  createTag.mutate(newTag);
                }
              }
            }}
            className="h-8 w-44 rounded-full border border-dashed border-line bg-transparent px-3 text-xs text-fg placeholder:text-fg-subtle"
          />
        </div>
        {createTag.isError ? (
          <p className="mt-1 text-xs text-danger">{describeError(createTag.error)}</p>
        ) : null}
      </div>
    </div>
  );
}

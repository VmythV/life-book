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
  CHECKLIST_PURPOSE_LABELS,
  checklistPurposes,
  type CreatableRecordType,
  type RecordFormChecklistItem,
  type RecordFormFreq,
  type RecordFormReminder,
  type RecordFormState,
  TODAY_VISIBILITY_HINTS,
  DISCARD_CHANGES_MESSAGE,
  isRecordFormDirty,
  todayIn,
  toRecordRequest,
  validateFields,
  weekdayName,
} from '@life-book/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { Alert, Linking, StyleSheet, Text, TextInput, View } from 'react-native';

import { api, categoriesQuery, tagsQuery } from '../lib/api';
import { requestNotificationPermission } from '../lib/notifications';
import { useTheme } from '../lib/theme';
import { DateField, TimeField } from './pickers';
import {
  Button,
  Card,
  Chip,
  ChipGroup,
  ErrorBanner,
  FieldLabel,
  InfoBanner,
  SmallButton,
  SwitchRow,
  TextField,
} from './ui';

export function RecordForm({
  type,
  initial,
  timeZone,
  submitLabel,
  onSubmit,
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
  /** 保存时版本冲突：提供“载入最新内容”的操作。 */
  conflict?: ReactNode;
}) {
  const [state, setState] = useState(initial);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const submit = useMutation({ mutationFn: onSubmit });
  const navigation = useNavigation();
  // 有未保存的修改时，返回前先确认；保存成功后由调用方离开，不再拦截。
  usePreventRemove(
    isRecordFormDirty(initial, state) && !submit.isPending && !submit.isSuccess,
    ({ data }) =>
      Alert.alert('放弃修改？', DISCARD_CHANGES_MESSAGE, [
        { text: '继续编辑', style: 'cancel' },
        {
          text: '放弃',
          style: 'destructive',
          onPress: () => navigation.dispatch(data.action),
        },
      ]),
  );

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

  function handleSubmit() {
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
    <View style={styles.form}>
      {submit.isError ? (
        isApiError(submit.error, 'VERSION_CONFLICT') && conflict !== undefined ? (
          conflict
        ) : (
          <ErrorBanner message={describeError(submit.error)} />
        )
      ) : null}
      {Object.keys(fieldErrors).length > 0 ? (
        <ErrorBanner message="有些内容需要修改，请查看下方的提示。" />
      ) : null}

      <TextField
        label={type === 'memo' ? '标题（可选）' : '标题'}
        value={state.title}
        maxLength={200}
        onChangeText={(value) => update('title', value)}
        error={fieldErrors.title}
        placeholder={
          type === 'recurring'
            ? '如：给绿植浇水'
            : type === 'important_date'
              ? '如：妈妈的生日'
              : type === 'household_item'
                ? '如：抽纸'
                : '如：家里 Wi-Fi'
        }
      />
      <TextField
        label={type === 'memo' ? '内容' : '说明（可选）'}
        value={state.notes}
        multiline
        textAlignVertical="top"
        style={{ minHeight: type === 'memo' ? 160 : 80 }}
        onChangeText={(value) => update('notes', value)}
        error={fieldErrors.notes}
      />

      {type === 'recurring' ? (
        <FormCard title="重复" error={fieldErrors.recurring}>
          <ChipGroup>
            {(Object.keys(FREQ_LABELS) as RecordFormFreq[]).map((freq) => (
              <Chip
                key={freq}
                label={FREQ_LABELS[freq]}
                selected={rule.freq === freq}
                onPress={() => updateRule({ freq })}
              />
            ))}
          </ChipGroup>
          <TextField
            label={`每隔几${INTERVAL_UNITS[rule.freq]}`}
            keyboardType="number-pad"
            value={rule.interval}
            onChangeText={(value) => updateRule({ interval: value })}
          />
          {rule.freq === 'weekly' ? (
            <View style={styles.group}>
              <FieldLabel>星期</FieldLabel>
              <ChipGroup>
                {[1, 2, 3, 4, 5, 6, 7].map((weekday) => {
                  const selected = rule.byWeekdays.includes(weekday);
                  return (
                    <Chip
                      key={weekday}
                      label={weekdayName(weekday)}
                      selected={selected}
                      onPress={() =>
                        updateRule({
                          byWeekdays: selected
                            ? rule.byWeekdays.filter((value) => value !== weekday)
                            : [...rule.byWeekdays, weekday],
                        })
                      }
                    />
                  );
                })}
              </ChipGroup>
            </View>
          ) : null}
          {rule.freq === 'monthly' ? (
            <TextField
              label="每月几号"
              keyboardType="number-pad"
              hint="当月没有这一天时，取当月最后一天"
              value={rule.byMonthDay}
              onChangeText={(value) => updateRule({ byMonthDay: value })}
            />
          ) : null}
          <DateField
            label={rule.freq === 'yearly' ? '日期' : '开始日期'}
            value={rule.startDate}
            hint={
              rule.freq === 'yearly'
                ? '每年的这一天；2 月 29 日在平年取 28 日'
                : undefined
            }
            onChange={(value) => updateRule({ startDate: value })}
          />
          <TimeField
            label="时间（可选）"
            value={rule.timeOfDay}
            placeholder="全天"
            clearLabel="全天"
            onChange={(value) => updateRule({ timeOfDay: value })}
          />
          <View style={styles.group}>
            <FieldLabel>结束</FieldLabel>
            <ChipGroup>
              <Chip
                label="一直重复"
                selected={rule.endType === 'never'}
                onPress={() => updateRule({ endType: 'never' })}
              />
              <Chip
                label="到某天为止"
                selected={rule.endType === 'until'}
                onPress={() =>
                  updateRule({
                    endType: 'until',
                    until: rule.until === '' ? rule.startDate : rule.until,
                  })
                }
              />
              <Chip
                label="重复一定次数"
                selected={rule.endType === 'count'}
                onPress={() => updateRule({ endType: 'count' })}
              />
            </ChipGroup>
          </View>
          {rule.endType === 'until' ? (
            <DateField
              label="结束日期"
              value={rule.until}
              onChange={(value) => updateRule({ until: value })}
            />
          ) : null}
          {rule.endType === 'count' ? (
            <TextField
              label="次数"
              keyboardType="number-pad"
              value={rule.count}
              onChangeText={(value) => updateRule({ count: value })}
            />
          ) : null}
        </FormCard>
      ) : null}

      {type === 'important_date' ? (
        <FormCard title="日期" error={fieldErrors.importantDate}>
          <ChipGroup>
            {importantDateKinds.map((kind) => (
              <Chip
                key={kind}
                label={IMPORTANT_DATE_KIND_LABELS[kind]}
                selected={date.kind === kind}
                onPress={() => updateDate({ kind })}
              />
            ))}
          </ChipGroup>
          <ChipGroup>
            <Chip
              label="每年"
              selected={date.repeat === 'yearly'}
              onPress={() => updateDate({ repeat: 'yearly' })}
            />
            <Chip
              label="仅一次"
              selected={date.repeat === 'once'}
              onPress={() => updateDate({ repeat: 'once' })}
            />
          </ChipGroup>
          <DateField
            label="日期"
            value={date.date}
            hint={date.repeat === 'yearly' ? '每年重复时只看月和日' : undefined}
            onChange={(value) => updateDate({ date: value })}
          />
          {date.kind === 'birthday' || date.kind === 'anniversary' ? (
            <TextField
              label={date.kind === 'birthday' ? '出生年份（可选）' : '起始年份（可选）'}
              keyboardType="number-pad"
              hint={date.kind === 'birthday' ? '用于显示年龄' : '用于显示第几周年'}
              value={date.startYear}
              onChangeText={(value) => updateDate({ startYear: value })}
            />
          ) : null}
          {date.startYear === '' ? null : (
            <SwitchRow
              label={date.kind === 'birthday' ? '显示年龄' : '显示第几周年'}
              value={date.showCounter}
              onValueChange={(value) => updateDate({ showCounter: value })}
            />
          )}
        </FormCard>
      ) : null}

      {type === 'checklist' ? (
        <FormCard title="清单" error={fieldErrors.checklist}>
          <ChipGroup>
            {checklistPurposes.map((purpose) => (
              <Chip
                key={purpose}
                label={CHECKLIST_PURPOSE_LABELS[purpose]}
                selected={state.checklist.purpose === purpose}
                onPress={() => updateChecklist({ purpose })}
              />
            ))}
          </ChipGroup>
          <DateField
            label="截止日期（可选）"
            value={state.checklist.dueDate}
            clearLabel="不设"
            onChange={(value) =>
              updateChecklist(
                value === '' ? { dueDate: '', dueTime: '' } : { dueDate: value },
              )
            }
          />
          {state.checklist.dueDate === '' ? null : (
            <TimeField
              label="截止时间（可选）"
              value={state.checklist.dueTime}
              placeholder="当天结束前"
              clearLabel="不设"
              onChange={(value) => updateChecklist({ dueTime: value })}
            />
          )}
          {isNew ? (
            <ChecklistItemsEditor
              items={state.checklist.items}
              onChange={(items) => updateChecklist({ items })}
            />
          ) : (
            <InfoBanner message="项目在详情里直接添加、勾选和删除。" />
          )}
        </FormCard>
      ) : null}

      {type === 'household_item' ? (
        <FormCard title="库存" error={fieldErrors.householdItem}>
          <TextField
            label="单位"
            placeholder="如：包、瓶、个、kg"
            maxLength={10}
            value={state.householdItem.unit}
            onChangeText={(value) => updateHousehold({ unit: value })}
          />
          {isNew ? (
            <TextField
              label="现有数量"
              keyboardType="decimal-pad"
              placeholder="0"
              hint="会记为一条“期初”流水"
              value={state.householdItem.quantity}
              onChangeText={(value) => updateHousehold({ quantity: value })}
            />
          ) : null}
          <TextField
            label="最低库存（可选）"
            keyboardType="decimal-pad"
            hint="数量不高于它时算低库存，提醒一次"
            value={state.householdItem.lowStockThreshold}
            onChangeText={(value) => updateHousehold({ lowStockThreshold: value })}
          />
          <TextField
            label="存放位置（可选）"
            placeholder="如：厨房、储物间"
            maxLength={50}
            value={state.householdItem.location}
            onChangeText={(value) => updateHousehold({ location: value })}
          />
          {isNew ? null : (
            <InfoBanner message="数量在详情里通过买入、使用、调整来改变。" />
          )}
        </FormCard>
      ) : null}

      {type === 'household_item' ? null : (
        <RemindersEditor
          type={type}
          today={todayIn(timeZone)}
          reminders={state.reminders}
          error={fieldErrors.reminders}
          onChange={(reminders) => update('reminders', reminders)}
        />
      )}

      <FormCard title="整理">
        <TaxonomyPicker
          categoryId={state.categoryId}
          tagIds={state.tagIds}
          onCategoryChange={(categoryId) => update('categoryId', categoryId)}
          onTagsChange={(tagIds) => update('tagIds', tagIds)}
        />
        <SwitchRow
          label="置顶"
          value={state.isPinned}
          onValueChange={(value) => update('isPinned', value)}
        />
      </FormCard>

      <Button label={submitLabel} loading={submit.isPending} onPress={handleSubmit} />
    </View>
  );
}

function FormCard({
  title,
  error,
  children,
}: {
  title: string;
  error?: string | undefined;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Card>
      <Text style={[theme.type['type.label'], { color: theme.color.textSecondary }]}>
        {title}
      </Text>
      {error === undefined ? null : <ErrorBanner message={error} />}
      <View style={styles.cardBody}>{children}</View>
    </Card>
  );
}

const emptyItem: RecordFormChecklistItem = {
  groupName: '',
  title: '',
  quantity: '',
  unit: '',
};

/** 新建清单时一次填写多个项目；最后一行有内容时自动补一个空行。 */
function ChecklistItemsEditor({
  items,
  onChange,
}: {
  items: RecordFormChecklistItem[];
  onChange: (items: RecordFormChecklistItem[]) => void;
}) {
  const theme = useTheme();
  const rows =
    items.length === 0 || items.at(-1)?.title !== '' ? [...items, emptyItem] : items;
  const replace = (index: number, patch: Partial<RecordFormChecklistItem>) =>
    onChange(rows.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  const inputStyle = [
    theme.type['type.body'],
    styles.itemInput,
    {
      color: theme.color.textPrimary,
      borderColor: theme.color.borderDefault,
      backgroundColor: theme.color.surface,
    },
  ];

  return (
    <View style={styles.group}>
      <FieldLabel>项目</FieldLabel>
      {rows.map((item, index) => (
        <View key={index} style={styles.itemRow}>
          <TextInput
            accessibilityLabel={`项目 ${index + 1}`}
            placeholder="项目名称"
            placeholderTextColor={theme.color.textTertiary}
            value={item.title}
            maxLength={200}
            onChangeText={(value) => replace(index, { title: value })}
            style={[inputStyle, styles.itemTitle]}
          />
          <TextInput
            accessibilityLabel={`项目 ${index + 1} 的分组`}
            placeholder="分组"
            placeholderTextColor={theme.color.textTertiary}
            value={item.groupName}
            maxLength={30}
            onChangeText={(value) => replace(index, { groupName: value })}
            style={[inputStyle, styles.itemGroup]}
          />
        </View>
      ))}
      <Text style={[theme.type['type.caption'], { color: theme.color.textTertiary }]}>
        分组可以不填；数量和单位可以保存后在详情里修改。
      </Text>
    </View>
  );
}

function RemindersEditor({
  type,
  today,
  reminders,
  error,
  onChange,
}: {
  type: CreatableRecordType;
  today: string;
  reminders: RecordFormReminder[];
  error: string | undefined;
  onChange: (reminders: RecordFormReminder[]) => void;
}) {
  const [permission, setPermission] = useState<
    'granted' | 'denied' | 'undetermined' | null
  >(null);
  const replace = (index: number, draft: RecordFormReminder) =>
    onChange(reminders.map((current, i) => (i === index ? draft : current)));

  async function add() {
    onChange([
      ...reminders,
      type === 'memo' || type === 'checklist'
        ? { kind: 'absolute', date: today, time: '09:00' }
        : { kind: 'relative', daysBefore: '0', timeOfDay: '' },
    ]);
    // 第一次设置提醒时申请通知权限。
    setPermission(await requestNotificationPermission());
  }

  return (
    <FormCard title="提醒" error={error}>
      {permission === 'denied' ? (
        <View style={styles.group}>
          <InfoBanner message="通知权限已关闭：记录照常保存，也会出现在“今天”里，但手机不会按时提醒。可以在系统设置中为“生活有谱”开启通知。" />
          <SmallButton label="打开系统设置" onPress={() => void Linking.openSettings()} />
        </View>
      ) : null}
      {reminders.length === 0 ? (
        <InfoBanner
          message={`${TODAY_VISIBILITY_HINTS[type]}；设置提醒后手机会按时通知。`}
        />
      ) : null}
      {reminders.map((draft, index) => (
        <View key={index} style={styles.reminder}>
          {draft.kind === 'absolute' ? (
            <>
              <DateField
                label="日期"
                value={draft.date}
                onChange={(value) => replace(index, { ...draft, date: value })}
              />
              <TimeField
                label="时间"
                value={draft.time}
                onChange={(value) => replace(index, { ...draft, time: value })}
              />
            </>
          ) : (
            <>
              <ChipGroup>
                {DAYS_BEFORE_PRESETS.map((days) => (
                  <Chip
                    key={days}
                    label={days === '0' ? '当天' : `提前 ${days} 天`}
                    selected={draft.daysBefore === days}
                    onPress={() => replace(index, { ...draft, daysBefore: days })}
                  />
                ))}
              </ChipGroup>
              <TimeField
                label="时间（可选）"
                value={draft.timeOfDay}
                placeholder={type === 'recurring' ? '跟随重复的时间' : '默认提醒时间'}
                clearLabel="默认"
                onChange={(value) => replace(index, { ...draft, timeOfDay: value })}
              />
            </>
          )}
          <SmallButton
            label="删除这个提醒"
            variant="ghost"
            onPress={() => onChange(reminders.filter((_, i) => i !== index))}
          />
        </View>
      ))}
      <SmallButton label="添加提醒" onPress={() => void add()} />
    </FormCard>
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
  const [newCategory, setNewCategory] = useState('');
  const [newTag, setNewTag] = useState('');

  const createCategory = useMutation({
    mutationFn: (name: string) => api.categories.create({ name }),
    onSuccess: async (category) => {
      await queryClient.invalidateQueries({ queryKey: categoriesQuery.queryKey });
      onCategoryChange(category.id);
      setNewCategory('');
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
    <View style={styles.cardBody}>
      <View style={styles.group}>
        <FieldLabel>分类</FieldLabel>
        <ChipGroup>
          <Chip
            label="无"
            selected={categoryId === ''}
            onPress={() => onCategoryChange('')}
          />
          {(categories.data?.items ?? []).map((category) => (
            <Chip
              key={category.id}
              label={category.name}
              selected={categoryId === category.id}
              onPress={() => onCategoryChange(category.id)}
            />
          ))}
        </ChipGroup>
        <TextField
          label="新建分类"
          placeholder="输入名称后点完成"
          value={newCategory}
          maxLength={30}
          returnKeyType="done"
          onChangeText={setNewCategory}
          onSubmitEditing={() => {
            if (newCategory.trim() !== '') {
              createCategory.mutate(newCategory);
            }
          }}
          error={createCategory.isError ? describeError(createCategory.error) : undefined}
        />
      </View>
      <View style={styles.group}>
        <FieldLabel>标签</FieldLabel>
        <ChipGroup>
          {(tags.data?.items ?? []).map((tag) => {
            const selected = tagIds.includes(tag.id);
            return (
              <Chip
                key={tag.id}
                label={tag.name}
                selected={selected}
                onPress={() =>
                  onTagsChange(
                    selected ? tagIds.filter((id) => id !== tag.id) : [...tagIds, tag.id],
                  )
                }
              />
            );
          })}
        </ChipGroup>
        <TextField
          label="新建标签"
          placeholder="输入名称后点完成"
          value={newTag}
          maxLength={30}
          returnKeyType="done"
          onChangeText={setNewTag}
          onSubmitEditing={() => {
            if (newTag.trim() !== '') {
              createTag.mutate(newTag);
            }
          }}
          error={createTag.isError ? describeError(createTag.error) : undefined}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16 },
  cardBody: { gap: 14 },
  group: { gap: 8 },
  reminder: { gap: 10, paddingBottom: 6 },
  itemRow: { flexDirection: 'row', gap: 8 },
  itemInput: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10 },
  itemTitle: { flex: 1 },
  itemGroup: { width: 90 },
});

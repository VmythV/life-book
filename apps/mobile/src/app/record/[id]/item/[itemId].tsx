import { describeError } from '@life-book/api-client';
import {
  type ChecklistItemDraft,
  DISCARD_CHANGES_MESSAGE,
  toChecklistItemDraft,
  type UpdateChecklistItemRequest,
  validateChecklistItemDraft,
} from '@life-book/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import {
  BodyText,
  Button,
  ErrorBanner,
  Screen,
  TextField,
} from '../../../../components/ui';
import { api, recordQuery, useInvalidateRecords } from '../../../../lib/api';

/** 修改清单里的一项：名称、分组、数量和单位。 */
export default function EditChecklistItemScreen() {
  const { id, itemId } = useLocalSearchParams<{ id: string; itemId: string }>();
  const record = useQuery(recordQuery(id));
  const item = record.data?.checklist?.items.find((other) => other.id === itemId);

  if (record.isError) {
    return (
      <Screen edges={['left', 'right']}>
        <ErrorBanner message={describeError(record.error)} />
      </Screen>
    );
  }
  if (record.data === undefined) {
    return (
      <Screen edges={['left', 'right']}>
        <BodyText muted>正在加载…</BodyText>
      </Screen>
    );
  }
  if (item === undefined) {
    return (
      <Screen edges={['left', 'right']}>
        <ErrorBanner message="这个项目已经删除了。" />
      </Screen>
    );
  }
  return (
    <ItemForm
      key={item.id}
      recordId={id}
      itemId={item.id}
      initial={toChecklistItemDraft(item)}
    />
  );
}

function ItemForm({
  recordId,
  itemId,
  initial,
}: {
  recordId: string;
  itemId: string;
  initial: ChecklistItemDraft;
}) {
  const invalidate = useInvalidateRecords();
  const [draft, setDraft] = useState(initial);
  const change = (patch: Partial<ChecklistItemDraft>) => setDraft({ ...draft, ...patch });
  const [invalid, setInvalid] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (input: UpdateChecklistItemRequest) =>
      api.checklistItems.update(recordId, itemId, input),
    onSuccess: async () => {
      await invalidate();
      router.back();
    },
  });
  const navigation = useNavigation();
  usePreventRemove(
    JSON.stringify(draft) !== JSON.stringify(initial) &&
      !save.isPending &&
      !save.isSuccess,
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

  return (
    <Screen edges={['left', 'right']}>
      <TextField
        label="项目名称"
        value={draft.title}
        maxLength={200}
        onChangeText={(title) => change({ title })}
      />
      <TextField
        label="分组（可选）"
        hint="同一分组的项目放在一起"
        value={draft.groupName}
        maxLength={30}
        onChangeText={(groupName) => change({ groupName })}
      />
      <View style={styles.row}>
        <View style={styles.quantity}>
          <TextField
            label="数量（可选）"
            keyboardType="decimal-pad"
            value={draft.quantity}
            onChangeText={(quantity) => change({ quantity })}
          />
        </View>
        <View style={styles.unit}>
          <TextField
            label="单位"
            placeholder="如：个、kg"
            value={draft.unit}
            maxLength={10}
            onChangeText={(unit) => change({ unit })}
          />
        </View>
      </View>
      {invalid !== null ? (
        <ErrorBanner message={invalid} />
      ) : save.isError ? (
        <ErrorBanner message={describeError(save.error)} />
      ) : null}
      <Button
        label="保存"
        loading={save.isPending}
        onPress={() => {
          const result = validateChecklistItemDraft(draft);
          setInvalid(result.error);
          if (result.data !== null) {
            save.mutate(result.data);
          }
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  quantity: { flex: 3 },
  unit: { flex: 2 },
});

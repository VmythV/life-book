import { describeError, queryKeys } from '@life-book/api-client';
import {
  initialRecordFormState,
  isCreatableRecordType,
  RECORD_TYPE_LABELS,
  todayIn,
} from '@life-book/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { RecordForm } from '../../../components/record-form';
import { BodyText, ErrorBanner, Screen, SmallButton } from '../../../components/ui';
import { api, meQuery, recordQuery, useInvalidateRecords } from '../../../lib/api';

export default function EditRecordScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const record = useQuery(recordQuery(id));
  const me = useQuery(meQuery);
  const queryClient = useQueryClient();
  const invalidate = useInvalidateRecords();

  if (record.isError) {
    return (
      <Screen edges={['left', 'right']}>
        <ErrorBanner message={describeError(record.error)} />
      </Screen>
    );
  }
  if (record.data === undefined || me.data === undefined) {
    return (
      <Screen edges={['left', 'right']}>
        <BodyText muted>正在加载…</BodyText>
      </Screen>
    );
  }
  const current = record.data;
  if (!isCreatableRecordType(current.type)) {
    return (
      <Screen edges={['left', 'right']}>
        <ErrorBanner message="这种记录暂不支持编辑。" />
      </Screen>
    );
  }
  const type = current.type;
  const timeZone = me.data.settings.timezone;

  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen options={{ title: `编辑${RECORD_TYPE_LABELS[type]}` }} />
      <RecordForm
        // 载入最新内容后用新的版本号重建表单。
        key={current.version}
        type={type}
        initial={initialRecordFormState(type, todayIn(timeZone), timeZone, current)}
        timeZone={timeZone}
        submitLabel="保存"
        onSubmit={async (request) => {
          const { type: _type, id: _id, ...fields } = request;
          await api.records.update(id, { ...fields, version: current.version });
          await invalidate();
          router.back();
        }}
        conflict={
          <View style={{ gap: 8 }}>
            <ErrorBanner message="这条记录已在其他地方修改过。载入最新内容后，你需要重新修改。" />
            <SmallButton
              label="载入最新内容"
              onPress={() =>
                void queryClient.invalidateQueries({ queryKey: queryKeys.record(id) })
              }
            />
          </View>
        }
      />
    </Screen>
  );
}

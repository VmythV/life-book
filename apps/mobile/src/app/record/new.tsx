import {
  initialRecordFormState,
  type CreatableRecordType,
  creatableRecordTypes,
  RECORD_TYPE_LABELS,
  todayIn,
} from '@life-book/core';
import { describeError } from '@life-book/api-client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { RecordForm } from '../../components/record-form';
import { BodyText, ErrorBanner, Row, Screen, Section } from '../../components/ui';
import { api, meQuery, templatesQuery, useInvalidateRecords } from '../../lib/api';

const TYPE_HINTS: Record<CreatableRecordType, string> = {
  recurring: '每天、每周、每月或每年要做的事',
  important_date: '生日、纪念日、到期日',
  memo: '需要长期查找、偶尔提醒的信息',
  checklist: '旅行、搬家、采购时逐项勾选',
  household_item: '家里东西的数量和存放位置，快用完时提醒',
};

export default function NewRecordScreen() {
  const params = useLocalSearchParams<{ type?: string }>();
  const type = (creatableRecordTypes as readonly string[]).includes(params.type ?? '')
    ? (params.type as CreatableRecordType)
    : undefined;

  if (type === undefined) {
    return (
      <Screen edges={['left', 'right']}>
        <Stack.Screen options={{ title: '新建' }} />
        <Section title="要记点什么？">
          {creatableRecordTypes.map((value, index) => (
            <Row
              key={value}
              first={index === 0}
              title={RECORD_TYPE_LABELS[value]}
              subtitle={TYPE_HINTS[value]}
              onPress={() => router.setParams({ type: value })}
            />
          ))}
        </Section>
      </Screen>
    );
  }
  return <NewRecordForm type={type} />;
}

function NewRecordForm({ type }: { type: CreatableRecordType }) {
  const me = useQuery(meQuery);
  const invalidate = useInvalidateRecords();
  // 客户端生成 ID：网络重试时服务端会返回同一条记录，不会重复创建。
  const [recordId] = useState(() => randomUUID());

  if (me.data === undefined) {
    return (
      <Screen edges={['left', 'right']}>
        <BodyText muted>正在加载…</BodyText>
      </Screen>
    );
  }
  const timeZone = me.data.settings.timezone;
  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen options={{ title: `新建${RECORD_TYPE_LABELS[type]}` }} />
      {type === 'checklist' ? <FromTemplate recordId={recordId} /> : null}
      <RecordForm
        isNew
        type={type}
        initial={initialRecordFormState(type, todayIn(timeZone), timeZone)}
        timeZone={timeZone}
        submitLabel="保存"
        onSubmit={async (request) => {
          const record = await api.records.create({ ...request, id: recordId });
          await invalidate();
          router.replace({ pathname: '/record/[id]', params: { id: record.id } });
        }}
      />
    </Screen>
  );
}

/** 新建清单时可以直接从模板创建。 */
function FromTemplate({ recordId }: { recordId: string }) {
  const templates = useQuery(templatesQuery);
  const invalidate = useInvalidateRecords();
  const instantiate = useMutation({
    mutationFn: (templateId: string) =>
      api.templates.instantiate(templateId, { id: recordId }),
    onSuccess: async (record) => {
      await invalidate();
      router.replace({ pathname: '/record/[id]', params: { id: record.id } });
    },
  });
  const items = templates.data?.items ?? [];
  if (items.length === 0) {
    return null;
  }
  return (
    <Section title="从模板创建">
      {instantiate.isError ? (
        <ErrorBanner message={describeError(instantiate.error)} />
      ) : null}
      {items.map((template, index) => (
        <Row
          key={template.id}
          first={index === 0}
          title={template.title}
          subtitle={`${template.items.length} 项`}
          onPress={() => {
            if (!instantiate.isPending) {
              instantiate.mutate(template.id);
            }
          }}
        />
      ))}
    </Section>
  );
}

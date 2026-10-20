import { describeError } from '@life-book/api-client';
import {
  describeRecordSummary,
  displayTitle,
  type CreatableRecordType,
  creatableRecordTypes,
  RECORD_TYPE_LABELS,
  todayIn,
} from '@life-book/core';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Badge,
  Chip,
  ChipGroup,
  EmptyState,
  ErrorBanner,
  Fab,
  InfoBanner,
  Row,
  Title,
} from '../../components/ui';
import { meQuery, recordListQuery } from '../../lib/api';
import { useIsOnline } from '../../lib/online';
import { useTheme } from '../../lib/theme';

export default function BookScreen() {
  const theme = useTheme();
  const online = useIsOnline();
  const me = useQuery(meQuery);
  const timeZone = me.data?.settings.timezone ?? 'Asia/Shanghai';
  const today = todayIn(timeZone);
  const [type, setType] = useState<CreatableRecordType | undefined>(undefined);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');

  // 输入停顿 300 毫秒后再搜索。
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);

  const list = useInfiniteQuery(
    recordListQuery({
      ...(type === undefined ? {} : { type }),
      ...(q === '' ? {} : { q }),
    }),
  );
  const records = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.screen, { backgroundColor: theme.color.canvas }]}
    >
      <FlatList
        data={records}
        keyExtractor={(record) => record.id}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching && !list.isFetchingNextPage}
            onRefresh={() => void list.refetch()}
            colors={[theme.color.actionPrimary]}
          />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) {
            void list.fetchNextPage();
          }
        }}
        ListHeaderComponent={
          <View style={styles.header}>
            <Title>生活簿</Title>
            {online ? null : <InfoBanner message="没有网络，显示的是上次同步的内容。" />}
            <TextInput
              accessibilityLabel="搜索"
              placeholder="搜索标题和内容"
              placeholderTextColor={theme.color.textTertiary}
              value={text}
              onChangeText={setText}
              returnKeyType="search"
              clearButtonMode="while-editing"
              style={[
                theme.type['type.body'],
                styles.search,
                {
                  color: theme.color.textPrimary,
                  backgroundColor: theme.color.surface,
                  borderColor: theme.color.borderDefault,
                },
              ]}
            />
            <ChipGroup>
              <Chip
                label="全部"
                selected={type === undefined}
                onPress={() => setType(undefined)}
              />
              {creatableRecordTypes.map((value) => (
                <Chip
                  key={value}
                  label={RECORD_TYPE_LABELS[value]}
                  selected={type === value}
                  onPress={() => setType(value)}
                />
              ))}
            </ChipGroup>
            {list.isError && records.length === 0 ? (
              <ErrorBanner message={describeError(list.error)} />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          list.isPending ? (
            <ActivityIndicator color={theme.color.textTertiary} />
          ) : list.isError ? null : (
            <EmptyState
              title={type === undefined && q === '' ? '还没有记录' : '没有符合条件的记录'}
              message={
                type === undefined && q === ''
                  ? '点右下角的“+”开始记录。'
                  : '换个条件试试。'
              }
            />
          )
        }
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <ActivityIndicator color={theme.color.textTertiary} />
          ) : null
        }
        renderItem={({ item, index }) => (
          <View
            style={[
              styles.item,
              {
                backgroundColor: theme.color.surface,
                borderColor: theme.color.borderDefault,
              },
              index === 0 ? styles.itemFirst : null,
              index === records.length - 1 ? styles.itemLast : null,
            ]}
          >
            <Row
              first
              title={displayTitle(item)}
              subtitle={describeRecordSummary(item, today, timeZone)}
              onPress={() =>
                router.push({ pathname: '/record/[id]', params: { id: item.id } })
              }
              right={
                <>
                  {item.isPinned ? <Badge label="置顶" tone="warning" /> : null}
                  <Badge label={RECORD_TYPE_LABELS[item.type]} />
                </>
              }
            />
          </View>
        )}
      />
      <Fab label="新建" onPress={() => router.push('/record/new')} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 20, paddingBottom: 96 },
  header: { gap: 14, marginBottom: 14 },
  search: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12 },
  item: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  itemFirst: { borderTopWidth: 1, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  itemLast: {
    borderBottomWidth: 1,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
});

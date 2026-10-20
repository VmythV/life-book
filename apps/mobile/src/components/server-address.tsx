import { normalizeServerUrl } from '@life-book/api-client';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { queryClient } from '../lib/api';
import { checkServer, defaultServerUrl, server, useServerUrl } from '../lib/server';
import { useTheme } from '../lib/theme';
import { ErrorBanner, SmallButton, TextField } from './ui';

/** 服务器地址（登录页底部和“我的”）：电脑换了局域网地址时在这里改，不用重新安装应用。 */
export function ServerAddress() {
  const theme = useTheme();
  const url = useServerUrl();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function save() {
    const normalized = normalizeServerUrl(draft ?? '');
    if (normalized === null) {
      setError('请输入服务器地址，如 http://192.168.1.5:8787');
      return;
    }
    setChecking(true);
    const reachable = await checkServer(normalized);
    setChecking(false);
    if (!reachable) {
      setError(
        '连不上这个地址。请确认电脑上的服务已启动，手机和电脑连的是同一个 Wi-Fi。',
      );
      return;
    }
    await server.save(normalized);
    setDraft(null);
    setError(null);
    // 已登录时用新地址重新加载数据。
    await queryClient.invalidateQueries();
  }

  if (draft === null) {
    return (
      <View style={styles.row}>
        <Text
          style={[
            theme.type['type.caption'],
            styles.url,
            { color: theme.color.textTertiary },
          ]}
        >
          服务器：{url}
        </Text>
        <SmallButton label="修改" variant="ghost" onPress={() => setDraft(url)} />
      </View>
    );
  }
  return (
    <View style={styles.editor}>
      <TextField
        label="服务器地址"
        hint="电脑上运行服务的地址，如 http://192.168.1.5:8787"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        value={draft}
        onChangeText={(text) => {
          setDraft(text);
          setError(null);
        }}
        onSubmitEditing={() => void save()}
      />
      {error === null ? null : <ErrorBanner message={error} />}
      <View style={styles.row}>
        <SmallButton
          label={checking ? '正在连接…' : '连接并保存'}
          disabled={checking}
          onPress={() => void save()}
        />
        {url === defaultServerUrl ? null : (
          <SmallButton
            label="恢复默认"
            variant="ghost"
            disabled={checking}
            onPress={() => {
              void server.save(null).then(() => queryClient.invalidateQueries());
              setDraft(null);
              setError(null);
            }}
          />
        )}
        <SmallButton
          label="取消"
          variant="ghost"
          disabled={checking}
          onPress={() => {
            setDraft(null);
            setError(null);
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  url: { flexShrink: 1 },
  editor: { gap: 10 },
});

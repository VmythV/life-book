import { useQuery } from '@tanstack/react-query';

import { BodyText, Card, Screen, Title } from '../../components/ui';
import { meQuery } from '../../lib/api';

export default function TodayScreen() {
  const me = useQuery(meQuery);
  const timeZone = me.data?.settings.timezone;
  const today = new Intl.DateTimeFormat('zh-CN', {
    ...(timeZone === undefined ? {} : { timeZone }),
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date());

  return (
    <Screen>
      <Title caption={today}>今天</Title>
      <Card>
        <BodyText bold>今天没有需要处理的事。</BodyText>
        <BodyText muted>
          这里会列出今天要做的事、近期的重要日期和到时间的备忘提醒。
        </BodyText>
      </Card>
    </Screen>
  );
}

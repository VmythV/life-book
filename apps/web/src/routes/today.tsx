import { useSuspenseQuery } from '@tanstack/react-query';

import { Card } from '../components/ui';
import { meQuery } from '../queries';

export function TodayPage() {
  const { data } = useSuspenseQuery(meQuery);
  const today = new Intl.DateTimeFormat('zh-CN', {
    timeZone: data.settings.timezone,
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date());

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-sm text-fg-muted">{today}</p>
        <h1 className="mt-1 text-3xl font-semibold">今天</h1>
      </header>
      <Card>
        <p className="font-semibold">今天没有需要处理的事。</p>
        <p className="mt-2 text-sm text-fg-muted">
          这里会列出今天要做的事、近期的重要日期和到时间的备忘提醒。
        </p>
      </Card>
    </div>
  );
}

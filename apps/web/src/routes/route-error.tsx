import { describeError } from '@life-book/api-client';
import { type ErrorComponentProps, useRouter } from '@tanstack/react-router';

import { Button } from '../components/ui';

export function RouteError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold">页面加载失败</h1>
      <p className="text-sm text-fg-muted">{describeError(error)}</p>
      <Button onClick={() => void router.invalidate()}>重试</Button>
    </main>
  );
}

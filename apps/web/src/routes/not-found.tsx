import { Link } from '@tanstack/react-router';

export function NotFoundPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold">没有找到这个页面</h1>
      <Link to="/" className="font-semibold text-link">
        回到今天
      </Link>
    </main>
  );
}

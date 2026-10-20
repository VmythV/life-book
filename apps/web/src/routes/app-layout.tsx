import { useSuspenseQuery } from '@tanstack/react-query';
import { Link, Outlet } from '@tanstack/react-router';

import { meQuery } from '../queries';

const navItems = [
  { to: '/', label: '今天', exact: true },
  { to: '/book', label: '生活簿', exact: false },
  { to: '/home', label: '家中', exact: true },
  { to: '/templates', label: '清单模板', exact: false },
  { to: '/settings', label: '设置', exact: true },
] as const;

export function AppLayout() {
  const { data } = useSuspenseQuery(meQuery);

  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-line bg-surface md:flex md:w-56 md:flex-col md:border-r md:border-b-0">
        <div className="px-5 pt-5 pb-3 text-lg font-semibold text-brand">生活有谱</div>
        <nav aria-label="主导航" className="flex gap-1 px-3 pb-3 md:flex-col">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.exact, includeSearch: false }}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-fg-muted hover:bg-surface-subtle"
              activeProps={{ className: 'bg-surface-subtle !text-fg' }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <p className="mt-auto hidden px-5 py-4 text-xs text-fg-subtle md:block">
          {data.user.displayName ?? data.user.username}
        </p>
      </aside>
      <main className="flex-1 px-4 py-8 md:px-10">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

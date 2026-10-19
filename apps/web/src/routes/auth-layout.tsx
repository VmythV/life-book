import { type ReactNode } from 'react';

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <header className="mb-8 text-center">
          <p className="text-2xl font-semibold text-brand">生活有谱</p>
          <p className="mt-1 text-sm text-fg-muted">每件生活小事，都有着落。</p>
        </header>
        <section className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <h1 className="mb-6 text-xl font-semibold">{title}</h1>
          {children}
        </section>
      </div>
    </main>
  );
}

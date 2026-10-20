import { creatableRecordTypes, RECORD_TYPE_LABELS } from '@life-book/core';
import { Link } from '@tanstack/react-router';
import { useRef } from 'react';

/** “新建”下拉菜单：选择要新建的记录类型。 */
export function NewRecordMenu() {
  const details = useRef<HTMLDetailsElement>(null);
  return (
    <details ref={details} className="group relative">
      <summary className="inline-flex h-11 cursor-pointer list-none items-center rounded-lg bg-primary px-5 text-sm font-semibold text-on-primary hover:bg-primary-hover [&::-webkit-details-marker]:hidden">
        新建
      </summary>
      <div className="absolute right-0 z-20 mt-2 flex w-40 flex-col rounded-xl border border-line bg-surface-raised p-1 shadow-lg">
        {creatableRecordTypes.map((type) => (
          <Link
            key={type}
            to="/book/new"
            search={{ type }}
            onClick={() => details.current?.removeAttribute('open')}
            className="rounded-lg px-3 py-2 text-sm hover:bg-surface-subtle"
          >
            {RECORD_TYPE_LABELS[type]}
          </Link>
        ))}
      </div>
    </details>
  );
}

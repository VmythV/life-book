import { TRASH_RETENTION_DAYS } from '@life-book/core';
import { and, isNotNull, lt } from 'drizzle-orm';

import { type Database } from '../db/client';
import { records } from '../db/schema';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 永久删除在回收站里超过保留天数的记录，子表随之级联删除。返回删除的条数。 */
export async function purgeExpiredTrash(db: Database, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - TRASH_RETENTION_DAYS * DAY_MS);
  const deleted = await db
    .delete(records)
    .where(and(isNotNull(records.deletedAt), lt(records.deletedAt, cutoff)))
    .returning({ id: records.id });
  return deleted.length;
}

/** 启动时清理一次，之后每天一次；返回停止定时器的函数。 */
export function scheduleTrashPurge(db: Database, now: () => Date): () => void {
  const run = () => {
    purgeExpiredTrash(db, now())
      .then((count) => {
        if (count > 0) {
          console.log(`Purged ${count} records from the trash.`);
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to purge the trash', error);
      });
  };
  run();
  const timer = setInterval(run, DAY_MS);
  timer.unref();
  return () => clearInterval(timer);
}

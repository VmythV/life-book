import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;

export interface DatabaseConnection {
  db: Database;
  close: () => Promise<void>;
}

export function connectDatabase(url: string): DatabaseConnection {
  const client = postgres(url, { onnotice: () => undefined });
  return {
    db: drizzle(client, { schema }),
    close: () => client.end(),
  };
}

/** PostgreSQL 唯一约束冲突；drizzle 可能把驱动错误包在 `cause` 里。 */
export function isUniqueViolation(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if ((current as { code?: unknown }).code === '23505') {
      return true;
    }
  }
  return false;
}

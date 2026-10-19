import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { connectDatabase } from './client';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

export async function runMigrations(url: string): Promise<void> {
  const { db, close } = connectDatabase(url);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}

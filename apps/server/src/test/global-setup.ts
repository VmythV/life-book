import postgres from 'postgres';

import { runMigrations } from '../db/migrate';
import { loadEnv } from '../env';

/** 每次测试运行前重建测试库的表结构，保证迁移本身也被验证。 */
export default async function setup(): Promise<void> {
  const url = loadEnv().TEST_DATABASE_URL;
  const client = postgres(url, { onnotice: () => undefined, max: 1 });
  try {
    await client`select 1`;
  } catch (error) {
    await client.end();
    throw new Error(
      `Cannot connect to the test database (${url}). Start it with "pnpm db:up".`,
      { cause: error },
    );
  }
  await client.unsafe(
    'drop schema if exists drizzle cascade; drop schema public cascade; create schema public;',
  );
  await client.end();
  await runMigrations(url);
}

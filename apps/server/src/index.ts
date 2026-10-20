import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';

import { createApp } from './app';
import { DEFAULT_SCRYPT_PARAMS } from './auth/password';
import { connectDatabase } from './db/client';
import { loadEnv } from './env';
import { scheduleTrashPurge } from './maintenance/purge-trash';

const env = loadEnv();
const { db, close } = connectDatabase(env.DATABASE_URL);

const app = createApp({
  db,
  passwordParams: DEFAULT_SCRYPT_PARAMS,
  secureCookies: env.SECURE_COOKIES,
  now: () => new Date(),
  getClientIp: (c) => getConnInfo(c).remote.address ?? 'unknown',
  logRequests: true,
});

const stopTrashPurge = scheduleTrashPurge(db, () => new Date());

const server = serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST }, (info) => {
  console.log(`Life Book API listening on http://${info.address}:${info.port}`);
});

function shutdown() {
  stopTrashPurge();
  server.close(() => {
    void close().then(() => process.exit(0));
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

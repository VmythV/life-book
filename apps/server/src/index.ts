import { networkInterfaces } from 'node:os';

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
  webDistDir: env.WEB_DIST_DIR,
});

const stopTrashPurge = scheduleTrashPurge(db, () => new Date());

const server = serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST }, (info) => {
  console.log(`Life Book API listening on http://${info.address}:${info.port}`);
  if (env.HOST === '0.0.0.0') {
    // 手机上要填的服务器地址。
    for (const address of lanAddresses()) {
      console.log(`  局域网地址：http://${address}:${info.port}`);
    }
  }
  if (env.WEB_DIST_DIR !== undefined) {
    console.log(`  同时提供 Web 页面：${env.WEB_DIST_DIR}`);
  }
});

/** 本机的局域网地址。只列有线和无线网卡，Docker 网桥和 VPN 等虚拟网卡的地址手机用不上。 */
function lanAddresses(): string[] {
  const all = Object.entries(networkInterfaces()).flatMap(([name, items]) =>
    (items ?? [])
      .filter((item) => item.family === 'IPv4' && !item.internal)
      .map((item) => ({ name, address: item.address })),
  );
  const physical = all.filter((item) => /^(en|eth|wlan|wl)/.test(item.name));
  return (physical.length > 0 ? physical : all).map((item) => item.address);
}

function shutdown() {
  stopTrashPurge();
  server.close(() => {
    void close().then(() => process.exit(0));
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

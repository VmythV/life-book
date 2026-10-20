import { describe, expect, it } from 'vitest';

import { createTestUser, request, setupTestDatabase } from '../test/harness';
import { purgeExpiredTrash } from './purge-trash';

const { createTestApp, db } = setupTestDatabase();

describe('purgeExpiredTrash', () => {
  it('only deletes records that stayed in the trash for more than 30 days', async () => {
    let now = new Date('2026-09-01T00:00:00Z');
    const app = createTestApp({ now: () => now });
    const { cookie } = await createTestUser(app);
    const create = async (title: string) => {
      const response = await request(app, 'POST', '/api/v1/records', {
        cookie,
        body: { type: 'memo', title },
      });
      return ((await response.json()) as { id: string }).id;
    };
    const old = await create('old');
    const recent = await create('recent');
    const active = await create('active');
    await request(app, 'DELETE', `/api/v1/records/${old}`, { cookie });
    now = new Date('2026-09-20T00:00:00Z');
    await request(app, 'DELETE', `/api/v1/records/${recent}`, { cookie });

    expect(await purgeExpiredTrash(db, new Date('2026-10-02T00:00:00Z'))).toBe(1);

    const status = async (id: string) =>
      (await request(app, 'GET', `/api/v1/records/${id}`, { cookie })).status;
    expect(await status(old)).toBe(404);
    expect(await status(recent)).toBe(200);
    expect(await status(active)).toBe(200);
  });
});

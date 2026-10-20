import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { setupTestDatabase } from '../test/harness';

const { createTestApp } = setupTestDatabase();

function webDist(): string {
  const root = mkdtempSync(join(tmpdir(), 'life-book-web-'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>生活有谱</title>');
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'assets', 'app.js'), 'console.log(1);');
  return root;
}

describe('serving the web app', () => {
  it('serves files, falls back to index.html and leaves the API alone', async () => {
    const app = createTestApp({ webDistDir: webDist() });

    const asset = await app.request('/assets/app.js');
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe('console.log(1);');

    for (const path of ['/', '/book', '/book/new?type=memo']) {
      const page = await app.request(path);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('<title>生活有谱</title>');
    }

    const missing = await app.request('/api/v1/nope');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect((await app.request('/health')).status).toBe(200);
  });

  it('does not serve pages unless a directory is configured', async () => {
    const app = createTestApp();
    expect((await app.request('/book')).status).toBe(404);
  });
});

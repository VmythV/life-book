import { describe, expect, it } from 'vitest';

import { registerUser, request, setupTestDatabase } from '../test/harness';

const { createTestApp } = setupTestDatabase();

describe('categories and tags', () => {
  it('creates and lists names, returning the existing one for duplicates', async () => {
    const app = createTestApp();
    const { cookie } = await registerUser(app);

    const created = await request(app, 'POST', '/api/v1/tags', {
      cookie,
      body: { name: 'Home' },
    });
    expect(created.status).toBe(201);
    const tag = (await created.json()) as { id: string };

    const duplicate = await request(app, 'POST', '/api/v1/tags', {
      cookie,
      body: { name: ' home ' },
    });
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toEqual({ id: tag.id, name: 'Home', color: null });

    await request(app, 'POST', '/api/v1/tags', { cookie, body: { name: 'Away' } });
    const list = await request(app, 'GET', '/api/v1/tags', { cookie });
    expect(
      ((await list.json()) as { items: { name: string }[] }).items.map(
        (item) => item.name,
      ),
    ).toEqual(['Away', 'Home']);
  });

  it('rejects empty names', async () => {
    const app = createTestApp();
    const { cookie } = await registerUser(app);
    const response = await request(app, 'POST', '/api/v1/categories', {
      cookie,
      body: { name: '  ' },
    });
    expect(response.status).toBe(400);
  });

  it('renames, rejecting names that are already taken', async () => {
    const app = createTestApp();
    const { cookie } = await registerUser(app);
    const home = await request(app, 'POST', '/api/v1/tags', {
      cookie,
      body: { name: '家' },
    });
    await request(app, 'POST', '/api/v1/tags', { cookie, body: { name: '工作' } });
    const { id } = (await home.json()) as { id: string };

    const renamed = await request(app, 'PATCH', `/api/v1/tags/${id}`, {
      cookie,
      body: { name: '家里' },
    });
    expect(await renamed.json()).toMatchObject({ id, name: '家里' });

    const taken = await request(app, 'PATCH', `/api/v1/tags/${id}`, {
      cookie,
      body: { name: '工作' },
    });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ error: { code: 'NAME_TAKEN' } });
  });

  it('deletes a category and clears it from records', async () => {
    const app = createTestApp();
    const { cookie } = await registerUser(app);
    const category = await request(app, 'POST', '/api/v1/categories', {
      cookie,
      body: { name: '证件' },
    });
    const { id } = (await category.json()) as { id: string };
    const record = await request(app, 'POST', '/api/v1/records', {
      cookie,
      body: { type: 'memo', title: '护照', categoryId: id },
    });
    const { id: recordId } = (await record.json()) as { id: string };

    const deleted = await request(app, 'DELETE', `/api/v1/categories/${id}`, { cookie });
    expect(deleted.status).toBe(204);
    const after = await request(app, 'GET', `/api/v1/records/${recordId}`, { cookie });
    expect(await after.json()).toMatchObject({ categoryId: null, version: 1 });
  });

  it('deletes a tag and removes it from records', async () => {
    const app = createTestApp();
    const { cookie } = await registerUser(app);
    const tag = await request(app, 'POST', '/api/v1/tags', {
      cookie,
      body: { name: '重要' },
    });
    const { id } = (await tag.json()) as { id: string };
    const record = await request(app, 'POST', '/api/v1/records', {
      cookie,
      body: { type: 'memo', title: 'x', tagIds: [id] },
    });
    const { id: recordId } = (await record.json()) as { id: string };

    await request(app, 'DELETE', `/api/v1/tags/${id}`, { cookie });
    const after = await request(app, 'GET', `/api/v1/records/${recordId}`, { cookie });
    expect(await after.json()).toMatchObject({ tagIds: [] });
  });

  it('puts new categories last regardless of their names', async () => {
    const app = createTestApp();
    const { cookie } = await registerUser(app);
    for (const name of ['b', 'a']) {
      await request(app, 'POST', '/api/v1/categories', { cookie, body: { name } });
    }
    const list = await request(app, 'GET', '/api/v1/categories', { cookie });
    expect(
      ((await list.json()) as { items: { name: string }[] }).items.map(
        (item) => item.name,
      ),
    ).toEqual(['b', 'a']);
  });

  it('reorders categories, keeping unlisted ones at the end', async () => {
    const app = createTestApp();
    const { cookie } = await registerUser(app);
    const ids: string[] = [];
    for (const name of ['a', 'b', 'c']) {
      const response = await request(app, 'POST', '/api/v1/categories', {
        cookie,
        body: { name },
      });
      ids.push(((await response.json()) as { id: string }).id);
    }
    const response = await request(app, 'POST', '/api/v1/categories/reorder', {
      cookie,
      body: { ids: [ids[2], ids[0]] },
    });
    expect(
      ((await response.json()) as { items: { name: string }[] }).items.map(
        (item) => item.name,
      ),
    ).toEqual(['c', 'a', 'b']);
  });

  it('hides other users’ categories and tags from changes', async () => {
    const app = createTestApp();
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');
    const tag = await request(app, 'POST', '/api/v1/tags', {
      cookie: alice.cookie,
      body: { name: '家' },
    });
    const { id } = (await tag.json()) as { id: string };
    const rename = await request(app, 'PATCH', `/api/v1/tags/${id}`, {
      cookie: bob.cookie,
      body: { name: 'x' },
    });
    expect(rename.status).toBe(404);
    const remove = await request(app, 'DELETE', `/api/v1/tags/${id}`, {
      cookie: bob.cookie,
    });
    expect(remove.status).toBe(404);
  });
});

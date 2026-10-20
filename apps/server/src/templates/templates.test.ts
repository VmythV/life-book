import { type ChecklistTemplate, type LifeRecord } from '@life-book/core';
import { describe, expect, it } from 'vitest';

import { registerUser, request, setupTestDatabase, type TestApp } from '../test/harness';

const { createTestApp } = setupTestDatabase();

async function createTemplate(app: TestApp, cookie: string): Promise<ChecklistTemplate> {
  const response = await request(app, 'POST', '/api/v1/templates', {
    cookie,
    body: {
      title: '出差',
      notes: '提前一天收拾',
      items: [
        { title: '护照' },
        { title: '充电器', groupName: '电子', quantity: 2, unit: '个' },
      ],
    },
  });
  if (response.status !== 201) {
    throw new Error(`Create failed with ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as ChecklistTemplate;
}

describe('checklist templates', () => {
  it('creates, lists, updates and deletes templates', async () => {
    const app = createTestApp();
    const { cookie } = await registerUser(app);
    const template = await createTemplate(app, cookie);
    expect(template).toMatchObject({
      title: '出差',
      notes: '提前一天收拾',
      items: [
        { title: '护照', groupName: null, sortOrder: 0 },
        { title: '充电器', groupName: '电子', quantity: 2, unit: '个', sortOrder: 1 },
      ],
    });

    const updated = await request(app, 'PATCH', `/api/v1/templates/${template.id}`, {
      cookie,
      body: { title: '短途出差', items: [{ title: '身份证' }] },
    });
    expect(await updated.json()).toMatchObject({
      title: '短途出差',
      notes: '提前一天收拾',
      items: [{ title: '身份证' }],
    });

    const list = await request(app, 'GET', '/api/v1/templates', { cookie });
    expect(((await list.json()) as { items: unknown[] }).items).toHaveLength(1);

    const deleted = await request(app, 'DELETE', `/api/v1/templates/${template.id}`, {
      cookie,
    });
    expect(deleted.status).toBe(204);
    const gone = await request(app, 'GET', `/api/v1/templates/${template.id}`, {
      cookie,
    });
    expect(gone.status).toBe(404);
  });

  it('creates an independent checklist from a template', async () => {
    const app = createTestApp();
    const { cookie } = await registerUser(app);
    const template = await createTemplate(app, cookie);
    const id = '0199f3a2-8c1e-7b4a-9d2e-1f0a3b4c5d6e';

    const created = await request(
      app,
      'POST',
      `/api/v1/templates/${template.id}/instantiate`,
      {
        cookie,
        body: { id, dueAt: '2026-10-20T12:00:00Z' },
      },
    );
    expect(created.status).toBe(201);
    const record = (await created.json()) as LifeRecord;
    expect(record).toMatchObject({
      id,
      type: 'checklist',
      title: '出差',
      notes: '提前一天收拾',
      checklist: {
        sourceTemplateId: template.id,
        dueAt: '2026-10-20T12:00:00.000Z',
        items: [
          { title: '护照', isDone: false },
          { title: '充电器', groupName: '电子', quantity: 2, unit: '个' },
        ],
      },
    });

    // 重复提交返回同一份清单。
    const retried = await request(
      app,
      'POST',
      `/api/v1/templates/${template.id}/instantiate`,
      {
        cookie,
        body: { id },
      },
    );
    expect(retried.status).toBe(200);

    // 修改模板不影响已经创建的清单。
    await request(app, 'PATCH', `/api/v1/templates/${template.id}`, {
      cookie,
      body: { items: [] },
    });
    await request(app, 'DELETE', `/api/v1/templates/${template.id}`, { cookie });
    const checklist = await request(app, 'GET', `/api/v1/records/${id}`, { cookie });
    expect(((await checklist.json()) as LifeRecord).checklist?.items).toHaveLength(2);
  });

  it('saves a checklist as a template without check marks', async () => {
    const app = createTestApp();
    const { cookie } = await registerUser(app);
    const created = await request(app, 'POST', '/api/v1/records', {
      cookie,
      body: {
        type: 'checklist',
        title: '搬家',
        checklist: { items: [{ title: '纸箱', quantity: 10 }, { title: '胶带' }] },
      },
    });
    const record = (await created.json()) as LifeRecord;
    await request(app, 'POST', `/api/v1/records/${record.id}/items/complete-all`, {
      cookie,
      body: {},
    });

    const saved = await request(
      app,
      'POST',
      `/api/v1/records/${record.id}/save-as-template`,
      {
        cookie,
        body: {},
      },
    );
    expect(saved.status).toBe(201);
    expect(await saved.json()).toMatchObject({
      title: '搬家',
      items: [{ title: '纸箱', quantity: 10 }, { title: '胶带' }],
    });
  });

  it('keeps templates private to each user', async () => {
    const app = createTestApp();
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');
    const template = await createTemplate(app, alice.cookie);
    const path = `/api/v1/templates/${template.id}`;

    for (const [method, url, body] of [
      ['GET', path, undefined],
      ['PATCH', path, { title: 'x' }],
      ['DELETE', path, undefined],
      ['POST', `${path}/instantiate`, {}],
    ] as const) {
      const response = await request(app, method, url, {
        cookie: bob.cookie,
        ...(body === undefined ? {} : { body }),
      });
      expect(response.status, `${method} ${url}`).toBe(404);
    }
    const list = await request(app, 'GET', '/api/v1/templates', { cookie: bob.cookie });
    expect(await list.json()).toEqual({ items: [] });
  });
});

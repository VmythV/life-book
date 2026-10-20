import { type LifeRecord, type RecordListResponse } from '@life-book/core';
import { describe, expect, it } from 'vitest';

import {
  createTestUser,
  request,
  setupTestDatabase,
  type TestApp,
} from '../test/harness';

const { createTestApp } = setupTestDatabase();

// 上海时间 2026-10-19（周一）10:00。
const NOW = new Date('2026-10-19T02:00:00Z');

const weeklyRule = {
  startDate: '2026-10-01',
  freq: 'weekly',
  interval: 1,
  byWeekdays: [1, 4],
  byMonthDay: null,
  timeOfDay: '09:00',
  end: { type: 'never' },
};

async function setup() {
  let now = NOW;
  const app = createTestApp({ now: () => now });
  const { cookie } = await createTestUser(app);
  return {
    app,
    cookie,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}

async function createRecord(
  app: TestApp,
  cookie: string,
  body: Record<string, unknown>,
): Promise<LifeRecord> {
  const response = await request(app, 'POST', '/api/v1/records', { cookie, body });
  if (response.status !== 201) {
    throw new Error(`Create failed with ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as LifeRecord;
}

async function listRecords(
  app: TestApp,
  cookie: string,
  query = '',
): Promise<RecordListResponse> {
  const response = await request(app, 'GET', `/api/v1/records${query}`, { cookie });
  expect(response.status).toBe(200);
  return (await response.json()) as RecordListResponse;
}

describe('POST /api/v1/records', () => {
  it('creates a recurring record with its rule and reminders', async () => {
    const { app, cookie } = await setup();
    const record = await createRecord(app, cookie, {
      type: 'recurring',
      title: '给绿植浇水',
      recurring: weeklyRule,
      reminders: [{ kind: 'relative', daysBefore: 0, timeOfDay: null }],
    });

    expect(record).toEqual({
      id: expect.any(String),
      type: 'recurring',
      title: '给绿植浇水',
      notes: null,
      categoryId: null,
      tagIds: [],
      isPinned: false,
      archivedAt: null,
      deletedAt: null,
      version: 1,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      recurring: weeklyRule,
      importantDate: null,
      checklist: null,
      householdItem: null,
      reminders: [
        {
          id: expect.any(String),
          enabled: true,
          kind: 'relative',
          daysBefore: 0,
          timeOfDay: null,
        },
      ],
      nextOccurrenceDate: '2026-10-19',
    });
  });

  it('creates important dates and memos', async () => {
    const { app, cookie } = await setup();
    const birthday = await createRecord(app, cookie, {
      type: 'important_date',
      title: '妈妈的生日',
      importantDate: {
        kind: 'birthday',
        repeat: 'yearly',
        year: null,
        month: 10,
        day: 24,
        startYear: 1966,
        showCounter: true,
      },
      reminders: [
        { kind: 'relative', daysBefore: 7, timeOfDay: null },
        { kind: 'relative', daysBefore: 0, timeOfDay: '08:00' },
      ],
    });
    expect(birthday.importantDate).toMatchObject({ month: 10, day: 24 });
    expect(birthday.reminders.map((reminder) => reminder.kind)).toEqual([
      'relative',
      'relative',
    ]);

    const memo = await createRecord(app, cookie, {
      type: 'memo',
      notes: 'Wi-Fi 密码：12345678',
      reminders: [{ kind: 'absolute', fireAt: '2026-10-20T06:00:00+08:00' }],
    });
    expect(memo).toMatchObject({ title: '', notes: 'Wi-Fi 密码：12345678' });
    expect(memo.reminders[0]).toMatchObject({
      kind: 'absolute',
      fireAt: '2026-10-19T22:00:00.000Z',
    });
  });

  it('returns the same record when the client retries with the same id', async () => {
    const { app, cookie } = await setup();
    const body = {
      id: '0199f3a2-8c1e-7b4a-9d2e-1f0a3b4c5d6e',
      type: 'memo',
      title: '带身份证',
    };
    const first = await request(app, 'POST', '/api/v1/records', { cookie, body });
    const second = await request(app, 'POST', '/api/v1/records', { cookie, body });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect((await listRecords(app, cookie)).items).toHaveLength(1);
  });

  it('rejects an id that another user already used', async () => {
    const { app, cookie } = await setup();
    const id = '0199f3a2-8c1e-7b4a-9d2e-1f0a3b4c5d6e';
    await createRecord(app, cookie, { id, type: 'memo', title: 'mine' });
    const bob = await createTestUser(app, 'bob');

    const response = await request(app, 'POST', '/api/v1/records', {
      cookie: bob.cookie,
      body: { id, type: 'memo', title: 'theirs' },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'ID_CONFLICT' } });
  });

  it('validates content against the type', async () => {
    const { app, cookie } = await setup();
    const response = await request(app, 'POST', '/api/v1/records', {
      cookie,
      body: { type: 'recurring', title: '', recurring: weeklyRule },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED',
        details: { fieldErrors: { title: ['请填写标题'] } },
      },
    });
  });

  it('only accepts the user’s own categories and tags', async () => {
    const { app, cookie } = await setup();
    const unknown = '0199f3a2-8c1e-7b4a-9d2e-1f0a3b4c5d6e';
    const response = await request(app, 'POST', '/api/v1/records', {
      cookie,
      body: { type: 'memo', title: 'x', tagIds: [unknown] },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { message: '标签不存在' } });
  });
});

describe('PATCH /api/v1/records/:id', () => {
  it('updates fields and bumps the version', async () => {
    const { app, cookie, advance } = await setup();
    const record = await createRecord(app, cookie, { type: 'memo', title: '旧标题' });
    const category = await request(app, 'POST', '/api/v1/categories', {
      cookie,
      body: { name: '家务' },
    });
    const { id: categoryId } = (await category.json()) as { id: string };
    advance(60_000);

    const response = await request(app, 'PATCH', `/api/v1/records/${record.id}`, {
      cookie,
      body: { version: 1, title: '新标题', categoryId, isPinned: true },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      title: '新标题',
      categoryId,
      isPinned: true,
      version: 2,
      updatedAt: '2026-10-19T02:01:00.000Z',
    });
  });

  it('rejects a stale version', async () => {
    const { app, cookie } = await setup();
    const record = await createRecord(app, cookie, { type: 'memo', title: 'x' });
    await request(app, 'PATCH', `/api/v1/records/${record.id}`, {
      cookie,
      body: { version: 1, title: 'y' },
    });

    const response = await request(app, 'PATCH', `/api/v1/records/${record.id}`, {
      cookie,
      body: { version: 1, title: 'z' },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: 'VERSION_CONFLICT', details: { currentVersion: 2 } },
    });
  });

  it('rejects details of another type and empty content', async () => {
    const { app, cookie } = await setup();
    const memo = await createRecord(app, cookie, { type: 'memo', title: 'x' });

    const wrongType = await request(app, 'PATCH', `/api/v1/records/${memo.id}`, {
      cookie,
      body: { version: 1, recurring: weeklyRule },
    });
    expect(wrongType.status).toBe(400);

    const empty = await request(app, 'PATCH', `/api/v1/records/${memo.id}`, {
      cookie,
      body: { version: 1, title: '' },
    });
    expect(empty.status).toBe(400);
  });

  it('starts a changed rule from today but keeps time-only edits', async () => {
    const { app, cookie } = await setup();
    const record = await createRecord(app, cookie, {
      type: 'recurring',
      title: '浇水',
      recurring: weeklyRule,
    });

    const timeOnly = await request(app, 'PATCH', `/api/v1/records/${record.id}`, {
      cookie,
      body: { version: 1, recurring: { ...weeklyRule, timeOfDay: '20:00' } },
    });
    expect(await timeOnly.json()).toMatchObject({
      recurring: { startDate: '2026-10-01', timeOfDay: '20:00' },
    });

    const changed = await request(app, 'PATCH', `/api/v1/records/${record.id}`, {
      cookie,
      body: { version: 2, recurring: { ...weeklyRule, byWeekdays: [6] } },
    });
    expect(await changed.json()).toMatchObject({
      recurring: { startDate: '2026-10-19', byWeekdays: [6] },
    });
  });

  it('replaces reminders and tags', async () => {
    const { app, cookie } = await setup();
    const tag = await request(app, 'POST', '/api/v1/tags', {
      cookie,
      body: { name: '重要' },
    });
    const { id: tagId } = (await tag.json()) as { id: string };
    const record = await createRecord(app, cookie, {
      type: 'memo',
      title: 'x',
      reminders: [{ kind: 'absolute', fireAt: '2026-10-20T01:00:00Z' }],
    });

    const response = await request(app, 'PATCH', `/api/v1/records/${record.id}`, {
      cookie,
      body: { version: 1, reminders: [], tagIds: [tagId] },
    });
    expect(await response.json()).toMatchObject({ reminders: [], tagIds: [tagId] });
  });
});

describe('GET /api/v1/records', () => {
  it('filters by type, category, tag and search text', async () => {
    const { app, cookie } = await setup();
    const tag = await request(app, 'POST', '/api/v1/tags', {
      cookie,
      body: { name: '家' },
    });
    const { id: tagId } = (await tag.json()) as { id: string };
    const category = await request(app, 'POST', '/api/v1/categories', {
      cookie,
      body: { name: '证件' },
    });
    const { id: categoryId } = (await category.json()) as { id: string };

    const memo = await createRecord(app, cookie, {
      type: 'memo',
      title: '护照',
      notes: '放在书房抽屉 100% 确定',
      categoryId,
      tagIds: [tagId],
    });
    await createRecord(app, cookie, {
      type: 'recurring',
      title: '浇水',
      recurring: weeklyRule,
    });

    const titles = async (query: string) =>
      (await listRecords(app, cookie, query)).items.map((record) => record.title);
    expect(await titles('?type=memo')).toEqual(['护照']);
    expect(await titles(`?categoryId=${categoryId}`)).toEqual(['护照']);
    expect(await titles(`?tagId=${tagId}`)).toEqual(['护照']);
    expect(await titles('?q=书房')).toEqual(['护照']);
    expect(await titles('?q=100%25')).toEqual(['护照']);
    expect(await titles('?q=0%25')).toEqual(['护照']);
    expect(await titles('?q=%25%25')).toEqual([]);
    expect(await titles('?q=浇')).toEqual(['浇水']);
    expect(memo.tagIds).toEqual([tagId]);
  });

  it('pages with a cursor, pinned records first', async () => {
    const { app, cookie, advance } = await setup();
    const ids: string[] = [];
    for (const title of ['a', 'b', 'c', 'd', 'e']) {
      ids.push((await createRecord(app, cookie, { type: 'memo', title })).id);
      advance(1000);
    }
    await request(app, 'PATCH', `/api/v1/records/${ids[0] ?? ''}`, {
      cookie,
      body: { version: 1, isPinned: true },
    });

    const first = await listRecords(app, cookie, '?limit=2');
    expect(first.items.map((record) => record.title)).toEqual(['a', 'e']);
    const second = await listRecords(
      app,
      cookie,
      `?limit=2&cursor=${first.nextCursor ?? ''}`,
    );
    expect(second.items.map((record) => record.title)).toEqual(['d', 'c']);
    const third = await listRecords(
      app,
      cookie,
      `?limit=2&cursor=${second.nextCursor ?? ''}`,
    );
    expect(third.items.map((record) => record.title)).toEqual(['b']);
    expect(third.nextCursor).toBeNull();
  });

  it('rejects a malformed cursor', async () => {
    const { app, cookie } = await setup();
    const response = await request(app, 'GET', '/api/v1/records?cursor=nope', { cookie });
    expect(response.status).toBe(400);
  });
});

describe('archive, trash and restore', () => {
  it('moves records between active, archived and trash', async () => {
    const { app, cookie } = await setup();
    const record = await createRecord(app, cookie, { type: 'memo', title: 'x' });
    const titles = async (status: string) =>
      (await listRecords(app, cookie, `?status=${status}`)).items.map((item) => item.id);

    const archived = await request(app, 'POST', `/api/v1/records/${record.id}/archive`, {
      cookie,
    });
    expect(await archived.json()).toMatchObject({
      archivedAt: NOW.toISOString(),
      version: 2,
    });
    expect(await titles('active')).toEqual([]);
    expect(await titles('archived')).toEqual([record.id]);

    await request(app, 'POST', `/api/v1/records/${record.id}/unarchive`, { cookie });
    expect(await titles('active')).toEqual([record.id]);

    const deleted = await request(app, 'DELETE', `/api/v1/records/${record.id}`, {
      cookie,
    });
    expect(deleted.status).toBe(200);
    expect(await titles('trash')).toEqual([record.id]);
    const hidden = await request(app, 'PATCH', `/api/v1/records/${record.id}`, {
      cookie,
      body: { version: 4, title: 'y' },
    });
    expect(hidden.status).toBe(404);

    const restored = await request(app, 'POST', `/api/v1/records/${record.id}/restore`, {
      cookie,
    });
    expect(await restored.json()).toMatchObject({ deletedAt: null, version: 5 });
  });

  it('only permanently deletes records in the trash', async () => {
    const { app, cookie } = await setup();
    const record = await createRecord(app, cookie, { type: 'memo', title: 'x' });

    const active = await request(
      app,
      'DELETE',
      `/api/v1/records/${record.id}/permanent`,
      {
        cookie,
      },
    );
    expect(active.status).toBe(400);

    await request(app, 'DELETE', `/api/v1/records/${record.id}`, { cookie });
    const permanent = await request(
      app,
      'DELETE',
      `/api/v1/records/${record.id}/permanent`,
      {
        cookie,
      },
    );
    expect(permanent.status).toBe(204);
    const gone = await request(app, 'GET', `/api/v1/records/${record.id}`, { cookie });
    expect(gone.status).toBe(404);
  });
});

describe('occurrences', () => {
  it('completes, skips and undoes occurrences', async () => {
    const { app, cookie } = await setup();
    const record = await createRecord(app, cookie, {
      type: 'recurring',
      title: '浇水',
      recurring: weeklyRule,
    });
    const path = `/api/v1/records/${record.id}/occurrences`;

    const completed = await request(app, 'PUT', `${path}/2026-10-15`, {
      cookie,
      body: { status: 'completed' },
    });
    expect(await completed.json()).toEqual({
      recordId: record.id,
      date: '2026-10-15',
      originalDate: '2026-10-15',
      status: 'completed',
      handledAt: NOW.toISOString(),
    });
    await request(app, 'PUT', `${path}/2026-10-19`, {
      cookie,
      body: { status: 'skipped' },
    });

    const list = await request(app, 'GET', `${path}?from=2026-10-12&to=2026-10-22`, {
      cookie,
    });
    expect(
      ((await list.json()) as { items: { date: string; status: string }[] }).items.map(
        (item) => [item.date, item.status],
      ),
    ).toEqual([
      ['2026-10-12', 'overdue'],
      ['2026-10-15', 'completed'],
      ['2026-10-19', 'skipped'],
      ['2026-10-22', 'pending'],
    ]);

    const undo = await request(app, 'DELETE', `${path}/2026-10-15`, { cookie });
    expect(undo.status).toBe(204);
  });

  it('rejects dates that are not part of the rule', async () => {
    const { app, cookie } = await setup();
    const record = await createRecord(app, cookie, {
      type: 'recurring',
      title: '浇水',
      recurring: weeklyRule,
    });
    const response = await request(
      app,
      'PUT',
      `/api/v1/records/${record.id}/occurrences/2026-10-20`,
      { cookie, body: { status: 'completed' } },
    );
    expect(response.status).toBe(400);
  });

  it('only exists for recurring records', async () => {
    const { app, cookie } = await setup();
    const memo = await createRecord(app, cookie, { type: 'memo', title: 'x' });
    const response = await request(
      app,
      'PUT',
      `/api/v1/records/${memo.id}/occurrences/2026-10-19`,
      { cookie, body: { status: 'completed' } },
    );
    expect(response.status).toBe(404);
  });

  it('reschedules one occurrence without changing the rule', async () => {
    const { app, cookie } = await setup();
    const record = await createRecord(app, cookie, {
      type: 'recurring',
      title: '浇水',
      recurring: weeklyRule,
    });
    const path = `/api/v1/records/${record.id}/occurrences`;
    const list = async () =>
      (
        (await (
          await request(app, 'GET', `${path}?from=2026-10-19&to=2026-10-26`, { cookie })
        ).json()) as { items: { date: string; originalDate: string; status: string }[] }
      ).items.map((item) => [item.date, item.originalDate, item.status]);

    // 周四 10-22 改到周六 10-24。
    const moved = await request(app, 'PUT', `${path}/2026-10-22/reschedule`, {
      cookie,
      body: { to: '2026-10-24' },
    });
    expect(await moved.json()).toMatchObject({
      date: '2026-10-24',
      originalDate: '2026-10-22',
      status: 'pending',
    });
    expect(await list()).toEqual([
      ['2026-10-19', '2026-10-19', 'pending'],
      ['2026-10-24', '2026-10-22', 'pending'],
      ['2026-10-26', '2026-10-26', 'pending'],
    ]);

    // 完成后撤销，仍然停在新日期。
    await request(app, 'PUT', `${path}/2026-10-22`, {
      cookie,
      body: { status: 'completed' },
    });
    const done = await list();
    expect(done[1]).toEqual(['2026-10-24', '2026-10-22', 'completed']);
    const blocked = await request(app, 'PUT', `${path}/2026-10-22/reschedule`, {
      cookie,
      body: { to: '2026-10-25' },
    });
    expect(blocked.status).toBe(400);
    await request(app, 'DELETE', `${path}/2026-10-22`, { cookie });
    expect((await list())[1]).toEqual(['2026-10-24', '2026-10-22', 'pending']);

    // 取消改期回到原定日期。
    await request(app, 'DELETE', `${path}/2026-10-22/reschedule`, { cookie });
    expect((await list())[1]).toEqual(['2026-10-22', '2026-10-22', 'pending']);
  });

  it('reports the next pending date after completing and rescheduling', async () => {
    const { app, cookie } = await setup();
    const record = await createRecord(app, cookie, {
      type: 'recurring',
      title: '浇水',
      recurring: weeklyRule,
    });
    const path = `/api/v1/records/${record.id}/occurrences`;
    const next = async () => {
      const list = await listRecords(app, cookie, '?type=recurring');
      return list.items[0]?.nextOccurrenceDate;
    };

    expect(await next()).toBe('2026-10-19');
    // 今天完成后，下一次是周四；周四改到周二，下一次就是周二。
    await request(app, 'PUT', `${path}/2026-10-19`, {
      cookie,
      body: { status: 'completed' },
    });
    expect(await next()).toBe('2026-10-22');
    await request(app, 'PUT', `${path}/2026-10-22/reschedule`, {
      cookie,
      body: { to: '2026-10-20' },
    });
    expect(await next()).toBe('2026-10-20');
  });

  it('limits how far an occurrence can move', async () => {
    const { app, cookie } = await setup();
    const record = await createRecord(app, cookie, {
      type: 'recurring',
      title: '浇水',
      recurring: weeklyRule,
    });
    const response = await request(
      app,
      'PUT',
      `/api/v1/records/${record.id}/occurrences/2026-10-22/reschedule`,
      { cookie, body: { to: '2027-01-01' } },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { message: '最多改到前后 60 天' },
    });
  });
});

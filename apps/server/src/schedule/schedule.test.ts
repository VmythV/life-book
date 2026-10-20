import {
  type CalendarResponse,
  type TodayResponse,
  type UpcomingRemindersResponse,
} from '@life-book/core';
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

async function create(app: TestApp, cookie: string, body: Record<string, unknown>) {
  const response = await request(app, 'POST', '/api/v1/records', { cookie, body });
  if (response.status !== 201) {
    throw new Error(`Create failed with ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as { id: string };
}

async function seed(app: TestApp, cookie: string) {
  const water = await create(app, cookie, {
    type: 'recurring',
    title: '给绿植浇水',
    recurring: {
      startDate: '2026-10-01',
      freq: 'weekly',
      interval: 1,
      byWeekdays: [1, 4],
      byMonthDay: null,
      timeOfDay: '09:00',
      end: { type: 'never' },
    },
    reminders: [{ kind: 'relative', daysBefore: 0, timeOfDay: null }],
  });
  const birthday = await create(app, cookie, {
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
    reminders: [{ kind: 'relative', daysBefore: 1, timeOfDay: null }],
  });
  const memo = await create(app, cookie, {
    type: 'memo',
    title: '带身份证去银行',
    reminders: [{ kind: 'absolute', fireAt: '2026-10-19T14:00:00+08:00' }],
  });
  return { water, birthday, memo };
}

describe('GET /api/v1/today', () => {
  it('aggregates overdue, today and upcoming dates in the user’s time zone', async () => {
    const app = createTestApp({ now: () => NOW });
    const { cookie } = await createTestUser(app);
    const { water, birthday, memo } = await seed(app, cookie);
    // 10-15 已完成，10-12 和更早的周一、周四未处理。
    await request(app, 'PUT', `/api/v1/records/${water.id}/occurrences/2026-10-15`, {
      cookie,
      body: { status: 'completed' },
    });

    const response = await request(app, 'GET', '/api/v1/today', { cookie });
    expect(response.status).toBe(200);
    const today = (await response.json()) as TodayResponse;

    expect(today.date).toBe('2026-10-19');
    expect(today.overdue).toEqual([
      {
        kind: 'occurrence',
        recordId: water.id,
        title: '给绿植浇水',
        date: '2026-10-12',
        originalDate: '2026-10-12',
        time: '09:00',
        status: 'overdue',
        moreCount: 3,
      },
    ]);
    expect(today.today.map((card) => [card.kind, card.recordId, card.time])).toEqual([
      ['occurrence', water.id, '09:00'],
      ['memo_reminder', memo.id, '14:00'],
    ]);
    expect(today.upcomingDates).toEqual([
      {
        kind: 'important_date',
        recordId: birthday.id,
        title: '妈妈的生日',
        dateKind: 'birthday',
        date: '2026-10-24',
        daysUntil: 5,
        counter: 60,
      },
    ]);
  });

  it('accepts an explicit date and leaves out archived and deleted records', async () => {
    const app = createTestApp({ now: () => NOW });
    const { cookie } = await createTestUser(app);
    const { water, memo } = await seed(app, cookie);
    await request(app, 'POST', `/api/v1/records/${water.id}/archive`, { cookie });
    await request(app, 'DELETE', `/api/v1/records/${memo.id}`, { cookie });

    const response = await request(app, 'GET', '/api/v1/today?date=2026-10-24', {
      cookie,
    });
    const today = (await response.json()) as TodayResponse;
    expect(today.overdue).toEqual([]);
    expect(today.today).toEqual([]);
    expect(today.upcomingDates[0]).toMatchObject({ daysUntil: 0 });
  });
});

describe('GET /api/v1/reminders/upcoming', () => {
  it('lists reminder times for the coming days', async () => {
    const app = createTestApp({ now: () => NOW });
    const { cookie } = await createTestUser(app);
    const { water, birthday, memo } = await seed(app, cookie);
    // 周四的已经提前完成，不再提醒。
    await request(app, 'PUT', `/api/v1/records/${water.id}/occurrences/2026-10-22`, {
      cookie,
      body: { status: 'completed' },
    });

    const response = await request(app, 'GET', '/api/v1/reminders/upcoming?days=7', {
      cookie,
    });
    expect(response.status).toBe(200);
    const { items } = (await response.json()) as UpcomingRemindersResponse;
    expect(
      items.map((item) => [item.recordId, item.fireAt, item.occurrenceDate]),
    ).toEqual([
      [memo.id, '2026-10-19T06:00:00.000Z', null],
      [birthday.id, '2026-10-23T01:00:00.000Z', '2026-10-24'],
      [water.id, '2026-10-26T01:00:00.000Z', '2026-10-26'],
    ]);
    expect(items[0]?.key).toMatch(/:once$/);
  });

  it('uses the default reminder time from the settings', async () => {
    const app = createTestApp({ now: () => NOW });
    const { cookie } = await createTestUser(app);
    await request(app, 'PATCH', '/api/v1/me/settings', {
      cookie,
      body: { defaultReminderTime: '20:30' },
    });
    const { birthday } = await seed(app, cookie);

    const response = await request(app, 'GET', '/api/v1/reminders/upcoming', { cookie });
    const { items } = (await response.json()) as UpcomingRemindersResponse;
    expect(items.find((item) => item.recordId === birthday.id)?.fireAt).toBe(
      '2026-10-23T12:30:00.000Z',
    );
  });
});

describe('GET /api/v1/calendar', () => {
  it('lists what happens on each day of the range', async () => {
    const app = createTestApp({ now: () => NOW });
    const { cookie } = await createTestUser(app);
    const { water, birthday, memo } = await seed(app, cookie);
    await request(app, 'PUT', `/api/v1/records/${water.id}/occurrences/2026-10-15`, {
      cookie,
      body: { status: 'completed' },
    });
    await request(
      app,
      'PUT',
      `/api/v1/records/${water.id}/occurrences/2026-10-22/reschedule`,
      { cookie, body: { to: '2026-10-23' } },
    );

    const response = await request(
      app,
      'GET',
      '/api/v1/calendar?from=2026-10-12&to=2026-10-25',
      { cookie },
    );
    expect(response.status).toBe(200);
    const calendar = (await response.json()) as CalendarResponse;
    expect(calendar.today).toBe('2026-10-19');
    expect(
      calendar.items.map((item) => [
        item.date,
        item.recordId,
        item.kind === 'occurrence' ? item.status : item.kind,
      ]),
    ).toEqual([
      ['2026-10-12', water.id, 'overdue'],
      ['2026-10-15', water.id, 'completed'],
      ['2026-10-19', water.id, 'pending'],
      ['2026-10-19', memo.id, 'memo_reminder'],
      ['2026-10-23', water.id, 'pending'],
      ['2026-10-24', birthday.id, 'important_date'],
    ]);
    expect(calendar.items[4]).toMatchObject({ originalDate: '2026-10-22' });
    expect(calendar.items[5]).toMatchObject({ counter: 60 });

    // 别人的日历里看不到这些。
    const other = await createTestUser(app, 'bob');
    const otherResponse = await request(
      app,
      'GET',
      '/api/v1/calendar?from=2026-10-12&to=2026-10-25',
      { cookie: other.cookie },
    );
    expect(((await otherResponse.json()) as CalendarResponse).items).toEqual([]);
  });

  it('rejects a missing, reversed or too long range', async () => {
    const app = createTestApp({ now: () => NOW });
    const { cookie } = await createTestUser(app);
    for (const query of [
      '',
      '?from=2026-10-25&to=2026-10-12',
      '?from=2026-10-01&to=2026-12-31',
    ]) {
      const response = await request(app, 'GET', `/api/v1/calendar${query}`, { cookie });
      expect(response.status).toBe(400);
    }
    expect(
      (await request(app, 'GET', '/api/v1/calendar?from=2026-10-12&to=2026-10-25'))
        .status,
    ).toBe(401);
  });
});

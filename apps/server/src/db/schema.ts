import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  type AnyPgColumn,
  type PgColumn,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);
const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const userId = () =>
  uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });
const localDate = (name: string) => date(name, { mode: 'string' });

export const users = pgTable(
  'users',
  {
    id: id(),
    username: text('username').notNull(),
    displayName: text('display_name'),
    passwordHash: text('password_hash').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('users_username').on(table.username),
    check('users_username_format', sql`${table.username} ~ '^[a-z0-9_]{3,32}$'`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [index('sessions_user').on(table.userId)],
);

export const userSettings = pgTable(
  'user_settings',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    timezone: text('timezone').notNull().default('Asia/Shanghai'),
    defaultReminderTime: time('default_reminder_time').notNull().default('09:00'),
    weekStartsOn: smallint('week_starts_on').notNull().default(1),
    updatedAt: updatedAt(),
  },
  (table) => [
    check('user_settings_week_starts_on', sql`${table.weekStartsOn} between 1 and 7`),
  ],
);

// ---- 记录 ----

export const categories = pgTable(
  'categories',
  {
    id: id(),
    userId: userId(),
    name: text('name').notNull(),
    color: text('color'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('categories_id_user').on(table.id, table.userId),
    uniqueIndex('categories_user_name').on(table.userId, sql`lower(${table.name})`),
  ],
);

export const tags = pgTable(
  'tags',
  {
    id: id(),
    userId: userId(),
    name: text('name').notNull(),
    color: text('color'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('tags_id_user').on(table.id, table.userId),
    uniqueIndex('tags_user_name').on(table.userId, sql`lower(${table.name})`),
  ],
);

export const records = pgTable(
  'records',
  {
    id: id(),
    userId: userId(),
    type: text('type', {
      enum: ['recurring', 'important_date', 'memo', 'checklist', 'household_item'],
    }).notNull(),
    title: text('title').notNull().default(''),
    notes: text('notes'),
    categoryId: uuid('category_id'),
    isPinned: boolean('is_pinned').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('records_id_user').on(table.id, table.userId),
    check(
      'records_type',
      sql`${table.type} in ('recurring', 'important_date', 'memo', 'checklist', 'household_item')`,
    ),
    // 分类只能删除前先把记录的分类清空（V1 的分类管理里处理）。
    foreignKey({
      name: 'records_category',
      columns: [table.categoryId, table.userId],
      foreignColumns: [categories.id, categories.userId],
    }),
    index('records_user_type')
      .on(table.userId, table.type)
      .where(sql`${table.deletedAt} is null`),
    index('records_user_list').on(
      table.userId,
      table.isPinned.desc(),
      table.updatedAt.desc(),
      table.id.desc(),
    ),
  ],
);

/** 子表通过 `(record_id, user_id)` 复合外键保证与父记录属于同一用户。 */
const recordForeignKey = (
  name: string,
  table: { recordId: PgColumn; userId: PgColumn },
) =>
  foreignKey({
    name,
    columns: [table.recordId, table.userId],
    foreignColumns: [records.id, records.userId],
  }).onDelete('cascade');

export const recordTags = pgTable(
  'record_tags',
  {
    userId: userId(),
    recordId: uuid('record_id').notNull(),
    tagId: uuid('tag_id').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ name: 'record_tags_pk', columns: [table.recordId, table.tagId] }),
    recordForeignKey('record_tags_record', table),
    foreignKey({
      name: 'record_tags_tag',
      columns: [table.tagId, table.userId],
      foreignColumns: [tags.id, tags.userId],
    }).onDelete('cascade'),
    index('record_tags_user_tag').on(table.userId, table.tagId),
  ],
);

export const recurringRules = pgTable(
  'recurring_rules',
  {
    recordId: uuid('record_id').primaryKey(),
    userId: userId(),
    startDate: localDate('start_date').notNull(),
    freq: text('freq', { enum: ['daily', 'weekly', 'monthly', 'yearly'] }).notNull(),
    interval: smallint('interval').notNull().default(1),
    byWeekdays: smallint('by_weekdays').array(),
    byMonthDay: smallint('by_month_day'),
    timeOfDay: time('time_of_day'),
    endType: text('end_type', { enum: ['never', 'until', 'count'] })
      .notNull()
      .default('never'),
    untilDate: localDate('until_date'),
    count: integer('count'),
    updatedAt: updatedAt(),
  },
  (table) => [
    recordForeignKey('recurring_rules_record', table),
    check(
      'recurring_rules_freq',
      sql`${table.freq} in ('daily', 'weekly', 'monthly', 'yearly')`,
    ),
    check('recurring_rules_interval', sql`${table.interval} >= 1`),
    check('recurring_rules_month_day', sql`${table.byMonthDay} between 1 and 31`),
    check(
      'recurring_rules_end_type',
      sql`${table.endType} in ('never', 'until', 'count')`,
    ),
    check('recurring_rules_count', sql`${table.count} >= 1`),
  ],
);

/** 只保存已处理的周期实例；没有对应行就是“待完成”。 */
export const occurrences = pgTable(
  'occurrences',
  {
    id: id(),
    userId: userId(),
    recordId: uuid('record_id').notNull(),
    /** 规则算出的原定日期。 */
    occurrenceDate: localDate('occurrence_date').notNull(),
    /** pending 只用于改期后还没处理的实例。 */
    status: text('status', { enum: ['pending', 'completed', 'skipped'] }).notNull(),
    /** “仅本次改期”后的日期。 */
    rescheduledTo: localDate('rescheduled_to'),
    handledAt: timestamp('handled_at', { withTimezone: true }).notNull().defaultNow(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (table) => [
    unique('occurrences_record_date').on(table.recordId, table.occurrenceDate),
    recordForeignKey('occurrences_record', table),
    check(
      'occurrences_status',
      sql`${table.status} in ('pending', 'completed', 'skipped')`,
    ),
    check(
      'occurrences_pending_rescheduled',
      sql`${table.status} <> 'pending' or ${table.rescheduledTo} is not null`,
    ),
    index('occurrences_user_date').on(table.userId, table.occurrenceDate),
  ],
);

export const importantDates = pgTable(
  'important_dates',
  {
    recordId: uuid('record_id').primaryKey(),
    userId: userId(),
    kind: text('kind', {
      enum: ['birthday', 'anniversary', 'expiry', 'other'],
    }).notNull(),
    repeat: text('repeat', { enum: ['once', 'yearly'] }).notNull(),
    year: smallint('year'),
    month: smallint('month').notNull(),
    day: smallint('day').notNull(),
    startYear: smallint('start_year'),
    showCounter: boolean('show_counter').notNull().default(true),
    updatedAt: updatedAt(),
  },
  (table) => [
    recordForeignKey('important_dates_record', table),
    check(
      'important_dates_kind',
      sql`${table.kind} in ('birthday', 'anniversary', 'expiry', 'other')`,
    ),
    check('important_dates_repeat', sql`${table.repeat} in ('once', 'yearly')`),
    check(
      'important_dates_year',
      sql`(${table.repeat} = 'once') = (${table.year} is not null)`,
    ),
    check('important_dates_month', sql`${table.month} between 1 and 12`),
    check('important_dates_day', sql`${table.day} between 1 and 31`),
  ],
);

export const reminders = pgTable(
  'reminders',
  {
    id: id(),
    userId: userId(),
    recordId: uuid('record_id').notNull(),
    kind: text('kind', { enum: ['absolute', 'relative'] }).notNull(),
    fireAt: timestamp('fire_at', { withTimezone: true }),
    daysBefore: smallint('days_before'),
    timeOfDay: time('time_of_day'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    recordForeignKey('reminders_record', table),
    check('reminders_kind', sql`${table.kind} in ('absolute', 'relative')`),
    check(
      'reminders_fire_at',
      sql`(${table.kind} = 'absolute') = (${table.fireAt} is not null)`,
    ),
    check(
      'reminders_days_before',
      sql`(${table.kind} = 'relative') = (${table.daysBefore} is not null) and ${table.daysBefore} >= 0`,
    ),
    index('reminders_user')
      .on(table.userId)
      .where(sql`${table.enabled}`),
    index('reminders_record').on(table.recordId),
  ],
);

// ---- 清单 ----

/** 数量最多 3 位小数，不用浮点数。 */
const quantity = (name: string) =>
  numeric(name, { precision: 12, scale: 3, mode: 'number' });

export const checklists = pgTable(
  'checklists',
  {
    recordId: uuid('record_id').primaryKey(),
    userId: userId(),
    purpose: text('purpose', { enum: ['general', 'shopping'] })
      .notNull()
      .default('general'),
    /** 只作来源说明，不加外键，模板删除后保留。 */
    sourceTemplateId: uuid('source_template_id'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (table) => [
    recordForeignKey('checklists_record', table),
    check('checklists_purpose', sql`${table.purpose} in ('general', 'shopping')`),
  ],
);

export const checklistItems = pgTable(
  'checklist_items',
  {
    id: id(),
    userId: userId(),
    recordId: uuid('record_id').notNull(),
    groupName: text('group_name'),
    title: text('title').notNull(),
    notes: text('notes'),
    quantity: quantity('quantity'),
    unit: text('unit'),
    isDone: boolean('is_done').notNull().default(false),
    doneAt: timestamp('done_at', { withTimezone: true }),
    sortOrder: integer('sort_order').notNull().default(0),
    /** 采购清单里关联的家庭物品；归属由服务层校验，物品永久删除后置空。 */
    householdItemId: uuid('household_item_id').references(() => records.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    recordForeignKey('checklist_items_record', table),
    index('checklist_items_record').on(table.userId, table.recordId, table.sortOrder),
    check('checklist_items_quantity', sql`${table.quantity} >= 0`),
    // 同一物品在同一清单里最多一条未完成的采购项。
    uniqueIndex('checklist_items_active_purchase')
      .on(table.recordId, table.householdItemId)
      .where(sql`${table.householdItemId} is not null and not ${table.isDone}`),
  ],
);

// ---- 清单模板 ----

export const checklistTemplates = pgTable(
  'checklist_templates',
  {
    id: id(),
    userId: userId(),
    title: text('title').notNull(),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('checklist_templates_id_user').on(table.id, table.userId),
    index('checklist_templates_user').on(table.userId, table.updatedAt.desc()),
  ],
);

export const checklistTemplateItems = pgTable(
  'checklist_template_items',
  {
    id: id(),
    userId: userId(),
    templateId: uuid('template_id').notNull(),
    groupName: text('group_name'),
    title: text('title').notNull(),
    quantity: quantity('quantity'),
    unit: text('unit'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    foreignKey({
      name: 'checklist_template_items_template',
      columns: [table.templateId, table.userId],
      foreignColumns: [checklistTemplates.id, checklistTemplates.userId],
    }).onDelete('cascade'),
    index('checklist_template_items_template').on(table.userId, table.templateId),
    check('checklist_template_items_quantity', sql`${table.quantity} >= 0`),
  ],
);

// ---- 家庭物品 ----

export const householdItems = pgTable(
  'household_items',
  {
    recordId: uuid('record_id').primaryKey(),
    userId: userId(),
    unit: text('unit').notNull(),
    quantity: quantity('quantity').notNull().default(0),
    lowStockThreshold: quantity('low_stock_threshold'),
    location: text('location'),
    /** 当前这次低库存从何时开始；恢复后清空。 */
    lowStockSince: timestamp('low_stock_since', { withTimezone: true }),
    /** 这次低库存是否已经提醒过。 */
    lowStockNotifiedAt: timestamp('low_stock_notified_at', { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (table) => [
    recordForeignKey('household_items_record', table),
    check('household_items_quantity', sql`${table.quantity} >= 0`),
    check('household_items_threshold', sql`${table.lowStockThreshold} >= 0`),
  ],
);

/** 库存流水只增不改，改错用一条“调整”流水。 */
export const stockTransactions = pgTable(
  'stock_transactions',
  {
    id: id(),
    userId: userId(),
    recordId: uuid('record_id').notNull(),
    kind: text('kind', {
      enum: ['opening', 'purchase', 'consume', 'adjust', 'discard', 'lost'],
    }).notNull(),
    delta: quantity('delta').notNull(),
    quantityAfter: quantity('quantity_after').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    note: text('note'),
    correctsId: uuid('corrects_id').references((): AnyPgColumn => stockTransactions.id),
    createdAt: createdAt(),
  },
  (table) => [
    recordForeignKey('stock_transactions_record', table),
    check(
      'stock_transactions_kind',
      sql`${table.kind} in ('opening', 'purchase', 'consume', 'adjust', 'discard', 'lost')`,
    ),
    check('stock_transactions_quantity_after', sql`${table.quantityAfter} >= 0`),
    index('stock_transactions_item').on(table.userId, table.recordId, table.createdAt),
  ],
);

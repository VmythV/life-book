# 数据模型

> 下面的 SQL 只用来说明设计。实现后以 `apps/server/src/db/schema.ts` 中的 Drizzle schema 和生成的迁移文件为准，改表时同步更新本文。

## 1. 通用约定

| 约定       | 规则                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| 主键       | `id uuid primary key default uuidv7()`；新建记录时允许客户端传入 `id`，用于幂等。                                        |
| 用户归属   | **每张业务表都有 `user_id uuid not null references users(id) on delete cascade`**。                                      |
| 子表一致性 | 子表用复合外键 `(record_id, user_id) references records(id, user_id)`，保证子行与父记录属于同一用户。                    |
| 时间       | 绝对时间点用 `timestamptz`；业务日期用 `date`；一天中的时刻用 `time`。表都带 `created_at`，可修改的表再加 `updated_at`。 |
| 枚举       | 用 `text` 加 `check` 约束，便于以后增加取值。                                                                            |
| 删除       | 记录软删除（`deleted_at`）后进入回收站，30 天后由定时任务物理删除；其他表随父记录级联删除。                              |
| 数量       | `numeric(12,3)`，最多 3 位小数，不用浮点数。                                                                             |
| 命名       | 表名用复数 snake_case，字段用 snake_case；API 层转换为 camelCase。                                                       |
| 索引       | 业务表的索引都以 `user_id` 开头。                                                                                        |

## 2. 关系概览

```text
users ─┬─ sessions (1:N)
       ├─ user_settings (1:1)
       ├─ categories ─┐
       ├─ tags ───────┼─ record_tags
       └─ records ────┤
            │ type = recurring       ── recurring_rules (1:1) ── occurrences (1:N)
            │ type = important_date  ── important_dates (1:1)
            │ type = memo            ── （正文存在 records.notes）
            │ type = checklist       ── checklists (1:1) ── checklist_items (1:N)   [V1]
            │ type = household_item  ── household_items (1:1) ── stock_transactions [V1]
            └─ reminders (1:N)
       └─ checklist_templates ── checklist_template_items                          [V1]
```

## 3. 账号

```sql
create table users (
  id            uuid primary key default uuidv7(),
  username      text not null,           -- 3～32 位小写字母、数字或下划线，创建时转为小写
  display_name  text,
  password_hash text not null,           -- scrypt$N$r$p$salt$hash
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index users_username on users (username);

create table sessions (
  id           uuid primary key default uuidv7(),
  user_id      uuid not null references users(id) on delete cascade,
  token_hash   text not null unique,     -- 令牌的 SHA-256，明文令牌只返回给客户端
  user_agent   text,
  expires_at   timestamptz not null,
  last_used_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index sessions_user on sessions (user_id);

create table user_settings (
  user_id               uuid primary key references users(id) on delete cascade,
  timezone              text not null default 'Asia/Shanghai',  -- IANA 时区
  default_reminder_time time not null default '09:00',
  week_starts_on        smallint not null default 1,            -- 1 = 周一
  updated_at            timestamptz not null default now()
);
```

`users` 是用户本身，主键 `id` 就是其他表里的 `user_id`；其余表都带 `user_id`。

- 应用里没有注册入口，账号用服务端脚本 `pnpm create-user <用户名> [显示名称]` 创建（见 D-024）。
- 修改密码后删除该用户的其他会话。
- 不收集邮箱或手机号，所以**忘记密码无法自助找回**。本地开发阶段用服务端脚本 `pnpm --filter @life-book/server reset-password <username>` 重置。

## 4. 记录（MVP）

```sql
create table categories (
  id         uuid primary key default uuidv7(),
  user_id    uuid not null references users(id) on delete cascade,
  name       text not null,
  color      text,                       -- 设计令牌名
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create unique index categories_user_name on categories (user_id, lower(name));

create table tags (                      -- 结构同 categories
  id uuid primary key default uuidv7(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null, color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create unique index tags_user_name on tags (user_id, lower(name));

create table records (
  id          uuid primary key default uuidv7(),
  user_id     uuid not null references users(id) on delete cascade,
  type        text not null check (type in
                ('recurring', 'important_date', 'memo', 'checklist', 'household_item')),
  title       text not null default '',
  notes       text,                      -- 说明；备忘的正文
  category_id uuid,
  is_pinned   boolean not null default false,
  archived_at timestamptz,
  deleted_at  timestamptz,               -- 非空表示在回收站
  version     integer not null default 1,  -- 乐观锁，每次修改 +1
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, user_id),
  -- 删除分类前由服务层先清空记录的 category_id（V1 的分类管理）；
  -- Drizzle 不支持只置空复合外键中的一列，所以这里不用 on delete set null。
  foreign key (category_id, user_id) references categories(id, user_id)
);
create index records_user_type on records (user_id, type) where deleted_at is null;
-- 列表按“置顶、修改时间、id”倒序，游标分页也用这三个字段。
create index records_user_list on records (user_id, is_pinned desc, updated_at desc, id desc);

create table record_tags (
  user_id    uuid not null references users(id) on delete cascade,
  record_id  uuid not null,
  tag_id     uuid not null,
  created_at timestamptz not null default now(),
  primary key (record_id, tag_id),
  foreign key (record_id, user_id) references records(id, user_id) on delete cascade,
  foreign key (tag_id, user_id) references tags(id, user_id) on delete cascade
);
```

### 4.1 重复日常

```sql
create table recurring_rules (
  record_id    uuid primary key,
  user_id      uuid not null references users(id) on delete cascade,
  start_date   date not null,            -- 规则从哪天开始生效，也是间隔计算的起点
  freq         text not null check (freq in ('daily', 'weekly', 'monthly', 'yearly')),
  interval     smallint not null default 1 check (interval >= 1),
  by_weekdays  smallint[],               -- weekly 时使用，1 = 周一 ... 7 = 周日
  by_month_day smallint check (by_month_day between 1 and 31),  -- monthly 时使用
  time_of_day  time,                     -- 为空表示全天
  end_type     text not null default 'never' check (end_type in ('never', 'until', 'count')),
  until_date   date,
  count        integer check (count >= 1),
  updated_at   timestamptz not null default now(),
  foreign key (record_id, user_id) references records(id, user_id) on delete cascade
);

create table occurrences (               -- 只保存已处理或改期过的周期实例
  id              uuid primary key default uuidv7(),
  user_id         uuid not null references users(id) on delete cascade,
  record_id       uuid not null,
  occurrence_date date not null,          -- 原定日期
  status          text not null check (status in ('pending', 'completed', 'skipped')),
  rescheduled_to  date,                   -- “仅本次改期”后的日期；pending 时必填
  handled_at      timestamptz not null default now(),
  note            text,
  created_at      timestamptz not null default now(),
  unique (record_id, occurrence_date),
  foreign key (record_id, user_id) references records(id, user_id) on delete cascade
);
```

规则：

- 待完成的实例不入库，由 `core` 根据规则实时展开；`occurrences` 里没有对应行就是“待完成”，计划时间已过即为“逾期”。
- “撤销完成或跳过”就是删除对应的 `occurrences` 行。
- 修改规则时把 `start_date` 设为新规则开始的日期（默认今天）。在此之前已完成或已跳过的行保留不变；在此之前未处理的实例不再显示为逾期。
- 逾期最多回看 30 天，同一事项的多次逾期在“今天”合并为一张卡片。
- “仅本次改期”（见 D-016）：在原定日期那一行写入 `pending` 和 `rescheduled_to`。“今天”、逾期和提醒都按实际日期（`rescheduled_to ?? occurrence_date`）计算；撤销完成或跳过时，改期过的回到 `pending`，否则删除这一行；取消改期时删除 `pending` 行或清空 `rescheduled_to`。改期最多前后 60 天。

### 4.2 重要日期

```sql
create table important_dates (
  record_id    uuid primary key,
  user_id      uuid not null references users(id) on delete cascade,
  kind         text not null check (kind in ('birthday', 'anniversary', 'expiry', 'other')),
  repeat       text not null check (repeat in ('once', 'yearly')),
  year         smallint,                 -- repeat = once 时必填
  month        smallint not null check (month between 1 and 12),
  day          smallint not null check (day between 1 and 31),
  start_year   smallint,                 -- 用于显示年龄或第 N 周年
  show_counter boolean not null default true,
  updated_at   timestamptz not null default now(),
  check ((repeat = 'once') = (year is not null)),
  foreign key (record_id, user_id) references records(id, user_id) on delete cascade
);
```

### 4.3 备忘

备忘没有独立表：标题存在 `records.title`，正文存在 `records.notes`，两者不能同时为空（在服务层校验）。提醒时间存在 `reminders`。

### 4.4 提醒

```sql
create table reminders (
  id          uuid primary key default uuidv7(),
  user_id     uuid not null references users(id) on delete cascade,
  record_id   uuid not null,
  kind        text not null check (kind in ('absolute', 'relative')),
  fire_at     timestamptz,               -- absolute：备忘、清单的具体时刻
  days_before smallint check (days_before >= 0),  -- relative：相对每次发生日提前几天
  time_of_day time,                      -- relative：几点提醒；为空时取规则时刻或默认提醒时间
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check ((kind = 'absolute') = (fire_at is not null)),
  foreign key (record_id, user_id) references records(id, user_id) on delete cascade
);
create index reminders_user on reminders (user_id) where enabled;
```

- `relative` 用于重复日常和重要日期：每次发生都会算出一个提醒时刻。
- 每个提醒时刻的唯一键为 `reminderKey = {reminder.id}:{发生日期 | once}`，手机端直接用它作通知 ID。
- 提醒的投递状态不入库：已完成的实例不再提醒，“稍后提醒”只在手机本地处理。

## 5. 清单与家庭物品（V1）

```sql
create table checklist_templates (
  id uuid primary key default uuidv7(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null, notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table checklist_template_items (
  id          uuid primary key default uuidv7(),
  user_id     uuid not null references users(id) on delete cascade,
  template_id uuid not null,
  group_name  text,                      -- 分组名；为空表示未分组
  title       text not null,
  quantity    numeric(12,3), unit text,
  sort_order  integer not null default 0,
  foreign key (template_id, user_id) references checklist_templates(id, user_id) on delete cascade
);

create table checklists (
  record_id          uuid primary key,
  user_id            uuid not null references users(id) on delete cascade,
  purpose            text not null default 'general' check (purpose in ('general', 'shopping')),
  source_template_id uuid,               -- 只作来源说明，不加外键，模板删除后保留
  due_at             timestamptz,
  foreign key (record_id, user_id) references records(id, user_id) on delete cascade
);

create table checklist_items (
  id                uuid primary key default uuidv7(),
  user_id           uuid not null references users(id) on delete cascade,
  record_id         uuid not null,
  group_name        text,
  title             text not null,
  notes             text,
  quantity          numeric(12,3), unit text,
  is_done           boolean not null default false,
  done_at           timestamptz,
  sort_order        integer not null default 0,
  household_item_id uuid references records(id) on delete set null,  -- 采购清单里关联的家庭物品，归属由服务层校验
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (record_id, user_id) references records(id, user_id) on delete cascade
);
-- 同一物品在同一清单里最多一条未完成的采购项
create unique index checklist_items_active_purchase
  on checklist_items (record_id, household_item_id)
  where household_item_id is not null and not is_done;

create table household_items (
  record_id             uuid primary key,
  user_id               uuid not null references users(id) on delete cascade,
  unit                  text not null,
  quantity              numeric(12,3) not null default 0 check (quantity >= 0),
  low_stock_threshold   numeric(12,3) check (low_stock_threshold >= 0),
  location              text,
  low_stock_since       timestamptz,     -- 当前这次低库存从何时开始；恢复后清空
  low_stock_notified_at timestamptz,     -- 这次低库存是否已提醒过
  foreign key (record_id, user_id) references records(id, user_id) on delete cascade
);

create table stock_transactions (        -- 只增不改
  id             uuid primary key default uuidv7(),
  user_id        uuid not null references users(id) on delete cascade,
  record_id      uuid not null,
  kind           text not null check (kind in
                   ('opening', 'purchase', 'consume', 'adjust', 'discard', 'lost')),
  delta          numeric(12,3) not null,
  quantity_after numeric(12,3) not null check (quantity_after >= 0),
  occurred_at    timestamptz not null default now(),
  note           text,
  corrects_id    uuid references stock_transactions(id),
  created_at     timestamptz not null default now(),
  foreign key (record_id, user_id) references records(id, user_id) on delete cascade
);
create index stock_transactions_item on stock_transactions (user_id, record_id, created_at);
```

库存规则：

- 写流水时，在同一个事务里对 `household_items` 加行锁（`select ... for update`），计算新数量，再写入流水和新数量。
- 买入、使用、报废、丢失按增减量提交；期初和调整按目标数量提交，由服务端计算增减量。
- 结果为负时拒绝。流水不能修改或删除，改错用 `adjust` 流水并填写 `corrects_id`。
- 数量从高于阈值降到 `<=` 阈值时写入 `low_stock_since`；恢复到阈值以上时清空 `low_stock_since` 和 `low_stock_notified_at`。

## 6. 搜索

MVP 直接对 `records.title`、`records.notes` 做 `ILIKE '%关键词%'`（V1 起再加上清单项目标题）。个人数据量小，足够使用。数据量变大后，再考虑 `pg_trgm`（注意它对中文的支持取决于数据库的 ctype 设置）或中文分词扩展。

## 7. 以后再设计

- **附件**：`attachments` 表加对象存储（S3 兼容）。
- **设备与推送**：`devices` 表保存推送令牌。
- **家庭共享**：新增 `spaces`、`space_members`，在需要共享的表上加 `space_id`。`user_id` 保持“创建者或归属者”的含义，查询条件从“`user_id` 等于我”扩展为“我所在的空间”。

## 8. 已实现的补充说明（V1）

- 清单项目的增删改只更新记录的 `updated_at`，不改 `version`（见 D-018）；“全部完成”只改状态不同的项目，已勾选的保留原来的 `done_at`。
- 新建家庭物品时写入一条 `opening` 流水；`low_stock_since` 在期初就低库存时也会写入。低库存提醒的去重见 D-017。
- 删除分类前先把记录的 `category_id` 置空；删除标签时 `record_tags` 级联删除。新分类的 `sort_order` 排在最后。
- 回收站超过 30 天的记录由服务端每天清理（见 D-019）。
- 删除账号时删除 `users` 一行，其余表全部按 `user_id` 级联删除。

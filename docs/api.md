# 接口约定

> 路由的请求和响应 schema 以 `packages/core` 中的 zod 定义为准；服务端用它校验请求，客户端通过 `@life-book/api-client` 调用并用同一份 schema 校验响应。本文只列约定和清单。

## 1. 通用约定

| 项       | 约定                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 前缀     | 所有接口都在 `/api/v1/*` 下。                                                                                                                                                        |
| 格式     | JSON，字段用 camelCase；日期 `YYYY-MM-DD`，时刻 `HH:mm`，时间点用 ISO 8601（带时区偏移）。                                                                                           |
| 认证     | Web 用 Cookie，手机用 `Authorization: Bearer <token>`。未登录返回 `401`。                                                                                                            |
| 用户隔离 | 用户由会话确定，请求里不传 `userId`；访问别人的数据一律返回 `404`。                                                                                                                  |
| 幂等     | 新建记录可以带客户端生成的 `id`，重复提交返回同一条记录。                                                                                                                            |
| 并发     | 修改记录时带上 `version`，与服务端不一致返回 `409`，客户端刷新后重试。                                                                                                               |
| 分页     | 游标分页：`?limit=50&cursor=...`，响应带 `nextCursor`（没有下一页时为 `null`）。                                                                                                     |
| 错误     | `{ "error": { "code": "VALIDATION_FAILED", "message": "…", "details": {…} } }`；`code` 为稳定的英文常量，`message` 用于展示。校验错误的 `details` 为 `{ formErrors, fieldErrors }`。 |

## 2. 接口清单

### 账号与设置（MVP）

| 方法     | 路径                           | 说明                                                                                          |
| -------- | ------------------------------ | --------------------------------------------------------------------------------------------- |
| `POST`   | `/api/v1/auth/register`        | 注册：`{ "username", "password", "displayName"? }`，成功后直接登录                            |
| `POST`   | `/api/v1/auth/login`           | 登录：`{ "username", "password" }`；返回用户信息，Web 同时设置 Cookie，手机取响应里的 `token` |
| `POST`   | `/api/v1/auth/logout`          | 退出：删除当前会话                                                                            |
| `POST`   | `/api/v1/auth/change-password` | 修改密码：`{ "currentPassword", "newPassword" }`，其他会话失效                                |
| `GET`    | `/api/v1/me`                   | 当前用户和设置                                                                                |
| `PATCH`  | `/api/v1/me/settings`          | 修改时区、默认提醒时间等                                                                      |
| `DELETE` | `/api/v1/me`                   | 删除账号及全部数据：`{ "password" }`，密码错误返回 `400 WRONG_PASSWORD`                       |
| `GET`    | `/api/v1/me/export`            | 导出全部数据（JSON 附件），包括已归档和回收站里的记录                                         |

### 今天与提醒（MVP）

| 方法  | 路径                                | 说明                                                                                |
| ----- | ----------------------------------- | ----------------------------------------------------------------------------------- |
| `GET` | `/api/v1/today?date=2026-10-19`     | 今天聚合；`date` 默认按用户时区取当天                                               |
| `GET` | `/api/v1/reminders/upcoming?days=7` | 未来提醒列表，供手机调度通知；`days` 为 1～30，默认 7。已完成或已跳过的实例不再提醒 |

### 记录（MVP）

| 方法     | 路径                                               | 说明                                                                                                                         |
| -------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/records`                                  | 列表：`type`、`categoryId`、`tagId`、`q`（搜索）、`status=active\|archived\|trash`、`sort`                                   |
| `POST`   | `/api/v1/records`                                  | 新建：按 `type` 区分请求体，见下例                                                                                           |
| `GET`    | `/api/v1/records/:id`                              | 详情：包含类型详情、标签、提醒；重复日常另有 `nextOccurrenceDate`（见下）                                                    |
| `PATCH`  | `/api/v1/records/:id`                              | 修改，需带 `version`；省略的字段不变，`reminders`、`tagIds` 和类型详情整体替换。改了重复方式时，新规则从今天开始（见 D-013） |
| `POST`   | `/api/v1/records/:id/archive` / `unarchive`        | 归档或取消归档                                                                                                               |
| `DELETE` | `/api/v1/records/:id`                              | 移入回收站                                                                                                                   |
| `POST`   | `/api/v1/records/:id/restore`                      | 从回收站恢复                                                                                                                 |
| `DELETE` | `/api/v1/records/:id/permanent`                    | 永久删除，只能删回收站中的记录                                                                                               |
| `POST`   | `/api/v1/records/batch`                            | 批量归档、删除、改分类或加标签（Web）                                                                                        |
| `GET`    | `/api/v1/records/:id/occurrences?from=&to=`        | 重复日常在某段时间内的实例及状态（`pending`、`overdue`、`completed`、`skipped`），一次最多 366 天                            |
| `PUT`    | `/api/v1/records/:id/occurrences/:date`            | 完成或跳过：`{ "status": "completed" }`；这一天不是规则的发生日时返回 `400`                                                  |
| `DELETE` | `/api/v1/records/:id/occurrences/:date`            | 撤销完成或跳过                                                                                                               |
| `PUT`    | `/api/v1/records/:id/occurrences/:date/reschedule` | 仅本次改期：`{ "to": "2026-10-24" }`，`:date` 是原定日期，最多前后 60 天（见 D-016）                                         |
| `DELETE` | `/api/v1/records/:id/occurrences/:date/reschedule` | 取消改期，回到原定日期                                                                                                       |

### 分类与标签

| 方法               | 路径                                         | 说明                                                        |
| ------------------ | -------------------------------------------- | ----------------------------------------------------------- |
| `GET` / `POST`     | `/api/v1/categories`、`/api/v1/tags`         | 新建：`{ "name" }`；重名时返回已有的那个（`200`），见 D-015 |
| `PATCH` / `DELETE` | `/api/v1/categories/:id`、`/api/v1/tags/:id` | V1                                                          |

### 错误码

| `code`                | 状态码 | 含义                                                  |
| --------------------- | ------ | ----------------------------------------------------- |
| `VALIDATION_FAILED`   | 400    | 参数不正确                                            |
| `UNAUTHENTICATED`     | 401    | 未登录或会话已失效                                    |
| `INVALID_CREDENTIALS` | 401    | 用户名或密码错误                                      |
| `WRONG_PASSWORD`      | 400    | 修改密码时当前密码错误                                |
| `NOT_FOUND`           | 404    | 不存在，或属于其他用户                                |
| `VERSION_CONFLICT`    | 409    | 记录已在别处修改；`details.currentVersion` 为最新版本 |
| `ID_CONFLICT`         | 409    | 客户端生成的记录 ID 已被其他用户使用                  |
| `USERNAME_TAKEN`      | 409    | 用户名已被注册                                        |
| `TOO_MANY_REQUESTS`   | 429    | 尝试次数过多                                          |
| `INTERNAL_ERROR`      | 500    | 服务器内部错误                                        |

### 清单、模板与库存（V1）

| 方法                                | 路径                                       | 说明                                                                                                                                              |
| ----------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST`                              | `/api/v1/records/:id/items`                | 添加清单项目：`{ "title", "groupName"?, "quantity"?, "unit"?, "notes"?, "isDone"? }`                                                              |
| `PATCH` / `DELETE`                  | `/api/v1/records/:id/items/:itemId`        | 修改（含勾选 `isDone`，只改提交的字段）或删除项目；不改记录的版本号（见 D-018）                                                                   |
| `POST`                              | `/api/v1/records/:id/items/complete-all`   | 全部完成，或用 `{ "done": false }` 全部取消；返回整条记录                                                                                         |
| `GET` / `POST` / `PATCH` / `DELETE` | `/api/v1/templates[/:id]`                  | 清单模板；`PATCH` 提交 `items` 时整体替换                                                                                                         |
| `POST`                              | `/api/v1/templates/:id/instantiate`        | 从模板创建清单：`{ "id"?, "title"?, "dueAt"? }`，`id` 用于幂等                                                                                    |
| `POST`                              | `/api/v1/records/:id/save-as-template`     | 把清单另存为模板（不带勾选状态）                                                                                                                  |
| `GET` / `POST`                      | `/api/v1/records/:id/stock-transactions`   | 库存流水，只能新增：买入、使用、报废、丢失按 `{ "kind", "amount" }`；调整按 `{ "kind": "adjust", "quantity", "correctsId"? }`；结果为负返回 `400` |
| `POST`                              | `/api/v1/records/:id/add-to-shopping-list` | 加入采购清单：`{ "checklistId"? }`，不指定时用最近的采购清单，没有就新建；已在清单里时 `created` 为 `false`                                       |
| `POST`                              | `/api/v1/records/:id/low-stock-notified`   | 手机排好低库存通知后调用：`{ "since" }`（见 D-017）                                                                                               |

新建记录时，`type` 还可以是 `checklist`（`checklist: { purpose, dueAt, items }`）和 `household_item`（`householdItem: { unit, quantity, lowStockThreshold, location }`，`quantity` 记为期初流水）。修改记录时可以带 `checklist: { purpose?, dueAt? }` 或 `householdItem: { unit?, lowStockThreshold?, location? }`。

## 3. 示例

新建一条每周一和周四提醒的重复日常：

```http
POST /api/v1/records
```

```json
{
  "id": "0199f3a2-8c1e-7b4a-9d2e-1f0a3b4c5d6e",
  "type": "recurring",
  "title": "给绿植浇水",
  "notes": null,
  "categoryId": null,
  "tagIds": [],
  "recurring": {
    "startDate": "2026-10-20",
    "freq": "weekly",
    "interval": 1,
    "byWeekdays": [1, 4],
    "timeOfDay": "09:00",
    "end": { "type": "never" }
  },
  "reminders": [{ "kind": "relative", "daysBefore": 0, "timeOfDay": "09:00" }]
}
```

所有返回记录的接口都带 `nextOccurrenceDate`：重复日常从今天（按用户时区）起下一次待完成的实际日期，已考虑改期，跳过已完成和已跳过的实例；规则已结束或不是重复日常时为 `null`。列表和详情里的“下次”都直接用它。

今天聚合的响应结构（逾期规则见 D-012；`today` 中全天的事项排在前面，其余按时刻）：

```json
{
  "date": "2026-10-19",
  "overdue": [
    {
      "kind": "occurrence",
      "recordId": "…",
      "title": "交物业费",
      "date": "2026-10-15",
      "originalDate": "2026-10-15",
      "time": null,
      "status": "overdue",
      "moreCount": 1
    }
  ],
  "today": [
    {
      "kind": "occurrence",
      "recordId": "…",
      "title": "给绿植浇水",
      "date": "2026-10-19",
      "originalDate": "2026-10-19",
      "time": "09:00",
      "status": "pending",
      "moreCount": 0
    },
    {
      "kind": "memo_reminder",
      "recordId": "…",
      "title": "带身份证去银行",
      "reminderId": "…",
      "fireAt": "2026-10-19T06:00:00.000Z",
      "time": "14:00"
    }
  ],
  "upcomingDates": [
    {
      "kind": "important_date",
      "recordId": "…",
      "title": "妈妈的生日",
      "dateKind": "birthday",
      "date": "2026-10-24",
      "daysUntil": 5,
      "counter": 60
    }
  ],
  "lowStock": [
    {
      "kind": "low_stock",
      "recordId": "…",
      "title": "抽纸",
      "quantity": 1,
      "unit": "包",
      "threshold": 1,
      "location": "储物间"
    }
  ]
}
```

`overdue` 和 `today` 里还会有 `kind: "checklist"` 的卡片（截止日期在今天或已过期、未完成的清单）；`lowStock` 列出低库存的家庭物品。周期实例卡片带 `originalDate`，改期后与 `date` 不同。

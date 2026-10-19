# 接口约定

> 路由的请求和响应 schema 以 `packages/core` 中的 zod 定义为准；客户端通过 `@life-book/api-client` 调用，类型直接来自服务端路由。本文只列约定和清单。

## 1. 通用约定

| 项       | 约定                                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 前缀     | 所有接口都在 `/api/v1/*` 下。                                                                                                 |
| 格式     | JSON，字段用 camelCase；日期 `YYYY-MM-DD`，时刻 `HH:mm`，时间点用 ISO 8601（带时区偏移）。                                    |
| 认证     | Web 用 Cookie，手机用 `Authorization: Bearer <token>`。未登录返回 `401`。                                                     |
| 用户隔离 | 用户由会话确定，请求里不传 `userId`；访问别人的数据一律返回 `404`。                                                           |
| 幂等     | 新建记录可以带客户端生成的 `id`，重复提交返回同一条记录。                                                                     |
| 并发     | 修改记录时带上 `version`，与服务端不一致返回 `409`，客户端刷新后重试。                                                        |
| 分页     | 游标分页：`?limit=50&cursor=...`，响应带 `nextCursor`（没有下一页时为 `null`）。                                              |
| 错误     | `{ "error": { "code": "VALIDATION_FAILED", "message": "…", "details": {…} } }`；`code` 为稳定的英文常量，`message` 用于展示。 |

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
| `DELETE` | `/api/v1/me`                   | 删除账号及全部数据                                                                            |

### 今天与提醒（MVP）

| 方法  | 路径                                | 说明                                  |
| ----- | ----------------------------------- | ------------------------------------- |
| `GET` | `/api/v1/today?date=2026-10-19`     | 今天聚合；`date` 默认按用户时区取当天 |
| `GET` | `/api/v1/reminders/upcoming?days=7` | 未来提醒列表，供手机调度通知          |

### 记录（MVP）

| 方法     | 路径                                        | 说明                                                                                       |
| -------- | ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET`    | `/api/v1/records`                           | 列表：`type`、`categoryId`、`tagId`、`q`（搜索）、`status=active\|archived\|trash`、`sort` |
| `POST`   | `/api/v1/records`                           | 新建：按 `type` 区分请求体，见下例                                                         |
| `GET`    | `/api/v1/records/:id`                       | 详情：包含类型详情、标签、提醒                                                             |
| `PATCH`  | `/api/v1/records/:id`                       | 修改，需带 `version`                                                                       |
| `POST`   | `/api/v1/records/:id/archive` / `unarchive` | 归档或取消归档                                                                             |
| `DELETE` | `/api/v1/records/:id`                       | 移入回收站                                                                                 |
| `POST`   | `/api/v1/records/:id/restore`               | 从回收站恢复                                                                               |
| `DELETE` | `/api/v1/records/:id/permanent`             | 永久删除，只能删回收站中的记录                                                             |
| `POST`   | `/api/v1/records/batch`                     | 批量归档、删除、改分类或加标签（Web）                                                      |
| `GET`    | `/api/v1/records/:id/occurrences?from=&to=` | 重复日常在某段时间内的实例及状态                                                           |
| `PUT`    | `/api/v1/records/:id/occurrences/:date`     | 完成或跳过：`{ "status": "completed" }`                                                    |
| `DELETE` | `/api/v1/records/:id/occurrences/:date`     | 撤销完成或跳过                                                                             |

### 分类与标签（MVP 只需要新建和选择；V1 补完整管理）

| 方法               | 路径                                         |
| ------------------ | -------------------------------------------- |
| `GET` / `POST`     | `/api/v1/categories`、`/api/v1/tags`         |
| `PATCH` / `DELETE` | `/api/v1/categories/:id`、`/api/v1/tags/:id` |

### 清单、模板与库存（V1）

| 方法                                | 路径                                       | 说明                                        |
| ----------------------------------- | ------------------------------------------ | ------------------------------------------- |
| `POST` / `PATCH` / `DELETE`         | `/api/v1/records/:id/items[/:itemId]`      | 清单项目                                    |
| `POST`                              | `/api/v1/records/:id/items/complete-all`   | 全部完成，或用 `{ "done": false }` 全部取消 |
| `GET` / `POST` / `PATCH` / `DELETE` | `/api/v1/templates[/:id]`                  | 清单模板                                    |
| `POST`                              | `/api/v1/templates/:id/instantiate`        | 从模板创建清单                              |
| `POST`                              | `/api/v1/records/:id/save-as-template`     | 把清单另存为模板                            |
| `GET` / `POST`                      | `/api/v1/records/:id/stock-transactions`   | 库存流水，只能新增                          |
| `POST`                              | `/api/v1/records/:id/add-to-shopping-list` | 把物品加入采购清单（去重）                  |
| `GET`                               | `/api/v1/export`                           | 导出全部数据（JSON）                        |

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

今天聚合的响应结构：

```json
{
  "date": "2026-10-19",
  "overdue": [
    {
      "kind": "occurrence",
      "recordId": "…",
      "title": "交物业费",
      "date": "2026-10-15",
      "moreCount": 1
    }
  ],
  "today": [
    {
      "kind": "occurrence",
      "recordId": "…",
      "title": "给绿植浇水",
      "date": "2026-10-19",
      "time": "09:00"
    },
    {
      "kind": "memo_reminder",
      "recordId": "…",
      "title": "带身份证去银行",
      "fireAt": "2026-10-19T14:00:00+08:00"
    }
  ],
  "upcomingDates": [
    {
      "kind": "important_date",
      "recordId": "…",
      "title": "妈妈的生日",
      "date": "2026-10-24",
      "daysUntil": 5,
      "counter": 60
    }
  ],
  "lowStock": []
}
```

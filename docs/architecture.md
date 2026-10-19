# 技术架构

## 1. 总览

```text
┌──────────────┐   ┌──────────────────────┐
│ Web (Vite +  │   │ 手机 (Expo, iOS +     │
│ React)       │   │ Android)              │
└──────┬───────┘   └──────────┬───────────┘
       │  HTTPS + JSON（共用 @life-book/api-client）
       └───────────┬──────────┘
                   ▼
        ┌─────────────────────┐
        │ 后台服务             │
        │ Node + Hono          │
        │ 用户名 + 密码认证     │
        │ Drizzle ORM          │
        └─────────┬───────────┘
                  ▼
        ┌─────────────────────┐
        │ PostgreSQL 18        │
        │ 每张业务表带 user_id  │
        └─────────────────────┘
```

- 数据只有一份，存在服务端，三端读写同一个 API。
- 业务规则写在共享包 `@life-book/core` 里，比如重复规则展开、清单完成判定、库存计算和“今天”的聚合。服务端用它做权威计算，客户端用它做即时预览，避免两边规则不一致。

## 2. 技术选型

| 部分       | 选择                                                                                | 说明                                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 语言       | TypeScript（strict）                                                                | 三端与服务端统一。                                                                                                          |
| 包管理     | pnpm workspace                                                                      | 单仓库、单 lockfile。                                                                                                       |
| 后台框架   | Hono + `@hono/node-server`                                                          | 轻量，原生支持 zod 校验，并能导出路由类型给客户端。                                                                         |
| 数据库     | PostgreSQL 18                                                                       | 18 版原生提供 `uuidv7()`。                                                                                                  |
| ORM 与迁移 | Drizzle ORM + drizzle-kit                                                           | 表结构用 TypeScript 定义，迁移生成 SQL 文件并入库。                                                                         |
| 认证       | 自己实现：用户名 + 密码                                                             | 密码用 Node 内置 scrypt 哈希；会话令牌随机生成，数据库只存其 SHA-256；Web 用 Cookie，手机用 Bearer 令牌（存 SecureStore）。 |
| 校验       | zod                                                                                 | 请求和响应的 schema 放在 `@life-book/core`，前后端共用。                                                                    |
| 日期时间   | date-fns + `@date-fns/tz`                                                           | 业务日期按用户时区计算。                                                                                                    |
| Web        | Vite + React 19 + TanStack Router + TanStack Query + Tailwind CSS                   | 纯前端 SPA，部署为静态文件。                                                                                                |
| 手机       | Expo SDK 57 + Expo Router + TanStack Query + expo-notifications + expo-secure-store | iOS 16+、Android 10+。                                                                                                      |
| 测试       | Vitest；服务端集成测试连真实 PostgreSQL                                             | 业务规则以 `core` 单测为主。                                                                                                |
| 本地开发   | Docker Compose 启动 PostgreSQL                                                      | `pnpm dev` 同时启动服务端和 Web。                                                                                           |

## 3. 仓库结构

```text
apps/
  server/          后台服务（Hono 路由、服务层、Drizzle schema 与迁移）
  web/             Web 端（Vite + React）
  mobile/          手机端（Expo）
packages/
  core/            领域类型、zod schema、纯业务规则（无 IO）
  api-client/      类型安全的 HTTP 客户端 + TanStack Query hooks（Web 与手机共用）
  design-tokens/   颜色、间距、字号等设计令牌（Web 与手机共用）
docs/              当前有效的文档
archive/           旧文档与合同，只读参考
```

依赖方向：`apps/*` → `api-client` → `core`；`core` 不依赖任何 app，也不做 IO。`server` 只依赖 `core`。

## 4. 认证与数据隔离

1. 用户用用户名和密码注册或登录后，服务端生成随机会话令牌，在 `sessions` 表里只保存令牌的 SHA-256。Web 收到 httpOnly Cookie；手机收到令牌后存进 SecureStore，之后每次请求放在 `Authorization: Bearer` 里。会话有效期 30 天，使用中自动续期。
2. 服务端中间件校验会话，把 `userId` 放进请求上下文。**`user_id` 只能来自会话，不能来自请求参数或请求体。**
3. 每个服务层函数都接收 `userId`，每条 SQL 都带 `where user_id = $userId`。读、改、删别人的数据一律按“不存在”返回 404。
4. 子表通过复合外键 `(record_id, user_id) → records(id, user_id)` 保证子行和父记录属于同一用户，数据库层面就无法串号。
5. 以后可加 PostgreSQL 行级安全（RLS）作为第二道防线，首期不做。

## 5. 在线优先与离线行为

- 数据以服务端为准。客户端用 TanStack Query 缓存查询结果；手机端把缓存持久化到本地，所以离线时还能看到最近的数据（只读）。
- 修改操作需要联网。离线时禁用保存按钮，并提示“网络恢复后再试”，首期不做离线队列。
- 新建记录时由客户端生成 UUID 作为 `id`。服务端遇到重复 `id` 直接返回已有结果，这样网络重试不会产生重复记录。

## 6. 提醒机制

```text
服务端                                   手机
──────                                   ────
reminders + 记录规则  ──GET /reminders/upcoming──▶  计算出的未来提醒（未来 7 天）
                                               │
                                               ▼
                                      取消本应用已排的通知
                                      按时间排序取前 60 条重新调度
                                      通知 ID = reminderKey（去重）
```

- 未来的提醒时刻由服务端用 `core` 的规则展开计算，客户端不保存提醒状态。
- 手机在这些时机重新调度：启动、回到前台、任何修改成功后，以及后台任务（expo-background-task，尽力而为）。iOS 最多保留 64 条待发通知，所以只排最近的 60 条。
- 通知上的动作（完成、稍后提醒）：“完成”调用 API；“稍后提醒”只在本机重排一条通知。
- 多台设备登录同一账号时，每台设备各自调度，都会收到提醒。
- Android 拿不到精确闹钟权限时，按近似时间提醒，并在设置里如实显示。
- 服务端推送（Expo Push）和 Web 通知放到 V2。

## 7. 时间规则

- 用户设置里保存 IANA 时区（默认 `Asia/Shanghai`）。
- 重复规则和重要日期保存**本地日期**和可选的**本地时刻**，展开发生日和提醒时刻时按用户时区换算。
- 绝对时间点（创建时间、备忘提醒时刻等）用 `timestamptz` 存储。
- 月末规则：每月 31 号在短月取当月最后一天；2 月 29 号的年度日期在平年取 2 月 28 号。

## 8. 部署（暂不考虑）

当前只做本地开发：PostgreSQL 用 Docker Compose 启动，服务端和 Web 在本机运行，手机连接本机局域网地址。下表是以后需要部署时的初步设想，届时再决定。

| 部分   | 方案                                                               |
| ------ | ------------------------------------------------------------------ |
| 服务端 | Docker 镜像，部署到一台云主机或容器平台；前面放 Caddy 处理 HTTPS。 |
| 数据库 | 云厂商托管 PostgreSQL，或同机 Docker 加每日 `pg_dump` 异地备份。   |
| Web    | 静态文件放 CDN 或对象存储，也可以由 Caddy 直接提供。               |
| 手机   | EAS Build 构建；iOS 走 TestFlight，Android 先分发 APK 内测。       |
| 监控   | 服务端结构化日志；客户端和服务端接入 Sentry 收集错误。             |

## 9. 安全基线

- 密码至少 8 位，用 scrypt 加随机盐哈希，比较时用 `timingSafeEqual`；登录失败统一提示“用户名或密码错误”。
- 登录和注册接口按 IP 和用户名限流。
- 部署时：全站 HTTPS；CORS 只允许自家 Web 域名。
- 密钥和数据库连接串只放环境变量，仓库只提交 `.env.example`。
- 日志不记录记录正文、密码或令牌。
- 删除账号时级联删除该用户的全部数据。

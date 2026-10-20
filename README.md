# 生活有谱

> 每件生活小事，都有着落。

生活有谱（项目代号：`life-book`）是一款面向个人与家庭的生活记录工具。它把重复日常、可复用清单、临时备忘、重要日期和家庭物品放在一个清楚、可靠的地方，帮助你少记在脑中，多安心生活。

## 它可以记录什么

- **重复日常**：安排每天、每周、每月或自定义周期需要完成的事情。
- **可复用清单**：为旅行、搬家、采购等场景准备模板，需要时直接复用。
- **备忘事项**：随手记下重要信息，在合适的时间再次看到。
- **日期提醒**：记录生日、纪念日和到期日，可在当天或提前若干天提醒。
- **家庭物品**：记录物品的购入、消耗和剩余数量，随时知道家中存量。

## 产品理念

- 温和，不用焦虑和压力催促用户。
- 清楚，让不同形式的生活记录容易理解和查找。
- 可靠，让该出现的信息在需要时出现。
- 贴近日常，从真实的小事出发，而不是堆叠效率概念。

## 多端

| 端                    | 技术                     | 目录          |
| --------------------- | ------------------------ | ------------- |
| 手机（iOS / Android） | Expo（React Native）     | `apps/mobile` |
| Web                   | React + Vite             | `apps/web`    |
| 后台服务              | Node + Hono + PostgreSQL | `apps/server` |

三端登录同一账号，共用一个后台服务和数据库。

## 项目状态

MVP 和 V1 功能已完成，Web 和 Android 真机已在本地跑通。下一步是阶段 4：把 Web 和 Android 打磨到可以每天使用；iOS 放到阶段 5。详见 [开发计划](docs/plan.md)。

## 文档

- [产品说明](docs/product.md)：定位、五类记录、规则和分期
- [技术架构](docs/architecture.md)：技术栈、仓库结构、认证、提醒机制
- [数据模型](docs/data-model.md)：表结构
- [接口约定](docs/api.md)：API 规范与清单
- [开发计划](docs/plan.md)：阶段、任务和未决问题
- [决策记录](docs/decisions.md)：重要决定及与旧文档的关系
- [归档资料](archive/README.md)：旧规划文档，只读参考

## 本地开发

需要 Node 24（见 `.node-version`）、Corepack 和 Docker：

```sh
corepack enable
pnpm install
pnpm db:up        # 启动 PostgreSQL 18（端口 5432）
pnpm db:migrate   # 建表
pnpm dev          # 服务端 http://localhost:8787，Web http://localhost:5180
```

手机端（需要先安装 Xcode 或 Android SDK 来构建开发包）：

```sh
pnpm --filter @life-book/mobile android   # 或 ios，首次会构建原生开发包
pnpm dev:mobile                           # 之后只需启动 Metro
```

手机默认访问运行 Metro 的电脑的局域网地址，请确保手机和电脑在同一网络；也可以设置 `LIFE_BOOK_API_URL` 指定服务端地址。

常用命令：

```sh
pnpm verify    # 格式、lint、类型检查和全部测试（服务端测试需要先 pnpm db:up）
pnpm --filter @life-book/server db:generate          # 修改表结构后生成迁移
pnpm --filter @life-book/server reset-password <用户名>   # 忘记密码时生成临时密码
```

## 品牌

- 对外名称：**生活有谱**
- 项目代号：`life-book`
- 品牌口号：**每件生活小事，都有着落。**

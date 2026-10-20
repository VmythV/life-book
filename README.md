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

## 日常使用

服务端和数据库跑在自己的 Mac 上，手机和其他电脑通过同一个 Wi-Fi 访问（见 [D-022](docs/decisions.md)）。

```sh
pnpm serve            # 启动数据库、构建 Web、迁移并启动服务端，一直开着
pnpm create-user <用户名> [显示名称]   # 新建账号，密码在终端里输入；应用里没有注册入口
```

启动后会打印局域网地址，如 `http://192.168.1.5:8787`：

- **Web**：在同一 Wi-Fi 下的任何浏览器打开这个地址。
- **Android**：`pnpm android:release` 打一个独立运行的安装包（默认连本机当前的局域网地址），再用 `adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk` 安装，或把这个文件传到手机上安装。电脑换了地址时，在登录页或“我的”底部修改服务器地址，不用重装。

注意：

- 电脑睡眠后手机就连不上了。`pnpm serve` 会阻止空闲睡眠，但合上笔记本盖子仍会睡眠；需要时在“系统设置 → 电池”里打开“接通电源时防止自动进入睡眠”。
- 第一次启动时 macOS 可能询问是否允许 `node` 接受传入连接，选“允许”。
- 出门在外连不上电脑时，手机显示上次同步的内容，已经排好的提醒照常响。
- `pnpm serve` 和 `pnpm dev` 都使用 8787 端口和同一个数据库，不要同时运行。
- 日常使用版（“生活有谱”）和开发版（“生活有谱开发版”）包名不同，可以同时装在手机上。

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
pnpm --filter @life-book/mobile android   # 构建并安装开发版（“生活有谱开发版”）
pnpm dev:mobile                           # 之后只需启动 Metro
```

手机默认访问运行 Metro 的电脑的局域网地址，请确保手机和电脑在同一网络；也可以设置 `LIFE_BOOK_API_URL` 指定服务端地址。

常用命令：

```sh
pnpm verify    # 格式、lint、类型检查和全部测试（服务端测试需要先 pnpm db:up）
pnpm --filter @life-book/server db:generate          # 修改表结构后生成迁移
pnpm create-user <用户名> [显示名称]                      # 新建账号（应用里没有注册入口）
pnpm --filter @life-book/server reset-password <用户名>   # 忘记密码时生成临时密码
```

## 品牌

- 对外名称：**生活有谱**
- 项目代号：`life-book`
- 品牌口号：**每件生活小事，都有着落。**

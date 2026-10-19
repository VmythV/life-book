# 生活有谱系统架构

> 项目代号：`life-book` · 版本：v1.1 · 更新日期：2026-07-27 · 状态：文档基线
>
> 权威范围：系统上下文、逻辑组件、模块职责与依赖、运行入口、状态权威、数据流、故障隔离、部署视图和阶段扩展缝
>
> 不负责：产品范围、领域字段、物理 DDL、HTTP 字段、加密参数、具体依赖版本、发布步骤或测试场景
>
> 依赖文档：[产品路线图](roadmap.md)、[领域模型](domain-model.md)、[数据生命周期](data-lifecycle.md)、[质量属性](quality-attributes.md)、[ADR 索引](adr/README.md)、[文档治理](documentation-governance.md)

本文把已经接受的技术决定组织成一套可实现的系统结构。页首“文档基线”只表示本文的架构边界可以作为实施依据，不会替尚缺的叙事规范、机器合同、oracle、实现 evidence 或发布 evidence 开门。

当前只允许开始第 13 节定义的**永久工程骨架**和 TD-001 要求的可丢弃能力验证。P0 正式持久化、通知、附件、备份，P0 在线能力以及 P1/P2 都必须分别满足第 12 节阶段门；本文中的后续组件是关闭状态下的目标边界，不是已获准部署的承诺。

## 1. 架构不变量

| 编号 | 不变量 |
| --- | --- |
| ARCH-001 | P0 手动核心是完整离线产品；服务器、账号、模型、遥测、远程配置和在线更新都不是启动或使用前提。 |
| ARCH-002 | 移动端采用模块化单体与 Ports and Adapters，依赖只向内；Domain 不依赖 UI、平台、存储或网络。 |
| ARCH-003 | 对已通过合同门的数据，加密 SQLite 与加密附件目录共同构成本机业务事实源；UI store、查询缓存、搜索、“今天”、缩略图、系统通知和网络响应均不是第二事实源。 |
| ARCH-004 | 业务写入必须经过显式 command 和一个 Unit of Work；不可撤回的外部副作用只在提交后由可重放任务执行。 |
| ARCH-005 | composition root 是生产 adapter 的唯一装配位置；未过阶段门的能力不得注册入口、route、adapter、worker 或数据解释器。 |
| ARCH-006 | 数据库、标量、安全记录、附件、时间数据、通知、备份、API、AI、同步、遥测和发布运行时分别版本化，App 版本不得代替它们。 |
| ARCH-007 | 可选在线能力的故障只能关闭相应局部能力，不得阻断本地记录、查找、提醒、备份或恢复。 |
| ARCH-008 | 本文只拥有组件、依赖、入口和数据流；字段、byte layout、协议算法与业务规则必须由其登记的唯一 owner 定义。 |
| ARCH-009 | 进入系统的时间、ID、随机、locale、time zone、平台状态和外部结果都通过显式输入或 port；确定性核心不得读取隐式全局状态。 |
| ARCH-010 | 关闭能力必须在装配层不可达，而不是只隐藏按钮；预留字段和未知版本不得被旧客户端近似解释。 |

## 2. 系统上下文与信任边界

```text
用户
 │
 ├── iOS / Android App
 │    ├── Presentation / Navigation
 │    ├── Application / Deterministic Domain
 │    ├── [过门后] SQLCipher + encrypted attachments
 │    ├── Keychain / Keystore / system authentication
 │    ├── OS notification service
 │    └── file picker / share target / local backup destination
 │
 ├── [P0 online，当前关闭] Regional Service Cell
 │    ├── TLS/L7 ingress
 │    ├── stateless API replicas
 │    ├── short-lived content-free admission state
 │    ├── regional telemetry collector
 │    └── approved model providers
 │
 ├── [P1，当前关闭] Account and Sync Platform
 │    ├── identity/session and sync APIs
 │    ├── relational business store and object storage
 │    ├── outbox/background workers
 │    └── email and push providers
 │
 └── [P2，当前关闭]
      ├── Web client
      ├── family authorization and audit
      ├── authorized AI context/patch
      └── public template/content governance
```

图中节点是逻辑责任边界，不等于微服务数量或云产品选择。P0 在线的精确拓扑仍受 TD-012～017 约束；P1/P2 的实际进程与部署拆分只能由 TD-018～027 决定。

任何数据流图和实现评审都必须显式标出下列边界：

1. App JS/原生进程与 App 私有容器；
2. 系统安全存储与生物识别/设备凭据；
3. OS 通知队列、系统分享和外部文件提供者；
4. 设备与公网、产品服务区域与第三方供应商；
5. P1 服务端租户/空间边界；
6. P2 浏览器的不可信运行环境。

## 3. 移动端容器和依赖方向

移动端遵循 [TD-002](adr/0002-offline-first-client-architecture.md) 的单向结构：

```text
Presentation / Navigation
          │ commands + queries
          ▼
Application / Use Cases
          │
          ▼
Deterministic Domain  ◄── Ports
                            ▲
                            │
              Repository / Platform / Network Adapters
```

| 层/边界 | 可以拥有 | 不得拥有 |
| --- | --- | --- |
| Presentation | 页面状态、表单 draft、导航、可访问语义、受控错误呈现。 | SQL、文件路径、HTTP、领域迁移、通知调度或密钥操作。 |
| Application | 用例编排、事务边界、幂等、权限前置、领域结果到持久任务的转换。 | 重写领域算法、依赖 React 组件、吞掉局部失败。 |
| Domain | 实体、值对象、不变量、状态迁移、确定性计算和领域错误。 | React Native、Expo、SQLite、网络、日志、系统时钟、环境变量或 SDK。 |
| Ports | Repository、UnitOfWork、Clock、ID、Crypto、File、Notification、Network 等窄契约。 | ORM 行、SDK 可变对象、原生异常或供应商响应对象。 |
| Adapters | 实际 I/O、资源释放、重试边界和受控错误映射。 | 绕过 application command 改变领域事实，或自行发明业务默认。 |

跨模块协作必须通过公开 application facade、command/query DTO 或登记的领域结果。模块不得导入另一模块的私有目录、adapter 或物理表。允许共享的基础包只包含受控标量、Schema 生成物、错误基类和无平台纯函数，不能演变成第二套 `common business rules`。

## 4. 逻辑模块

模块名和职责继承 TD-002；模块是代码与所有权边界，不是独立服务。

| 模块 | 唯一职责 | 首次激活阶段 |
| --- | --- | --- |
| `shell` | 启动、锁定、导航、当前安全空间和 composition root。 | 工程骨架 |
| `records` | Record 根、五类记录的通用生命周期和类型聚合入口。 | P0 本地 |
| `scheduling` | 时间、重复、Occurrence 与 DateOccurrence 的确定性生成。 | P0 本地 |
| `checklists` | 模板、实例、分组、项目和派生进度。 | P0 本地 |
| `inventory` | 库存意图、不可变流水、数量投影和低库存周期。 | P0 本地 |
| `organization` | 分类、标签、置顶、归档、关联和筛选规范。 | P0 本地 |
| `reminders` | ReminderPlan/Instance、通知动作、调度期望和对账。 | P0 本地 |
| `attachments` | 加密暂存、元数据、缩略图、引用和垃圾回收。 | P0 本地后续切片 |
| `projections` | 生活簿、今天、搜索和其他可重建读模型。 | P0 本地 |
| `portability` | 备份、恢复、导出与后续导入。 | P0 本地后续切片 |
| `ai-creation` | 临时创建会话、草稿校验和确认到普通 command 的转换。 | P0 在线过门后 |
| `identity-sync` | 账号、设备、SyncMutation、cursor、快照和冲突。 | P1 过门后 |
| `spaces-family` | 成员缓存、邀请和高风险空间操作入口。 | P2 过门后 |

不得为了“预留”创建可调用的 P1/P2 空入口或生产 adapter。纯类型扩展缝只有在当前代码确实消费且不会解释未来语义时才可加入；否则等对应阶段开门后再创建。

## 5. Composition roots 与运行入口

下表是逻辑入口，不强制成为同名类。每个入口必须从同一受控装配清单创建依赖，并且只获得完成自身职责所需的 capability。

| 逻辑入口 | 阶段 | 职责与限制 |
| --- | --- | --- |
| `MobileScaffoldRoot` | 工程骨架 | 装配安全静态壳、内存/空实现 port 和合成诊断页；不得打开正式数据库、发通知或联网。 |
| `MobileBootstrapRecoveryRoot` | P0 本地过门后 | 安全遮罩、presence/bootstrap/control 分类、解封密钥、initialize/migrate/restore 与 Repository 开放门。 |
| `MobileForegroundRoot` | P0 本地过门后 | 解锁后的页面、query、command 与前台对账。 |
| `MobileBackgroundMaintenanceRoot` | P0 本地过门后 | 以窄 capability 执行持久任务、投影重建、提醒对账和清理；不得弹权限或认证。 |
| `NotificationResponseRoot` | P0 本地过门后 | 有界解析系统输入，经过通知合同规定的 durable inbox/lease，再调用普通 command 或导航。 |
| `PortabilityOperationRoot` | P0 本地后续切片 | 在独占 DatasetGate 下执行备份、恢复和导出。 |
| `CapabilitySpikeRoot` | 工程骨架 | 位于不进入普通产品 artifact 的独立 build variant/target 或 spike App，只接合成数据验证原生能力；产物可删除且不得被产品入口依赖。 |
| `TestCompositionRoot` | 全阶段 | 注入固定 Clock/ID、内存 port、模拟平台状态和故障 adapter。 |
| `ServerApiRoot` | P0 在线过门后 | 无状态 HTTP、admission、AI route；当前不得部署生产 route。 |
| `ServerWorkerRoot` | P1 过门后 | outbox、对象任务、邮件和推送；P0 不部署。 |
| `MigrationAdminRoot` | P1 过门后 | 一次性服务端迁移；不得由普通 API replica 启动。 |
| `WebRoot` | P2 过门后 | 浏览器 UI 与 API client；不得复用移动端 SQLite 或安全存储假设。 |

生产 composition root 禁止使用字符串 service locator 或运行时“找一个实现”。同一构建配置下 port 到 adapter 的绑定必须可静态审查；功能关闭时绑定 `Disabled/Unavailable` application policy，且入口不可达，不能返回伪成功。

## 6. 状态权威与生命周期

| 状态 | 权威位置 | 说明 |
| --- | --- | --- |
| 记录、Occurrence、清单、库存、提醒实例 | 过门后的 active SQLCipher 规范表 | 跨进程业务事实；物理映射由 `persistence-schema.md` 与 `specs/persistence/` 唯一拥有。 |
| 附件正文 | 过门后的加密私有文件 | SQLite 只保存元数据和引用；两者的绑定协议由专项合同拥有。 |
| 安装 anchor 与 key envelope | 系统安全存储 | 语义来自 TD-004 及后续安全合同，不得复制到普通偏好或日志。 |
| 搜索、今天、数量预估、缩略图 | 本地可重建投影 | 可以删除并从事实重建；不能写回规范事实。 |
| 系统通知请求 | OS 外部投影 | 平台接受请求不证明准时展示、用户已读或业务状态已改变。 |
| 未提交表单与 AI 输入 | 当前会话内存 | 未经明确产品规则不进入业务库、日志、遥测或崩溃附件。 |
| 导航、展开、临时选择 | Presentation 状态 | 进程内或不含内容的安全偏好。 |
| P0 AI admission、quota、replay | 计划由尚未建立的 TD-014 决定 | 目标仅允许短期无内容状态，不是生活内容数据库或异步作业队列；TD-014 建立并接受前只可合成 spike。 |
| P1 待同步业务写 | SQLite `SyncMutation` | 与本地 command 同事务；通用 task 只负责唤醒/传输。 |
| P1 服务端账号、会话、membership、版本序列 | 服务端业务存储 | 精确 owner 等 TD-018～023；本表不冻结 Schema。 |
| P1 云附件字节 | 对象存储 | 授权、状态和元数据在服务端业务存储；具体协议待阶段门。 |
| 遥测 | 允许采集的观测记录 | 不得反向驱动业务事实；允许字段由 `analytics-and-telemetry.md` 唯一拥有。 |
| 远程配置 | 可选能力的收窄开关 | 只能关闭或缩小在线能力，不能下发领域算法、SQL migration 或扩大数据可见范围。 |

永久工程骨架中的内存数据全部是合成且可丢弃的测试状态，不是上表任何生产权威的临时替代，也不产生兼容承诺。

## 7. 关键运行数据流

### 7.1 本地 command 与副作用

```text
UI draft
→ Application command
→ 读取聚合并检查 revision/precondition
→ Domain 验证并产生确定性结果
→ 单一 Unit of Work
   ├── 业务事实 / 必要历史
   ├── projection invalidation
   └── durable side-effect task
→ commit
→ 返回 committed + sideEffectsPending + warnings
→ 幂等 task runner 执行并对账
```

事务内不得调用网络、模型、系统通知、相册、分享、长时文件操作或等待用户输入。事务前失败不产生外部动作；提交后外部动作失败不回滚已向用户确认的事实，而是进入可理解、可重放的局部状态。

### 7.2 查询与投影

详情从规范事实构建只读 DTO；列表、今天与搜索可以读取带来源版本的投影。投影落后或重建时返回显式 `stale/rebuilding` 状态，不把旧投影写回领域表。查询必须携带空间、生命周期和隐私上下文；敏感裁剪在查询边界完成。

### 7.3 正式数据集启动

以下流程只在安全、持久化与迁移合同过门后激活：

```text
安全遮罩
→ 验证 installation presence/bootstrap
→ 选择并验证 DatasetControl
→ 解封 data key
→ 完成未决 initialize / migrate / restore
→ 验证 receipt 与 active anchor
→ 开放 Repository
→ 应用锁门
→ 首屏
→ 异步投影、提醒、附件和同步对账
```

未知 Schema、错误密钥、损坏或证据冲突进入完整性阻断；不得创建空库覆盖。工程骨架不得用一个简化数据库启动流程冒充该协议。

### 7.4 附件

正式附件流程是“选择外部文件 → 加密暂存 → 校验 → 事务绑定元数据 → 原子提升 → 可重放清理/缩略图”。外部 provider URI、明文临时文件和加密文件路径都不能进入 Presentation 或日志。合同未过门时只允许独立能力 spike，不能把文件留作用户记录附件。

### 7.5 提醒

领域事务保存 ReminderPlan/Instance 和调度期望，提交后任务 runner 调用平台 adapter；前台、后台、权限/时间变化、升级和通知响应触发对账。OS 队列只是投影。通知合同未过门时 App 产品入口不得调度真实产品提醒。

### 7.6 备份与恢复

备份从受控数据集快照流式生成版本化加密容器；恢复在隔离候选中完成认证、解密、Schema/附件/规则校验后原子激活。任何失败保持原数据集不变。工程骨架与 capability spike 不生成看似正式的备份扩展名或版本。

### 7.7 P0 在线智能

```text
本地临时输入
→ HTTPS AI Gateway
→ anonymous admission / quota / one logical execution
→ approved route + ProviderAdapter
→ Schema 与领域边界校验
→ DraftEnvelope
→ 本地确认页
→ 用户确认
→ 普通本地 command
```

网关不访问生活数据库；模型响应不能直接写记录或触发通知。TD-012、TD-013 当前均为 `Proposed`，TD-014～017 尚未建立，因此现阶段只允许 fake provider、合成 payload、无外网或隔离的可丢弃 spike，不允许真实内容和生产 route。

### 7.8 P1 同步与 P2 家庭

P1 目标流为：本地 command 与 `SyncMutation` 同事务提交，异步 push；服务端逐操作授权并产生版本/序列；客户端完整应用一个 pull page 后才推进 cursor。本地 SQLite 在登录后仍是可写副本。P2 的 membership 是服务端授权权威，每个家庭请求重新授权，家庭复用通用同步而不另建第二协议。两者在 OQ-006 及对应 ADR/合同过门前不得冻结实现。

## 8. 故障隔离与降级

| 故障 | 必须行为 | 不得行为 |
| --- | --- | --- |
| 搜索/今天投影损坏 | 标记不可用或 stale，从规范事实重建。 | 清空规范事实或把投影覆盖回去。 |
| 通知权限/OEM/平台失败 | 记录仍保存，显示 degraded/pending，获得运行机会时对账。 | 回滚记录或声称必达。 |
| 附件处理失败 | 保留可恢复暂存/明确取消，清理任务可重放。 | 产生半引用或静默丢文件。 |
| 网络、网关或 Provider 失败 | 保留当前输入并提供手动入口。 | 阻断本地 App 或迟到响应覆盖已取消 draft。 |
| 遥测 collector 失败 | 有界丢弃诊断数据，业务继续。 | 阻塞命令或无限落盘。 |
| 登录过期/同步停机 | 停止对应同步，P0 本地个人数据继续读写。 | 锁住本地数据或自动上传未授权内容。 |
| 单实体同步/附件冲突 | 隔离目标并继续其他队列项。 | 阻塞整个空间且无诊断。 |
| 磁盘不足 | 停止相关写并保留既有数据。 | 自动删除用户事实或覆盖原备份。 |
| DB/key/control 完整性失败 | 停止破坏性写，保留 artifacts，进入恢复路径。 | 降级为 fresh install。 |
| P2 权限撤销 | 服务端立即拒绝，客户端清理不可见缓存。 | 把旧写入转投个人/其他空间。 |

## 9. 阶段部署视图

### 9.1 永久工程骨架

仓库包含一个可重建的 Expo Development Build/CNG 移动工程、纯 TypeScript 核心边界、测试 composition root 和不产生用户数据的安全 App 壳。默认构建不注册数据库、通知、网络、遥测、更新或后续阶段 adapter。能力 spike 使用独立入口、合成数据和可删除 artifacts。

### 9.2 P0 本地目标

一个移动二进制、一个 App 私有加密数据集和平台 adapter 集合。手动记录、搜索、提醒、备份和恢复不依赖网络。该目标只有在当前切片的叙事规范、机器合同、oracle 和实现门分别通过后才能逐项激活。

### 9.3 P0 在线目标

仅在 TD-012～017、OpenAPI、安全、遥测与运行门通过后增加一个区域 service cell：

```text
Ingress → stateless API replicas → Provider adapters
                  ├→ short-lived admission KV
                  └→ regional telemetry collector
```

P0 不建立账号、生活内容服务端数据库、异步 AI job 或跨区域复制。具体云、区域和副本数由后续 ADR/运营规范决定；本图不把拟议方案提升为已接受选择。

### 9.4 P1/P2 目标

P1 可以在区域边界内增加身份、同步、关系数据库、对象存储、outbox/worker、邮件和推送；物理拆分由 TD-018～023 决定。P2 可以增加 Web、家庭授权/审计、受控 AI 上下文和公共模板治理；由 TD-024～027 决定。未过门时这些进程、数据 owner 和 route 均不存在于生产装配。

## 10. 版本与扩展缝

下列身份独立演进，不能合并成含糊的“v1”：

- active database、portable data、migration 与 SQLCipher profile；
- installation anchor、key envelope 与 attachment private format；
- scalar encoding、tzdb manifest 与 recurrence algorithm；
- notification request、payload、action、category、dedup 与 initialization；
- backup container、header、suite、passphrase 与 KDF profile；
- API major/OpenAPI revision、AI contract、provider route/prompt/adapter/validation；
- sync protocol、snapshot generation、telemetry event；
- App version、native build 与 runtime/update identity。

可替换边界至少包括 `Repository`、`UnitOfWork`、`Clock`、`IdGenerator`、`TimeZoneSource`、`KeyManager`、`Crypto`、`FileStore`、`NotificationScheduler`、`AiGatewayPort`、`TelemetryPort`，以及后续的 `AuthPort`、`SyncTransport`、`ObjectTransfer` 和 ProviderAdapter。只有存在真实替换、平台或测试边界时才建立 port，不为每个类机械创建接口。

新增模块或外部系统必须同时回答：状态 owner 是谁、信任边界在哪里、谁创建 adapter、失败如何隔离、版本如何选择、关闭时如何不可达、由哪个规范/合同/测试证明。无法回答时不得接入 production composition root。

## 11. 权威 owner 映射

| 问题 | 唯一 owner |
| --- | --- |
| 阶段、排除项和发布结果门 | [产品路线图](roadmap.md) |
| 逻辑实体、字段和不变量 | [领域模型](domain-model.md) |
| 非时间业务行为 | `business-rules.md` |
| 时间、提醒、搜索行为 | 对应专项规范 |
| 备份/恢复/删除的产品语义 | [数据生命周期](data-lifecycle.md) |
| 技术选择和接受门 | [ADR 索引](adr/README.md)及对应 ADR |
| 物理 DDL、profile 和 mapper | `persistence-schema.md` 与 `specs/persistence/` |
| HTTP 字段、status 和公共 Schema | `specs/api/openapi.yaml` |
| 服务端运行行为 | `service-contracts.md` |
| 威胁、分级、密钥、日志和隐私控制 | `security-and-privacy.md` |
| 遥测事件与允许属性 | `analytics-and-telemetry.md` |
| 实际第三方 route 的地区、处理条件与启用资格 | `third-party-services.md` |
| 仓库、代码和依赖规则 | `engineering-standards.md` |
| 里程碑和切片顺序 | `implementation-plan.md` |
| 测试层级、矩阵和证据门 | `test-strategy.md` |
| 组件、依赖、运行入口、状态权威和数据流 | 本文件 |

缺失路径使用代码样式而非链接，表示它们是已登记的后继 owner，并不表示文件或 Gate 已存在。

## 12. 阶段激活矩阵

| 范围 | 可以开始的必要条件 | 当前结论 |
| --- | --- | --- |
| 永久工程骨架 | TD-001/002 `Accepted`；本文、`engineering-standards.md`、`implementation-plan.md`、`test-strategy.md` 为合法基线；最新治理快照确认该 scope。 | 文档列车完成并刷新治理快照后可开始。 |
| TD-001 能力 spike | 永久骨架可构建；只用合成数据；独立入口和删除策略；按 TD-001 Verification 留证。 | 可随骨架执行，不是正式 adapter/发布 evidence。 |
| 首个 P0 持久化纵向切片 | 治理规范“可以开始 P0 本地功能开发”全部满足；首个切片固定为“创建一条带提醒的重复事项”。 | `persistence-schema.md`、`security-and-privacy.md`、`acceptance-spec.md` 及 scalar/security/persistence/time/notification 等合同/oracle 缺失，当前阻塞。 |
| P0 附件/备份/恢复 | 上一门及 attachment、portable/backup 合同、oracle 和专项验收分别通过。 | 当前阻塞。 |
| P0 在线智能 | TD-012～017 `Accepted`，服务/API/安全/遥测/运营/第三方合同与 oracle 过门。 | TD-012/013 仍 `Proposed`，其余缺失；只允许合成 spike。 |
| P1 账号与同步 | OQ-006 关闭，TD-018～023 与同步/云合同过门。 | 当前关闭，不反向阻塞 P0。 |
| P1 农历 | PD-018、TD-028、转换合同和跨实现 oracle 过门。 | 当前关闭，不反向阻塞其他 P1 切片。 |
| P2 家庭/Web/成熟 AI | P1 相应基础稳定，TD-024～027 与授权/API/内容合同过门。 | 当前关闭。 |

OQ-001/002/009 不阻止本地骨架和合成 spike，但分别阻止生产区域/真实在线内容、正式运营主体相关流程和公开品牌投放；OQ-008 只阻止日历承诺。

## 13. 永久工程骨架允许范围

为消除“只能做可删除 spike”与“可以建立长期工程”的歧义，当前第一批代码只允许以下永久产物：

- 根 workspace、移动 App、TypeScript/格式化/静态检查/测试配置和锁文件；
- TD-002 的层与模块边界、public API 约束、composition root 协议和静态依赖测试；
- 安全静态 App 壳、导航容器和不会显示虚假保存成功的 disabled capability 状态；
- 固定 Clock/ID、内存 repository、noop/disabled port、故障 adapter 和合成 test fixture；
- 不做持久化/序列化的纯领域值与确定性函数，前提是能追溯到现有领域规则；
- CNG/config plugin 的可重放基础、Development Build 与本地 release build；
- CI 中的 lockfile、typecheck、lint、unit、架构边界、秘密扫描和干净生成检查；
- 独立 `CapabilitySpikeRoot` 中使用合成数据的 TD-001 能力验证代码和证据。

当前明确禁止：创建正式 SQLite/SQLCipher Schema 或 bootstrap 记录、写入真实用户数据、定义临时持久化/通知/备份版本、从产品入口调度通知、保存正式附件、调用真实模型/API、接入遥测出口、创建账号/同步/家庭/Web 入口、配置生产签名/OTA/商店标识。能力 spike 的代码不得被正式 App 路由或 production composition root 依赖。

上述边界允许团队先建立不会被后续合同推翻的工程结构，同时保证第一条真实数据仍从完整安全与兼容协议开始。

## 14. 架构符合性检查

永久骨架完成后，CI 至少必须证明：

1. Presentation 不能导入 adapter，Domain 不能导入平台包，模块不能访问另一模块私有目录；
2. production/scaffold composition root 的依赖清单中不存在未过门 adapter、route、worker 或遥测 exporter；
3. 纯 Domain 测试可在无 React Native、SQLite、网络和系统全局时间的进程中运行；
4. 所有外部输入在边界校验，adapter 异常不会穿透为页面或领域错误；
5. iOS/Android 工程可从 CNG 权威输入干净重建，不依赖生成目录的手工修改；
6. unit/architecture 测试不联网、不读取开发机秘密、不使用真实生活内容；
7. capability spike 与正式 App 入口有自动化依赖隔离，删除 spike 不影响普通构建；
8. 首个正式切片在开门后按 TD-002 覆盖事务前后 kill、任务恢复、通知拒绝、幂等与搜索重建；
9. 新增状态 owner、外部系统、运行入口或跨模块依赖时同步更新本文并评估是否需要 ADR。

具体测试层次与 evidence 归 `test-strategy.md`，物理目录、命名、命令和 CI 脚本归 `engineering-standards.md`；本节只定义架构必须被证明的结果。

## 15. 变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| v1.1 | 2026-07-27 | 修正 TD-014 的缺失状态，登记第三方服务 owner，并把 capability spike 固定到独立构建入口。 |
| v1.0 | 2026-07-27 | 建立全阶段上下文、移动模块与入口、状态权威、数据流、故障隔离和阶段门；定义不产生长期数据的永久工程骨架边界。 |

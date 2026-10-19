# 生活有谱实施计划

> 项目代号：`life-book` · 版本：v1.1 · 更新日期：2026-07-27 · 状态：文档基线
>
> 权威范围：无日期里程碑、依赖关系、纵向切片顺序、工作包、角色 owner、进入/退出条件和完成定义
>
> 不负责：需求正文、业务算法、技术选择、物理合同、逐场景验收步骤、人员排班或日历承诺
>
> 依赖文档：[产品路线图](roadmap.md)、[系统架构](system-architecture.md)、[工程规范](engineering-standards.md)、[测试策略](test-strategy.md)、[未决事项](open-questions.md)、[文档治理](documentation-governance.md)

本计划把完整产品拆成可逐门交付的实施顺序。OQ-008 尚未提供团队人数与容量，因此只承诺依赖顺序，不虚构开始日、截止日或工期；完成第一个正式纵向切片后，再用实际吞吐量形成带日期的候选计划。

当前执行起点是 M0“永久工程骨架”。它是可长期保留的产品工程，不是一次性 demo；但不产生用户数据、不激活正式平台 adapter，也不代表 P0 本地功能开发门已经通过。所有后继里程碑均继承路线图、ADR、合同、oracle、implementation 和 release Gate。

## 1. 计划不变量

| 编号 | 不变量 |
| --- | --- |
| IMP-001 | 先满足当前切片的决定、叙事、合同与 oracle 门，再创建会产生长期兼容负担的实现。 |
| IMP-002 | 产品能力按端到端纵向切片交付；每个切片包含领域、应用、adapter、UI、失败恢复、测试和文档影响。 |
| IMP-003 | 永久骨架只建立稳定边界和工具；capability spike 明确可删除，不能被产品入口或正式 adapter 依赖。 |
| IMP-004 | P0 本地手动闭环不依赖账号、服务端、模型、遥测、远程配置或在线构建服务。 |
| IMP-005 | 第一条真实数据即遵守正式安全、持久化、迁移、时间和通知协议，不建立明文或临时 Schema 过渡版。 |
| IMP-006 | 每个状态、规则、字段、bytes、命令和测试预期只有一个 owner；派生代码不反向修改 owner 语义。 |
| IMP-007 | P0 在线、P1 和 P2 通过 composition root 与阶段 Gate 隔离；后续能力不能扩大当前数据可见范围。 |
| IMP-008 | 保存成功与外部副作用完成分开交付和验收；失败注入是切片 DoD，不是发布前补测。 |
| IMP-009 | 文档 change train 遵守一文件一提交；只有全部 owner 更新、审计和新治理快照后才宣称 Gate 变化。 |
| IMP-010 | 没有实现/发布 evidence 时如实记为待产生；不以文档、ADR、mock、CI 配置存在或人工口头确认替代。 |
| IMP-011 | 未决事项用已登记安全默认继续或隔离；会改变当前范围/信任边界且无安全默认时才暂停请求决定。 |
| IMP-012 | 里程碑完成以可验证结果定义，不以代码量、页面数量、分支合并或“开发完成”口头状态定义。 |

## 2. 里程碑总览

```text
治理确认
   │
   ▼
M0 永久工程骨架 ───────────────┐
   │                           ├── TD-001 capability spike
   │                           │
   └──────────┬────────────────┘
              │
              ▼
M1 正式本地合同与验收基础
              │
              ▼
M2 首个纵向切片：带提醒的重复事项
              │
              ▼
M3 五类记录、整理、搜索与今天
              │
              ▼
M4 附件、数据生命周期、备份与恢复
              │
              ▼
M5 P0 本地闭环硬化
              │
          ┌───┴─────────────────────┐
          ▼                         ▼
M6 P0 在线智能（独立开门）   本地闭环继续离线可用
          │
          ▼
M7 P0 候选、内测与公开发布门
          │
          ▼
P1 独立切片 → P2 独立切片
```

M0 代码与 M1 文档/合同设计可以由不同 owner 并行，但 M2 必须同时继承两者的通过结果。M4 的附件/备份合同准备可与 M3 并行；产品附件实现必须等 IMP-302 备忘和 IMP-304 家庭物品切片存在，M5 同时继承 M3、M4 的完成结果。M6 不能阻塞 M2～M5 的本地实现；P0 正式范围仍以路线图为准，只有 M6 关闭或通过策略获得新的产品决定时，才能改变 P0 发布承诺。

## 3. 角色与责任

| 角色 | 主要责任 |
| --- | --- |
| 产品负责人 | 阶段、需求取舍、未决项关闭和验收结果。 |
| 架构负责人 | ADR、系统边界、跨模块依赖和阶段隔离。 |
| 客户端负责人 | Expo/RN 工程、application/domain、UI 与 composition root。 |
| 平台负责人 | iOS/Android 原生模块、CNG、通知、密钥、文件和真机能力。 |
| 数据/安全负责人 | SQLCipher、Schema/migration、密钥、附件、备份、威胁模型和合同。 |
| 服务端负责人 | 过门后的 API、admission、AI gateway；P1 再扩展账号/同步。 |
| 设计/内容负责人 | 页面、交互、文案、无障碍和品牌一致性。 |
| 测试负责人 | acceptance trace、oracle、矩阵、故障注入、真机和 evidence 完整性。 |
| 发布/运营负责人 | TD-017、环境、签名、分发、监控、回滚、支持和事件响应。 |

角色表示责任，不假设团队人数；一人可以承担多角色，但高风险安全/合同/发布变更需要独立复核。每个工作项必须有一个 accountable owner，不能只写“团队”。

## 4. Backlog 准入和完成规则

### 4.1 普通产品切片 Definition of Ready

进入实现前必须有：

1. 明确的阶段和 `PR-*`/`QR-*` 范围，排除项也已写出；
2. 适用 `PD-*`、`OQ-*`、ADR 状态及安全默认；
3. 权威领域/专项规则编号和页面/流程入口；
4. 所有实际读写边界的 `Normative + ACTIVE` 合同、paired contract 与 oracle PASS；
5. `ACPT-*` 成功、取消、拒绝、失败、重试和恢复场景；
6. 数据分级、日志 allowlist、权限和删除/迁移影响；
7. adapter、composition root、feature gate、disable/rollback 路径；
8. 受影响平台、设备、历史版本与测试矩阵；
9. 单一 owner、依赖和无日期的退出条件。

缺一项则工作项保持 `BLOCKED`，只能做不会进入兼容承诺的 spike。M0 是特殊的工程切片，其准入按第 5.1 节，不要求尚未产生的产品合同。

### 4.2 Definition of Done

每个切片至少满足：

- 正向和负向业务场景通过，UI 不绕过 application command；
- 事务、幂等、取消、deadline、重启和适用 kill points 通过；
- fake 与 production adapter 运行同一 contract suite；
- 无障碍、内容、离线、性能、安全和隐私的适用 QR 通过；
- feature 关闭时 route/adapter/数据解释器不可达，本地其余能力继续可用；
- 文档、合同、生成物、migration 和测试在同一 change train 完整更新；
- 没有 S0/S1，S2 有明确 owner、隔离和退出条件；
- CI evidence 绑定当前 Git/合同/oracle；需要发布时另有候选构建 evidence；
- 回滚不会让旧 binary 误读已提交的新 Schema/格式。

完成一个页面或 happy path 不等于完成纵向切片。

## 5. M0：永久工程骨架

### 5.1 进入条件

M0 只需满足：

- TD-001、TD-002 为 `Accepted`；
- [系统架构](system-architecture.md)、[工程规范](engineering-standards.md)、[测试策略](test-strategy.md)和本文为合法“文档基线”；
- 最新治理快照明确给出“永久工程骨架”scope PASS；
- OQ-003 已按 TD-001 关闭，OQ-008 只阻塞日期；
- 工作树干净且没有生产 secret/真实内容。

它不要求 persistence/API/notification/backup 合同或实现 evidence，因为 M0 不产生需要长期兼容的生产格式、真实用户数据或真实外部服务流量；独立 spike 可以产生可删除的合成库、文件和本地平台请求。

### 5.2 第一批可执行工作包

| 编号 | 工作包 | 产物 | 验收 |
| --- | --- | --- | --- |
| IMP-100 | 根 workspace 与工具链 | private pnpm workspace、Corepack、精确 Node/pnpm、单 lockfile、基础版本文件。 | frozen install 在干净 checkout 可重复，版本不漂移。 |
| IMP-101 | Expo 移动工程 | 当前稳定兼容 Expo/RN/React、TypeScript、New Architecture、Hermes、Development Build/CNG。 | iOS/Android 启动，clean CNG 和 local release configuration build。 |
| IMP-102 | 物理边界 | `shell`、当前所需 module 目录、`@life-book/scalar`/`time`/`ui`/`test-support` 初始包和 public entry。 | architecture checker 能拒绝五类故意违规 import。 |
| IMP-103 | Scaffold composition root | static shell、typed config、fixed/in-memory/noop/disabled ports。 | 无 DB/通知/网络/遥测仍能构造；关闭能力不显示伪成功。 |
| IMP-104 | 工程门 | format、lint、strict typecheck、unit、architecture、docs/deps/secret/generate checks。 | 根 `pnpm verify` 与生成后 clean 检查通过。 |
| IMP-105 | CI 基础 | frozen install、缓存边界、required checks、双平台条件构建。 | CI 只调用根 scripts；失败不能被空 no-op 标绿。 |
| IMP-106 | 合成测试支撑 | fixed Clock/ID/Random、fake/fault adapters、privacy canary。 | production graph 不能 import test-support，测试默认无外网。 |
| IMP-107 | TD-001 capability spike | 不进入普通产品 artifact 的独立 build variant/target 或 spike App，覆盖加密库/文件、通知、密钥、文件分享、生命周期、a11y、诊断。 | 按测试策略第 5 节留证；可整体删除且不影响普通构建。 |

建议执行顺序为 IMP-100 → 101 → 102/103 → 104/105/106；IMP-107 在基础 build 可运行后并行展开。每个工作包可以拆成小 PR，但拆分不能留下主分支不可安装、不可验证或默认接通未过门能力。

### 5.3 明确禁止

M0 不创建：正式 SQLCipher/SQLite Schema、installation anchor/key envelope、用户记录、产品通知 ID/category、正式附件/备份格式、真实 API/provider 调用、遥测 exporter、账号/同步/家庭/Web route、生产签名、OTA channel、商店 ID 或真实服务端 workspace。

纯 Domain 代码只有在不序列化、不打开产品入口、直接追溯现有规则并使用合成输入时可以保留。临时 SQL/JSON/notification payload 不得因“稍后再迁移”进入主分支。

### 5.4 退出条件

M0 达到工程规范第 15 节和测试策略第 4 节全部结果，并完成 TD-001 所有关键能力的可维护性判断。M0 完成只表示仓库可持续开发；不把 `evidence/spike` 结果记为 P0 本地功能 conformance。

## 6. M1：正式本地合同与验收基础

### 6.1 目标

在不写第一条真实数据前，建立 M2 所需的唯一物理语义、独立 oracle 和可执行验收。该里程碑以文档/合同/test tooling 为主，可以与 M0 后半段并行。

### 6.2 叙事与状态工作包

| 编号 | 工作包 | 最低结果 |
| --- | --- | --- |
| IMP-110 | 安全与隐私基线 | `security-and-privacy.md`：威胁模型、数据分级、密钥/日志/权限/失败控制。 |
| IMP-111 | 持久化映射基线 | `persistence-schema.md`：domain→active/portable、profile、meta、mapper、索引和 migration。 |
| IMP-112 | 验收基线 | `acceptance-spec.md`：M2 `ACPT-*` 场景与 PR/QR/rule/contract trace。 |
| IMP-113 | 依赖状态归一 | M2 实际使用的业务规则、搜索、页面、流程、内容、设计和无障碍文档使用合法基线状态并完成内容复核。 |
| IMP-114 | 治理更新 | 每个合同/owner 登记准确，snapshot 在 change train 尾部重审。 |

### 6.3 机器合同与 oracle 工作包

M2 至少需要下列成套结果，精确路径与身份以治理 registry 为准：

| 编号 | 合同族 | 必须成套的内容 |
| --- | --- | --- |
| IMP-120 | Scalar | `specs/scalars/v1.md`、manifest、golden/negative，覆盖 EntityId、Instant、LocalDate、LocalTime、TimeZoneId、ExactDecimal、SortKey、Revision、LongCounter。 |
| IMP-121 | Installation security | installation anchor、device-key envelope 的协议 + Schema、fixtures 与 bootstrap/partial/错误 key oracle。 |
| IMP-122 | Persistence | active/portable SQL、SQLCipher profiles、DatasetControl、migration manifest、mapper fixtures 与 kill-point 预期。 |
| IMP-123 | Time | tzdb manifest/资产 identity、recurrence fixtures、DST/月末/闰年/升级 oracle。 |
| IMP-124 | Notification | local contract + payload Schema、完整版本矩阵、action/category/dedup/initialization fixtures。 |
| IMP-125 | Backup pairing | 修正现有 container/manifest metadata，与 portable/profile 成对；补 KAT、negative 与兼容 oracle。 |
| IMP-126 | Testing infrastructure | fixture manifest、conformance/release evidence Schema 与独立自校验命令，不能让实现代码生成自己的 expected。 |

由于 active DDL、portable DDL、SQLCipher profile、DatasetControl 与 backup container 形成兼容图，不能只写一张“临时 M2 表”规避 portable/backup owner。M2 不必实现用户备份 UI，但第一版 active 数据集必须已经有可映射、可迁移且不会封死后续备份的正式身份。

### 6.4 退出条件

M2 实际依赖的叙事文档 Gate 为 PASS；TD-001～011 与索引一致；上述主合同 `PRESENT + Normative + ACTIVE`、paired contract 无缺口、oracle 为 VERIFIED；M2 验收覆盖成功、取消、权限拒绝、事务失败、进程重启、重复 command、投影重建和未知/损坏数据集。

M1 可以按合同族分批通过，但任何子集只能打开明确依赖它的实现；不得用 scalar PASS 声称整个 persistence Gate 已通过。

## 7. M2：首个正式纵向切片

### 7.1 固定范围

首个正式切片继承 TD-002，固定为**创建一条带提醒的重复事项**，不能换成简单备忘来规避时间、通知、任务和搜索边界。范围至少包括：

1. 严格数据集初始化、解锁和 Repository 开放门；
2. Record + recurring detail + segment/occurrence policy + ReminderPlan 的领域/application command；
3. 一个本地事务提交业务事实、必要历史、projection invalidation 和 durable reminder/search task；
4. 提交结果在详情/生活簿/搜索的最小页面可见；
5. 提交后提醒 adapter 调度与权限拒绝/降级状态；
6. 重启后任务恢复、通知对账和搜索重建；
7. 编辑/完成/跳过的最小闭环只按已映射验收范围加入，不顺手扩张趋势或协作。

### 7.2 工作包

| 编号 | 工作包 | 关键验收 |
| --- | --- | --- |
| IMP-200 | Secure dataset bootstrap | all-absent 成功；partial/错误 key/unknown/mismatch 阻断且不建空库。 |
| IMP-201 | Scalar/time implementation | 运行全部 cross-implementation oracle，Hermes release 与 SQLite bridge 无近似转换。 |
| IMP-202 | Domain/application | fixed sources、合法/非法 recurrence、显式 command/result、重复 commandId 幂等。 |
| IMP-203 | SQLCipher repositories/UoW | Record/detail/segment/reminder/task 原子；异常不穿透，mapper 与 portable 身份一致。 |
| IMP-204 | Projection/query | 详情/列表/搜索 DTO，删除索引可重建，stale 不写回事实。 |
| IMP-205 | Notification adapter/task | 提交后调度、权限拒绝、平台 accepted 边界、重启 lease/对账。 |
| IMP-206 | Minimal UI | 创建、校验、保存、结果、失败/恢复和可访问反馈；UI 不直连 adapter。 |
| IMP-207 | Kill/contract/e2e | TD-002 九项验证与 M2 `ACPT-*` 全部通过。 |

### 7.3 退出条件

事务前 kill 无部分数据/外部通知；事务后通知前 kill 时记录保留且重启补调度；拒绝权限不回滚记录；重复 command 不产生第二条记录/提醒；搜索删除后可重建；两平台 release configuration 读取同一正式数据结果；任何 integrity 失败不降级成 fresh。

完成 M2 后才用实际吞吐量、缺陷和 spike 结果更新 OQ-008 的容量输入；在此之前不承诺后续日期。

## 8. M3：五类记录、整理、搜索与今天

每个子切片复用 M2 的 command/UoW/task/query/contract 测试骨架，不并行发明第二套基础设施。

| 编号 | 纵向切片 | 范围与关键风险 |
| --- | --- | --- |
| IMP-300 | 重复事项完整化 | 规则编辑、仅本次/本次及以后、历史不变、完成/跳过/逾期与今天。 |
| IMP-301 | 清单 | 模板/实例分离、分组项目、批量完成/重开、截止提醒、复制与另存模板。 |
| IMP-302 | 备忘（无附件部分） | 标题正文、多个提醒、知道了/稍后、置顶/归档/搜索。 |
| IMP-303 | 公历重要日期 | 类型、一次/每年、起始年份、多个提前/当天提醒、年龄/周年显示。 |
| IMP-304 | 家庭物品 | 不可变库存流水、精确数量、低库存周期、采购清单去重。 |
| IMP-305 | 统一整理 | 分类、标签、置顶、归档、回收站、筛选、稳定分页。 |
| IMP-306 | 今天/生活簿/全局搜索 | 来源分组、动作适用性、敏感裁剪、projection 重建和性能。 |
| IMP-307 | 设置最小切片 | 已实际交付的通知、分类标签、数据、安全与智能关闭状态；不展示未来入口。 |

执行顺序优先完成 IMP-300 以收口 M2，再按领域依赖推进 301～304；IMP-305/306 随每个记录切片增量扩展并在末尾做全类型收敛。IMP-307 只显示已交付能力。

M3 不含附件 bytes、通用关联、账号、农历、家庭协作、AI 增强或 P1/P2 预留入口。

## 9. M4：附件、数据生命周期、备份与恢复

M4 合同/oracle 可以在 M3 期间准备；产品实现以 IMP-302 的备忘和 IMP-304 的家庭物品为入口依赖，并在 M3 完成后收敛。不得为了提前验证附件而创建脱离正式 Record owner 的临时业务实体。

### 9.1 附件切片

在 private attachment contract/oracle 通过后，先交付备忘图片/文件和物品主图：选择 → 加密暂存 → 校验 → 事务绑定 → 原子提升 → 缩略图/清理。覆盖取消、文件 provider 丢失、超限、空间不足、kill points 和引用一致性。其他记录类型附件仍按路线图后置。

### 9.2 Portability 切片

| 编号 | 工作包 | 关键结果 |
| --- | --- | --- |
| IMP-400 | 加密备份创建 | 数据集快照、portable mapper、附件流、版本化容器、用户口令与完整性校验。 |
| IMP-401 | 原子恢复 | 隔离 candidate、错误口令/损坏/空间不足不改原数据、成功后原子激活。 |
| IMP-402 | 结构化/可阅读导出 | 明确未加密、用户选择目的地、取消/分享失败、临时文件清理。 |
| IMP-403 | 回收站与清除 | 30 天规则、恢复/永久删除、默认空间仍存在、清除与卸载边界。 |
| IMP-404 | 历史兼容矩阵 | 每个受支持 Schema/backup 升级恢复、旧 reader 边界、搜索与提醒重建。 |

M4 完成需要至少一次“创建数据 → 加附件/提醒 → 备份 → 清除测试数据 → 恢复 → 校验事实/附件/设置 → 重建搜索/对账提醒”的双平台端到端闭环。

## 10. M5：P0 本地闭环硬化

M5 不新增无需求能力，集中完成：

- 首次体验、导航、空/载入/错误/锁定/恢复状态与真实内容反馈；
- 应用锁、安全遮罩、通知隐私、权限按需申请和设置修复入口；
- 五类记录的编辑、归档、删除、恢复及所有适用提醒动作；
- QR-010～012/020/030～052/070～112 的适用性能、耐久、离线、容量、能耗、无障碍和本地化；
- iOS 16+、Android 10+ 与发行相关厂商的真机矩阵；
- 历史 migration/backup、故障注入、S0/S1 清零和诊断内容审计。

M5 退出后可以得到完整的 P0 **本地手动候选**，但不能称为路线图 P0 已发布：P0 在线智能仍按 M6 独立开门，发布/法律/支持按 M7。

## 11. M6：P0 在线智能（独立开门）

### 11.1 进入条件

- TD-012～017 全部 `Accepted`；
- `service-contracts.md`、`security-and-privacy.md`、`analytics-and-telemetry.md`、`observability-and-operations.md`、`release-operations.md` 和 `third-party-services.md` 达到各自 Gate；
- `specs/api/openapi.yaml`、AI Schema/fixtures、API/telemetry 合同和 oracle PASS；
- OQ-001/002 对内部合成环境可暂不关闭，但 production route/真实内容/公开测试仍保持阻塞；
- provider、地区、用途、训练/留存/删除和合同证据逐 route 核验。

### 11.2 顺序

| 编号 | 工作包 | 安全边界 |
| --- | --- | --- |
| IMP-600 | 合成 API skeleton | 无状态 server root、OpenAPI validation、无真实 provider/内容。 |
| IMP-601 | Anonymous admission | 安装 token/DPoP、quota、idempotency、lease/settlement；只存短期无内容状态。 |
| IMP-602 | AI gateway/router | one logical execution、attempt 上限、取消/deadline、provider simulators。 |
| IMP-603 | Provider adapters | OpenAI/千问各通过相同 Schema、安全和错误合同；route 默认关闭。 |
| IMP-604 | Client creation session | 输入只在内存、最多一个关键问题、确认前不写业务库、失败转手动。 |
| IMP-605 | Telemetry/operations | allowlist、collector 隔离、限额/熔断/route kill switch、runbook。 |
| IMP-606 | Evaluation | AI 评测集、供应商回归、安全/隐私和 QR-062 门。 |

任何在线失败必须保留输入并回到手动流程。网关不得访问用户生活数据库，provider 结果不得直接执行 command。M6 未通过时 production composition root 不注册真实 route，M2～M5 本地能力继续工作。

## 12. M7：P0 候选、内测与公开发布

### 12.1 交付文档

首次内部分发前至少完成 TD-017 和 `release-operations.md`；公开测试/发布前完成 `observability-and-operations.md`、`legal-and-compliance.md`、`support-playbook.md`、`third-party-services.md`、隐私/权限披露与品牌核验。运营主体、联系方式、地区和名称受 OQ-001/002/009 阻塞。

### 12.2 候选门

| 编号 | 门 | 结果 |
| --- | --- | --- |
| IMP-700 | Requirement trace | 所有 P0 `PR-*`/`QR-*` 映射 `ACPT-*` 并通过，无排除项偷渡。 |
| IMP-701 | Conformance | 当前 Git/合同/oracle/平台的 evidence index 为 VERIFIED。 |
| IMP-702 | Upgrade/recovery | 历史数据库与备份往返、错误路径、回滚兼容全部通过。 |
| IMP-703 | Platform/security | 真机、权限、应用锁、通知、附件、secret/日志/出站与安全评审通过。 |
| IMP-704 | Operations | 监控、告警、provider/region kill switch、事件响应和恢复演练。 |
| IMP-705 | Release | 签名、渠道、灰度、停止/回滚、商店材料和支持流程绑定同一候选。 |

只有适用 Gate 全部通过且治理 snapshot 非 stale，才可进入公开测试。发布后任何格式升级仍按同样 change train，不把“首发已过”当永久豁免。

## 13. P1/P2 后继实施

### 13.1 P1 独立切片

- 账号/云备份/同步：OQ-006 关闭且 TD-018～023、同步/API/对象/推送合同过门后，按账号与本地认领 → 双设备增量同步 → 附件/云备份 → 会话/删除的纵向顺序实施。
- 农历重要日期：PD-018、TD-028、转换合同/数据许可/跨实现 oracle 过门后独立实施，不依赖账号切片。
- 输入/记录增强：附件扩展、关联、复制、分享副本、多轮/语音/上下文和 BYOK 分别过自己的合同/隐私门，不用“P1 已开始”整体放行。

P1 任何服务故障都不能让免登录本地数据不可用；账号不成为 P0 本地使用前提。

### 13.2 P2 独立切片

P2 在相关 P1 基础稳定、TD-024～027 与授权/API/内容合同过门后，依次实施家庭 membership/邀请 → 共享记录与冲突 → 审计/高风险操作 → Web → 受控上下文 AI → 公共模板治理。每一步都证明个人记录不会默认公开，服务端逐操作授权。

本计划不为 P1/P2 冻结服务拆分、Schema 或日期；实际决定形成时新增/更新 ADR、合同与对应里程碑。

## 14. 并行工作与依赖控制

允许的并行：

- M0 工具/壳与 M1 叙事/合同由不同 owner 并行；
- 不共享文件 owner 的 TD-001 原生 capability spike 可以并行；
- M3 的纯领域规则准备可在合同复用边界明确后并行，但正式 adapter/UI 按纵向切片合入；
- M6 合成服务研究不阻塞 M2～M5，但不连接 production composition root。

禁止的并行：

- 两个 owner 同时定义同一字段、版本、error code 或 bytes；
- Schema、mapper 和 migration 各自推进后再“对齐”；
- UI 用临时 Repository/HTTP 接口先行，迫使后续合同兼容；
- 多个切片同时修改同一启动/数据集状态机而无单一 integration owner；
- P1/P2 预留实现与 P0 合入，靠隐藏入口降低审查。

跨切片依赖必须写成“需要哪个 Gate/公共 facade”，不能只写“等后端”“等设计”。阻塞解除时由 owner 更新 backlog 和 trace，不静默扩大 scope。

## 15. 变更、回滚与进度表达

- 进度只报告 `READY / IN_PROGRESS / BLOCKED / DONE` 及其证据；“90%”不能替代缺失 Gate。
- `DONE` 只用于第 4.2 节完成定义全部满足的切片；代码合并但合同/evidence 缺失仍是 `BLOCKED` 或 `IN_PROGRESS`。
- 产品/技术/合同改变时执行影响检查：owner、阶段、Schema/API、migration、测试、发布、支持和旧版本兼容。
- M0 尚无用户数据时，技术栈反证可删除可重建骨架并用替代 ADR 重建；从第一条正式数据开始，回滚必须保持现有数据可读。
- feature kill switch 只关闭可选入口，不删除用户事实或改变格式解释；不可安全关闭的变化必须走 compatible forward fix。
- 每个治理 snapshot 只锚定一次；登记路径改变后先视为 stale，完整重审后分配新 ID。

## 16. 当前开工判定

文档 change train 完成并由最新治理 snapshot 确认后，IMP-100～107 满足 Definition of Ready，可以直接进入代码实施。此时：

- 可以建立长期保留的客户端仓库、工具链、移动壳、模块边界、测试和 CI；
- 可以使用合成数据做 TD-001 原生能力验证；
- 可以实现不序列化的纯确定性基础代码；
- 不可以开始 M2 的正式持久化/通知产品路径，也不可以开始生产在线服务。

因此“可以开始写程序”和“可以保存第一条真实用户记录”是两个明确不同的 Gate。前者由 M0 打开，后者必须等待 M1 完成。

## 17. 变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| v1.1 | 2026-07-27 | 修正 M3→M4→M5 依赖与附件入口，完整列出 scalar 合同范围，收窄 M0 格式/流量表述并固定第三方服务 owner。 |
| v1.0 | 2026-07-27 | 建立无日期里程碑、M0 永久骨架首批工作包、正式本地合同轨、首个纵向切片及 P0 在线/P1/P2 后继门。 |

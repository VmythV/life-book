# TD-003：加密本地数据库

> Status：`Accepted`  
> Date：2026-07-26  
> Decision owners：客户端数据负责人、安全负责人  
> Scope：P0～P2 移动客户端的关系数据、启动门、事务、加密、迁移与本地全文索引<br>
> Related requirements：PD-002、PD-006、PR-500、DATA-001～002、DATA-110～122、QR-011、QR-020、QR-030～032、QR-070、QR-110～112  
> Related ADRs：[TD-002](0002-offline-first-client-architecture.md)、[TD-004](0004-device-key-hierarchy-and-app-lock.md)、[TD-006](0006-cross-platform-scalar-representations.md)、[TD-008](0008-encrypted-local-search.md)、[TD-010](0010-sqlite-snapshot-migration-and-atomic-restore.md)<br>
> Decision gate：生产构建必须通过编译能力、SQLite/SQLCipher 版本、bootstrap/control/receipt/anchor 启动矩阵、安全、迁移、崩溃和容量 spike；不允许退回未加密数据库或路径缺失自动建库发布

## Context

本地数据库必须同时支持复杂关系、不可变历史、事务、离线全文搜索、可重建投影、P1 同步 outbox 和 50,000/250,000 设计容量。数据包含生活正文、家庭物品、日期、提醒、附件元数据和未来家庭信息，不能以明文数据库或平台默认备份的方式离开 App 控制。

React Native 页面状态和普通键值存储无法提供这些事务/查询能力。字段级加密会破坏索引、约束和迁移，并容易遗漏新字段；只依赖 App 私有目录也不能覆盖设备备份、调试导出或离线文件获取等威胁。与此同时，全库加密并不替代应用锁、附件加密、日志最小化和运行时授权。

数据库 API 常把“打开”与“文件不存在时创建”合并；如果启动只看数据库路径，这会把 control/key/anchor 损坏静默变成一套新空数据。另一方面，TD-010 activation 在 control 已 active 后仍需受限打开 candidate、写 receipt 并推进 TD-004 anchor，不能把这段高权限恢复连接泄露为普通 Repository。数据库边界因此还必须区分 bootstrap creation、activation recovery 和 ordinary active open。

## Decision

客户端使用 **SQLite + SQLCipher** 作为关系事实库，通过 `expo-sqlite` 的 CNG 配置在 iOS/Android 构建同一能力，并启用 FTS5。TypeScript 访问层采用 **Drizzle ORM 的 Expo SQLite driver** 处理表定义、类型化常规查询和迁移生成；迁移的权威产物是经过评审并带 checksum 的 SQL，关键事务、FTS、完整性、查询计划和 PRAGMA 可以通过封装后的原生 SQLite API 执行。活动数据库不依赖可覆盖固定路径；启动必须先经 TD-004 presence/bootstrap 联合分类，再由 TD-010 恢复 control、typed marker/abort evidence、`ActivationOpenReceipt` 与 active bootstrap anchor。`phase=active` 本身仍不足以开放业务写；control/evidence/receipt/anchor 四项精确匹配后 Dataset Controller 才向 Database Manager 交付不暴露路径或 raw key 的 `ActiveGenerationHandle`。

数据库使用随机设备数据密钥，不使用用户口令直接作为 SQLCipher key。密钥解封由 TD-004 负责。应用以单一受控连接管理器打开数据库，P0 只有一个串行写连接；启用 `foreign_keys`、WAL 与 `synchronous=FULL`，所有用户输入使用绑定参数。数据库、WAL、SHM 和索引全部位于 App 私有且排除系统自动备份的目录。

## Decision details

### 1. 构建能力

`expo-sqlite` config plugin 至少配置：

```json
{
  "enableFTS": true,
  "useSQLCipher": true
}
```

实际生成值由工程配置集中维护，不在多个 app config 重复。构建时记录并在测试中读取：

- `sqlite_version()` 与 `sqlite_source_id()`；
- `PRAGMA cipher_version` 与供应商/构建 patch manifest；
- `PRAGMA compile_options`；
- FTS5、外键、线程和所需 backup/snapshot API 是否存在；
- iOS/Android release 二进制实际链接的库，避免系统 SQLite 与 SQLCipher 混用。

SQLCipher 不受 Expo Go 支持，因此所有数据库测试在 Development Build 或 release build 运行。若当前 `expo-sqlite`/SQLCipher 组合缺少本决定要求的修复或 C API，优先用受控 fork/config/native module 补齐；不能在一端静默改用普通 SQLite。

### 2. 数据库位置与文件集

- 每个 generation 的唯一物理形态为固定根下 `dataset/generations/<opaqueGenerationId>/database.sqlite`；固定的只是目录模板和业务逻辑标识，generation ID 是受控不透明 ID，不包含账号、标题、空间名或时间；活动 generation 只由 TD-010 control 解析，不能扫描目录或按 mtime 猜测；
- 放在 Application Support/No Backup 等平台等价私有目录；iOS 设置排除云备份资源属性，Android backup rules 排除主库、`-wal`、`-shm`、附件及密钥相关文件；
- 数据库文件不进入系统文件选择器、分享面板、日志附件或崩溃报告；
- WAL 与 SHM 是数据库持久状态的一部分，普通文件操作不得单独复制、删除或移动；
- 导出、备份和只读恢复必须走 TD-010/TD-011 的一致快照，不暴露活动数据库文件；
- 开发调试数据库只能使用合成数据和调试密钥；生产数据库浏览功能不打入 release 包。

### 3. 打开和解锁顺序

```text
Installation Anchor / Key Manager:
  联合验证 InstallPresenceRecord + InstallationBootstrapRecord + journal
  → clearing: 只续跑 DATA-091，不取得 DB handle
  → fresh/initializing: 只进入 TD-010 initialize recovery
  → initialized/control_eligible: 交付当前 incarnation 的 control-key capability
  → integrity_blocked/key_unavailable: 安全遮罩，不打开 DB
Dataset Controller:
  → 认证并恢复双槽 DatasetControlRecord
  → phase=validating:
      先为 control 指定的 candidate/prior 签发 DatasetMaintenanceGenerationHandle
      initialize/no marker → 同 bootstrap operation 重建空 candidate
      other/no marker → 复验 prior 后写 activation_abort terminal control
      marker present → operation-specific read-back 后完成同 candidate
  → phase=active: 先交付仅 TD-010 可用的 ActivationRecoveryGenerationHandle
  → 通过 ActivationRecoveryRepository 复验 typed marker 或 abort journal
    + ActivationOpenReceipt + bootstrap active anchor
  → anchor 仍为 evidence 绑定的 expected prior 时只可幂等 guard-CAS
  → control/evidence/receipt/anchor 四项精确匹配后解析 generation/key/cipher/canonical path
  → 交付 ActiveGenerationHandle
Database Manager:
  使用 ActiveGenerationHandle 打开 SQLCipher connection
→ 立即设置 raw hex key（不插入口令/用户输入）
→ 执行最小读取验证 key 与文件头
→ 读取 cipher/sqlite/compile 版本并验证 allowlist
→ 设置连接 PRAGMA
→ 检查 handle 绑定的 typed marker 或 activation-abort receipt chain、迁移 ledger、Schema 与完整性状态
→ 若需升级：关闭普通 handle，保持 Repository gate，交给 TD-010 candidate 状态机
→ 重新从 Controller 取得全新 active handle 并完成全部 gate
→ 开放 Repository
```

三种 handle 是不同 capability，不能互相转换。TD-010 的“Repository in activation-recovery mode”在本 ADR 中精确定义为下表 `ActivationRecoveryRepository`，不是业务 `Repository`：

| handle | 必须绑定 | 唯一调用者/权限 |
| --- | --- | --- |
| `DatasetMaintenanceGenerationHandle` | Installation/incarnation、`phase=validating` control/operation/epoch、candidate 与必要 prior generation 的明确 role、key/cipher profile、journal/evidence/control digest。 | 仅 TD-010 maintenance adapter；可 first-open/验证 candidate、读写 typed marker transaction，或只读复验 prior 供 abort；不能创建未被 bootstrap capability 授权的文件，不得交给 ORM/业务 Repository。 |
| `ActivationRecoveryGenerationHandle` | Installation/incarnation、`phase=active` generation、control sequence/operation/epoch、key/cipher profile、expected marker 或 abort-journal digest、expected receipt/bootstrap digest。 | 仅构造内部 `ActivationRecoveryRepository`：其 typed API 只可复验 marker/task/owner/pairs/prior receipt，写本 operation 的 `ActivationOpenReceipt` 并请求 anchor CAS；不得暴露通用 query/unit-of-work 或交给 ORM、业务 Repository、同步、通知、UI。 |
| `ActiveGenerationHandle` | Installation/incarnation、active generation、control sequence/epoch、key/cipher profile、typed marker/abort evidence chain、matching `ActivationOpenReceipt` digest 与 initialized bootstrap digest。 | 仅 Database Manager；只能在四项 active facts 已 read-back 后签发，任一 control/anchor 改变立即失效。 |

约束：

- key 只以固定长度字节/严格 hex 编码短暂进入 native boundary，不组成可记录的普通 SQL 字符串；
- 数据库 key、`PRAGMA key`、完整 connection string 不得出现在日志、错误、analytics 或 crash breadcrumbs；
- 在 key 验证和 Schema gate 完成前，任何业务 Repository 均不可取得 connection；
- TD-004 classifier 必须先于 control/key/数据库打开，valid `clearing` 无条件优先；slot 无效、身份冲突、control 引用路径缺失、receipt/anchor 不匹配或 `phase=validating` 时只运行 TD-010 startup recovery，不得把 recovery/candidate handle 暴露给 ORM，不得退回固定旧路径或创建空库；
- ordinary/recovery open 均使用不含 `SQLITE_OPEN_CREATE` 的受控 flags；control 引用的 generation/DB 不存在一律 integrity-blocked。只有 TD-004 strict all-absent + 一次性 bootstrap capability 成立后，TD-010 initialize writer 才可在新的 operation-owned candidate 路径显式创建文件；单独“数据库路径不存在”从来不是 fresh evidence；
- 若 `expo-sqlite` 当前入口不能表达 `sqlite3_open_v2` 的 `SQLITE_OPEN_READWRITE`、明确不含 `SQLITE_OPEN_CREATE` 的语义，或不能接管已验证 native handle，ordinary/recovery path 必须使用项目窄原生模块并把已打开连接封装给 adapter；禁止以“先检查 exists，再调用会 CREATE 的 wrapper”制造 TOCTOU。只有 initialize/candidate writer 的专用 API 包含 CREATE，且先验证 capability、固定 canonical path 与 operation ownership；
- “file is not a database”等底层结果不能直接告诉用户是口令错误还是损坏；恢复层根据已知操作上下文映射受控错误；
- 失败时关闭 connection、清理 key buffer 能控制的副本，并保留原文件，不创建同名空库。

### 4. 连接配置

新库和每次受控打开验证以下有效设置：

| 配置 | 决定 | 原因 |
| --- | --- | --- |
| `PRAGMA foreign_keys=ON` | 必须，且每个 connection 设置。 | 让物理引用约束与聚合清理可验证。 |
| `PRAGMA journal_mode=WAL` | 必须检查返回确为 `wal`。 | 原子提交、读写隔离和恢复能力；不能假定设置一定成功。 |
| `PRAGMA synchronous=FULL` | P0 默认。 | QR-030/031 优先于极限写吞吐；`NORMAL` 的掉电回滚风险不符合已确认保存语义。 |
| `PRAGMA busy_timeout` | 初始 5,000 ms，并可取消/观测。 | 短暂锁竞争等待；不能掩盖长事务。 |
| `PRAGMA secure_delete=ON` | 用户内容库启用并做性能验证。 | 永久清理后降低仍持 key 时从自由页恢复内容的机会；仍不替代 VACUUM/密钥销毁。 |
| WAL auto-checkpoint | 从 SQLite 默认开始，按真实 WAL 大小/P95 调优。 | 避免拍脑袋固定页数；监测 checkpoint starvation。 |

P0 对**当前 active generation** 使用一个长生命周期 connection 和进程内写队列，读事务不得跨页面等待、网络或渲染帧长期持有。TD-010 maintenance lease 可以为不同目标文件打开 capture/candidate 专用连接，但它们不能成为第二个 active writer，且 activation 前必须排空并关闭。增加同一 active generation 的第二 connection、后台 checkpoint 或并发 writer 前，必须验证实际链接 SQLite 已包含 WAL-reset 修复，并增加并发/崩溃测试。

截至本决定日期，SQLite 官方披露 WAL-reset bug 在 3.51.3 及特定回移版本修复。生产构建必须按实际 `sqlite_source_id()` 与可审计 patch manifest 核验，而不是只比较语义版本：若未包含修复，只能保持单 connection、禁止并发 checkpoint/write，并在升级门替换；不能因发生概率低而忽略数据损坏风险。

### 5. Schema 与物理类型边界

- 领域到物理表的唯一映射由 `persistence-schema.md` 维护；本 ADR 不允许 ORM 自动从运行时对象推断生产表；
- ID、枚举、LocalDate/LocalTime/Instant、ExactDecimal、SortKey 和 boolean 按 TD-006 的可移植编码保存；
- `NOT NULL`、`CHECK`、`UNIQUE`、外键和部分索引用来防止物理非法状态，但数据库触发器不得成为唯一业务规则实现；
- 不把附件二进制、备份容器、API Key、session token 或数据库 key 存入普通 BLOB/表；
- JSON 只用于已版本化、难以关系化且不参与核心约束的封装；Schema 校验通过后才写，未知字段兼容策略明确；
- 时间不使用 SQLite 本地时区函数决定业务含义；排序/截止由领域规范后的规范列和稳定 tie-breaker 决定。

### 6. Drizzle 使用边界

- Drizzle schema 生成/检查普通表类型，Repository 对上层返回领域对象/DTO，不返回 Drizzle row；
- `drizzle-kit` 只生成候选迁移；开发者必须评审 SQL、数据回填、索引锁定、回滚/前滚和磁盘需求后提交；
- 运行时只执行随 App 签名打包、checksum 匹配的迁移，不从网络下载 SQL；
- 复杂查询必须有手写 SQL/查询计划测试的出口；不为坚持 ORM 把高效查询拆成 N+1；
- FTS5 virtual table、trigger/同步写入策略、PRAGMA、backup、integrity 与批量流式游标通过 Database Adapter 封装；
- 如果 Drizzle 的稳定版本在目标 Expo/React Native 组合不能通过迁移和性能契约，可用薄 typed SQL adapter 替换而不改变数据库格式；这属于实现替换，不授权换数据库。

### 7. 查询与写入纪律

- 所有动态值使用 prepared statement/binding；禁止把标题、搜索词、ID、排序字段直接拼入 SQL；
- 动态排序/列名只能从编译期 allowlist 映射；
- `getAll` 只用于有严格小上限结果；大列表、导出、备份检查和重建使用 cursor/iterator 分批处理；
- Repository 负责显式选择列，不使用长期 `SELECT *` 穿过迁移边界；
- 写事务用显式 begin/commit/rollback helper，异常路径保证 rollback；不得在事务内等待外部系统；
- 每条用户写命令在事务前以 TD-006 exact integer 对 `dataMutationCounter` checked `+1`，并在同事务保存新 counter、必要版本、不可变历史、任务/outbox，提交后再通知 UI；counter 为 MAX 时 Repository 只读并拒绝 mutation/capture，不影响 matching control/bootstrap sequence 为 MAX 的稳定 active 数据集正常读取；
- 批量迁移/重建分批并可恢复；不得在 JS 主线程构造 250,000 行数组。

### 8. 迁移协议

下面 ledger 只存在于已完成 generation 或正在构建的 candidate；`applying` 不是 active 上的可恢复迁移状态：

```text
schema_version
migration_id
checksum
applied_at
app_build
state = applying | applied
```

TD-010 接受后，所有已发布数据的 schema、data 和 cipher 迁移都遵循 `active → encrypted clone/capture → candidate transform → verify/seal → atomic activation`，不得在 active generation 原地执行。迁移规则：

```text
resolved_active → preflighted → cloned
→ transforming(migrationId, phase, lastStableKey)
→ verified → sealed → validating_active → active → cleanup_pending
```

1. 编号只增不改；已发布 migration 内容与 checksum 不得改写；
   artifact 的 `kind/execution/requiredCapabilities`、SQL/transform/manifest digest、portable classification、verification suite 与 minimum/rollback reader version 必须按 TD-010 完整登记，不能只存一段 SQL；
2. 候选构建前验证 active control、bootstrap anchor 与数据库唯一 Installation mirror 的 Installation/incarnation 完全相同，active key、当前版本、剩余空间、内置 migration chain/checksum 和上一 candidate operation 状态合法；在写 validating 前一次预留两个 `controlSequence`（validating + success/abort terminal）和一个 `bootstrapSequence`（success/abort anchor 二选一），没有完整 headroom 不开始；
3. 能单事务完成的 DDL/DML 在 candidate 的一个事务中执行；需要重建表/文件的迁移使用 TD-010 checkpointed shadow 状态和稳定 keyset；
4. 新增列先允许旧写入兼容，再回填/验证，最后在后续版本收紧约束；
5. 删除/改义先双读或复制到新列，经历声明兼容窗口后才物理清除；
6. FTS、今天、缓存、缩略图索引标为可重建，不通过复制旧错误投影完成迁移；
7. validating control 写入前失败可丢弃或隔离 candidate，原 active/anchor 不变；validating 后且无 marker 的失败必须走 TD-010 `activation_abort` terminal control → prior-generation recovery receipt → bootstrap active-anchor CAS，不能直接删 slot/复用旧 receipt；marker 后只可完成同 candidate active 或 integrity-blocked；三者都不把半迁移库当空数据；
8. App 遇到更新 Schema 时进入受控“需要更新/只读恢复”状态，不尝试降级写入；
9. SQLCipher major/cipher settings 迁移与业务 Schema 分开演练；先从 active 得到隔离 capture，再以 `sqlcipher_export` 写新 key/settings candidate；`cipher_migrate` 只在明确检测受支持旧格式后作用于可丢弃隔离副本，检查返回值，不能在 active 或每次打开时执行。

已发布版本不承诺原地 downgrade。回滚发布必须使用仍能读取当前 Schema 的前一兼容构建，或先有显式反向迁移/恢复方案。

### 9. 完整性和维护

| 时机 | 检查 |
| --- | --- |
| Repository 签发前 | active control、typed marker/abort evidence、matching open receipt、bootstrap active anchor、Installation/incarnation/generation/control/epoch 全量一致。 |
| 正常启动 | Schema/migration 状态、快速 key 读取、必要外键配置。 |
| 上次异常退出/存储 IO 错误后 | `quick_check`、`foreign_key_check` 与任务/文件操作恢复。 |
| 创建备份、完成迁移、恢复预检 | 完整 `integrity_check`、`foreign_key_check`、领域关键不变量和附件 manifest。 |
| 发布候选/自动化 | 完整性、FTS 一致、查询计划、WAL checkpoint、自由页/安全删除测试。 |

检查失败进入完整性保护：停止业务写、保留文件、生成无内容诊断 ID，只在安全读路径通过时提供受控导出。修复不得执行“drop and recreate”或自动下载云副本覆盖本地。

checkpoint、FTS optimize/rebuild、`VACUUM` 和统计分析是持久维护任务：统一经 `DatasetMaintenanceLease/DatasetGate` 调度，不与 TD-010 capture 或 activation 并发；只在供电/前台或合适后台机会、空间充足且没有用户事务时运行，可取消并有进度。处理 WAL/SHM/journal 或切换 journal mode 前必须排空并关闭相关 handle/statement/cursor。`VACUUM` 前预留至少数据库大小加安全余量，不能因清理反而耗尽存储。

### 10. 本地全文索引

FTS5 virtual table 与规范表位于同一个 SQLCipher 数据库，不创建明文 sidecar。索引是派生数据：

- 只索引搜索规范允许的字段；敏感内容仍可在解锁后的授权查询中搜索，但结果裁剪遵循隐私上下文；
- P0 不保存原始搜索词历史；SQL 参数和 debug plan 不记录词值；
- 规范表提交与“索引待更新”在同事务，索引可以同事务同步更新或由幂等任务补齐；
- 索引记录来源 revision；落后/缺失可检测并全量重建；
- tokenizer、Unicode 规范化、中文策略和排名由 TD-008 唯一决定。

## Alternatives considered

### 普通 SQLite + 字段级加密

可以保留系统 SQLite，但每个新字段、索引、唯一性、搜索和迁移都必须正确处理密文；元数据/Schema/FTS 容易泄露，查询能力显著下降。只对少量特别字段二次封装可以由安全规范决定，但不作为数据库主保护。

### 只依赖 App 私有目录/系统文件保护

系统保护有价值但受设备解锁、平台备份、调试和实现差异影响，不能单独满足 PR-500。它作为 SQLCipher 外层 defense in depth，不替代数据库加密。

### Realm 或其他对象数据库

对象映射方便，但不可变流水、复杂关系、FTS、精细迁移、可审计 SQL 和跨端备份控制更不透明；加密/许可/同步实现也可能绑供应商。当前不选。

### iOS Core Data + Android Room

平台集成好，但两套 Schema、迁移、查询和加密方案会放大一致性成本；领域层仍需共享。当前统一 SQLite 物理语义更适合契约测试。

### JSON/文件集合

无法可靠提供跨实体事务、约束、分页、索引、增量迁移和 250,000 子对象性能。拒绝。

### SQLite 不使用 ORM

完全手写 SQL 可控但类型/迁移样板更多。保留为 Drizzle adapter 的退出路径；规范仍以 SQL/Schema 为准，因此 ORM 不形成不可逆锁定。

## Consequences

### Positive

- 关系、事务、不可变历史、全文检索和设计容量使用成熟数据库能力；
- 全库内容与索引统一静态加密，减少字段遗漏；
- SQL Schema、迁移 checksum 和完整性检查可审计、可测试；
- Drizzle 提供 TypeScript 类型和迁移工具，同时不隐藏原生 SQLite 能力；
- P1 同步 outbox、cursor 和冲突状态可在同一事务与业务事实提交。

### Negative

- SQLCipher 增加 native 构建、启动 KDF、二进制体积、许可核验和大版本迁移成本；
- `synchronous=FULL`、`secure_delete=ON` 可能降低写入/清理性能，需要真实设备测量；
- ORM、SQLite、SQLCipher、Expo SDK 四者存在版本兼容矩阵；
- WAL 需要 checkpoint、文件集和已披露缺陷的版本管理；
- 忘失设备密钥时数据库不能由产品解密，只能从用户可用的加密备份恢复。

## Risks and mitigations

| 风险 | 缓解 |
| --- | --- |
| 错误 key、anchor/control 或库损坏被误判为空库 | TD-004 presence/bootstrap 先行、TD-010 strict all-absent、ordinary open 禁 CREATE；存在/mixed evidence 一律阻断。 |
| active control 尚未完成 evidence/receipt/anchor 就开放写 | recovery/active handle 类型隔离；control、marker/abort、receipt、whole-record anchor 四项 read-back 后才签发 active handle。 |
| clear/reinstall 后旧 handle 访问同 ID 数据 | handle、control、数据库 Installation mirror 全部绑定 installation incarnation；incarnation 改变立即撤销连接/statement/Repository。 |
| validating 失败直接复用旧 receipt | 只允许 `activation_abort` terminal control + recovery receipt + active-anchor CAS；每个 kill point 幂等恢复。 |
| sequence 中途耗尽 | operation 在 validating 前预留两个 control + 一个 bootstrap 值；initialize/clear 服从 TD-010/TD-004 的更大 headroom；不先写后检查。 |
| SQLCipher/SQLite 大版本不兼容 | 记录实际版本和 cipher settings；旧格式 fixture、隔离迁移、备份往返和最低客户端门。 |
| WAL-reset/其他上游缺陷 | 构建版本 allowlist、安全公告监测；单 writer/connection；升级后并发崩溃测试。 |
| WAL 无限增长/磁盘耗尽 | 限制长读事务、观测 WAL、空闲 checkpoint、容量预检和 storage UI。 |
| Drizzle 生成破坏性 SQL | 生成物只作候选；只在 candidate generation 执行；人工评审、checksum、旧 fixture 升级和 kill-point 测试。 |
| SQL 注入或敏感查询日志 | 全部绑定参数、列 allowlist、release 禁止 SQL 值日志、静态扫描。 |
| OS 自动备份泄露/复制不一致 | iOS/Android 明确排除规则及安装包测试；只用产品加密备份。 |
| 删除后自由页仍有内容 | secure_delete、受控 VACUUM、密钥销毁和物理取证测试；不作无法验证的瞬时擦除承诺。 |

## Implementation constraints

- 数据库连接只能由 Database Manager 创建，业务模块不能自行 `openDatabase`；
- Dataset Controller 是 active generation 的唯一解析者；Database Manager 只接受 receipt/anchor 已验证的 `ActiveGenerationHandle`，不接受 `DatasetMaintenanceGenerationHandle`、`ActivationRecoveryGenerationHandle`、业务层路径/control/raw key，也不得在 bootstrap/control/activation recovery 完成前尝试旧固定路径；
- 所有 connection/statement/cursor/transaction/Repository 都继承 handle 的 Installation/incarnation/generation/control sequence/epoch guard；任一 guard 变化由 DatasetGate 阻止新工作、排空并关闭旧 handle，不能让旧 connection 跨 activation/clear；
- Repository/UnitOfWork 不把 Drizzle/SQLite 类型或原始错误暴露给上层；
- release 构建若 `useSQLCipher`、FTS5、foreign keys 或版本 allowlist 检查失败，启动进入阻断状态，不能降级明文；
- Database Manager 永远没有自动创建生产库的 API；只有 TD-010 initialize writer 可用 TD-004 operation/incarnation-bound bootstrap capability 在全新 candidate 路径创建库。路径不存在、存在但打不开、control 引用缺失分别都不是 Database Manager 可修复状态；
- active control/bootstrap sequence 为 MAX 只阻止下一次 control/anchor transition，不使当前 active 自动只读；只有 `dataMutationCounter=MAX` 阻止普通 mutation/capture。所有 headroom 比较使用 TD-006 exact integer adapter；
- 数据库文件名、表名、migration 与 compile options 不包含环境密钥或用户内容；
- 任何性能优化先保留 QR-030/031 的耐久语义；改变 `synchronous`、连接数、checkpoint 或 cipher 参数需要新基准和安全评审；
- Web 不复用移动数据库文件；P2 Web 的浏览器存储由 TD-026 决定。

## Verification

### Build and encryption

1. 两个平台 release build 报告允许的 SQLite/SQLCipher 版本和 compile options；
2. 未提供 key、错误 key、普通 SQLite 工具直接打开均不能读出 Schema/正文；正确 key 可通过完整性检查；
3. 二进制/产物确认没有同时链接导致调用错误 SQLite 实现；
4. iOS/Android 系统备份清单不包含 presence/bootstrap/journal/key envelope、DB/WAL/SHM/附件/密钥；
5. 日志、崩溃和调试包不含 key、SQL 参数或生活文本。

### Reliability and migration

1. 启动矩阵覆盖 TD-004 strict all-absent、presence-only matching/mismatching journal、clearing source/pending presence/target pair、initialized、orphan、invalid/mixed evidence；`clearing` 先于 control，除 strict fresh initialize 外均不创建库；
2. control 引用 generation/DB 路径缺失、Installation/incarnation mirror 不匹配、key ID 不可用、slot 冲突都 integrity-blocked，不扫描目录或 fallback 固定路径；
3. 在每个 candidate clone/begin/write/task/migration/commit/seal/control/typed-marker 点 kill；validating 无 marker 的 non-initialize 路径另覆盖 abort control、prior reopen、recovery receipt、anchor CAS，每次重启只能完成同一 terminal identity；
4. active control × matching/missing/conflicting receipt × prior/target/third-value bootstrap anchor 全组合；只有精确 matching 后签发 `ActiveGenerationHandle`；maintenance/recovery handle 在类型、runtime 与依赖测试中都无法进入 ORM/业务 Repository，`ActivationRecoveryRepository` 只能调用 allowlisted read-back/receipt/CAS；
5. counter fixture 覆盖 `MAX-4...MAX`：已有 active 的 operation 缺两个 control 或一个 bootstrap 值时在 validating 前拒绝；稳定 active control/bootstrap 为 MAX 仍可普通读写，`dataMutationCounter=MAX` 只读且 capture 拒绝；
6. 从每个已发布 Schema/cipher fixture 升级，checksum、行数、领域不变量和 FTS 一致；
7. 错误 key、截断 DB/WAL、缺失 SHM、磁盘不足、迁移 SQL 失败时原文件保留且不创建空库；
8. 新版 Schema 被旧版打开时只读阻断，不执行 downgrade 写；
9. 外键、CHECK/UNIQUE、secure delete、VACUUM 中断和 checkpoint starvation 有自动测试。

### Capacity and performance

在最低支持与主流设备、接近 QR-020 数据量测量：冷开/解锁、普通写事务、列表、今天、搜索、迁移、完整性检查、全量索引重建、备份快照、WAL 峰值和 24 小时压力。P95 必须满足 QR-010～012；若 FULL/secure_delete 未达标，先优化事务/索引/批次，不得无评审降低耐久或隐私。

## Rollout and rollback

首个保存真实用户数据的版本即使用 SQLCipher，并同时发布 TD-004 IAK/presence/bootstrap、TD-010 strict all-absent/`EmptyCandidateEvidence`、initialize control sequence 0、typed marker/open receipt/active-anchor CAS 和 generation 双槽；不发布“固定 `main.db`/先明文以后加密”、无 anchor 空库或 Database Manager 自动创建的过渡版。首次内部 spike 数据只经一次性 importer 进入新 generation，不冒充 fresh、不进入兼容承诺。之后升级 SQLite、SQLCipher、Expo SQLite 或 Drizzle 时，先在旧数据库副本完成读取/迁移/备份/恢复矩阵，再灰度新构建；若升级失败，回滚到能读取当前 presence/bootstrap/Schema/cipher/control/receipt 的上一构建。已迁移 cipher/Schema/control/anchor 不允许通过商店回滚到不兼容二进制。

商店二进制回滚只更换代码；`phase=validating` 且未写 activation marker 的自动恢复只能通过 `activation_abort` terminal control、新 recovery receipt 和 bootstrap anchor CAS 重新认证 prior generation，绝不能删除新 slot 后直接使用旧 receipt。active 后的 previous rollback 必须把 previous 当只读源复制成新的 candidate，并经影响预览、fresh auth 与完整 activation，绝不能直接改 control 回指旧数据库。商店回滚、activation abort 与用户 manual rollback 三条路径不得互相替代。

## References

- [Expo SQLite：配置、SQLCipher、FTS 与 Drizzle 集成](https://docs.expo.dev/versions/latest/sdk/sqlite/)
- [SQLite：Write-Ahead Logging](https://www.sqlite.org/wal.html)
- [SQLite：Online Backup API](https://www.sqlite.org/backup.html)
- [SQLite：PRAGMA integrity_check](https://www.sqlite.org/pragma.html#pragma_integrity_check)
- [SQLCipher：API、配置与迁移](https://www.zetetic.net/sqlcipher/sqlcipher-api/)
- [Drizzle ORM：Expo SQLite](https://orm.drizzle.team/docs/sqlite/connect-expo-sqlite)

依赖升级与发布前重新核验这些官方资料、实际链接版本和安全公告；尤其不能把 Expo 文档中的示例口令或默认 PRAGMA 直接复制为生产密钥方案。

## Revision notes

| 日期 | 说明 |
| --- | --- |
| 2026-07-26 | 对齐 TD-004/TD-010：bootstrap/presence 先行分类、recovery/active handle 隔离、receipt+anchor 开库门、incarnation/headroom 与 activation-abort。 |
| 2026-07-26 | 补足 ActiveGenerationHandle 职责边界、validating 先行恢复、candidate 完整状态机、maintenance lease 和三类回滚语义。 |
| 2026-07-26 | 对齐 TD-010：先解析 generation control、所有已发布迁移只在 candidate 执行、cipher 变化走隔离 export，并界定 maintenance connection。 |
| 2026-07-26 | 接受 SQLite/SQLCipher、expo-sqlite、Drizzle、FTS5、单写连接、FULL WAL、迁移与完整性基线。 |

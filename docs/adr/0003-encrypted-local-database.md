# TD-003：加密本地数据库

> Status：`Accepted`  
> Date：2026-07-26  
> Decision owners：客户端数据负责人、安全负责人  
> Scope：P0～P2 移动客户端的关系数据、事务、加密、迁移与本地全文索引  
> Related requirements：PD-002、PD-006、PR-500、DATA-001～002、DATA-110～122、QR-011、QR-020、QR-030～032、QR-070、QR-110～112  
> Related ADRs：[TD-002](0002-offline-first-client-architecture.md)、[TD-004](0004-device-key-hierarchy-and-app-lock.md)、[TD-008](0008-encrypted-local-search.md)、[TD-010](0010-sqlite-snapshot-migration-and-atomic-restore.md)  
> Decision gate：生产构建必须通过编译能力、SQLite/SQLCipher 版本、安全、迁移、崩溃和容量 spike；不允许退回未加密数据库发布

## Context

本地数据库必须同时支持复杂关系、不可变历史、事务、离线全文搜索、可重建投影、P1 同步 outbox 和 50,000/250,000 设计容量。数据包含生活正文、家庭物品、日期、提醒、附件元数据和未来家庭信息，不能以明文数据库或平台默认备份的方式离开 App 控制。

React Native 页面状态和普通键值存储无法提供这些事务/查询能力。字段级加密会破坏索引、约束和迁移，并容易遗漏新字段；只依赖 App 私有目录也不能覆盖设备备份、调试导出或离线文件获取等威胁。与此同时，全库加密并不替代应用锁、附件加密、日志最小化和运行时授权。

## Decision

客户端使用 **SQLite + SQLCipher** 作为关系事实库，通过 `expo-sqlite` 的 CNG 配置在 iOS/Android 构建同一能力，并启用 FTS5。TypeScript 访问层采用 **Drizzle ORM 的 Expo SQLite driver** 处理表定义、类型化常规查询和迁移生成；迁移的权威产物是经过评审并带 checksum 的 SQL，关键事务、FTS、完整性、查询计划和 PRAGMA 可以通过封装后的原生 SQLite API 执行。活动数据库不依赖可覆盖固定路径；Database Manager 必须先按 TD-010 解析受认证 `DatasetControlRecord`，再打开其中唯一的 active generation。

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

- `sqlite_version()`；
- `PRAGMA cipher_version`；
- `PRAGMA compile_options`；
- FTS5、外键、线程和所需 backup/snapshot API 是否存在；
- iOS/Android release 二进制实际链接的库，避免系统 SQLite 与 SQLCipher 混用。

SQLCipher 不受 Expo Go 支持，因此所有数据库测试在 Development Build 或 release build 运行。若当前 `expo-sqlite`/SQLCipher 组合缺少本决定要求的修复或 C API，优先用受控 fork/config/native module 补齐；不能在一端静默改用普通 SQLite。

### 2. 数据库位置与文件集

- 每个 generation 内数据库使用固定内部逻辑名 `database.sqlite`，generation 目录只使用受控不透明 ID，不包含账号、标题、空间名或时间；活动 generation 只由 TD-010 control 解析，不能扫描目录或按 mtime 猜测；
- 放在 Application Support/No Backup 等平台等价私有目录；iOS 设置排除云备份资源属性，Android backup rules 排除主库、`-wal`、`-shm`、附件及密钥相关文件；
- 数据库文件不进入系统文件选择器、分享面板、日志附件或崩溃报告；
- WAL 与 SHM 是数据库持久状态的一部分，普通文件操作不得单独复制、删除或移动；
- 导出、备份和只读恢复必须走 TD-010/TD-011 的一致快照，不暴露活动数据库文件；
- 开发调试数据库只能使用合成数据和调试密钥；生产数据库浏览功能不打入 release 包。

### 3. 打开和解锁顺序

```text
取得受控 no-backup 数据根
→ 从安全存储解封 DatasetControlKey
→ 认证并恢复双槽 DatasetControlRecord
→ 解析唯一 activeGenerationId、activeKeyId 与 cipher profile
→ 解封该 generation 的随机 DB key
→ 构造并验证固定根内 canonical generation 路径
→ 打开 SQLCipher connection
→ 立即设置 raw hex key（不插入口令/用户输入）
→ 执行最小读取验证 key 与文件头
→ 读取 cipher/sqlite/compile 版本并验证 allowlist
→ 设置连接 PRAGMA
→ 检查 activation marker、迁移 ledger、Schema 与完整性状态
→ 若需升级则关闭普通打开并交给 TD-010 candidate migration
→ 开放 Repository
```

约束：

- key 只以固定长度字节/严格 hex 编码短暂进入 native boundary，不组成可记录的普通 SQL 字符串；
- 数据库 key、`PRAGMA key`、完整 connection string 不得出现在日志、错误、analytics 或 crash breadcrumbs；
- 在 key 验证和 Schema gate 完成前，任何业务 Repository 均不可取得 connection；
- control 恢复必须先于普通数据库打开；slot 无效、冲突、引用缺失或 `phase=validating` 时只运行 TD-010 startup recovery，不得退回固定旧路径或创建空库；
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

截至本决定日期，SQLite 官方披露 WAL-reset bug 在 3.51.3 及特定回移版本修复。生产构建必须核验实际版本/补丁：若未包含修复，只能保持单 connection、禁止并发 checkpoint/write，并在升级门替换；不能因发生概率低而忽略数据损坏风险。

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
- 每条用户写命令同时保存必要版本、不可变历史、任务/outbox，提交后再通知 UI；
- 批量迁移/重建分批并可恢复；不得在 JS 主线程构造 250,000 行数组。

### 8. 迁移协议

数据库内对已完成/正在构建 candidate 的迁移证据至少包含：

```text
schema_version
migration_id
checksum
applied_at
app_build
state = applying | applied
```

TD-010 接受后，所有已发布数据的 schema、data 和 cipher 迁移都遵循 `active → encrypted clone/capture → candidate transform → verify/seal → atomic activation`，不得在 active generation 原地执行。迁移规则：

1. 编号只增不改；已发布 migration 内容与 checksum 不得改写；
2. 候选构建前验证 active key、当前版本、剩余空间、内置 migration chain/checksum 和上一 candidate operation 状态；
3. 能单事务完成的 DDL/DML 在 candidate 的一个事务中执行；需要重建表/文件的迁移使用 TD-010 checkpointed shadow 状态和稳定 keyset；
4. 新增列先允许旧写入兼容，再回填/验证，最后在后续版本收紧约束；
5. 删除/改义先双读或复制到新列，经历声明兼容窗口后才物理清除；
6. FTS、今天、缓存、缩略图索引标为可重建，不通过复制旧错误投影完成迁移；
7. 升级失败丢弃或隔离 candidate，保留 active 与无内容诊断，不把半迁移库当空数据；
8. App 遇到更新 Schema 时进入受控“需要更新/只读恢复”状态，不尝试降级写入；
9. SQLCipher major/cipher settings 迁移与业务 Schema 分开演练；先从 active 得到隔离 capture，再以 `sqlcipher_export` 写新 key/settings candidate；`cipher_migrate` 只在明确检测受支持旧格式后作用于可丢弃隔离副本，检查返回值，不能在 active 或每次打开时执行。

已发布版本不承诺原地 downgrade。回滚发布必须使用仍能读取当前 Schema 的前一兼容构建，或先有显式反向迁移/恢复方案。

### 9. 完整性和维护

| 时机 | 检查 |
| --- | --- |
| 正常启动 | Schema/migration 状态、快速 key 读取、必要外键配置。 |
| 上次异常退出/存储 IO 错误后 | `quick_check`、`foreign_key_check` 与任务/文件操作恢复。 |
| 创建备份、完成迁移、恢复预检 | 完整 `integrity_check`、`foreign_key_check`、领域关键不变量和附件 manifest。 |
| 发布候选/自动化 | 完整性、FTS 一致、查询计划、WAL checkpoint、自由页/安全删除测试。 |

检查失败进入完整性保护：停止业务写、保留文件、生成无内容诊断 ID，只在安全读路径通过时提供受控导出。修复不得执行“drop and recreate”或自动下载云副本覆盖本地。

checkpoint、FTS optimize/rebuild、`VACUUM` 和统计分析是持久维护任务：只在供电/前台或合适后台机会、空间充足且没有用户事务时运行；可取消并有进度。`VACUUM` 前预留至少数据库大小加安全余量，不能因清理反而耗尽存储。

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
| 错误 key 或库损坏被误判为空库 | 打开 gate、已知文件存在检查、只读诊断；绝不自动创建同名替代库。 |
| SQLCipher/SQLite 大版本不兼容 | 记录实际版本和 cipher settings；旧格式 fixture、隔离迁移、备份往返和最低客户端门。 |
| WAL-reset/其他上游缺陷 | 构建版本 allowlist、安全公告监测；单 writer/connection；升级后并发崩溃测试。 |
| WAL 无限增长/磁盘耗尽 | 限制长读事务、观测 WAL、空闲 checkpoint、容量预检和 storage UI。 |
| Drizzle 生成破坏性 SQL | 生成物只作候选；只在 candidate generation 执行；人工评审、checksum、旧 fixture 升级和 kill-point 测试。 |
| SQL 注入或敏感查询日志 | 全部绑定参数、列 allowlist、release 禁止 SQL 值日志、静态扫描。 |
| OS 自动备份泄露/复制不一致 | iOS/Android 明确排除规则及安装包测试；只用产品加密备份。 |
| 删除后自由页仍有内容 | secure_delete、受控 VACUUM、密钥销毁和物理取证测试；不作无法验证的瞬时擦除承诺。 |

## Implementation constraints

- 数据库连接只能由 Database Manager 创建，业务模块不能自行 `openDatabase`；
- Dataset Controller 是 active generation 的唯一解析者；Database Manager 不接受业务层路径，也不得在 control 解析前尝试旧固定路径；
- Repository/UnitOfWork 不把 Drizzle/SQLite 类型或原始错误暴露给上层；
- release 构建若 `useSQLCipher`、FTS5、foreign keys 或版本 allowlist 检查失败，启动进入阻断状态，不能降级明文；
- 自动创建新库只允许确认路径不存在且初始化状态机合法；存在但打不开的文件一律保护；
- 数据库文件名、表名、migration 与 compile options 不包含环境密钥或用户内容；
- 任何性能优化先保留 QR-030/031 的耐久语义；改变 `synchronous`、连接数、checkpoint 或 cipher 参数需要新基准和安全评审；
- Web 不复用移动数据库文件；P2 Web 的浏览器存储由 TD-026 决定。

## Verification

### Build and encryption

1. 两个平台 release build 报告允许的 SQLite/SQLCipher 版本和 compile options；
2. 未提供 key、错误 key、普通 SQLite 工具直接打开均不能读出 Schema/正文；正确 key 可通过完整性检查；
3. 二进制/产物确认没有同时链接导致调用错误 SQLite 实现；
4. iOS/Android 系统备份清单不包含 DB/WAL/SHM/附件/密钥；
5. 日志、崩溃和调试包不含 key、SQL 参数或生活文本。

### Reliability and migration

1. 在每个 candidate clone/begin/write/task/migration/commit/seal/control/activation-marker 点 kill，重启后只有旧 active 或 TD-010 已验证的新 active；
2. 从每个已发布 Schema/cipher fixture 升级，checksum、行数、领域不变量和 FTS 一致；
3. 错误 key、截断 DB/WAL、缺失 SHM、磁盘不足、迁移 SQL 失败时原文件保留且不创建空库；
4. 新版 Schema 被旧版打开时只读阻断，不执行 downgrade 写；
5. 外键、CHECK/UNIQUE、secure delete、VACUUM 中断和 checkpoint starvation 有自动测试。

### Capacity and performance

在最低支持与主流设备、接近 QR-020 数据量测量：冷开/解锁、普通写事务、列表、今天、搜索、迁移、完整性检查、全量索引重建、备份快照、WAL 峰值和 24 小时压力。P95 必须满足 QR-010～012；若 FULL/secure_delete 未达标，先优化事务/索引/批次，不得无评审降低耐久或隐私。

## Rollout and rollback

首个公开版本即使用 SQLCipher，不发布“先明文以后加密”的过渡库。首次内部 spike 数据不进入兼容承诺。之后升级 SQLite、SQLCipher、Expo SQLite 或 Drizzle 时，先在旧数据库副本完成读取/迁移/备份/恢复矩阵，再灰度新构建；若升级失败，回滚到能读取当前 Schema/cipher 的上一构建。已迁移 cipher/Schema 不允许通过商店回滚到不兼容二进制。

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
| 2026-07-26 | 对齐 TD-010：先解析 generation control、所有已发布迁移只在 candidate 执行、cipher 变化走隔离 export，并界定 maintenance connection。 |
| 2026-07-26 | 接受 SQLite/SQLCipher、expo-sqlite、Drizzle、FTS5、单写连接、FULL WAL、迁移与完整性基线。 |

# TD-010：SQLite 快照、迁移与原子恢复

> Status：`Accepted`
> Date：2026-07-26
> Decision owners：客户端数据负责人、安全负责人、质量负责人
> Scope：P0～P2 移动端 SQLCipher 一致性快照、数据库/密码格式迁移、备份候选恢复、generation 切换和崩溃回滚
> Related requirements：DATA-002、DATA-020～022、DATA-030～036、DATA-040～052、DATA-110～122、DATA-130～132、QR-003、QR-010、QR-020、QR-030～032、QR-070～072、QR-100～101、QR-110～112
> Related ADRs：[TD-002](0002-offline-first-client-architecture.md)、[TD-003](0003-encrypted-local-database.md)、[TD-004](0004-device-key-hierarchy-and-app-lock.md)、[TD-005](0005-encrypted-attachment-store.md)、[TD-008](0008-encrypted-local-search.md)、[TD-009](0009-native-reminder-scheduler.md)、[TD-011](0011-backup-container-and-cryptography.md)
> Decision gate：目标 release 二进制的 SQLCipher backup/export 能力、双槽文件屏障、全部迁移 fixture、恶意 portable DB、存储不足和每个 activation kill point 在两平台真机通过后，才允许生成可保留备份或执行已发布数据迁移/覆盖恢复

## Context

生活有谱使用 WAL 模式 SQLCipher 保存关系事实，并把附件密文放在独立不可变文件存储。复制正在使用的 `.db` 而漏掉 `-wal`/`-shm` 可能产生旧新页面混合；重命名或替换仍被连接打开的数据库也属于 SQLite 明确警告的损坏路径。数据库事务又不能把附件文件、系统通知和目录切换包含在同一个原子提交中。

三个看似相同的“复制数据库”实际有不同安全要求：迁移回滚检查点要保留当前设备完整状态；用户 `.lifebook` 只能包含可迁移的权威数据，不能带 Installation、设备 key envelope、搜索索引、通知投递或旧自由页；SQLCipher key/cipher settings 变化还不能假定普通 backup API 会完成格式转换。恢复输入即使通过容器认证，也可能来自旧实现、损坏介质或恶意构造，不能直接成为活动数据库。

原子恢复也不能通过两次目录 rename 假装成一个动作。如果进程在“旧目录移走、新目录尚未就位”之间终止，固定路径不存在；如果最新指针损坏后静默选择更旧数据库，又可能丢弃已经在新数据集接受的用户写入。系统必须明确区分候选构建、首次验证、激活和已开放写入，并让启动恢复状态机拥有唯一答案。

本 ADR 决定数据库和本地数据集的技术协议。备份容器密码学由 TD-011、附件字节格式由 TD-005、逻辑恢复范围由[数据生命周期规范](../data-lifecycle.md)、物理表和 portable allowlist 由后续持久化 Schema 文档拥有。

## Decision

数据库不使用固定可覆盖文件作为活动身份，而从受认证双槽 `DatasetControlRecord` 解析一个不可变 generation 路径。每个候选数据库在独立 generation 中完整构建、迁移、校验和封口；切换前关闭全部 SQLite handle/statement，原子写入新的 control slot，首次自检后在 candidate DB 写 durable activation marker，再提交 `phase=active`，最后才向 Repository 开放写入。活动数据库文件从不在打开时 rename、unlink 或覆盖。

建立原生边界内的 `DatabaseMaintenancePort`：

- 相同 SQLCipher 类型、key 和 cipher settings 的活动库捕获使用 SQLite Online Backup API（`sqlite3_backup_*`）；不复制 `.db/-wal/-shm`；
- 更换 SQLCipher key、major format 或 cipher settings 只在可丢弃隔离副本上，以 `sqlcipher_export()` 写入预配置的新加密数据库；旧格式探测后的 `cipher_migrate` 也只能作用于隔离副本；
- 用户备份先得到 current-device-only capture，再从空的 portable schema 按表/列覆盖白名单复制到每备份随机 `SnapshotDataKey` 加密的新 SQLCipher DB；未分类字段直接失败，绝不把完整活动物理库塞进容器；
- 已发布数据库迁移全部在 candidate generation 上执行，不原地改变 active generation；失败只丢弃 candidate；
- 恢复把 portable DB 当不可信只读输入，逐表逐字段复制到当前 schema/current-device key 的新 candidate，并重加密附件；禁止对用户输入直接执行 `sqlcipher_export`、trigger、view 或 extension；
- attachment store 继续使用共享、随机 locator 的不可变密文文件；active generation 以当前数据库 `Attachment` 集合作动态 root，sealed previous/candidate/capture 使用冻结的受认证 manifest，backup/upload 等 operation 使用 lease；GC 只有在全部动态/冻结 root 和 lease 都不引用后才可清理。

“原子恢复”在本项目中的可测试定义是：任一进程/系统崩溃后，启动只能选择旧或新**完整逻辑数据集**，不会把一方数据库和另一方可见附件关系混合。系统通知、搜索索引、缩略图和今天投影是切换后的可重建外部副本，不属于文件系统原子边界。

## Decision details

### 1. 所有权和层次

```text
Application use case
       │
       ▼
DatasetMaintenanceCoordinator
  ├─ DatasetGate / MaintenanceLease
  ├─ MigrationRegistry
  ├─ PortableSnapshotProjector
  ├─ CandidateValidator
  ├─ DeviceStateOverlay
  └─ ProjectionRebuildPlanner
       │
       ▼
DatabaseMaintenancePort (native, no UI/content logging)
  ├─ SQLCipher handles + sqlite3_backup_*
  ├─ sqlcipher_export / cipher probes
  ├─ defensive readonly opener
  ├─ fsync/barrier + atomic move
  └─ authenticated control-slot store
       │
       ├──────── AttachmentFileStore leases/roots
       └──────── KeyManager opaque handles
```

- Domain/feature 不能取得数据库路径、control slot、raw key、migration SQL 或任意文件 API；
- Database Manager 只有在 control recovery、key/cipher gate、Schema/migration gate和完整性 gate 全部通过后才返回 Repository；
- `DatabaseMaintenancePort` 接收受控 generation ID、预登记 profile 和 opaque key handle，不接收来自用户的路径、SQL、表名或 cipher 参数；
- TD-011 只返回已认证 `VerifiedBackupHandle`、portable DB/SnapshotDataKey 句柄和已认证附件流；本 ADR 不解析备份口令或容器 framing；
- 平台通知、文件分享、同步和遥测不在数据库事务内；切换成功后由幂等任务对账。

### 2. Generation 布局与控制记录

逻辑布局如下，物理根目录由平台 adapter 固定且全部排除系统自动备份：

```text
dataset/
  control-a.enc
  control-b.enc
  generations/
    <opaqueGenerationId>/
      database.sqlite
      generation-root.enc
  staging/
    <operationId>/...
  quarantine/...

attachments/
  active/<opaqueLocator>
  staging/<operationId>.part
  quarantine/...
```

- generation ID 是新的 TD-006 EntityId，只用于本机数据集版本，不含账号、空间、时间或内容；
- SQLite 文件没有 hard link/symlink/别名，始终以唯一 canonical path 打开；同一 generation 的 `-wal/-shm` 只与该文件同目录存在；
- attachment locator 全局随机且正文不可变；哪个附件可见只由当前数据库引用决定；
- `generation-root.enc` 是 **sealed generation** 的设备认证加密 locator/root manifest，至少绑定 generation ID、数据库 schema/cipher/key ID、附件 locator + expected ciphertext identity 的排序摘要、createdAt 和保留原因；candidate/capture 封口时生成，active 即将变为 previous 时从同一写 gate 下的当前数据库重新冻结；它不进入用户备份；
- active generation 的 GC root 是当前数据库中 `available` 权威原附件的动态集合，不使用 activation 时冻结的 `generation-root.enc` 判定当前集合；previous rollback、sealed candidate/capture 使用冻结 manifest，backup/upload/restore 使用 operation lease。孤儿清理必须合并所有这些 root；
- `candidateRootDigest` 只认证 activation 时的 candidate 初始附件集合和 sealed root，active 开放写入后不再代表其当前附件集合，也不得据此保留或删除 active 附件；
- staging/quarantine 只允许受控单项路径 API；用户输入不能成为文件名或相对路径。

`DatasetControlRecord` 使用由 TD-004 Key Manager 生成、DWK 包装的独立 256-bit `DatasetControlKey` 认证加密。两个 slot 交替写，明文逻辑结构为：

```text
formatVersion
controlSequence                 -- exact unsigned counter
phase: validating | active
activeGenerationId
previousGenerationId?
operationId
operationKind: initialize | migrate | restore | manual_rollback
targetDatabaseSchemaVersion
targetCipherProfileId
activeKeyId
candidateRootDigest
notificationDatasetEpoch        -- exact unsigned counter; logical dataset replacement fence
activatedAt?
```

`notificationDatasetEpoch` 在初始化时为 `0`，普通 schema/cipher migration 保持不变，整体 restore 和 manual rollback 从**当前 active control** 做 checked `+1`；溢出即阻止操作。它与 candidate 在同一个 validating control slot 原子切换，并纳入 TD-009 request ID、payload 和 action 校验，因此旧数据集已展示通知即使含相同业务 ID 也只能成为 no-op。

写 control 的唯一协议：选择 inactive slot → 写同目录随机 temp → flush 文件 → 平台写屏障 → atomic rename/move 覆盖 slot → 同步父目录 → read-back 解密并比较。Android 必须使用同文件系统 `ATOMIC_MOVE` 且验证结果；不支持时阻止切换，不能回退到 delete-then-move。Apple 使用同文件系统 `rename` 和受控 `F_BARRIERFSYNC`，发布门按目标系统决定是否还要求 `F_FULLFSYNC`。

启动选择 sequence 最高且 AEAD、Schema、路径和 generation root 均合法的记录；相同 sequence 内容不同、两个 slot 都无效、引用目录不存在或 key ID 不可用时进入 integrity-blocked，不扫描目录猜“最新”、不创建空库。

### 3. SQLCipher 复制矩阵

| 场景 | 唯一允许路径 | 目标 key/settings | 禁止 |
| --- | --- | --- | --- |
| 活动一致性 capture / candidate clone | `sqlite3_backup_*`；Expo API 只可经 adapter 调用 | 与 source 相同的 raw DB key 和 cipher settings | 文件 copy、漏 WAL、`VACUUM INTO`、不同 cipher profile backup |
| DB key/cipher settings/major format 变化 | 隔离 capture → 新 target → `sqlcipher_export()` | 新 raw key/明确 target settings | 对 active 原地 `rekey/cipher_migrate`、把 backup API 当格式转换 |
| 用户 portable snapshot | capture → fresh portable DDL → allowlisted rows | 每备份随机 SnapshotDataKey；portable cipher profile | blocklist 删除、复制设备表/自由页、`sqlcipher_export` 整库 |
| 用户 portable restore | defensive readonly reader → fresh current candidate | 接收设备当前/新 DB key 和 current cipher profile | 直接激活输入、对输入 `sqlcipher_export`、执行输入 Schema 对象 |

SQLCipher Online Backup 只有目标 release 实际链接版本明确支持 encrypted-to-encrypted、且同类型/settings 真机合同通过时才可使用。运行时验证 `sqlite_version`、`cipher_version`、`cipher_status`/等价探针、compile options 和 source/destination profile；任一不符阻止操作。Expo 的 `backupDatabaseAsync` 暴露了 Backup API，但没有成为业务事实；需要 stepped progress、取消、key handle 或文件屏障时使用项目薄原生实现。

`sqlcipher_export` 不复制 `user_version` 和 `auto_vacuum`。每次 export 后显式设置目标 application ID、page/cipher profile、`user_version`、schema meta 和 migration ledger，再完整验证。`cipher_migrate` 只有在精确识别受支持旧 SQLCipher profile 后对可删除 capture 执行；失败不得触碰 active。

### 4. 一致性 capture 与附件根

每次 backup、shadow migration、restore rollback checkpoint 先取得全局 `DatasetMaintenanceLease`。同一 installation 只能有一个会创建/激活 generation 的 operation；普通读取可以继续，写入在短 capture/最终切换阶段进入明确 gate。

```text
1. preflight exact free-space budget and key/cipher capabilities
2. acquire maintenance lease and close entry to new domain/task writes
3. drain current SQLite transactions and cross-store attachment bind operations
4. in one short transaction capture:
     activeGenerationId
     dataMutationCounter
     portable/device classification version
     ready authoritative attachment manifest
   and create attachment read/root lease
5. open keyed encrypted destination with identical cipher settings
6. run stepped sqlite3_backup_*; handle BUSY/LOCKED with bounded backoff
7. verify destination dataMutationCounter and generation equal fixed values
8. close/sync destination and release write gate
9. keep attachment lease until the consuming operation finishes or is recovered
10. run capture verification before using it
```

- `dataMutationCounter` 在每个权威领域事务递增；纯技术 lease/checkpoint 不改变它；
- 在同一 gate 内固定的 attachment manifest 只含 capture 中状态为 available 的权威原附件；processing、orphan、缩略图和明文 cache 不进入用户快照；
- TD-005 文件不可变，因此释放写 gate 后可以流式读取相同 locator；GC/purge 必须尊重 lease，即使用户随后删除来源；
- capture 失败、取消或计数不匹配时删除 destination、释放 lease并从头重试，不拼接两次结果；
- 不要求先把 WAL 普通复制/拼接。Backup API 从 SQLite handle 读取一致状态；完成后 destination 必须独立通过关闭/重开检查；
- progress 来自 backup pages 和后续 projector rows，但页数变化只作 UI 估算，不成为完整性证据。

### 5. Portable 数据库投影

用户备份数据库成员是独立的 `portableDataSchemaVersion`，不等同活动 `databaseSchemaVersion`，也不等同 container/manifest version。构建器从空 SQLCipher 文件开始：

1. 用预登记 SnapshotDataKey handle 和固定 portable cipher profile 创建目标；
2. 执行签名 App 内精确 portable DDL；portable schema 不含 trigger、view、FTS/virtual table 或任意扩展；
3. 从只读 capture 按生成的 `table.column` allowlist、稳定主键顺序和 prepared statements 分批复制；
4. 应用明确的 portable transform：移除 Installation/Device session/key envelope/storage locator/platform delivery/诊断/搜索/缓存/缩略图，清除 `thumbnailAttachmentId`，保留 DATA-020/033 所需业务和同步安全状态；
5. 将每个原附件逻辑 ID 映射为 TD-011 member ID，不保存设备 FileDataKey、ARK envelope、路径或 locator；
6. 写 snapshot ID、source dataMutationCounter、scalar/time/rule/schema version 和分类覆盖版本；
7. 验证行数、引用、领域不变量、成员映射与 schema fingerprint；
8. `journal_mode=DELETE`、FULL sync、关闭并重开验证，确保没有必要 WAL/SHM；
9. 只把已验证 portable DB 和 opaque SnapshotDataKey handle 交给 TD-011。

分类采用覆盖式 allowlist：每张生产表、每个 column 和每个 JSON 字段都必须声明 `portable_required | portable_optional | device_only | derived | diagnostic | forbidden`。Schema 增加未分类项、allowlist 与迁移 checksum 不一致或 projector 未消费必需字段时，备份失败并阻止 release；不得用“删除已知敏感表”的 blocklist。

portable DB 即使外层还会 AEAD 加密，本身仍使用独立 SQLCipher key，以保证私有 staging、进程重启清理和容器成员抽取不会产生明文 SQLite。SnapshotDataKey 只以 native handle 交给 TD-011 key slot 包装，不回到 JS、不复用设备 DatabaseDataKey。

### 6. Migration artifact 与 candidate 状态机

所有公开数据迁移随签名 App 打包，不从网络下载。每项 artifact 至少声明：

```text
migrationId
fromDatabaseSchemaVersion / toDatabaseSchemaVersion
kind: schema | data | cipher | attachment_format | projection_reset
execution: transaction | checkpointed_shadow | sqlcipher_export
requiredCapabilities
estimatedSpaceFormula
sqlDigest
transformCodeDigest
manifestDigest
portableClassificationVersion
verificationSuiteId
minimumReaderVersion / rollbackReaderVersion
```

checksum 覆盖 SQL、manifest、受控转换代码/fixture identity；发布后不能修改或复用 ID。数据库内 migration ledger 保存实际 checksum、app build、started/completed marker 和结果；`PRAGMA user_version` 仅作快速提示并必须与权威 schema meta 一致，不能单独决定迁移。

已发布数据不原地升级，统一状态机为：

```text
resolved_active
→ preflighted
→ cloned
→ transforming(migrationId, phase, lastStableKey)
→ verified
→ sealed
→ validating_active
→ active
→ cleanup_pending
```

- clone 使用同 key/settings encrypted backup；active generation 保持只读完整；
- 小迁移可在 candidate 的一个 `BEGIN IMMEDIATE` 事务完成；
- 大迁移使用 shadow table + 稳定主键 keyset 分批，batch 数据和 `phase/lastStableKey` 在同一事务提交；不用 `OFFSET`、wall clock 或进程内数组作进度；
- 最终 rename table/index 和 ledger 完成在短事务；所有 statement finalized；
- 默认保持 foreign keys 开启。若 SQLite 官方 12-step table rebuild 确需关闭，只能在 candidate 专用 connection、事务开始前关闭；完成前 `foreign_key_check` 必须零行并重新开启；
- 禁止 `PRAGMA writable_schema`、运行不可信 SQL、修改已发布 migration 和靠 ORM 自动推断 destructive change；
- candidate 任一错误可以删除后从 active 重建；不得把“部分迁移可打开”当成功；
- app 遇到更高 schema 时阻止写入并要求升级；不执行 down migration。

### 7. Cipher/key 迁移

改变 DatabaseDataKey、SQLCipher major defaults、page size、KDF/HMAC/cipher settings 属于独立高风险 migration：

1. 用旧 profile/key 只读验证 active 并 capture；
2. 在隔离目录以新 key/profile 创建空 candidate；
3. 通过 `sqlcipher_export` 从受信 capture 导出；
4. 显式恢复 application ID、user_version、auto_vacuum 和 migration/schema meta；
5. 运行 cipher/integrity/schema/domain 全套验证；
6. 按 generation activation 协议切换；
7. 旧 key envelope 与 previous generation 一起保留到回滚窗口结束，随后由 Key Manager 销毁。

不能在 active 上调用 `PRAGMA rekey` 或每次启动盲跑 `cipher_migrate`。目标 profile 只有编译 allowlist 中精确组合；失败不回退明文、旧弱 profile 或运行时默认。

### 8. 不可信 portable 恢复

TD-011 完成 header/KDF/AEAD/manifest/成员边界认证后，portable SQLCipher 仍按不可信数据库处理。原生 reader：

- 先把外部 provider 内容稳定到 App 私有加密 staging，不长期依赖外部 URI；
- 使用 `READONLY`、`NOFOLLOW`/平台等价防 symlink，固定 canonical path；
- 在执行任何来自该 handle 的 Schema/业务 SQL 前，通过 C API 设置 `SQLITE_DBCONFIG_DEFENSIVE=1`、`SQLITE_DBCONFIG_ENABLE_TRIGGER=0`、`SQLITE_DBCONFIG_ENABLE_VIEW=0`，并设置 `trusted_schema=OFF`、`query_only=ON`、`mmap_size=0`、`cell_size_check=ON`；任一能力缺失或设置 read-back 不符即拒绝输入；
- 禁止 load extension 和 virtual table；以 `sqlite3_limit(..., SQLITE_LIMIT_ATTACHED, 0)` 及 authorizer 拒绝 `ATTACH/DETACH`，并收紧 length、SQL、column、expression depth、compound select、page/count 等 SQLite limits；
- 完成上述隔离后，先验证 cipher 和 `integrity_check`，再验证 application ID、portable schema fingerprint、精确表/列/index 集合和所有版本，最后才查询业务行；
- 只用预编译 allowlist `SELECT` 按 keyset 读取，逐行做 TD-006 scalar、enum、长度、引用和资源验证；
- 不对输入调用 backup API、`sqlcipher_export`、migration SQL 或写操作。

恢复构建流程：

```text
verified portable reader
→ create fresh current-schema candidate with current-device DB key/profile
→ copy and transform allowlisted fields through prepared statements
→ merge DeviceStateOverlay field by field
→ stream authenticated backup attachments through TD-005 re-encryption
→ promote new immutable locators under candidate root lease
→ write restore/sync safety gates and projection rebuild tasks
→ verify candidate and attachment roots
→ produce non-content preview
→ fresh auth + explicit overwrite confirmation
→ bind expected current generation/counter and activate
```

旧 portable version 由专用只读 mapper 转成当前 candidate，不在输入文件上原地迁移。未知必需 feature/enum/field 安全失败；未知声明为可忽略的扩展仍由 TD-011 完整认证后才可丢弃。

`DeviceStateOverlay` 逐字段拥有恢复策略：保留当前 Installation、数据库/附件/control keys、应用锁能力、系统权限、通知 channel/平台 ID、账号 session/token、BYOK、遥测/法律同意的当前设备要求；只恢复明确分类为 portable 的用户内容偏好。物理 Schema 必须拆分或声明每列 policy，不能对混合 AppPreferences 做整行覆盖。

### 9. 原子 activation 协议

候选完成验证后执行：

```text
1. bind authorization to:
     expectedActiveGenerationId + expectedDataMutationCounter
     + current/targetNotificationDatasetEpoch
     + candidateGenerationId + candidateRootDigest
2. fresh auth and user confirmation (restore/manual rollback)
3. acquire exclusive DatasetGate; pause sync, reminder writes and cleanup
4. re-read active generation/counter; mismatch => release and re-preview/re-authorize
5. persist old active attachment root as retained previous root
6. drain and close every DB connection, statement, cursor and attachment stream
7. seal old and candidate DB: checkpoint/truncate, DELETE journal, FULL sync, close
8. write control sequence N+1:
     activeGeneration=candidate, previous=old, phase=validating,
     notificationDatasetEpoch=target epoch
9. reopen only candidate; run first-open self-test
10. in candidate DELETE/FULL transaction write durable activation marker
    binding operationId, generationId and candidateRootDigest; close/read back
11. write control sequence N+2 with phase=active and activatedAt
12. reopen candidate under normal WAL/FULL policy
13. only now open Repository and accept business writes
14. enqueue projection rebuild, notification force-reconcile, cleanup and cold-start check
```

restore/manual rollback 的 target notification epoch 必须由步骤 4 重新读取的当前 control 做 checked increment；migration 保持 epoch。通知 response 只有在其 payload epoch 等于当前 active control 且 request ID 按该 epoch 重算一致时才可进入业务 action inbox。旧 epoch 的 pending/delivered 清理是隐私和容量收敛，不是安全正确性的前提。

任何 SQLite 文件只在所有 handle 已关闭后变更 journal/清理 auxiliary file；不重命名活动数据库。activation marker 是防静默回滚边界：

- `phase=validating` 且 candidate 无 marker：startup 自检失败可写更高 sequence 回到 previous；
- `phase=validating` 且 candidate 有匹配 marker：完成 `phase=active`，不能回滚；
- `phase=active` 后即使 control 最新 slot 或数据库随后损坏，也不得自动启用 previous，因为 candidate 可能已经接受新写入；进入 integrity-blocked；
- 两个 control slot 都失效/冲突时不得按目录 mtime、文件名或 user_version 猜测；保留所有 generation 等待受控恢复。

旧/new slot、marker、root 和 journal 每个 transition 都幂等。启动恢复先于普通数据库打开、migration、通知、同步和 UI hydration。

### 10. Previous generation 与手动回滚

成功 restore/migration 后 previous generation 及其 attachment root 使用当前设备加密保留。清理条件同时满足：

- 从 `activatedAt` 起已满 7 个绝对 24 小时；检测到系统时钟异常时只延后、不提前；
- 至少完成一次之后的冷启动自检；
- 当前 active 已通过完整 gate；
- 没有 backup/upload/restore/manual rollback lease；
- 用户未选择立即删除检查点。

previous 不是可直接再次激活的 mutable 数据库。用户手动回滚必须显示将丢弃的激活后变化、建议先备份、fresh auth、暂停同步，再把 previous 当只读源复制/迁移为**新的** candidate generation，走同一预览与 activation 协议。已登录数据集还必须遵守 snapshotGeneration/provenance gate；不能把旧 outbox 自动发送或复活服务端墓碑。

自动回滚只允许在 candidate 尚未开放 Repository 写入的 validating 阶段。active 后故障、七日内用户回滚和商店二进制回滚不是同一概念。

### 11. Candidate 验证顺序

所有 capture/portable/candidate 根据 profile 运行适用子集，顺序固定：

1. key 可用，`cipher_status`/等价结果正确，cipher/sqlite/profile 在 allowlist；
2. `cipher_integrity_check` 零错误；
3. `PRAGMA integrity_check` 唯一结果为 `ok`；
4. `PRAGMA foreign_key_check` 零行，foreign_keys 实际开启；
5. application ID、database/portable schema version、migration checksum、Schema fingerprint 精确匹配；
6. table/column/JSON portable 分类覆盖完整；
7. 五种 Record/detail 一一对应、Occurrence、Checklist、库存账本、回收站、同步 generation、提醒等领域不变量通过；
8. attachment ID/member/locator、状态、大小和 hash/root 全部一致；
9. 未知 enum、版本和必需 feature 安全失败；
10. 可重建 search/today/thumbnail/platform delivery 不被误当权威或 portable 成员；
11. 关闭、同步、重新打开，再运行 quick/full profile 必需检查；
12. seal 后没有 hot/未处理 WAL、SHM 或 journal。

检查器使用流式/keyset 查询和 exact integer，不把 250,000 行载入 JS。错误只返回 stage、稳定 code、受影响实体类型/随机短 ID 和计数；不记录 SQL row、标题、路径、key 或用户内容。

### 12. 资源、取消和并发

- 预检公式覆盖 source DB、capture、candidate/portable、最大 WAL、SQLCipher/VACUUM/export 临时空间、待重加密附件、外层容器和安全余量；所有加法/乘法使用 TD-006 exact integer 并做 overflow 检查；
- 任何写中空间检查仍可返回 FULL；不得因预检通过就忽略中途错误；
- migration/restore final activation 不可由普通返回手势中断；之前的 capture/project/copy 可以在 batch 边界取消，取消只清 candidate；
- 进程终止后是否续跑由加密 operation journal、key handle 可恢复性和 profile 决定；无法安全恢复 key 的 partial 从头重建，不能把不完整文件续成成品；
- 同一时间只有一个 dataset maintenance writer；备份可与普通读取并存，短 capture 时写 gate；restore/migration activation 排斥所有 write/sync/GC；
- 后台时间到期时在安全 checkpoint 停止，不持有半开的 JS transaction 或 raw key；
- 资源不足时 active 不变，显示所需/可用区间和管理入口，不自动删除回收站或附件。

### 13. 切换后的收敛

activation transaction/candidate 预先写入幂等 rebuild tasks。Repository 开放后按依赖执行：

1. 校验当前 DeviceStateOverlay 和 sync restore gate；
2. 重建 Search A/B index、今天/统计 projection；
3. 重建缺失缩略图；
4. TD-009 推进 environment generation，定向清理旧 notification managed IDs 并从未来计划强制重挂，不补发过去提醒；
5. 恢复允许的 sync，先验证 Account/Space/membership/snapshotGeneration；
6. 完成一次冷启动自检后记录 rollback retention evidence；
7. GC 只清无 root 的 candidate/capture/attachment orphan。

projection 失败不自动回滚已验证业务数据；显示局部重建状态并重试。若业务权威自检失败且尚未写 activation marker，可自动回旧 generation；marker/active 后按完整性保护处理，避免丢新写入。

## Alternatives considered

### 1. 直接复制 `.db` 文件

WAL 中可能存在已提交内容，单文件 copy 会遗漏；复制三件套也难在活动事务中取得同一时点，并可能破坏锁。拒绝。

### 2. 只使用 `VACUUM INTO`

SQLite 可产生一致、紧凑副本，但 SQLCipher 目标 key/settings、取消/进度和 wrapper 行为不满足统一合同；输入路径还是 SQL 表达式，增加边界。P0 固定 Backup API + projector/export，`VACUUM INTO` 不进入生产快照协议。

### 3. 所有场景都使用 Online Backup API

它适合同类型 encrypted-to-encrypted capture，不拥有 key/settings 转换或 portable 字段剔除语义。会复制设备/派生表与自由页。拒绝。

### 4. 对活动库原地 migration/rekey

SQLite 事务能保护部分 DDL，但无法覆盖 cipher、长批次、附件和逻辑验证错误；成功后也失去旧数据回退点。选择 candidate generation。

### 5. `active → old`、`candidate → active` 两次 rename

两次文件系统动作之间存在缺口，恢复逻辑更难；还可能 rename 打开的 SQLite。选择稳定 generation path + 单个双槽 control commit。

### 6. symlink/hard link 指向当前 DB

SQLite 官方警告同文件多名、link 与 WAL/锁可能导致未定义行为；移动平台 API/备份也更复杂。拒绝。

### 7. 最新 control 损坏时总是选 previous

新 generation 可能已经接受写入，静默回退会造成不可见数据丢失。用 validating marker 完成/回滚边界；active 后损坏阻断而不猜。

### 8. 认证过的 portable DB 直接替换 active

容器认证不等于 Schema/SQLite parser 安全，也会带旧 cipher、设备状态和旧 schema。选择 defensive reader + fresh candidate copy。

### 9. 逐条把备份合入当前库

这不是 DATA-040 的整体恢复，会产生去重、引用和半成功语义。P1 通用导入另有独立计划；P0 只整体候选切换。

## Consequences

正面结果：

- active 文件从不被原地迁移/覆盖，迁移和恢复失败天然保留旧事实；
- WAL、SQLCipher key/settings、portable 数据最小化分别走合适的官方机制；
- 双槽 control + activation marker 消除“指针损坏就回旧库”的静默数据丢失；
- 附件不可变存储和多 root lease 把 DB/文件不具备跨系统事务的事实显式化；
- portable allowlist 对未来新增字段默认安全失败；
- 同一 candidate/validator/activation 协议可复用于 migration、restore 和手动 rollback。

成本和长期负担：

- 至少需要一个受审原生 maintenance/control 模块和跨平台文件屏障实现；
- migration/restore 需要额外约一份或多份数据库空间，低存储设备可能必须先清理空间；
- 每个 Schema 字段都要维护 portable 分类、旧 reader、fixture 和 migration checksum；
- previous generation/root 在 activation 后满 7×24 小时且完成一次后续冷启动自检时取得自动删除资格；若自检尚未完成可超过 7 天，会暂时增加占用；
- 完整恢复前后需要多轮校验，最大数据集耗时明显，必须有进度/取消边界；
- 系统通知等外部副本只能最终一致，不能纳入原子切换营销承诺。

## Risks and mitigations

| 风险 | 缓解 |
| --- | --- |
| 漏 WAL/复制活动文件造成损坏 | 只走 keyed SQLite Backup API；禁止普通文件 copy；关闭/重开验证。 |
| Backup API 与实际 SQLCipher build 不兼容 | release runtime probe、encrypted fixture、source/destination profile 比较；失败阻止功能。 |
| 换 key/settings 后不可读 | 只在 capture 上 sqlcipher_export；显式恢复 user_version/auto_vacuum；旧 active 保留。 |
| 新字段泄露到用户备份 | 覆盖式 table/column/JSON 分类；未知项阻止构建和备份。 |
| control slot torn/corrupt | AEAD 双槽、sequence、屏障、read-back；两个都无效时阻断不猜。 |
| 自动回旧 generation 丢新写入 | activation marker 后只能完成 active；Repository 在 active control 后才开放。 |
| GC 删除备份/回滚所需附件 | active DB 动态 root + sealed previous/candidate/capture manifest + backup/upload/restore lease；expected identity 和安全年龄。 |
| 恶意 SQLite 利用 Schema/parser | readonly NOFOLLOW、defensive/trusted_schema off、C API 禁 trigger/view/ATTACH、严格 limits/schema fingerprint、逐字段复制。 |
| 迁移中磁盘满 | exact 预检 + 写中处理；candidate 可删、active 不变；不自动删权威数据。 |
| 大迁移无限/重复 | keyset progress 与 batch 同事务；checksum/phase；从 candidate 重启安全。 |
| manual rollback 丢激活后内容 | 影响预览、建议先备份、fresh auth、同步 gate、新 candidate；不直接改 pointer。 |
| 时间回拨提前清 checkpoint | REC 时间异常只延后自动 GC；至少一次冷启动证据；用户删除需明确确认。 |
| 旧通知动作作用于新数据集 | restore/rollback 原子递增 `notificationDatasetEpoch`；TD-009 request ID/payload/current-control 校验；旧 epoch 永久 no-op，切换后再强制对账。 |

## Implementation constraints

- 只有 Key Manager/DatabaseMaintenance native boundary 能取得 DB/Snapshot/Control raw key；JS 只见 opaque handle；
- 只有 Dataset Controller 能解析/写 control、创建 generation 或开放 Repository；
- 活动数据库打开期间禁止 rename、unlink、file copy、hard link、symlink 和普通文件读取探测；
- 所有 generation/control/capture/candidate/root/key envelope/WAL/SHM/journal 明确排除 iOS/Android 自动备份，构建产物验证；
- 不使用任意路径：generation/operation/locator 必须先严格解析为受控 ID，再在固定根内 canonicalize 和 NOFOLLOW；
- SQLCipher/SQLite/Expo API 版本和 compile option 精确锁定；backup/export/defensive/limits/cipher integrity 缺一项即阻止对应能力；
- migration SQL 只从签名 bundle 按 ID/checksum 读取；网络、remote config 和 backup 文件不能提供 SQL；
- active schema、portable schema、container、manifest、scalar、time/recurrence、attachment 和 cipher profile 各自版本化，不复用一个“版本号”；
- portable projector 的 allowlist 由持久化 Schema 生成并 code review；业务代码不得临时加 `SELECT *`；
- 所有 copy/validation keyset 有稳定 ID tie-break，不使用 OFFSET/locale/rowid（除非 rowid 是该技术表明确身份）；
- 物理表、index、projection、restore policy 和 invariants 的可执行清单由 `persistence-schema.md`/specs 唯一维护；本 ADR 不复制最终 DDL；
- release 构建不得包含任意数据库导入、生产 DevTools inspector、执行用户 SQL 或“忽略完整性继续”开关；
- error/metrics 只包含 operation ID、stage、版本、大小分桶、耗时和稳定 code，不含 key/path/SQL/value/标题/附件名；
- 任何降低 fsync/FULL、移除 previous、允许 in-place migration 或扩大 portable 内容的优化需新 ADR/安全与耐久评审。

## Verification

### 1. 快照和密码格式

- 未 checkpoint 的 WAL committed 写必须出现在 capture，未提交写不得出现；source 在每个 backup step 前后改变时结果仍为单一 counter；
- 两平台 release SQLCipher encrypted→encrypted backup 合同；错误 key、不同 settings、缺能力都拒绝；
- source/capture byte/key independence 按 profile验证，普通 SQLite 工具不可读取；
- `sqlcipher_export` 的 old→new key/settings/major fixture，显式 user_version/auto_vacuum/schema meta 验证；
- source/capture/candidate 截断、bit flip、WAL/SHM 不配对和 IOERR/FULL/BUSY/LOCKED；
- capture/project 任一 kill 后 active 字节和可见数据不变，orphan 可回收。

### 2. Migration

- 每个公开 schema/cipher fixture 跑完整迁移链、逐步链和备份→恢复→再迁移往返；
- SQL/transform/manifest checksum 任一改变阻止已应用库；缺 migration、重复 ID、分叉和未来版本阻断；
- 每个 batch、progress write、shadow table swap、ledger commit、export 和 seal 前后 kill；结果只能 active old 或 verified new；
- SQLite 官方 12-step table rebuild、FK 开/关、constraint/index/trigger 名称、未知 enum、极限 scalar；
- 迁移完成的行数、五类 detail、库存 ledger、Occurrence、回收站、同步 generation、提醒和附件 invariants 100% 通过；
- 50,000 根记录/250,000 子对象/设计 DB 大小低端真机耗时、空间峰值、进度和取消符合 QR。

### 3. Control 和 activation

- control temp write、file sync、barrier、atomic move、parent sync、read-back 每点 kill/IO error；
- 最新 slot 截断/tag 错而另一 slot valid；相同 sequence 冲突；两个 slot 坏；未知 generation/path traversal/symlink；
- validating 前 crash、pointer 后 marker 前 crash、marker 后 active control 前 crash、active control 后 Repository 前 crash；
- active 后完成一笔新业务写，再破坏最新 slot/DB，证明不会自动回 previous；
- Android 目标文件系统实际支持/验证 `ATOMIC_MOVE`，Apple barrier/full sync 行为真机掉电/强杀测试；
- 切换时仍有 statement/cursor/connection/attachment stream 必须被 gate 阻止，不强行 rename open file。

### 4. 恢复与恶意输入

- portable schema 多/少表列、duplicate/错误类型、trigger/view/virtual table、超长值、深 JSON、巨大 page/count、恶意 record ID 和引用环；
- `trusted_schema=OFF`、DEFENSIVE、`ENABLE_TRIGGER=0`、`ENABLE_VIEW=0`、`SQLITE_LIMIT_ATTACHED=0`、authorizer、NOFOLLOW、extension disabled 和其余 SQLite limits 在 release 二进制实测；
- Installation、keys、app lock、permission、session、BYOK、telemetry consent 不被备份覆盖；portable 偏好按字段恢复；
- 10,000 附件/5 GiB root、缺失/损坏附件、restore re-encryption 任一点 kill、locator collision 和 GC lease；
- preview 后当前 generation/counter 改变会要求重新确认，不能覆盖未预览变化；
- switch 前所有失败当前 active 不变；validating 自检失败回旧；marker 后失败阻断/完成而不静默回旧；
- 恢复/手动回滚 activation 前后构造旧 epoch delivered response，证明同业务 ID 也永久 no-op；migration 保持 epoch 且现有请求可按 fingerprint 收敛；
- 恢复后 search/today/thumbnail 重建、TD-009 通知定向清理和强制重挂、过去提醒不补发、sync provenance/generation gate。

### 5. 安全和产物

- 解包 release 验证 no-backup、无数据库 inspector/任意 SQL、单 SQLCipher link、版本/compile allowlist；
- 日志、崩溃、诊断、heap snapshot 和控制文件不含 raw key、用户内容、原路径或 portable row；
- portable DB 解密后的 table/column 实际集合与分类清单逐项比对，free page 不含 device-only/derived 内容；
- independent security review 覆盖 key handle、control AEAD、TOCTOU/path、untrusted SQLite、migration supply chain 和 rollback data loss；
- 官方 SQLite/SQLCipher/Expo 版本升级前重跑全部合同、故障注入与历史 fixture。

## Rollout and rollback

首个包含真实用户数据的构建即初始化 generation/control 双槽，不先发布固定 `main.db` 再在线搬迁。已有内部开发数据库通过一次性、可丢弃 importer 进入 generation；不形成公开兼容承诺。

首次公开 schema 为基线 migration 0。以后每个 App 在发布前声明可读 schema 区间和最大可写 schema；商店回滚只能回到仍能读取当前 active schema/cipher/control 的兼容构建。不得通过旧二进制原地 down migration。若新 migration 尚未 activation，删除 candidate 并继续旧 active；若已经 active 且开放写入，修复通过新的 forward migration 或用户明确 previous rollback，不能静默回指旧库。

control format 升级采用双读旧/新、只写新和两个发布兼容窗口；candidate/portable schema、cipher profile 和 projection task 各自前向演进。若 maintenance native 模块出现可靠性问题，禁用新 backup/migration/restore activation，普通已验证 active 数据仍可读写；安全风险需要时进入只读保护，不能改用文件 copy。

previous generation 默认按 DATA-044 保留并允许用户提前清理。清理后无法用它回滚，但不影响用户持有 `.lifebook`。任何清理都不删除外部备份、当前 active 或仍有 root/lease 的附件。

## References

- [SQLite：Online Backup API](https://www.sqlite.org/backup.html)
- [SQLite：How To Corrupt A Database](https://www.sqlite.org/howtocorrupt.html)
- [SQLite：ALTER TABLE 与 12-step rebuild](https://www.sqlite.org/lang_altertable.html)
- [SQLite：PRAGMA integrity、foreign key 与 user_version](https://www.sqlite.org/pragma.html)
- [SQLite：Defense Against The Dark Arts](https://www.sqlite.org/security.html)
- [SQLCipher API：key、export、migrate 与 integrity](https://www.zetetic.net/sqlcipher/sqlcipher-api/)
- [SQLCipher changelog](https://github.com/sqlcipher/sqlcipher/blob/master/CHANGELOG.md)
- [Expo SQLite：backupDatabaseAsync 与 SQLCipher 配置](https://docs.expo.dev/versions/latest/sdk/sqlite/)
- [Apple rename(2)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/rename.2.html)
- [Apple：Reducing disk writes / filesystem barriers](https://developer.apple.com/documentation/xcode/reducing-disk-writes)
- [Android：StandardCopyOption.ATOMIC_MOVE](https://developer.android.com/reference/java/nio/file/StandardCopyOption)
- [Android：FileDescriptor.sync](https://developer.android.com/reference/java/io/FileDescriptor)

平台和库能力会变化。每次升级必须以 release 二进制 runtime probe、历史 SQLCipher fixture 和真机文件系统故障测试重新核验；本 ADR 固定的是分层、不可原地破坏和恢复边界，不把某版本 wrapper 行为当永久保证。

## Revision notes

| 日期 | 说明 |
| --- | --- |
| 2026-07-26 | 区分 active 动态附件 root 与 sealed manifest；增加通知数据集 epoch；显式禁用不可信 SQLite trigger/view/ATTACH；统一回滚检查点自动删除资格。 |
| 2026-07-26 | 接受 SQLCipher capture/export/portable 三路径、candidate-only migration、双槽 generation control、activation marker、不可信 portable reader 和多 root 附件协议。 |

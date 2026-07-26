# TD-010：SQLite 快照、迁移与原子恢复

> Status：`Accepted`
> Date：2026-07-26
> Decision owners：客户端数据负责人、安全负责人、质量负责人
> Scope：P0～P2 移动端首次数据集初始化、SQLCipher 一致性快照、数据库/密码格式迁移、备份候选恢复、generation 切换和崩溃回滚
> Related requirements：DATA-001～002、DATA-020～022、DATA-030～036、DATA-040～052、DATA-090～092、DATA-110～122、DATA-130～132、QR-003、QR-010、QR-020、QR-030～032、QR-070～072、QR-100～101、QR-110～112
> Related ADRs：[TD-002](0002-offline-first-client-architecture.md)、[TD-003](0003-encrypted-local-database.md)、[TD-004](0004-device-key-hierarchy-and-app-lock.md)、[TD-005](0005-encrypted-attachment-store.md)、[TD-008](0008-encrypted-local-search.md)、[TD-009](0009-native-reminder-scheduler.md)、[TD-011](0011-backup-container-and-cryptography.md)
> Decision gate：目标 release 二进制的首次 bootstrap/control 双槽、SQLCipher backup/export 能力、文件屏障、全部迁移 fixture、恶意 portable DB、存储不足和每个 initialize/activation kill point 在两平台真机通过后，才允许保存真实用户数据、生成可保留备份或执行已发布数据迁移/覆盖恢复

## Context

生活有谱使用 WAL 模式 SQLCipher 保存关系事实，并把附件密文放在独立不可变文件存储。复制正在使用的 `.db` 而漏掉 `-wal`/`-shm` 可能产生旧新页面混合；重命名或替换仍被连接打开的数据库也属于 SQLite 明确警告的损坏路径。数据库事务又不能把附件文件、系统通知和目录切换包含在同一个原子提交中。

三个看似相同的“复制数据库”实际有不同安全要求：迁移回滚检查点要保留当前设备完整状态；用户 `.lifebook` 只能包含可迁移的权威数据，不能带 Installation、设备 key envelope、搜索索引、通知投递或旧自由页；SQLCipher key/cipher settings 变化还不能假定普通 backup API 会完成格式转换。恢复输入即使通过容器认证，也可能来自旧实现、损坏介质或恶意构造，不能直接成为活动数据库。

原子恢复也不能通过两次目录 rename 假装成一个动作。如果进程在“旧目录移走、新目录尚未就位”之间终止，固定路径不存在；如果最新指针损坏后静默选择更旧数据库，又可能丢弃已经在新数据集接受的用户写入。系统必须明确区分候选构建、首次验证、激活和已开放写入，并让启动恢复状态机拥有唯一答案。

首次安装同样不能因“路径不存在”就让数据库层随手创建空库；否则 control、key 或数据损坏会被误报为新安装并静默丢失。空数据集必须有独立 bootstrap anchor、typed empty evidence、activation marker/open receipt 和逐写点崩溃恢复，且清除本机与卸载重装要明确区分 Installation 身份。

本 ADR 决定数据库和本地数据集的技术协议。备份容器密码学由 TD-011、附件字节格式由 TD-005、逻辑恢复范围由[数据生命周期规范](../data-lifecycle.md)、物理表和 portable allowlist 由后续持久化 Schema 文档拥有。

## Decision

数据库不使用固定可覆盖文件作为活动身份，而从受认证双槽 `DatasetControlRecord` 解析一个不可变 generation 路径。每个候选数据库在独立 generation 中完整构建、迁移、校验和封口；切换前关闭全部 SQLite handle/statement，原子写入新的 control slot，首次自检后在 candidate DB 写 durable activation marker，再提交 `phase=active`，最后才向 Repository 开放写入。活动数据库文件从不在打开时 rename、unlink 或覆盖。

真正首次安装先由 TD-004 原生 bootstrap anchor 证明严格 all-absent，再以 `EmptyCandidateEvidence` 和 `operationKind=initialize` 走同一 activation 骨架；存在但非法的 control/record/artifact 永不降级成 fresh。initialize、migrate、restore、manual rollback 使用互不替代的 evidence 与授权。

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
- Database Manager 只有在 bootstrap/clearing、control recovery、key/cipher、Schema/migration、operation marker/open receipt 与 active-anchor 完整性 gate 全部通过后才返回可接受业务写的 Repository；activation-recovery handle 不得泄露为普通 Repository；
- `DatabaseMaintenancePort` 接收受控 generation ID、预登记 profile 和 opaque key handle，不接收来自用户的路径、SQL、表名或 cipher 参数；
- TD-011 pass 1 首次只返回已认证 `VerifiedBackupHandle`；portable DB/附件流与 `SnapshotDataKeyHandle` 只能从该 handle 开启的一次性 second-pass import session 取得，不能作为独立可复用返回值；本 ADR 不解析备份口令或容器 framing；
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
- `generation-root.enc` 是 **sealed generation** 的设备认证加密 locator/root manifest，至少绑定 generation ID、数据库 schema/cipher/key ID、权威原附件 locator + TD-005 `CiphertextIdentity` 的排序摘要、createdAt 和保留原因；candidate/capture 封口时生成，active 即将变为 previous 时从同一写 gate 下的当前数据库重新冻结；派生缩略图不作为 sealed generation 必需 root，封口时清空其引用并写重建任务；该 manifest 不进入用户备份；
- active generation 的 GC root 是当前数据库中所有仍需保留字节的 locator-bearing `Attachment` 行动态集合，包含权威原附件和仍被引用的派生缩略图；不使用 activation 时冻结的 `generation-root.enc` 判定当前集合。previous rollback、sealed candidate/capture 使用冻结 manifest，backup/upload/restore 使用 operation lease；孤儿清理必须合并所有这些 root；
- `candidateRootDigest` 只认证 activation 时 candidate 的初始权威原附件集合和 sealed root，active 开放写入后不再代表其当前附件集合，也不得据此保留或删除 active 附件；
- staging/quarantine 只允许受控单项路径 API；用户输入不能成为文件名或相对路径。

`DatasetControlRecord` 使用由 TD-004 Key Manager 生成、DWK 包装的独立 256-bit `DatasetControlKey` 认证加密。两个 slot 交替写，明文逻辑结构为：

```text
formatVersion
installationId
installationIncarnationId       -- fresh install/reinstall/clear-created data realm fence
controlSequence                 -- TD-006 LongCounter
phase: validating | active
activeGenerationId
previousGenerationId?
operationId
operationKind: initialize | migrate | restore | manual_rollback | activation_abort
abortedOperationId?             -- required only for internal activation_abort
targetDatabaseSchemaVersion
targetCipherProfileId
activeKeyId
candidateRootDigest
notificationDatasetEpoch        -- TD-006 LongCounter; logical dataset replacement fence
activatedAt?
```

`controlSequence`、活动库 `dataMutationCounter`、`notificationDatasetEpoch` 和 TD-004 `bootstrapSequence` 全部使用 TD-006 `LongCounter` 范围 `0...9223372036854775807`，规范十进制/精确整数 adapter，绝不使用无上限 unsigned、JavaScript `number` 或 UInt64 回绕。每次递增都先 checked `+1`，但不同 counter 的耗用门不能混为“到上限才检查”：

- 每笔业务 mutation 只推进 `dataMutationCounter`；已到上限时 Repository 仍可受控只读，但拒绝新 mutation、capture 和依赖稳定 counter 的普通 maintenance，直到受审的 counter-width migration；
- restore/manual rollback 开始前要求当前 `notificationDatasetEpoch <= MAX-1`，只为已提交 replacement 消耗一次；migration 不消耗；
- 已有 active 的 operation 在发布 validating 前必须一次预留两个 `controlSequence`：一个给 validating，一个给 committed active 或 `activation_abort` terminal active。initialize 首次使用 `0`、成功 active 使用 `1`；无 marker 重试每次也必须先为新的 validating + terminal active 保留两个剩余值。稳定 active control 即使 sequence 为 `MAX` 仍可接受普通业务写，只拒绝任何需要新 control 的 operation；
- 普通 migrate/restore/manual rollback 在开始前为最终 active-anchor CAS 预留一个 `bootstrapSequence`；fresh initialize 从初始 `0` 为 candidate binding 和 initialized CAS 预留两个；DATA-091 clear 在进入 clearing 前一次预留 `initialized→clearing→new-incarnation initializing→candidate-bound→initialized` 的四个增量。重入复用已写 sequence，不重复消耗。稳定 initialized anchor 即使 sequence 为 `MAX` 仍可开放与其匹配的普通 Repository，只拒绝下一次 anchor transition；任何路径都不得先进入不可逆 transition 再发现 headroom 不足。

`notificationDatasetEpoch` 在每个新 installation incarnation 初始化时为 `0`，普通 schema/cipher migration 保持不变，整体 restore 和 manual rollback 从**当前 active control** 做 checked `+1`。本项目的 **notification realm** 恒定指 `(installationId, installationIncarnationId, notificationDatasetEpoch)`；current/target/same realm 都要求三项逐字段相同，generation、revision、pair digest 或 environment generation 不能代替其中任一项。incarnation+epoch 与 candidate 在同一个 validating control slot 固定，并共同纳入 TD-009 request ID、payload 和 action 校验；清除本机在保留 Installation ID 时必须先轮换 incarnation，因而旧 realm 已展示通知即使含相同业务 ID/epoch 也只能成为 no-op。

`abortedOperationId` 对 initialize/migrate/restore/manual rollback 必须为 null；`activation_abort` 必须直接写 `phase=active`、使用独立 recovery `operationId`，且 `abortedOperationId` 非空并指向同 journal 的 validating operation。不存在 `phase=validating + activation_abort`，也不允许外部调用者构造该 kind。

写 control 的唯一协议：真正首次 initialize，或已由完整 DATA-091 clearing 证明进入新 installation incarnation/new DatasetControlKey realm 的 initialize，其第一项 validating record 在 slot A 使用 `controlSequence=0`、`previousGenerationId=null`、`notificationDatasetEpoch=0`；此后从当前有效最高 sequence checked `+1`（从不复用）→ 选择另一 slot → 写同目录随机 temp → flush 文件 → 平台写屏障 → atomic rename/move 覆盖 slot → 同步父目录 → read-back 解密并比较。sequence 只在同一 incarnation/control-key realm 内单调且不复用，跨 realm 由随机 incarnation 隔离；除上述受 TD-004 bootstrap/clearing capability 约束的 sequence-0 特例外，任何路径都不得在无 current record 时自造控制状态。Android 必须使用同文件系统 `ATOMIC_MOVE` 且验证结果；不支持时阻止切换，不能回退到 delete-then-move。Apple 使用同文件系统 `rename` 和受控 `F_BARRIERFSYNC`，发布门按目标系统决定是否还要求 `F_FULLFSYNC`。

启动分类必须先由 TD-004 验证 bootstrap/presence：只有 `installPresenceRecordDigest` 与当前 presence 匹配的 bootstrap 才属于当前 app-container；其中有效 `phase=clearing` 是唯一先于 control 选择的分支，按第 9 节只处理 clear journal 明确拥有的旧 control/key/artifact，因此 key 已销毁而旧 control 尚未删除不会被误判为普通损坏。bootstrap 非 clearing 时，才选择 sequence 最高且 AEAD、Schema、路径和 generation root 均合法的 control record；一个 slot 无效而另一个有效时仍选择有效记录，相同 sequence 内容不同、有效记录引用目录不存在或 key ID 不可用时进入 integrity-blocked，不扫描目录猜“最新”。若没有任何有效 record，只要任一 canonical control 文件物理存在但无效就 integrity-blocked；只有两个 control 文件都**不存在**时才评估第 9 节 initialize：`InstallationBootstrapRecord` 与当前 `InstallPresenceRecord` 为 matching initializing 时只可续跑该 operation；只有 presence bootstrap intent 时还必须有 matching operation journal，才可完成同一 handshake；当前 presence 与 matching bootstrap pairing 都不存在时，还必须满足 clear journal、generation/root/staging、attachment namespace、与当前 app-container 绑定的 envelope 和 legacy DB 严格 all-absent，才是真正 fresh。与当前 presence 匹配的 bootstrap 已为 initialized、曾存在 active receipt、存在未归属 artifact，或证据冲突时一律 integrity-blocked，绝不能把损坏误当新安装。重装的 app-container anchor 与数据根全空时，Key Manager 只能隔离/删除不匹配当前 presence 的旧 incarnation secure-store orphan/alias；orphan 不算当前 pairing，也不能作为初始化证据，系统必须生成新 Installation/incarnation/key hierarchy，绝不复用旧 Installation 或 key。

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

每次 backup、shadow migration 或 manual-rollback source capture 先取得全局 `DatasetMaintenanceLease`。restore 不另复制“回滚检查点”；切换时旧 active 在同一 gate 下封口为 previous generation。同一 installation 只能有一个会创建/激活 generation 的 operation；普通读取可以继续，写入只在短 capture/最终切换阶段进入明确 gate。

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
9. run capture verification before using it
10. retain/release sealed capture and attachment lease by the operation-specific rule
```

- `dataMutationCounter` 在每个权威领域事务递增；纯技术 lease/checkpoint 不改变它；
- 在同一 gate 内固定的 attachment manifest 只含 capture 中状态为 available 的权威原附件；processing、orphan、缩略图和明文 cache 不进入用户快照；
- TD-005 文件不可变，因此释放写 gate 后可以流式读取相同 locator；GC/purge 必须尊重 lease，即使用户随后删除来源；
- backup 从 capture 到 TD-011 私有 `.lifebook` staging 完整复验始终持有 maintenance/snapshot/attachment lease；复验成功即全部释放，再执行可能很慢的 provider copy/commit/reopen/identity verify。用户口令确认和 provider handle 预备发生在任何 lease 之前；
- migration/manual rollback 的 source/candidate root lease 保持到 candidate seal/activation 或 terminal cleanup；每个 lease owner、operation ID 和 terminal release 条件必须持久可恢复，不能用含糊的“consumer 完成”；
- capture 失败、取消或计数不匹配时删除 destination、释放 lease 并从头重试，不拼接两次结果；
- 不要求先把 WAL 普通复制/拼接。Backup API 从 SQLite handle 读取一致状态；完成后 destination 必须独立通过关闭/重开检查；
- progress 来自 backup pages 和后续 projector rows，但页数变化只作 UI 估算，不成为完整性证据。

### 5. Portable 数据库投影

用户备份数据库成员是独立的 `portableDataSchemaVersion`，不等同活动 `databaseSchemaVersion`，也不等同 container/manifest version。构建器从空 SQLCipher 文件开始：

1. 请求 TD-004 Key Manager 每备份随机生成 operation-scoped `SnapshotDataKeyHandle`，用固定 portable cipher profile 创建目标；
2. 执行签名 App 内精确 portable DDL；portable schema 不含 trigger、view、FTS/virtual table 或任意扩展；
3. 从只读 capture 按生成的 `table.column` allowlist、稳定主键顺序和 prepared statements 分批复制；
4. 应用明确的 portable transform：移除 Installation/Device session/key envelope/storage locator、dataset activation marker/open receipt、平台 request/native ID、通知 capability/environment/channel/budget、明确呈现刷新意图、旧 reconcile task/checkpoint/receipt/watermark，以及 `NotificationDelivery`、`NotificationActionInbox`、`NotificationDatasetState`、`NotificationSchedulingDecision`、`NotificationSchedulingRun`、`NotificationReconciliationState` 六类通知设备投影；同时移除诊断/搜索/缓存/缩略图并清 `thumbnailAttachmentId`，但保留 ReminderPlan、ReminderInstance、业务幂等/dedupe 和 DATA-020/033 要求的业务、同步安全状态；
5. 将每个原附件逻辑 ID 映射为 TD-011 member ID，不保存设备 FileDataKey、ARK envelope、路径或 locator；
6. 写 snapshot ID、source dataMutationCounter、scalar/time/rule/schema version 和分类覆盖版本；
7. 验证行数、引用、领域不变量、成员映射与 schema fingerprint；
8. `journal_mode=DELETE`、FULL sync、关闭并重开验证，确保没有必要 WAL/SHM；
9. 只把已验证 portable DB 和 operation-scoped opaque SnapshotDataKey handle 交给 TD-011 创建 session；私有容器完整复验或 terminal failure 后销毁 handle。

分类采用覆盖式 allowlist：每张生产表、每个 column 和每个 JSON 字段都必须声明 `portable_required | portable_optional | device_only | derived | diagnostic | forbidden`。Schema 增加未分类项、allowlist 与迁移 checksum 不一致或 projector 未消费必需字段时，备份失败并阻止 release；不得用“删除已知敏感表”的 blocklist。

portable DB 即使外层还会 AEAD 加密，本身仍使用独立 SQLCipher key，以保证私有 staging、进程重启清理和容器成员抽取不会产生明文 SQLite。SnapshotDataKey 不是 DWK/BackupRootKey 派生值，只以 native handle 交给 TD-011 key slot 包装，不回到 JS、不复用设备 DatabaseDataKey、不跨 operation 保存。

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
- restore candidate 从 `transforming` 进入 `verified/sealed` 还必须消费匹配的 `Pass2CompletionEvidence`；migration/manual rollback 使用各自不可伪造的 source/copy completion evidence，不能复用布尔 `isVerified`；
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

本 ADR 的恢复入口是 TD-011 已完成外部文件私有密文 staging、header/manifest/全部 payload/唯一 FINAL/EOF 首遍认证后签发的 `VerifiedBackupHandle`。外部 provider copy、`NOFOLLOW`、文件身份与 whole-container identity 由 TD-011 独占；TD-010 不再接收 URI/path 或重复复制外部文件。即使容器 pass 1 完成，portable SQLCipher 仍按不可信数据库处理。原生 reader：

- 只接受 `VerifiedBackupHandle.openSecondPassImport(operationId, candidateSinkHandle)` 产生的一次性、session-scoped portable member handle，不接受任意路径；
- portable member 只能写入受控 candidate staging，以 `READONLY` 打开；path/descriptor/file identity 由 native handle 固定，调用者不能替换；
- 在执行任何来自该 handle 的 Schema/业务 SQL 前，通过 C API 设置 `SQLITE_DBCONFIG_DEFENSIVE=1`、`SQLITE_DBCONFIG_ENABLE_TRIGGER=0`、`SQLITE_DBCONFIG_ENABLE_VIEW=0`，并设置 `trusted_schema=OFF`、`query_only=ON`、`mmap_size=0`、`cell_size_check=ON`；任一能力缺失或设置 read-back 不符即拒绝输入；
- 禁止 load extension 和 virtual table；以 `sqlite3_limit(..., SQLITE_LIMIT_ATTACHED, 0)` 及 authorizer 拒绝 `ATTACH/DETACH`，并收紧 length、SQL、column、expression depth、compound select、page/count 等 SQLite limits；
- 完成上述隔离后，先验证 cipher 和 `integrity_check`，再验证 application ID、portable schema fingerprint、精确表/列/index 集合和所有版本，最后才查询业务行；
- 只用预编译 allowlist `SELECT` 按 keyset 读取，逐行做 TD-006 scalar、enum、长度、引用和资源验证；
- 不对输入调用 backup API、`sqlcipher_export`、migration SQL 或写操作。

恢复构建流程：

```text
VerifiedBackupHandle.openSecondPassImport(operationId, candidateSinkHandle)
→ re-authenticate exact container; write portable DB member to disposable staging
→ inside the session, defensive-open portable DB with session-scoped SnapshotDataKeyHandle
→ create fresh current-schema candidate with current-device DB key/profile
→ copy/transform allowlisted fields and merge DeviceStateOverlay field by field
→ continue pass 2; stream attachment members through TD-005 re-encryption staging
→ verify second-pass member/hash/FINAL/EOF/identity and terminal sink receipts
→ receive Pass2CompletionEvidence bound to operation + handle + plan + candidate
→ promote new immutable locators under candidate root lease
→ write restore/sync safety gates and dormant projection rebuild tasks
→ create exactly one dormant notification coordinator task bound to Installation/incarnation/target epoch/revision 0/pair-set digest
→ verify candidate and attachment roots
→ consume evidence once; seal candidate and produce non-content preview
→ bind preview to expected active generation/counter + candidate evidence
  + installationId + installationIncarnationId + targetNotificationDatasetEpoch
  + notification initialization contract version + registered pair-set digest
→ continue with §9 fresh auth and activation
```

pass 2 只能写可丢弃 candidate/attachment staging；全部完成前不提升 locator、不生成 preview、不切换数据集，也不触发通知/搜索/同步。`Pass2CompletionEvidence` 是不可伪造、process-local、一次消费 capability，必须绑定 operation ID、candidate generation、`VerifiedBackupHandle` 文件身份 tuple、manifest/member-plan digest、sink completion receipt 和第二遍 whole-container identity。缺失、提前结束、绑定不匹配、重复消费或 second-pass cancel 都删除 candidate，不能进入 preview。

旧 portable version 由专用只读 mapper 转成当前 candidate，不在输入文件上原地迁移。未知必需 feature/enum/field 安全失败；未知声明为可忽略的扩展仍由 TD-011 完整认证后才可丢弃。

`DeviceStateOverlay` 逐字段拥有恢复策略：保留当前 Installation/incarnation、数据库/附件/control keys、应用锁能力、系统权限、账号 session/token、BYOK、遥测/法律同意的当前设备要求；restore/manual rollback 不轮换 incarnation，只有真正重装或 DATA-091 clear 创建新 realm。overlay 为每个受支持 notification pair 提供接收设备的无内容 `environmentGeneration`、规范化 `capabilityFingerprint`（覆盖适用 channel 状态）、budget、transport enablement 和 `hasManagedEvidence`，但不含 request/delivery platform ID。签名目标 build 另行提供 tzdb/recurrence/adapter 合同版本、TD-009 pair registry/version 和 digest 算法；initializer 只为当前真实 OS platform 派生 active pair，并把已禁用但 `hasManagedEvidence=true` 的 pair 以 retiring 模式保留，再计算 runtime `registeredPairSetDigest`。权限/channel 不改变 pair 成员资格。该 overlay 数据只能初始化当前 `(installationId, installationIncarnationId, targetNotificationDatasetEpoch)` realm 下的 owner/pair；dataset replacement 本身不推进 environment generation。物理 Schema 必须拆分或声明每列 policy，不能对混合 AppPreferences 做整行覆盖，也不能从 portable/source 补设备基线。

`notificationInitializationContractVersion` 是签名 build 中的正整数；当前三元 realm 初始化合同固定为 `2`。任何 owner/pair 身份、初始字段、默认值、registry 规范或 marker/read-back 谓词改变都必须递增，不得以旧版默认补全 incarnation。初始化投影、task、preview、marker 和 open receipt 使用同一版本，不能用 database schema version、adapter version 或 task payload version 替代。

版本 `2` 的初始化集合恰为：一项 `task(operationId, candidateGenerationId, realm, revision=0, pairSetDigest)`、同 realm 下恰一项 `NotificationDatasetState`，以及每个 registered `(transport, platform)` 恰一项 `NotificationReconciliationState(realm, transport, platform)`。target realm 中初始必须没有 Run/Decision/Delivery/Inbox、notification checkpoint、platform receipt 或 watermark。上述 task/checkpoint/platform receipt/watermark/run/Decision/Delivery/Inbox 及其 lease/current-evidence guard 都必须携带并逐字段校验 realm；缺 incarnation 的 legacy 行不得变成 current evidence。

整体 restore/manual rollback 不导入任何源 generation 的六类通知设备投影、平台 ID、能力/环境/channel/budget、明确呈现刷新意图或旧 reconcile task/checkpoint/receipt/watermark。portable mapper 保留 ReminderPlan/ReminderInstance 与业务 dedupe，并对每个 ReminderInstance 严格按下表第一条命中；“来源失效”只按 REM-021 的穷举谓词判断，不得另造分支：

| 优先级 | source 实例条件 | target 状态 | 必须清理/保留 |
| ---: | --- | --- | --- |
| 1 | 原状态为 `acknowledged/snoozed/cancelled/expired` | 保持原业务终态 | 不重建平台请求。 |
| 2 | 其余实例的来源已失效 | `cancelled` | 离开 paused/failed 时分别清 `pauseReason/failureCode`。 |
| 3 | `paused` 且暂停原因仍成立 | `paused` | 保留 `pauseReason`，不重建平台请求。 |
| 4 | `paused` 原因已失效，目标在未来/已过 | `planned` / `expired` | 清 `pauseReason`；过去目标不补发。 |
| 5 | `scheduled/failed`，来源仍有效，目标在未来/已过 | `planned` / `planned` | 清 `failureCode`；过去目标只派生 application-only 待查看/逾期，永不补发。 |
| 6 | 原状态为 `planned` 且来源仍有效 | `planned` | 过去目标永不进入 desired platform request。 |

candidate 在 seal 前创建恰好一个通知 coordinator task，身份与 payload 绑定 `(operationId, candidateGenerationId, installationId, installationIncarnationId, targetNotificationDatasetEpoch, notificationInputRevision=0, registeredPairSetDigest)`，reason 固定为 `dataset_epoch_changed`。它复用普通 task 的 `pending` lifecycle，但 `activationGate/activatedAt` 为空，因此是 dormant；processor 必须同时验证 task gate 已激活、control 为匹配的 active installation/incarnation/generation/epoch 且 Repository 已 open，三项缺一都不得运行。activation marker 前，target 中不得存在 `NotificationDatasetState`、`NotificationReconciliationState`、`NotificationSchedulingRun`、`NotificationSchedulingDecision`、`NotificationDelivery` 或 `NotificationActionInbox`。schema/cipher migration 保持 incarnation/epoch、同 realm 合法设备投影和实例状态，不执行本规范化，也不走 replacement 初始化合同。

### 9. 原子 activation 协议

四种 operation 不共享含糊的“已确认”前置条件：

| operation | 前一 active | 必需 evidence / 授权 | target notification epoch | 通知初始化 |
| --- | --- | --- | --- | --- |
| `initialize` | 当前 incarnation 内不存在 | TD-004 一次性 bootstrap/clearing-complete capability、`EmptyCandidateEvidence`、签名空 Schema/cipher/build 合同、完整 DeviceStateOverlay；没有可覆盖数据，不弹恢复覆盖确认。 | 新 incarnation 固定 `0`。 | 在同一 target notification realm 创建 revision-0 owner、精确 pending pair 与 coordinator。 |
| `migrate` | 必须存在 | 已接受 migration artifact/ledger、当前已解锁 maintenance capability；不伪装成用户恢复确认。 | 保持 current。 | 保留合法的同 incarnation+同 epoch 设备投影；只激活 migration 所需普通任务。 |
| `restore` | 必须存在 | consumed `Pass2CompletionEvidence` 派生的 sealed evidence、preview、一次 fresh auth 和明确覆盖确认。 | current checked `+1`。 | 从 receiving overlay/build 全新创建。 |
| `manual_rollback` | 必须存在 | typed previous-source evidence、影响 preview、一次 fresh auth 和明确回滚确认。 | current checked `+1`。 | 从 receiving overlay/build 全新创建。 |

`activation_abort` 不是用户可发起的第五种 maintenance operation，也不接受 candidate evidence；它只是在已有 active 的上述 operation 已发布 validating、但尚无 marker 时，以预留 sequence 把原 active 身份重新锚定为 terminal active 的内部恢复记录。其 receipt/anchor 链由本节后文唯一规定。

TD-004 Key Manager 原生持有 device-only、无内容的 `InstallationBootstrapRecord`；逻辑字段恰含 `formatVersion`、TD-006 `bootstrapSequence`、随机 `installationIncarnationId`、`installationId`、`incarnationBootstrapOperationId`、`stateOperationId?`、`activeOperationId?`、`notificationDatasetEpoch`、`phase=initializing|initialized|clearing`、`installPresenceRecordDigest`、`candidateGenerationId?`、`initializedGenerationId?`、`initializedControlSequence?`、`activationOpenReceiptDigest?`、`appBuildId` 与 `createdAt`。其精确字节/双槽认证格式归 TD-004，但状态更新必须 atomic write + platform barrier + read-back，损坏 record 按存在但非法处理。app-container 另有原子 no-backup `InstallPresenceRecord`，至少绑定 Installation、incarnation、稳定的 `incarnationBootstrapOperationId` 与随机 nonce；TD-004 以 crash-recoverable handshake 先写/read-back presence bootstrap intent，再建立包含该 presence 完整 digest 的 secure bootstrap record 和同身份 key envelopes，presence 反向绑定同一组稳定身份字段。后续 migrate/restore/manual rollback/activation-abort 只推进 bootstrap record 的 `activeOperationId`，不改 presence 或 `incarnationBootstrapOperationId`。presence-only 中间态只有 matching incarnation-bootstrap operation journal 才可继续；单独残留的 secure-store record 或 alias 视为旧 incarnation orphan，不能证明当前安装。`clearing` 优先于 initialize：先按 DATA-091 operation journal 完成擦除，再保持产品要求的同一 Installation ID、生成新 incarnation/keys 和新的 incarnation-bootstrap operation；不得从半清除直接开空 Repository。

phase invariant 固定为：initializing 的 `stateOperationId=incarnationBootstrapOperationId`、`activeOperationId=null`，`initializedGenerationId/initializedControlSequence/activationOpenReceiptDigest` 全为 null，`candidateGenerationId` 在 candidate 绑定前可为 null、绑定后必须等于 incarnation-bootstrap journal，notification epoch 在新 incarnation 固定为 0；initialized 时 `stateOperationId=null`、`activeOperationId` 非空、`candidateGenerationId=null`，上述三个 initialized 字段全非空，Installation/incarnation/epoch/active operation 与 active control/open receipt 完全匹配；clearing 时 `stateOperationId` 等于 clear journal operation，`candidateGenerationId=null`，并保留被清理的 `activeOperationId`、initialized 证据与 epoch。每次状态、candidate binding 或 active anchor 改变都 checked 推进 `bootstrapSequence` 一次，并服从第 2 节的预留规则；到达上限不回绕或删 record，稳定 initialized anchor 仍可开放 matching Repository，但不能开始下一次状态转换。clear 先在旧 presence/clearing record 仍匹配时销毁旧数据 key 并删除旧 control/artifact，确认 canonical control 全部物理不存在后，持久化并 read-back 新 incarnation-bootstrap journal，再依次写/read-back 新 presence 与新 bootstrap record；clearing journal 保留到整个 handshake 完成。新 record 使用同 Installation ID、新 incarnation、新 `incarnationBootstrapOperationId`、epoch 0 和全空 active/initialized 字段进入 initializing。

TD-004 一次性 bootstrap capability 必须绑定 matching initializing record、`incarnationBootstrapOperationId`/incarnation、Installation 标识、待生成的 LocalActor 标识、Database/Attachment/Control key envelopes、install-presence nonce 和 candidate generation，只允许创建签名当前 Schema 的空 generation；不能转换成 restore/migrate capability。initialize candidate 的 `EmptyCandidateEvidence` 绑定该 bootstrap operation、bootstrap-record digest、Installation/incarnation/epoch、candidate、Schema/cipher/root digest、seed-row digest、notification initialization contract、DeviceStateOverlay 与 pair-set digest，并证明 baseline migration `0`、Installation mirror 等于 bootstrap ID、新 LocalActor、恰一默认 PersonalSpace、默认 AppPreferences/ProductCounter、`dataMutationCounter=0`、空 attachment root，且没有用户 Record/Plan/Instance、sync/outbox 或六类通知投影。seal 前只多出恰好一个绑定 `(operationId, candidateGenerationId, installationId, installationIncarnationId, epoch=0, notificationInputRevision=0, registeredPairSetDigest)` 的 dormant notification coordinator task，reason 固定为 `dataset_initialized`，gate/time 为空，其中 task `operationId` 必须等于 `incarnationBootstrapOperationId`。若 Key Manager 报告 initialized、存在 active/open receipt 或 artifact 不属于同一 bootstrap operation，capability 不签发。

候选完成其 operation-specific 验证后执行：

```text
1. require sealed operation-specific CandidateEvidence; restore derives it from consumed
   Pass2CompletionEvidence, while initialize/migrate/manual rollback use the typed evidence
   in the table; bind every operation to:
     + candidateGenerationId + candidateRootDigest + candidateEvidenceDigest
     + targetNotificationDatasetEpoch
     + expectedBootstrapRecordDigest + expectedInstallPresenceRecordDigest
     + installationId + installationIncarnationId
   bind initialize/restore/manual rollback additionally to:
     + notificationInitializationContractVersion + registeredPairSetDigest
     + receivingDeviceStateOverlayDigest
   and, except initialize, expectedActiveGenerationId + expectedDataMutationCounter
   + currentNotificationDatasetEpoch
2. for restore/manual rollback, obtain exactly one fresh auth + explicit user confirmation
   bound to the preview; initialize/migrate require only their non-interchangeable capability
3. acquire exclusive DatasetGate; pause sync, reminder writes and cleanup;
   wait for or revoke every reminder reconcile/action DatasetReadLease,
   and stop issuing new notification leases
4. re-read operation-specific preconditions, bootstrap/install-presence digests and evidence;
   initialize/restore/manual rollback also re-read the signed pair registry and DeviceStateOverlay.
   Initialize requires no valid prior control/active/receipt and the same bootstrap capability;
   other operations require the
   expected active generation/counter/epoch. Any mismatch releases the gate and invalidates or
   re-previews as its operation requires; never patch a sealed task
5. when a prior active exists, persist its attachment root as retained previous root;
   initialize keeps previous=null
6. drain and close every DB connection, statement, cursor and attachment stream
7. seal any old and the candidate DB: checkpoint/truncate, DELETE journal, FULL sync, close
8. write a validating control by the only protocol in §2:
     initialize first record in this incarnation: sequence=0, installation/incarnation match
       bootstrap, activeGeneration=candidate, previous=null, epoch=0;
     otherwise: sequence=N+1, activeGeneration=candidate, previous=old, target epoch
9. reopen only candidate; run first-open self-test
10. in one candidate DELETE/FULL transaction, for initialize/restore/manual rollback:
    write a typed durable activation marker binding operation kind/ID, Installation/incarnation,
    generation/root, target epoch, notification task ID, initialization contract version,
    pair-set digest, expected bootstrap/install-presence digests, CandidateEvidence digest,
    validating control sequence and the expected next active control sequence;
    activate the exact dormant coordinator task and set its activation gate/time;
    create exactly one NotificationDatasetState for
    (installationId, installationIncarnationId, targetNotificationDatasetEpoch) with
    revision=0, revisionState=active, exact registered pair set/version/digest,
    forcePresentationRefreshRevision=null;
    create exactly one NotificationReconciliationState for every registered pair under
    that exact same notification realm with
    state=pending, revision=0 and the same pair-set digest, per-pair overlay
    environmentGeneration/capabilityFingerprint/budget and signed
    tzdb/recurrence/adapter versions, while all
    publishedRunId/scheduledThrough/lastAttemptedAt/lastSucceededAt/inputFingerprint/
    failureCode fields are null; assert no extra pair and, within the target realm,
    zero Run/Decision/Delivery/Inbox/notification checkpoint/platform receipt/watermark;
    initialize additionally asserts the signed empty-data/default-space bootstrap invariants;
    migration writes its typed marker with the same bootstrap/presence/CandidateEvidence/control
    bindings and activates an ordinary task when needed;
    commit, FULL sync, close and read back the operation-specific marker/invariants;
    initialize/restore/manual rollback require the complete incarnation-keyed task/owner/pair set
11. write the next checked control sequence with phase=active and activatedAt
12. reopen candidate under normal WAL/FULL policy
13. open Repository in activation-recovery mode; reverify the operation-specific marker and,
    for initialize/restore/manual rollback, incarnation-keyed task/owner/exact pair set; write a durable
    ActivationOpenReceipt binding activationMarkerDigest, expectedBootstrapRecordDigest,
    expectedInstallPresenceRecordDigest, incarnation, installation, operation,
    control sequence, generation/root and epoch;
    operations with notification initialization also bind its set digest. TD-004 then guard-CASes the expected
    bootstrap record to phase=initialized, stateOperationId=null, candidate=null,
    activeOperationId=this operation and this generation/control/receipt digest
    (initialize changes phase; other operations advance only the active anchor);
    only after receipt and bootstrap CAS may Repository accept business writes
14. wake durable projection/notification processors; enqueue cleanup and cold-start check
```

数据集不可静默回滚的 durable commit boundary 是步骤 11 的 `phase=active`。operation 的可报告成功边界更严格：candidate 必须以 activation-recovery handle 再次打开，matching `ActivationOpenReceipt` 已提交且 TD-004 active bootstrap anchor CAS 已完成；restore/manual rollback/initialize 还必须把步骤 10 的 typed marker、唯一 active coordinator task、NotificationDatasetState 与精确全部 pair state 逐字段复验成功。这组初始化集合的统一身份必须是 `(installationId, installationIncarnationId, targetNotificationDatasetEpoch)`，任一行缺失或跨 realm 均不匹配。满足后才开放普通 Repository：initialize 返回 `Initialized`，migrate 返回 `MigrationSucceeded`，restore/manual rollback 返回 `RestoreSucceeded`。四种 candidate operation 的 receipt 必须绑定其 operation kind/ID、Installation/incarnation、typed marker digest、active control sequence/generation/epoch；带通知初始化的 operation 还绑定读取到的 incarnation-keyed 初始化集合 digest，migration receipt 绑定 typed migration marker digest。内部 `activation_abort` 没有自己的 candidate marker，改为按下段绑定 prior marker/receipt 与 aborted operation。receipt 与 bootstrap CAS 必须先于业务写启用；之后正常对账才可合法推进 revision/state。步骤 11～13 或 receipt→bootstrap CAS 间崩溃由启动状态机完成/阻断，不能报告成功。步骤 14 的 search/today/thumbnail/notification 等可重建投影失败属于已提交 operation 后的 `degraded_reconciliation`，显示状态并幂等重试，不回滚新数据集、也不把已提交 operation 改报失败。

已有 active 的 operation 在写 validating 前，journal 还必须绑定 prior active control、prior `ActivationOpenReceipt`、prior bootstrap anchor digest 和预留的 terminal sequence。若 candidate 尚无 marker 就终止，不能只写新 control 指回 previous 后直接开放，因为 prior receipt/anchor 仍绑定旧 sequence；唯一回退协议是在 DatasetGate 内写预留的 `operationKind=activation_abort` terminal active control：使用新的 recovery operation ID、`abortedOperationId` 指向未提交 operation，prior Installation/incarnation/active generation/root/schema/cipher/key/epoch 完全原样保持，`previousGenerationId` 继承 prior active control 的值。随后以 activation-recovery handle 打开 prior generation，复验其原 marker/receipt 与未变化的 `dataMutationCounter`，再写新的 `ActivationOpenReceipt`，其中 `recoveryOutcome=aborted_to_previous` 并绑定 aborted operation、validating/terminal control sequence、prior control/receipt/marker、expected bootstrap/presence digest 和同一 Installation/incarnation/generation/root/epoch。TD-004 最后 guard-CAS `activeOperationId`、terminal control sequence 与新 receipt digest；三者完成后才恢复普通 Repository。该 recovery 不改 notification incarnation/epoch/revision/task/state，返回 `NotActivated` 而非任何 operation success；任一中间 crash 只续写同一预留 control/receipt/CAS，字段冲突即 integrity-blocked。abort journal 不随失败 candidate GC，至少保留到下一次 non-abort active anchor 成功提交或 DATA-091 clear；matching abort control/receipt/anchor 被更新事实取代后才可清理。

initialize 的 target notification epoch 固定为 `0`；restore/manual rollback 必须由步骤 4 重新读取的当前 control 做 checked increment；migration 保持 epoch。只有提交 marker 的 replacement 才产生一次有效 epoch 增长：无 marker 的 `activation_abort` terminal control 原样恢复 prior epoch，有 marker 时完成同一个 target epoch 且不再次递增。initialize 重入始终使用新 incarnation 的 epoch 0，不把 bootstrap 尝试次数当 dataset replacement。通知 response 只有在 payload incarnation/epoch 同时等于当前 `phase=active` control、普通 Repository 已开放且 request ID 按两者重算一致时才可进入业务 action inbox。旧 realm/epoch 的 pending/delivered 清理是隐私和容量收敛，不是安全正确性的前提。

任何 SQLite 文件只在所有 handle 已关闭后变更 journal/清理 auxiliary file；不重命名活动数据库。activation marker 是防静默回滚边界，启动恢复按下列第一条匹配：

- 任意有效 `InstallationBootstrapRecord.phase=clearing` 先按其 journal 完成 DATA-091 擦除，期间 Repository/notification 保持关闭；完成后以该流程规定的 Installation ID 和新 incarnation 进入 initialize，不得绕过 clearing；
- 没有有效 control 时，只有第 2 节的真正首次安装证明成立才可创建或续跑 initialize；严格 all-absent 时由 TD-004 开始 presence→bootstrap record→key envelopes 的耐久 handshake，matching presence-only/bootstrap journal 可继续同一 operation，matching `initializing` record 只清理/重建该 operation 明确拥有且没有 marker/receipt 的 allowlisted staging。initialized/active receipt/未知 artifact/身份冲突一律 integrity-blocked；
- `phase=validating` 期间 notification subsystem 保持关闭，不能签发 reconcile/response/action lease；
- `phase=validating + operationKind=initialize` 且 candidate 无 marker：没有 previous 可回退，也不在原 candidate 上猜测续写；仅当 matching initializing record 证明尚未提交 active/receipt 时，构建并验证新的空 candidate，以 operation journal + bootstrap record CAS 先绑定 replacement candidate，再以更高 control sequence 发布新的 validating record，之后才回收旧 operation-owned candidate；任一 kill 从 journal/record/control 三者继续，不留下无 control 指向窗口或扫描其他 artifact；
- `phase=validating + operationKind=initialize` 且有 marker：read-back 必须同时找到 marker 绑定的唯一 active task、当前 Installation/incarnation/epoch-0 下唯一 revision-0 active NotificationDatasetState、同 realm 的精确全部 revision-0 pending pair state 与空业务 bootstrap invariants；完整时完成同一 candidate 的 active/receipt/bootstrap CAS，任一缺失、多余或跨 realm 都 integrity-blocked，不补行或另建默认空间；
- 非 initialize 的 `phase=validating` candidate 无 marker：按上文唯一 `activation_abort` 协议写预留 terminal active control、复验 prior generation、写 recovery receipt 并推进 active bootstrap anchor；完成前不开放 Repository。candidate 中 dormant task 永不满足 activation gate，随整个 candidate 安全 GC；
- `phase=validating` 且 restore/manual rollback candidate 有 marker：read-back 必须同时找到 marker 绑定的唯一 active task、一项 revision-0 active NotificationDatasetState 和精确全部 revision-0 pending pair state，且 task 另外匹配 operation/candidate generation，task/owner/state 的 Installation、incarnation、epoch、pair-set digest、overlay/build baseline 全匹配。完整时用 marker 已绑定 target epoch 完成同一次 `phase=active`，绝不再次递增；任一缺失、多余或跨 realm 即 integrity-blocked，不得局部补建、重新初始化或回 previous；
- `phase=validating` 且 migration candidate 有 typed marker：按 migration evidence/ledger/marker 合同完整 read-back 后完成同 epoch active；不得套用 replacement 初始化或增量；
- `phase=active`、非 abort marker 存在但 `ActivationOpenReceipt` 缺失：按 operation kind 重复对应上一条的完整 read-back，并用 marker 内耐久 expected bootstrap/install-presence digest 验证当前 prior anchor；匹配后以 activation-recovery 模式打开 Repository 并完成步骤 13，再开放业务写，任何不匹配都 integrity-blocked；
- `phase=active + operationKind=activation_abort`：只接受 control `abortedOperationId` 对应 journal 预留的 terminal sequence 与原样 prior Installation/incarnation/generation/root/epoch；recovery receipt 缺失时复验 prior marker/receipt/counter 后写绑定同一 realm 的 receipt，bootstrap anchor 仍为 journal 绑定的 prior digest 时 guard-CAS 到 abort control/receipt，其他值一律阻断；不得套用 candidate marker、重置通知状态或返回被中止 operation 成功；
- `phase=active` 且存在 matching receipt：先在 activation-recovery 模式复验；receipt、active control 与 bootstrap anchor 必须在 Installation/incarnation/operation/generation/control/epoch 上逐字段一致。bootstrap record 的 `activeOperationId`、generation/control/receipt 已精确指向该 active 时才按普通启动开放，仍是本 operation marker 或 abort journal 绑定的预期旧值（initialize 为 initializing、其他 operation 为 prior initialized anchor）时可 guard-CAS 到新 active anchor，任何其他值都 integrity-blocked。通知初始化行此后可由合法对账推进，不能再拿 revision 0 快照覆盖 current 状态；
- `phase=active` 后即使 control 最新 slot 或数据库随后损坏，也不得自动启用 previous，因为 candidate 可能已经接受新写入；进入 integrity-blocked；
- 非 clearing 分支的两个 control slot 都失效/冲突且不满足真正首次安装证明时，不得按目录 mtime、文件名或 user_version 猜测；保留所有 generation 等待受控恢复。

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
10. 可重建 search/today/thumbnail/platform delivery 不被误当权威或 portable 成员；restore/manual rollback candidate 排除六类通知设备投影、平台 ID、能力/环境/channel/budget、force marker、旧 task/checkpoint/receipt/watermark，ReminderInstance 严格满足 §8 首条命中表，并恰有一个与 operation/generation/Installation/incarnation/target epoch/revision 0/pair-set digest 匹配、activation gate 为空的 dormant coordinator task；
11. 关闭、同步、重新打开，再运行 quick/full profile 必需检查；
12. seal 后没有 hot/未处理 WAL、SHM 或 journal。

检查器使用流式/keyset 查询和 exact integer，不把 250,000 行载入 JS。错误只返回 stage、稳定 code、受影响实体类型/随机短 ID 和计数；不记录 SQL row、标题、路径、key 或用户内容。

### 12. 资源、取消和并发

- 预检公式覆盖 source DB、capture、candidate/portable、最大 WAL、SQLCipher/VACUUM/export 临时空间、待重加密附件、外层容器和安全余量；所有加法/乘法使用 TD-006 exact integer 并做 overflow 检查；
- 任何写中空间检查仍可返回 FULL；不得因预检通过就忽略中途错误；
- capture/project、TD-011 pass 1/pass 2、portable copy/transform、附件重加密、candidate validation 和 preview 可在安全 chunk/batch/member boundary 取消；pass 2 未正常结束不产生 evidence，candidate seal 前取消不消费 evidence，seal/preview 后取消则销毁 derived CandidateEvidence 与 candidate，均不触碰 active；
- 一旦 §9 步骤 3 取得 exclusive DatasetGate 并进入 activation 临界段，不再接受普通返回、后台或 cancel；迟到 cancel 不能把已经提交的新数据集报告为 canceled。临界段最终只能由启动/当前进程证明为 old active、new active 或 integrity-blocked；
- 进程终止后是否续跑由加密 operation journal、key handle 可恢复性和 profile 决定；无法安全恢复 key 的 partial 从头重建，不能把不完整文件续成成品；
- 同一时间只有一个 dataset maintenance writer；备份可与普通读取并存，短 capture 时写 gate；restore/migration activation 排斥所有 write/sync/GC；
- 后台时间到期时在安全 checkpoint 停止，不持有半开的 JS transaction 或 raw key；
- 资源不足时 active 不变，显示所需/可用区间和管理入口，不自动删除回收站或附件。

### 13. 切换后的收敛

candidate 预先写入 dormant 幂等 rebuild tasks；对 initialize/restore/manual rollback，§9 步骤 10 在 marker transaction 中耐久激活唯一 Installation+incarnation+target-epoch notification coordinator task，并创建同 realm 的完整 owner/pair state，步骤 14 只唤醒 processor。Repository 开放后按依赖执行：

1. 校验当前 DeviceStateOverlay、签名 pair registry 和 sync restore gate；若 overlay/pair 输入自 marker 后改变，先按 REM-015 以一个事务推进 owner revision 一次并 fan-out 全部 current pair，再进行任何平台写；dataset replacement 本身不推进 environment generation；
2. 重建 Search A/B index、今天/统计 projection；
3. 重建缺失缩略图；
4. initialize 以 `dataset_initialized`、restore/manual rollback 以 TD-009 `dataset_epoch_changed` 原因运行已激活的同 Installation/incarnation/epoch coordinator：按 registered pair digest 分发 runner，先定向清理旧/非法 incarnation 或 epoch 的 managed IDs（包括 legacy request identity），再从未来计划重挂；不补发过去提醒；
5. 恢复允许的 sync，先验证 Account/Space/membership/snapshotGeneration；
6. 完成一次冷启动自检后记录 rollback retention evidence；
7. GC 只清无 root 的 candidate/capture/attachment orphan。

projection 失败不自动回滚已验证业务数据；显示局部重建状态并重试。任一 notification pair 平台清理/重挂失败时，仍发布该 pair 完整、同 realm/revision/digest 的 degraded Decision run，但 `scheduledThrough/lastSucceededAt` 保持空、coordinator task 保持待处理、force marker 不清；initialize 返回 `Initialized + degraded_reconciliation`，restore/manual rollback 返回 `RestoreSucceeded + degraded_reconciliation`，只有 current realm 的精确全部 pair succeeded 才能 global finalize。旧 response 的安全性由 incarnation + epoch + request-ID fence 保证。若业务权威自检失败且尚未写 activation marker，已有 active 的 operation 可自动回 old generation；initialize 则只能重建未激活空 candidate。marker/active 后按完整性保护处理，避免丢新写入。

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
- 同一 typed candidate/validator/activation 骨架可复用于 initialize、migration、restore 和手动 rollback，而证据与确认不会互相冒充。

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
| control slot torn/corrupt | AEAD 双槽、sequence、屏障、read-back；非 clearing 分支存在 control 但没有有效项时阻断不猜。 |
| control/DB 损坏被误判为首次安装 | 只有 bootstrap/control/artifact 严格 all-absent 才能生成新 Installation；initialized、非法文件或混合证据一律 integrity-blocked。 |
| 自动回旧 generation 丢新写入 | marker 后只能完成 candidate active；无 marker 也必须用 `activation_abort` control + recovery receipt + anchor 重新认证 prior active；普通 Repository 仅在 control/evidence/receipt/anchor 四项匹配后开放。 |
| 恢复只初始化部分通知 pair | marker、唯一 task、owner 与精确 pair state 在同一 target realm 的一个 SQLite 事务提交并 FULL/read-back；任何不完整或跨 realm 状态 integrity-blocked，不做启动补写。 |
| GC 删除备份/回滚所需附件 | active DB 动态 root + sealed previous/candidate/capture 权威原附件 manifest + backup/upload/restore lease；TD-005 `CiphertextIdentity`、重新求根和安全年龄。 |
| 恶意 SQLite 利用 Schema/parser | readonly NOFOLLOW、defensive/trusted_schema off、C API 禁 trigger/view/ATTACH、严格 limits/schema fingerprint、逐字段复制。 |
| 迁移中磁盘满 | exact 预检 + 写中处理；candidate 可删、active 不变；不自动删权威数据。 |
| 大迁移无限/重复 | keyset progress 与 batch 同事务；checksum/phase；从 candidate 重启安全。 |
| manual rollback 丢激活后内容 | 影响预览、建议先备份、fresh auth、同步 gate、新 candidate；不直接改 pointer。 |
| 时间回拨提前清 checkpoint | REC 时间异常只延后自动 GC；至少一次冷启动证据；用户删除需明确确认。 |
| 旧通知动作作用于新数据集 | restore/rollback 原子递增 `notificationDatasetEpoch`，clear/reinstall 轮换 incarnation；TD-009 request ID、payload、ActionInbox/Delivery current-evidence guard 同时校验 Installation/incarnation/epoch；旧 realm 永久 no-op，切换后再强制对账。 |

## Implementation constraints

- 只有 Key Manager/DatabaseMaintenance native boundary 能取得 DB/Snapshot/Control raw key；JS 只见 opaque handle；
- 只有 TD-004 Key Manager 能解析/推进 `InstallationBootstrapRecord` 并签发 operation/incarnation-bound bootstrap capability；Dataset Controller/Database Manager 不得因路径缺失自行建库、生成 Installation 或把非法 control 删除后重试；
- 只有 Dataset Controller 能解析/写 control、创建 generation 或开放 Repository；
- Repository 普通写 gate 必须同时验证 active control、operation marker/open receipt 与 `InstallationBootstrapRecord` active anchor；只完成其中两项仍是 activation recovery，不得接受业务写；
- `installationIncarnationId` 必须进入 DatasetControl、generation/operation guard，notification task/checkpoint/platform receipt/watermark guard，以及 NotificationDatasetState/ReconciliationState/SchedulingRun/SchedulingDecision/Delivery/ActionInbox 的 realm identity；TD-009 request ID/payload/action 也必须携带并与 current realm 逐字段匹配。缺失或不匹配的 incarnation 与旧/future epoch 同样 targetless no-op，不能只靠 Installation ID + epoch；
- initialize 的 Installation 数据库行只能镜像 bootstrap anchor；LocalActor/default space/偏好/counter 必须由同一 `EmptyCandidateEvidence` seed mapper 一次生成，marker/receipt 后不得补建或重新生成；
- initialize activation/marker transaction 不调用通知平台、不请求权限；只有 activation-recovery 完成 receipt/bootstrap CAS、普通 Repository 已开放并唤醒 coordinator 后才允许平台对账；
- 活动数据库打开期间禁止 rename、unlink、file copy、hard link、symlink 和普通文件读取探测；
- 所有 bootstrap/install-presence、generation/control/capture/candidate/root/key envelope/WAL/SHM/journal 明确排除 iOS/Android 自动备份，构建产物验证；
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
- source/capture byte/key independence 按 profile 验证，普通 SQLite 工具不可读取；
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
- counter 边界 fixture 覆盖 `MAX-4...MAX`：已有 active 的 operation 没有两个 control 值或一个 bootstrap 值时必须在写 validating 前拒绝，clear 没有四个 bootstrap 值时必须在进入 clearing 前拒绝，restore epoch 为 MAX 时不建 candidate；稳定 active control/bootstrap sequence 为 MAX 仍可打开普通 Repository 并接受未耗用这些 sequence 的业务 mutation，`dataMutationCounter=MAX` 则只读；
- fresh bootstrap 黄金矩阵覆盖严格 all-absent、任一 control 物理存在但 tag/格式非法、initialized record + control 缺失、孤立 generation/envelope/legacy DB、重装遗留旧 incarnation alias、matching/mismatching initializing 和 clearing；只有严格 all-absent 创建新 Installation，clearing 必须优先续跑，其余混合态 integrity-blocked；
- initialize `EmptyCandidateEvidence` 精确验证 baseline migration 0、bootstrap Installation mirror、一个新 LocalActor、恰一默认 PersonalSpace、默认偏好/计数、mutation counter 0、空附件/用户/提醒/同步数据、恰一 `(operationId, candidateGenerationId, installationId, installationIncarnationId, epoch=0, revision=0, pairSetDigest)` dormant `dataset_initialized` task，且 marker 前六类通知投影为零；
- initialize 正常路径的首个 validating control 为 sequence 0/previous null/epoch 0 且 Installation/incarnation 与 bootstrap 逐字段匹配，随后 active 使用更高 sequence；在 bootstrap record/envelopes、candidate seed/seal、control、first-open、marker transaction、FULL/read-back、active、Repository reopen、receipt、bootstrap CAS 的每个写点 kill，按第 9 节唯一收敛且首个业务写永远在 receipt/CAS 后；
- DATA-091 clear 保持 Installation ID 但创建新 installation incarnation/new key realm，允许该 realm 从 control sequence/epoch 0 初始化；旧 incarnation 的 pending/delivered/action 即使后来恢复同 Reminder ID 与 epoch 也必须因 request/payload/action incarnation fence 永久 no-op；
- migrate/restore/manual rollback 在 active control、receipt 与 bootstrap active-anchor CAS 间的每个 kill point，只能从 expected prior anchor 幂等推进到 matching current anchor；冲突值阻断，不能开放业务写或把 prior anchor 当 current；
- `activation_abort` 在 validating、terminal active control、prior-generation reopen、recovery receipt 和 active-anchor CAS 每点 kill；重启只能完成同一预留 terminal identity，且 control/receipt/anchor 精确匹配，永不以旧 receipt 直接开放、改变通知 incarnation/epoch/revision 或返回被中止 operation 成功；
- 最新 slot 截断/tag 错而另一 slot valid；相同 sequence 冲突；两个 slot 坏；未知 generation/path traversal/symlink；
- validating 前 crash、pointer 后 marker 前 crash、marker 后 active control 前 crash、active control 后 Repository 前 crash；
- marker transaction 的每个 statement、commit、FULL sync、close/read-back 前后 kill；marker-only、task-only、owner-only、少/多 pair、任一行 realm 不同或部分初始化都不得成为 committed 可见状态；
- typed marker 必须持久绑定 expected bootstrap/install-presence/CandidateEvidence digest、Installation/incarnation、validating/expected-active control sequence；receipt 必须另绑定 marker digest。active 无 receipt 的新进程只能据这些字段 CAS prior→current anchor，缺失或冲突即阻断；
- 非 initialize 的 validating 无 marker 时必须走 `activation_abort`，terminal control/receipt/anchor 都保持 prior Installation/incarnation/epoch/revision/task state；marker 后完成 target 只递增一次；initialize 始终 epoch 0，migration 始终零次递增；
- initialize validating 无 marker 时只能以 matching initializing record 建新空 candidate/更高 validating control 后回收旧 candidate；其他 operation 无 marker 时只能复验 prior marker/receipt/counter，写预留 abort control + recovery receipt + active-anchor CAS，二者的 dormant task 都永不提前运行。有 marker 时只有 operation-specific marker/task/owner/精确 pair state/seed invariants 全匹配且 task/owner/每个 pair 都携带同一 realm 才能完成 active，否则 integrity-blocked；active control 但无 ActivationOpenReceipt 时重复相同检查，active+receipt 但 bootstrap 仍为 marker/abort journal 绑定的 expected prior anchor 时只可幂等 CAS，其他冲突值阻断；普通启动不得把合法新 revision 重置为 0；
- validating 阶段 reminder reconcile/response/action 无法取得 lease；activation gate 等待事务内 action 完整提交或回滚；
- active 后完成一笔新业务写，再破坏最新 slot/DB，证明不会自动回 previous；
- Android 目标文件系统实际支持/验证 `ATOMIC_MOVE`，Apple barrier/full sync 行为真机掉电/强杀测试；
- 切换时仍有 statement/cursor/connection/attachment stream 必须被 gate 阻止，不强行 rename open file。

### 4. 恢复与恶意输入

- TD-011 pass 1 未验证全部 member/FINAL/EOF 时无法构造 `VerifiedBackupHandle`；两遍间关闭/替换/修改 staging 会使 handle terminal；
- pass 2 未正常结束、sink receipt 缺失、operation/candidate/handle/plan/whole-container identity 不匹配或 evidence 重复消费时，无法 seal/preview/activate；
- portable schema 多/少表列、duplicate/错误类型、trigger/view/virtual table、超长值、深 JSON、巨大 page/count、恶意 record ID 和引用环；
- `trusted_schema=OFF`、DEFENSIVE、`ENABLE_TRIGGER=0`、`ENABLE_VIEW=0`、`SQLITE_LIMIT_ATTACHED=0`、authorizer、NOFOLLOW、extension disabled 和其余 SQLite limits 在 release 二进制实测；
- Installation、keys、app lock、permission、session、BYOK、telemetry consent 不被备份覆盖；portable 偏好按字段恢复；
- restore candidate 排除六类通知设备投影、平台 ID、能力/环境/channel/budget、force marker 和旧 task/checkpoint/receipt/watermark；保留 Plan/Instance/业务 dedupe，逐项穷举 §8 六条 mapper，验证严格首条命中、字段清理和过去目标不补发；
- candidate seal 前恰有一个 gate 为空的 dormant coordinator task，preview 同时绑定 operation/candidate generation、Installation/incarnation/target epoch、notification initialization contract version、pair-set digest 与 receiving overlay digest；任一绑定变化必须重新构建或重新确认，不能修改 sealed task；
- 10,000 附件/5 GiB root、缺失/损坏附件、restore re-encryption 任一点 kill、locator collision 和 GC lease；
- preview 后当前 generation/counter 改变会要求重新确认，不能覆盖未预览变化；
- preview cancel 清理 candidate；activation gate 前/后注入 late cancel，证明最终返回与 old/new/integrity-blocked 实际状态一致，绝不把已提交 new active 报为 canceled；
- switch 前所有失败当前 active 不变；validating 自检失败只经 `activation_abort` 重新锚定 prior active；marker 后失败阻断/完成而不静默回旧；
- `phase=active` 后 activation-recovery reopen、operation-specific read-back、ActivationOpenReceipt 或 bootstrap active-anchor CAS 失败不得返回 operation success；普通 Repository 已开放后 projection/notification rebuild 失败返回成功 + degraded reconciliation，并保持新 active；
- initialize/恢复/手动回滚 activation 前后构造不匹配 incarnation 或旧 epoch delivered response，证明同业务 ID 且 stale cleanup 尚未成功时也永久 no-op；migration 保持 incarnation/epoch 且现有请求可按 fingerprint 收敛；
- coordinator task、revision-0 owner 和精确全部 pending pair state 都携带并匹配同一 Installation/incarnation/target epoch/revision 0/pair-set digest，在 marker transaction 后共同耐久；步骤 13 前后立即 kill 仍能由冷启动按 receipt/anchor 状态唯一收敛；任一 pair 平台失败只可发布同 realm/revision/digest 的完整 degraded run、无成功水位并保留 coordinator，返回成功 + degraded reconciliation；
- 恢复后 search/today/thumbnail 重建、TD-009 通知定向清理和强制重挂、过去提醒不补发、sync provenance/generation gate。

### 5. 安全和产物

- 解包 release 验证 no-backup、无数据库 inspector/任意 SQL、单 SQLCipher link、版本/compile allowlist；
- 日志、崩溃、诊断、heap snapshot 和控制文件不含 raw key、用户内容、原路径或 portable row；
- portable DB 解密后的 table/column 实际集合与分类清单逐项比对，free page 不含 device-only/derived 内容；
- independent security review 覆盖 key handle、control AEAD、TOCTOU/path、untrusted SQLite、migration supply chain 和 rollback data loss；
- 官方 SQLite/SQLCipher/Expo 版本升级前重跑全部合同、故障注入与历史 fixture。

## Rollout and rollback

首个包含真实用户数据的构建即发布 TD-004 `InstallationBootstrapRecord`、严格 all-absent 判定、`EmptyCandidateEvidence` 和 initialize sequence-0/receipt 合同，不先发布固定 `main.db`、无 owner 的空库或可由 Database Manager 自建的路径。已有内部开发数据库通过一次性、可丢弃 importer 进入 generation；不冒充 fresh、不形成公开兼容承诺。

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
| 2026-07-26 | 将通知初始化合同升为 v2 三元 realm，task/owner/pair/receipt/guard 全量绑定 Installation/incarnation/epoch。 |
| 2026-07-26 | 补齐真正首次安装判定、InstallationBootstrapRecord/EmptyCandidateEvidence、sequence-0 initialize activation、稳定 presence/incarnation 围栏、counter headroom、activation-abort/active-anchor CAS、成功边界与崩溃恢复。 |
| 2026-07-26 | 将六类通知设备状态排除在 portable 外，固定 dormant coordinator task、NotificationDatasetState/全 pair 原子初始化、ActivationOpenReceipt、严格恢复 mapper 与崩溃 read-back。 |
| 2026-07-26 | 固定通知 lease/epoch 激活边界、validating 回旧语义、marker 事务中的同 realm force-reconcile，以及 portable 提醒状态规范化。 |
| 2026-07-26 | 对齐 TD-011 两遍恢复，以一次性 Pass2CompletionEvidence 封口 candidate；统一 TD-006 LongCounter、备份 lease 释放、单次 fresh auth、Repository-open 成功点和 late-cancel 终态。 |
| 2026-07-26 | 采用 TD-005 CiphertextIdentity，并明确 sealed generation 只保留权威原附件、派生缩略图清引用后重建。 |
| 2026-07-26 | 明确 active 动态附件 root 同时覆盖权威原附件和仍被引用的派生缩略图。 |
| 2026-07-26 | 区分 active 动态附件 root 与 sealed manifest；增加通知数据集 epoch；显式禁用不可信 SQLite trigger/view/ATTACH；统一回滚检查点自动删除资格。 |
| 2026-07-26 | 接受 SQLCipher capture/export/portable 三路径、candidate-only migration、双槽 generation control、activation marker、不可信 portable reader 和多 root 附件协议。 |

# 生活有谱数据生命周期规范

> 项目代号：`life-book` · 版本：v1.4 · 更新日期：2026-07-26 · 状态：文档基线
>
> 权威范围：本地数据、临时数据、附件，以及备份/恢复/导出/导入/删除/迁移的产品范围、用户可见成功/取消、保留和兼容承诺
>
> 不负责：具体加密算法与 byte framing、认证 manifest 字段、物理数据库表、云同步冲突和法律保留期限
>
> 依赖文档：[领域模型](domain-model.md)、[业务规则](business-rules.md)、[账号与同步](account-and-sync.md)、[产品需求基线](product-features.md)、[质量属性基线](quality-attributes.md)、[TD-010 原子恢复](adr/0010-sqlite-snapshot-migration-and-atomic-restore.md)、[TD-011 备份密码学](adr/0011-backup-container-and-cryptography.md)

## 1. 数据状态总览

```text
用户输入
├── 未确认表单/智能草稿（当前会话临时）
└── 用户保存/确认
    └── 本地持久数据（P0 权威；绑定后为同步副本）
        ├── active / archived
        ├── trashed（默认 30 天）
        └── purged（P1/P2 可保留最小墓碑）

本地持久数据
├── 用户主动创建 → 加密备份（可恢复）
├── 用户主动创建 → 未加密导出（不可直接恢复）
├── P1 可选 → 云备份 / 同步副本
└── 索引、缩略图、系统通知等可重建副本
```

## 2. 数据分类与权威性

### DATA-001：数据类别

| 类别 | 示例 | 权威性 | 默认位置 |
| --- | --- | --- | --- |
| 领域数据 | 记录、清单、周期实例、库存意图/流水、提醒计划 | P0 本地权威；绑定后本地是可同步副本，其中 StockChangeIntent 本地持久、StockTransaction 只由服务端权威过账后同步确认 | 加密数据库 |
| 附件内容 | 图片、用户文件 | 权威内容 | App 私有加密文件区 |
| 安全材料 | `DeviceWrappingKey`、数据/附件/控制 key、令牌、P1 自带 Key | 权威但不可导出为普通数据 | 系统安全存储 |
| 当前安装状态 | Installation ID、权限状态、平台调度 ID | 当前设备权威 | 安全存储/本地数据库/系统 |
| 可重建数据 | 搜索索引、缩略图、今天投影、通知队列 | 非权威 | 本地缓存或系统队列 |
| 当前会话临时数据 | 未保存表单、智能原始输入、临时附件 | 临时 | 内存或加密临时区 |
| 运行诊断 | 请求 ID、错误码、性能分桶 | 非业务数据，受保留规则限制 | 本地/经同意的服务端 |
| 用户持有副本 | 加密备份、未加密导出 | 产品无法远程控制 | 用户选择的位置 |

### DATA-002：单一事实源

- P0 领域数据库和附件是本机唯一业务事实源。
- Redux、页面状态、搜索索引、系统通知、导出和备份不是在线编辑事实源。
- 恢复成功后，恢复出的 generation 成为新的本地事实源；原 active 被封口为短期只读 previous generation。
- P1 同步使用增量变更协议，不复制整个 SQLite 文件作为跨设备事实源。

## 3. 当前会话与临时数据

### DATA-010：未保存表单

- 表单输入在页面当前会话保留，权限拒绝、系统文件选择取消、模型失败和局部网络错误不得清空。
- 用户主动返回且存在修改时，明确选择继续编辑或放弃。
- P0 不承诺 App 被操作系统终止、设备重启或用户确认放弃后恢复未保存表单。
- 未保存表单不得出现在生活簿、备份、搜索、同步或遥测中。

### DATA-011：智能创建临时数据

- 原始输入、追问答案、模型响应和草稿只存在于当前智能创建会话及完成请求所需的在途处理。
- 用户确认后只把标准领域字段写入数据库，不保存完整模型响应、推理文本或供应商原始格式。
- 转手动时把可安全映射的用户原始输入带入表单内存，不先生成正式记录。
- 退出并确认放弃、硬超时后的用户取消或 App 进程终止时清除客户端临时会话。
- 服务端和供应商临时处理、日志及留存边界由智能与安全规范定义，不能用“客户端未保存”概括。

### DATA-012：临时附件

- 选择后的文件立即复制到加密临时区；不长期依赖相册、聊天或文件提供者原路径。
- 表单提交成功后提升为正式附件；取消或失败后排队清除。
- 无引用临时附件最长保留 24 小时，用于崩溃恢复清理而不是恢复表单。
- 清理任务幂等，不能删除已经提升为正式附件的同路径文件。

## 4. 本地数据集

### DATA-020：数据集组成

一套完整可恢复的用户数据至少包括：

- 本地身份；
- 默认个人空间及后续用户拥有/加入空间的可备份部分；
- 记录根、五种类型详情和所有权威子对象；
- 分类、标签、记录关联和用户模板；
- 权威原附件内容及其逻辑元数据；备份时由 TD-005 认证解密后直接送入 TD-011 外层加密流，不复制源设备附件密文、locator 或 key envelope；
- 提醒计划、必要实例和业务去重状态；
- 库存变化意图（含 pending/rejected）和已过账流水；projectedQuantityCache 可重建，不是必要唯一副本；
- 回收站内容及 `trashedAt`、`purgeAfter`、`serverTrashedAt`、`serverPurgeAfter`；
- 已绑定数据集为安全恢复所需的未确认 SyncMutation、SyncCursor 与 snapshotGeneration；它们必须加密保存，但不是用户可读业务历史；
- 用户内容相关设置，例如周起始日、通知内容模式和备份提示状态；
- Schema、规则引擎和数据格式版本。

这里的“完整”只指 portable 业务数据闭包，不等于复制源设备运行态。提醒部分保留 ReminderPlan、ReminderInstance 与业务 dedupe；六类通知设备投影、平台身份和对账运行态必须排除并由接收设备重建。

### DATA-021：不随用户数据集迁移的设备状态

以下不从备份覆盖接收设备当前值：

- Installation ID；
- `DeviceWrappingKey`、`DatabaseDataKey`、`AttachmentRootKey`、`DatasetControlKey` 及其设备本地 envelope；
- 生物识别注册状态和系统凭据；
- 操作系统通知、精确提醒、相册、相机和麦克风权限；
- 系统通知平台 request/native ID、渠道用户设置、已展示通知、capability/environment/budget、明确呈现刷新意图，以及旧 reconcile task/checkpoint/receipt/watermark；
- `NotificationDelivery`、`NotificationActionInbox`、`NotificationDatasetState`、`NotificationSchedulingDecision`、`NotificationSchedulingRun`、`NotificationReconciliationState` 六类通知设备投影；
- P1 设备会话令牌、服务端刷新令牌和自带 API Key；
- 遥测同意（按当前地区和政策重新确认）；
- 智能数据说明确认（版本或地区变化时重新确认）；
- 可重建搜索索引、缩略图、今天投影和普通缓存。

恢复后使用接收设备当前或为 candidate 新生成的 DatabaseDataKey/AttachmentRootKey 重新保护内容，保持接收设备 DatasetControlKey，并从接收设备的无内容 `DeviceStateOverlay` 与签名 build 合同重新建立权限、能力、registered notification pair 和版本基线；不得从 source/portable 猜测或补值。

### DATA-022：系统自动备份排除

数据库、附件、`DeviceWrappingKey`/`DatabaseDataKey`/`AttachmentRootKey`/`DatasetControlKey`、设备 envelope 和安全令牌必须从 iOS/Android 普通自动应用数据备份中排除，除非未来专门设计并验证兼容密钥恢复。原因：恢复密文却没有原设备安全密钥会产生无法打开的幽灵数据，也会绕过产品明确的加密备份流程。

用户可恢复路径是产品内版本化加密备份，P1 再增加明确的云备份。

## 5. P0 加密备份

### DATA-030：备份目标

加密备份必须满足：

- 用户主动创建并选择保存位置；
- 无账号、无网络也能创建和恢复；
- 文件离开 App 私有目录后仍保持机密性和完整性；
- 默认 `complete` 备份包含全部权威生活数据与所有 available 权威原附件；若预检发现 missing/corrupt，只有用户明确选择后才能生成 `recoverable_with_attachment_gaps`，仍保留其逻辑元数据但不得宣称“全部附件完整”；
- 不包含设备主密钥、服务令牌、API Key、搜索索引、系统调度 ID、六类通知设备投影或旧通知任务/回执；
- 能在兼容版本的另一台设备恢复；
- 创建成功前完成结构和解密验证。

### DATA-031：文件与格式

- 推荐扩展名：`.lifebook`；
- provider MIME hint：`application/vnd.life-book.backup`；扩展名/MIME 都不是信任依据；
- 默认文件名：`生活有谱备份-YYYYMMDD-HHmm.lifebook`，只暴露产品名和创建时间，不含用户内容；
- 文件使用版本化容器，不是裸数据库副本；
- 公共头只包含识别与解密必需信息，不含记录数量、标题、附件名或账号；
- 加密容器由公共头、独立 AEAD-encrypted manifest 和一个 secretstream payload 构成；payload 只连续包含 portable SQLCipher DB、available 权威原附件和未来受控 non-critical extension member，没有成员路径、ZIP entry 或明文目录；
- [`specs/backup/container-v1.md`](../specs/backup/container-v1.md)唯一负责 header offset、registry、AAD、member/chunk framing 与长度公式；[`specs/backup/manifest.schema.json`](../specs/backup/manifest.schema.json)唯一负责认证 manifest 字段与 Schema 条件；portable/active 物理表由持久化 Schema 文档负责。

### DATA-032：备份口令

- 备份使用与设备解锁、账号密码和 App 锁独立的口令。
- 最少 10 个 Unicode 码点，允许密码管理器生成/粘贴和显示确认；不强制复杂字符组合。
- 创建时输入两次并一致，显示强度建议但不把常用句子静默上传检查。
- 口令和任何 raw/unwrapped key 不写入数据库、日志、遥测或备份文件；容器按 TD-011 必须携带 passphrase-wrapped `BackupRootKey` envelope 与 root-wrapped `SnapshotDataKey` slot，它们不是 raw key。
- P0 不托管恢复密钥；忘记口令后无法恢复，创建和恢复页必须明确说明。
- 用户可以把口令保存到其选择的系统密码管理器，但该操作独立于生活有谱备份。

### DATA-033：备份范围

P0 只提供“完整加密备份”，不允许用户通过取消勾选敏感记录生成看似完整却无法恢复的数据集。范围包括：

- active、archived 和 trashed 记录；
- 所有历史周期实例、清单结构、库存变化意图和已过账库存流水；
- 用户模板、分类和标签；
- 可用附件；
- 损坏/缺失附件的元数据与诊断标记；
- 内容相关设置与版本。

portable 范围明确保留 ReminderPlan、ReminderInstance 和业务幂等/dedupe，但排除 DATA-021 的六类通知设备投影、平台 ID、权限/capability/environment/channel/budget、force marker 与旧 reconcile task/checkpoint/receipt/watermark；不得通过“完整备份”把设备投影重新解释为必需内容。

manifest 必须分别记录 `state=pending` 的 StockChangeIntent 数量，以及 state 不为 `acknowledged` 的 SyncMutation 数量（精确集合以 manifest Schema 注释和领域状态机为准），供恢复预览和后续同步安全判断；projectedQuantityCache 不必备份，恢复后从确认账本和 pending 意图重建。

不包含第三方系统模板的可再生成内容本体，但 manifest 记录 portable 数据实际引用的唯一 `(sourceTemplateId, sourceTemplateRevision)` 集合；不使用含义重叠的 `sourceVersion` 代替。由用户修改的模板副本作为用户模板完整包含。

### DATA-034：创建流程

```text
检查可用空间与数据状态
→ 用户选择并准备 provider 目标，设置并确认口令
→ 生成数据库一致性 capture
→ 冻结权威附件集合并取得读取 lease，构建 portable 数据库与 manifest
→ 验证引用、大小和哈希
→ 在私有且排除系统备份的 staging 流式加密容器
→ 关闭、sync、重新打开并验证头、口令、manifest、全部 payload、唯一 FINAL 和 exact EOF
→ 计算私有文件精确长度与 whole-container SHA-256，释放 snapshot/附件/维护 lease
→ 写入并 commit 已选择的 provider 目标
→ 关闭并重新打开目标，验证精确长度与 TargetContainerIdentity
→ 记录成功并显示文件、时间、大小和验证结果
→ 清理所有临时明文/密文
```

provider selector/分享目标 UI 和口令确认必须在取得任何数据集 lease 前完成；取得 provider handle、私有 staging 验证完成或系统分享面板打开都不是成功。不得直接复制正在 WAL 模式运行的数据库文件；capture、lease、容器和目标身份算法分别遵循 TD-010、TD-011 及其规范性容器契约。

### DATA-035：空间和资源预检

- 创建前估算数据库、附件、容器开销和临时空间；至少需要估算输出大小的 1.5 倍可用临时空间，具体实现可更严格。
- 数据库完整性检查失败时停止并提供诊断，不生成“部分成功”的完整备份。
- 附件缺失/损坏时列出不含敏感文件名的数量，让用户选择先修复或生成带明确缺失标记的备份；后者仍可恢复其余数据，但不能显示“全部完整”。
- 进程仍存活时可以在安全 chunk 边界暂停并继续；P0 进程被系统终止后删除 partial，从头重新创建，不保留可跨进程复用的 `BackupRootKey` 或续跑状态。
- App 进入后台、空间不足或 provider 失败时安全暂停或失败；当前权威数据不因备份写入而改变。

### DATA-036：成功条件

只有同时满足以下条件才记录备份成功：

- 私有 staging 已关闭、sync、重新打开，公共头、口令、manifest、全部成员、唯一 FINAL、exact EOF 和数据库一致性全部验证通过；
- provider 写入与 commit 成功，目标已关闭；
- provider 目标已重新打开，精确长度及 `TargetContainerIdentity` 与已验证私有 staging 完全一致；
- 临时敏感文件已排队清理。

仅“分享面板已打开”、provider 返回 handle、私有 staging 验证完成或写出了一部分字节都不能算最终成功。

## 6. P0 整体恢复

### DATA-040：恢复不是导入

P0 恢复用备份中的完整数据集**整体替换**当前生活数据，不合并记录、不逐条选择、不按标题去重。通用合并导入属于 P1。

### DATA-041：恢复预检

用户选择文件后，按顺序验证：

1. 按 TD-011 把 provider 来源稳定为私有 regular-file 密文 staging，并通过资源门限；
2. 验证公共 magic、全部兼容选择器、声明长度和 hard limit；
3. 处理口令并认证 root envelope；错误口令、root envelope 损坏和相关截断统一为 `backup_unlock_failed`；
4. 认证并解析 canonical manifest，验证 Schema、required feature、成员计划和全文件精确长度；
5. 第一遍认证全部成员、计长、哈希、唯一 FINAL 和 exact EOF，成功后才产生一次性的 `VerifiedBackupHandle`；
6. 预检私有密文 staging、candidate、附件重加密和 previous generation 所需空间；
7. 由该 handle 打开第二遍会话，把再次认证的 portable member/附件写入可丢弃 staging；只有完整成员计划、terminal sink receipt、唯一 FINAL 和 exact EOF 全部匹配才产生 `Pass2CompletionEvidence`；
8. 在读取任何输入 Schema/业务行前以 TD-010 defensive/read-only 配置打开 portable 数据库，按已认证 `portableDataSchemaVersion` 选择签名 build 内的专用只读 mapper，用预编译 allowlist 逐字段复制到 fresh current-schema candidate；绝不在不可信输入上执行 migration SQL、trigger/view、backup API、`sqlcipher_export` 或写操作；
9. 使用该 mapper 完成附件重加密、REM-012 提醒状态规范化、实体/引用/资源/全部业务不变量检查；未知必需字段、版本、枚举或未消费 portable 字段安全失败；
10. 从接收设备 `DeviceStateOverlay`、当前 transport enablement/managed-evidence 摘要和签名 pair registry 派生精确 registered pair set/digest；在 candidate seal 前创建恰好一个绑定 operation/candidate/target epoch/revision 0/digest、activation gate 为空的 dormant notification coordinator task，且不创建六类通知设备投影；
11. 生成不含内容的恢复预览，并把它绑定到预期 active generation/mutation counter、当前/目标 notification epoch、candidate/evidence、`notificationInitializationContractVersion`、registered pair-set digest 与 receiving overlay digest。

激活前任一失败都不得以 candidate 覆盖当前权威逻辑数据集。预检期间业务写入仍可改变 active；若最终独占门内发现 generation、mutation counter 或 receiving overlay digest 不等于预览值，candidate 不得激活，必须重新预检并让用户再次预览。target epoch、pair-set digest 或 initialization contract 改变还会使 sealed dormant task 失配，必须重建 candidate，不能在激活临界段补丁修改。

### DATA-042：恢复预览

验证通过后显示不含内容正文的摘要：

- 备份创建时间、App 版本、格式版本；
- 五种记录、模板和附件数量；
- active、archived、trashed 数量；
- 总大小；
- `complete` 或 `recoverable_with_attachment_gaps` 状态，以及缺失/损坏附件数量；
- 数据集绑定、provenance 和待处理库存/同步状态的非内容摘要；
- 当前数据将被整体替换；
- 当前系统权限、设备密钥和登录会话不会从备份覆盖；
- 接收设备当前提醒权限/渠道/transport 配置保持不变，恢复提交后会按当前 registered pair 重新检查；
- 建议先为当前数据创建备份。

最终确认只执行一次 fresh 应用锁或设备凭据认证，并把认证、明确覆盖确认、preview digest、预期 generation/counter/current+target notification epoch、candidate、`Pass2CompletionEvidence`、notification initialization contract、pair-set digest 和 receiving overlay digest 绑定为同一短时操作；任何变化都使确认失效。

### DATA-043：原子替换

```text
VerifiedBackupHandle 第二遍认证并构建 candidate
→ 取得 Pass2CompletionEvidence
→ 防御性映射/验证，写入唯一 dormant notification coordinator task 并 seal candidate
→ 生成绑定预期 active generation/counter/evidence/target epoch/init contract/pair digest/overlay 的 preview
→ 执行一次 fresh 认证和明确覆盖确认
→ 取得独占激活门并重读、比较全部 preview guards
→ seal 旧 active 为 previous generation
→ 写入带 target notification epoch、phase=validating 的认证 DatasetControlRecord
→ 测试打开 candidate
→ 在一个 DELETE/FULL 事务写 activation marker、激活唯一 task、创建 revision-0 owner 和精确全部 pending pair state
→ close/sync/read-back marker、task、owner 与 pair 全集；Run/Decision/Delivery/Inbox 必须仍为空
→ 写入 phase=active 的认证 DatasetControlRecord
→ 以 activation-recovery 模式重新打开 candidate/Repository，并复验初始化集合
→ 提交 ActivationOpenReceipt 后才开放业务写入并返回 RestoreSucceeded
→ 唤醒任务，提交后重建索引、缩略图和未来提醒
```

不另复制一份回滚检查点：切换时封口的旧 active 就是只读 previous generation。marker 前 candidate 除唯一 dormant task 外没有六类通知设备投影；marker、task activation、NotificationDatasetState 和精确 pair states 要么在同一 SQLite 事务全部出现，要么全部不出现。只有 `phase=active` 已持久化、candidate/Repository 可重新打开、完整初始化集合复验通过且 ActivationOpenReceipt 已提交后才返回恢复成功；搜索、缩略图或通知收敛失败进入 degraded reconciliation，不回滚已提交的数据集。

启动恢复的唯一分支为：`validating` 无 marker 时回 previous，dormant task 永不运行并随 candidate 回收；`validating` 有 marker 时只在 marker/task/owner/精确 pair 全匹配时完成同一个 target epoch，缺失/多余/不匹配直接 integrity-blocked，禁止补建或回退；`active` 但无 open receipt 时重复完整复验、打开 Repository 并写 receipt 后才开放；有匹配 receipt 后走普通启动，不能把之后合法推进的 revision 重置为 0。`active` 后不得静默回 previous，任何时刻都不得让两个 generation 混合可写。

### DATA-044：previous generation

- previous generation 使用当前设备密钥加密，只读保存在 App 私有且排除系统备份的目录；它不是用户备份，不上传且不出现在系统分享面板。
- 自动删除必须同时满足：`activatedAt + 7×24h` 已到、至少完成一次恢复后的冷启动自检、active 完整 gate 通过且没有任何读取/维护 lease。冷启动或清理任务迟到时实际保留可超过 7 天。
- 用户可以重新认证并明确选择提前删除，以释放空间。
- 自动回退只允许发生在 `phase=validating` 且 activation marker 尚未写入；marker 存在或 `phase=active` 后不得静默使用 previous。
- 手动回滚把只读 previous 复制成新的 candidate，重新执行预检、preview、fresh 认证和 TD-010 激活；不得直接把 previous 改成可写 active。
- 清除本机数据和卸载会删除 previous generation；空间管理、损坏隔离和 lease 规则由 TD-010 统一约束。

### DATA-045：恢复后的身份与设置

- 恢复备份中的 LocalActor 和空间/记录 ID，保持创建人引用。
- 保持接收设备当前 Installation ID。
- 不恢复源设备的 `DeviceWrappingKey`、`DatabaseDataKey`、`AttachmentRootKey` 或 `DatasetControlKey`；candidate 使用接收设备当前或新生成的 `DatabaseDataKey`/`AttachmentRootKey` 重新保护内容，并保持接收设备现有 `DatasetControlKey`。
- 保持当前系统权限、应用锁认证能力、账号会话和遥测同意；不从备份打开权限。
- `DeviceStateOverlay` 从接收设备为每个受支持 notification pair 固定 environment generation、含适用 channel 状态的 capability fingerprint、budget、transport enablement 和无内容 `hasManagedEvidence`；签名 build 提供 pair registry、tzdb/recurrence/adapter 和 notification initialization contract。二者派生 runtime active/retiring pair set/digest，source/portable 不得提供这些值，dataset replacement 本身不增加 environment generation。
- 用户内容偏好可以恢复，但智能说明或法律同意版本过期时重新确认。
- P1 已登录且备份属于其他账号时停止自动同步，先进入认领/冲突流程。
- 隔离恢复出的本地实体 ID 在该副本内保持稳定，不等于获准上传。任何恢复出的 pending mutation 只有在同一 Account、同一 Space、同一 authorizationMembershipId（适用时）和同一 snapshotGeneration 全部验证后才能自动 push；generation 过期时先快照重建，再让用户逐项重放为新 mutation 或导出，不能直接发送旧队列。

### DATA-046：恢复后的提醒

- portable 保留 ReminderPlan、ReminderInstance 和业务 dedupe，但不恢复六类通知设备投影、平台 ID、旧 task/checkpoint/receipt/watermark、能力基线或“已展示”假设。
- ReminderInstance 必须严格按下表第一条命中；来源失效只按 REM-021 穷举谓词判断，不能另造模糊分支：

| 优先级 | source 条件 | target 状态 | 字段/投递结果 |
| ---: | --- | --- | --- |
| 1 | `acknowledged/snoozed/cancelled/expired` | 保持原终态 | 不重建平台请求。 |
| 2 | 其余实例来源已失效 | `cancelled` | 离开 paused/failed 时清对应 `pauseReason/failureCode`。 |
| 3 | `paused` 且原因仍成立 | `paused` | 保留 `pauseReason`，不重建。 |
| 4 | `paused` 原因失效，目标未来/已过 | `planned` / `expired` | 清 `pauseReason`；过去不补发。 |
| 5 | `scheduled/failed` 且来源有效，目标未来/已过 | `planned` / `planned` | 清 `failureCode`；过去只作 application-only 待查看/逾期，不进入 desired。 |
| 6 | `planned` 且来源有效 | `planned` | 过去目标不进入 desired。 |

- 激活从独占门内重读的 current control checked `+1` 得到 target `notificationDatasetEpoch`；validating 无 marker 回旧增量为 0，marker 后完成同一 target 不二次增加，schema/cipher migration 增量为 0。旧 epoch callback/action 在任何清理之前就永久 no-op。
- marker transaction 激活唯一 coordinator task、创建一项 revision-0 active NotificationDatasetState 和 runtime digest 对应的精确全部 revision-0 pending ReconciliationState；字段和 receiving-device/build baseline 必须满足 TD-010，Run/Decision/Delivery/Inbox 初始为空。
- Repository 开放后 coordinator 按 pair 分发：先定向清理旧/非法 epoch managed IDs，再只为未来计划重挂。若 overlay/pair 输入已改变，先以一次 owner revision `+1` fan-out 全 pair，再做平台写；单 pair 不能清 task 或全局 marker。
- 每个 pair 完整成功才发布 succeeded 水位；平台/清理错误可以发布同 revision/digest 的完整 degraded Decision run，但 `scheduledThrough/lastSucceededAt` 为空且 coordinator 保留。权限/channel/容量等确定性 Decision 可在零平台调用的完整 succeeded run 中解释，不伪造 Delivery。
- 通知/精确提醒权限不具备时计划仍保存；只要 succeeded/degraded pair 的 `publishedRunId` 指向完整 current revision/digest run，就按 current Decision 显示“等待通知权限/提醒渠道已关闭/等待补齐/失败”等单条状态并汇总不含标题的数量；没有 current published run 时才把对应结果显示为“正在重新检查”。degraded pair 仍不得展示成功水位，pair/全局检查状态保持“正在重新检查”；只有 current owner/digest 下的 succeeded pair 才展示其水位，精确全部 pair succeeded 才显示“全部提醒方式已检查”。

### DATA-047：取消和失败

- 口令输入、第一遍认证、第二遍认证、candidate 构建/验证和预览阶段都可以在安全 chunk/batch 边界取消；删除未提交 candidate 和 operation-scoped key handle。
- 一旦取得激活独占门，普通返回或迟到取消不再改变结果；界面进入不可取消的“正在切换数据”并等待启动/当前进程收敛。该临界段只能得到旧 active、新 active 或 integrity-blocked，不能把已提交的新数据集报告为 canceled。
- KDF 前可区分格式/版本不支持；root envelope 认证前，错误口令、envelope 篡改和相关截断统一显示 `backup_unlock_failed`。只有 root 已认证后的损坏才可分类为文件损坏；空间不足和迁移失败使用各自用户文案，日志只含错误码和非内容诊断。
- 激活前失败不以 candidate 覆盖当前权威逻辑数据集；若当前数据原本已损坏，不能把它描述为恢复导致。

用户/API 终态矩阵固定为：

| 耐久边界 | 启动/处理结果 | 用户状态 |
| --- | --- | --- |
| 未取得独占门，用户取消 | candidate/临时 key 清理，active 不变 | `RestoreCanceled`：“已取消，当前数据未更改”。 |
| 独占门后、validating control 前失败 | old active 仍唯一有效 | `RestoreFailed`：“恢复失败，当前数据未更改”。 |
| `phase=validating`、无 marker | startup 回 previous；dormant task 永不运行 | 启动恢复完成后报失败/中断，明确“当前数据未更改”。 |
| marker 已提交、active control 或 open receipt 未完成 | 完整 read-back 后完成同一 target；不匹配则 integrity-blocked | 重启时只显示“正在完成恢复”，不提供取消或旧数据入口。 |
| `phase=active` + matching open receipt + Repository open | 新 generation 是唯一事实源 | `RestoreSucceeded`；投影尚未完成时附“正在重建”。 |
| 上一行成立但通知任一 pair degraded | 数据恢复成功，coordinator 重试 | `RestoreSucceeded + degraded_reconciliation`：“恢复成功，提醒正在重新检查”。 |
| marker 后任一完整性谓词不匹配 | 不补建、不回 previous、不开放 Repository | `IntegrityBlocked`：显示数据保护页和受控诊断/恢复入口，绝不能冒充取消、普通失败或成功。 |

## 7. 备份兼容策略

### DATA-050：兼容选择器

| 选择器 | 产品级作用 |
| --- | --- |
| `headerVersion` | 公共头布局与 offset。 |
| `containerFormatVersion` | member/payload framing。 |
| `suiteId` | AEAD、HKDF、secretstream 与 AAD 投影组合。 |
| `passphraseProfileId` | 口令 Unicode/PRECIS 处理规则。 |
| `kdfProfileId` | 口令 KDF 算法与参数档。 |
| `manifestSchemaVersion` | 认证 manifest 的核心字段与条件。 |
| `portableDataSchemaVersion` | 备份内 portable 数据模型；接收端必须有兼容 reader/migration。 |
| `portableCipherProfileId` | portable 数据库密文档位。 |
| `scalarEncodingVersion` | ID、时间、计数器等跨平台标量编码。 |
| `databaseSchemaVersion` | 接收设备 active 数据库内部目标版本，不是备份输入格式选择器。 |

选择器各自独立演进，具体 registry、匹配顺序和升级条件由 TD-011 与 `container-v1.md` 唯一定义，manifest 中可认证字段由 manifest Schema 定义，portable/active 物理 Schema 与迁移由持久化 Schema 文档定义。App 必须先安全判断公共格式与资源门限，再认证容器，最后判断 portable 数据能否迁移到当前 `databaseSchemaVersion`。

### DATA-051：向后恢复

- 每个公开版本必须恢复当前格式及所有仍受支持旧 App 产生的备份。
- P0 正式版产生的 v1 容器至少在整个 1.x 产品生命周期保持可恢复；内部数据通过迁移升级。
- 停止支持某旧格式前必须同时满足“已提前至少两个公开版本通知”和“已提前至少 6 个月通知”；生效日不得早于两项门槛中较晚的日期，并提供可在旧版本生成新格式或独立转换的路径。
- 自动化测试保存每个已发布格式的去敏 fixture，所有后续发布候选都执行恢复。

### DATA-052：未来备份

- 旧 App 遇到更高容器或必要 Schema 版本时只显示“请升级生活有谱后恢复”，不得尝试猜测。
- 未知 non-critical member 只有在按成员计划完整认证、计长并校验哈希后才可丢弃；未知 required member 必须拒绝恢复。
- 不允许降级 App 直接打开高版本活动数据库。

## 8. 未加密导出

### DATA-060：导出与风险

导出用于阅读或迁移，不等于加密备份。创建前必须说明：

- 文件没有生活有谱加密保护；
- 保存位置、云盘、聊天和接收应用可能读取内容；
- 删除 App 内记录不会删除已经导出的副本；
- P0 不能直接从导出文件整体恢复。

用户必须主动继续；包含敏感内容时再次通过应用锁/设备认证。

### DATA-061：结构化导出

结构化导出为版本化 ZIP，包含：

- `manifest.json`：导出版本、时间、范围、实体数量和哈希；
- 按实体类型组织的 JSON Lines 或 JSON 文件；
- 用户选择包含的解密附件，使用安全相对路径；
- `README.txt`：格式、未加密风险和字段版本说明。

字段使用稳定机器名、ISO 日期和明确时间语义，不以中文展示文本作为枚举。它面向迁移和用户拥有权，但不是 P0 导入契约。

### DATA-062：可阅读导出

可阅读导出使用离线 HTML + 资源目录或单一可浏览包：

- 按记录类型、分类和标题导航；
- 展示清单、日期、库存流水和历史状态；
- 不包含可执行脚本、网络资源或追踪像素；
- 文件名经过安全规范化，原始标题只出现在内容中；
- 可以选择是否包含附件和回收站。

PDF 不是 P0 全量可阅读导出的唯一格式，因为大量内容与附件难以可靠分页；后续可以提供单条记录 PDF。

### DATA-063：敏感与范围选择

- 默认范围包含 active 和 archived，默认不包含 trashed。
- 敏感记录默认不包含；用户可以明确开启“包含敏感内容”，重新认证并看到数量。
- 完整数据拥有权导出允许包含全部记录、回收站和附件，但必须逐项显示风险。
- 不导出设备密钥、服务令牌、自带 Key、平台调度 ID、原始智能输入、模型响应或诊断日志。
- 不导出 SyncMutation、SyncCursor、Tombstone 或 mutation 幂等收据；结构化导出可以包含有用户输入的 StockChangeIntent，但必须与已过账 StockTransaction 分开标明状态。

### DATA-064：导出失败

- 流式生成到临时位置，全部完成并验证后才交给系统分享/文件选择器。
- 用户取消目标选择后删除临时明文，当前数据不变。
- 附件缺失时在报告中列出数量和记录 ID 的用户可定位短标识，不伪装完整。
- 导出过程可取消；取消后清理临时明文。

## 9. P1 通用导入

### DATA-070：导入阶段

```text
选择来源
→ 只读解析到隔离区
→ 识别格式和版本
→ 字段/类型/时间/单位映射
→ 附件与引用校验
→ 去重候选和冲突分析
→ 用户预览逐类结果
→ 生成带新 ID 或明确映射的导入计划
→ 单批或分页事务写入
→ 结果报告与可回滚批次
```

解析外部文件不能执行脚本、访问任意路径或发起网络请求。

### DATA-071：ID 与去重

- 只有 provenance 可验证为同一 Account、同一目标 Space、类型一致，且服务端既无 active 同 ID 实体也无 Tombstone 时，来自本产品结构化导出的全局 ID 才可以保留；云端为空的 direct claim 属于 SYNC-004，不是导入。
- 其他来源、provenance 不足或任何 ID 冲突都必须为整个聚合生成新 ID，并在一个导入计划中原子重写子对象、附件、RecordLink、提醒、correctionOf/source 等全部内部引用；预览列出重映射数量和断开的外部引用。
- 标题相同不自动判定重复；日期、类型、结构和用户确认共同决定。
- 两份库存账本不得交错、重排或重算既有 ledgerSequence/quantityBefore/quantityAfter。要保留双方完整历史就导入为两个家庭物品聚合；合并到同一物品时只保留选定权威账本，并由用户确认后追加一条新 adjust 建立新起点，另一份原始内容留在导入报告/用户源文件而不伪造成流水。
- 清单模板与实例关系只在双方都导入且引用合法时保留。

### DATA-072：导入回滚

- 一个导入批次拥有稳定 ID，所有创建和更新记录来源批次。
- 用户可以在同步前撤销整个批次；已与其他设备/成员产生后续编辑时进入冲突预览。
- 回滚使用补偿事务，不删除导入后由用户新增的无关数据。
- 导入失败提供逐项报告，不能声称全部成功。

## 10. 回收站与永久清理

### DATA-080：30 天保留

- 未绑定空间使用 `purgeAfter = trashedAt + 30 个绝对 24 小时`。绑定空间离线删除时该值只是界面估算且不得触发永久清理；服务端确认后写 `serverPurgeAfter = serverTrashedAt + 30 个绝对 24 小时`，它才是跨设备有效期限，并同步对齐本地 purgeAfter。
- UI 显示剩余整天并在不足一天时显示“即将永久删除”，不承诺后台精确执行时刻。
- 绑定记录尚无 serverPurgeAfter 时显示“删除日期待同步确认”，不能显示可承诺的永久删除日期。
- App 获得运行机会后清理未绑定到期项；绑定内容由服务端按可信时间执行，客户端收到墓碑后再清除副本。
- 恢复会清除 trashedAt、purgeAfter、serverTrashedAt、serverPurgeAfter，并使待清理任务和迟到删除确认因 revision/serverVersion 失效。

### DATA-081：级联范围

按 BR-015 永久清理记录聚合。额外规则：

- 分类、标签和模板不会因引用记录删除而自动删除；
- 清单模板删除不影响实例；
- 家庭物品流水只随物品根永久删除；
- 关联关系随任一端永久删除；
- 可共享物理附件只有在没有任何有效引用后擦除内容；
- 操作记录按专项规则保留；同步 Tombstone 只允许领域模型 §16.8 的 spaceId、entityType、entityId、serverVersion、serverSequence、purgedAt、retainUntil、reason 控制字段，不含标题、正文、详情、标签、附件、AI 内容或冲突快照，不可用于恢复。
- 裁剪到期 Tombstone 前必须先滚动到更高 snapshotGeneration 并使旧 generation 不可写；业务内容永久清理完成与无内容墓碑仍在安全窗口内不矛盾。

### DATA-082：附件擦除

- 删除引用与擦除文件是可重放任务；数据库先标记不再可访问。
- 普通文件系统和闪存不能保证物理扇区即时覆写，因此安全保证依赖加密密钥销毁和引用不可达，不使用误导性的“已物理粉碎”文案。
- 孤儿扫描只能删除确认无有效引用且超过 24 小时安全窗口的密文文件。
- 缩略图、分享临时文件和解密缓存使用更短保留并在后台/退出时清理。

## 11. 清除本机数据

### DATA-090：范围

清除本机数据删除：

- 本地领域数据库、附件、模板副本和回收站；
- previous/candidate generation、搜索索引、缩略图和临时文件；
- 本地身份、内容偏好和提醒计划；
- 系统通知调度；
- 当前设备 `DeviceWrappingKey`、`DatabaseDataKey`、`AttachmentRootKey`、`DatasetControlKey` 及 P1 用户选择删除的本地令牌/自带 Key。

不删除用户保存在文件、云盘或聊天中的加密备份/未加密导出，也不自动删除 P1 云端账号数据，除非用户另外执行账号删除。

### DATA-091：流程

1. 重新认证应用锁或设备凭据；
2. 展示范围、最近成功备份时间和“不会删除外部副本/云端账号”的说明；
3. 要求输入本地化确认词或执行等强度确认；
4. 取消所有系统通知；
5. 关闭数据库并删除 active/previous/candidate generation 与临时区；
6. 销毁 `DeviceWrappingKey`、`DatabaseDataKey`、`AttachmentRootKey` 和 `DatasetControlKey`；
7. 生成新的 LocalActor 和空默认个人空间；
8. 保持当前 Installation ID，但重置产品使用计数；
9. 运行空数据自检后回到首次空状态。

任一步失败显示当前数据是否仍可用，不能在部分删除后直接进入看似成功空首页。

### DATA-092：卸载

卸载后的实际擦除由操作系统负责。因为 DATA-022 排除普通系统备份，重新安装默认得到新空数据集；只有用户主动选择加密备份或 P1 云备份/同步才能恢复。

## 12. P1/P2 云端生命周期

### DATA-100：云备份与同步分离

- 云备份是有时间点的恢复副本；同步是持续增量状态。
- 删除同步记录会产生墓碑并传播，不等于立即清除所有备份版本。
- UI 必须分别显示最后同步时间和最后云备份时间。
- 恢复云备份进入与本地加密备份相同的预检/替换或明确合并流程。
- 云备份恢复仍须对照当前 Tombstone 和 snapshotGeneration；备份中的已永久删除 ID 不能覆盖墓碑或原 ID 复活，用户明确取回其内容时按 DATA-071 以新 ID 导入并列入报告。

### DATA-101：退出登录

退出前用户选择：

- 保留本地副本：转换为受当前设备保护的可用个人数据，并停止同步；
- 清除本地副本：完成服务端会话撤销后执行本地清理；
- 取消。

共享家庭记录不能被复制为个人数据作为默认保留；只能移除本地缓存，云端权限按成员关系保持或撤销。

### DATA-102：账号删除

账号删除是独立高风险流程，至少包括：

- 导出机会和影响预览；
- 个人空间、云备份、同步设备和家庭角色；
- 家庭创建者必须先转移所有权或删除家庭空间；
- 法律或安全必须保留的最小记录及期限；
- 可撤销等待期是否存在及明确日期；
- 最终删除完成通知。

运营主体与地区未确定前，具体法律期限只在合规文档登记，不虚构。

### DATA-103：成员移除与家庭解散

- 成员被移除后立即失去服务端读取新数据的权限；已同步到其设备的密文/明文处理受同步与未来加密策略约束，必须在家庭规范中说明。
- 家庭解散前提供成员通知、导出/迁移选择、待同步检查和强确认。
- 操作记录和墓碑按家庭规范及法律最小期限保留。

## 13. 数据库与内容迁移

### DATA-110：迁移要求

- 每次 Schema 变化有单调递增版本和显式前向迁移。
- 迁移在副本或受事务保护路径执行；失败不得创建空库覆盖原库。
- 迁移前检查空间，在独立 candidate generation 执行；旧 active 只在提交时封口为 previous，不创建临时拼装的检查点。
- 迁移脚本可重复检测已完成状态，不执行两次破坏性转换。
- 大迁移显示进度、可恢复标识和诊断码。

### DATA-111：迁移验证

每个迁移必须验证：

- 行数和实体类型计数；
- 外键/逻辑引用；
- 五种记录详情一一对应；
- 清单项目、周期实例和库存余额不变量；
- StockChangeIntent/StockTransaction 一对一、账本序列与确认余额不变量；
- 回收站四个时间字段及有效清理期限；
- SyncMutation.snapshotGeneration 与绑定状态；
- 附件 ID、locator、状态、大小、哈希和加密根引用；任何用户/provider 原路径都不得成为持久字段；
- 提醒计划可重算；
- 未知枚举安全失败；
- 从旧 fixture 升级、备份、恢复再打开的往返。

### DATA-112：降级

P0 不支持直接把活动数据库降级到旧 Schema。用户需要回到旧 App 时，只能使用旧 App 支持的备份格式或明确转换工具；不得让旧 App 写入未知高版本数据库。

## 14. 存储不足和损坏

### DATA-120：空间不足

- 普通写入前保留数据库事务和必要 WAL 空间；附件、备份、恢复、迁移和导出执行预检。
- 空间不足时停止产生大文件，保留表单和当前数据，提供存储管理入口。
- 清理只针对可再生成缓存和已确认孤儿；不自动永久删除回收站或附件解决空间。
- 用户可以明确清空回收站，但需显示不可恢复范围。

### DATA-121：数据库损坏

- 先把原文件置为只读并创建诊断副本，不运行会进一步破坏的盲目写入。
- 尝试系统提供的完整性检查和可验证恢复；每个恢复对象记录结果。
- 无法完整修复时提供最近有效备份恢复；只有密钥可用且解密成功、数据库能安全只读打开、存在兼容读取器且待导出范围完整性检查通过时才提供只读导出，否则禁用并给出不含内容的原因和诊断 ID。
- 不把“打不开数据库”解释为“用户没有记录”。

### DATA-122：附件缺失或损坏

- 记录其余字段保持可用；附件显示 missing/corrupt，不崩溃或无限重试。
- 用户可以重新选择文件替换，产生新 attachment ID 或显式修复关系。
- 同步阶段先尝试从其他合法副本恢复；失败后保留元数据用于说明。

## 15. 保留期限摘要

| 数据 | P0 默认保留 |
| --- | --- |
| active/archived 生活数据 | 直到用户删除。 |
| 未绑定回收站记录 | 本地 trashedAt 后 30×24 小时，之后在 App 获得运行机会时清理。 |
| 绑定回收站记录 | 服务端 serverTrashedAt 后 30×24 小时；未确认前不永久清理。 |
| 加密临时附件 | 无引用最多 24 小时。 |
| previous generation | `activatedAt + 7×24h`、后续冷启动自检、active 完整 gate 和无 lease 全部满足后才具备自动删除资格；实际可超过 7 天，用户可重新认证后明确提前删除。 |
| 当前智能创建会话 | 当前进程/会话，退出确认后清除。 |
| 搜索索引和缩略图 | 只要对应数据存在，可随时重建/清除。 |
| 系统通知投递诊断 | 由安全与遥测规范限定，不进入用户备份。 |
| 用户持有备份/导出 | 由用户控制，App 无法自动删除。 |

P1/P2 服务端期限必须结合发行地区、运营主体、供应商和端到端加密决定，并写入法律与安全文档。

## 16. 测试要求

### DATA-130：备份测试

- 空数据、最大设计容量、全部五类记录、敏感内容、回收站、损坏附件；
- 正确/错误口令、Unicode 长口令、密码管理器粘贴；
- 创建中断、App 被杀后不能续跑、目标 provider 拒绝、commit/close/reopen 失败和空间不足；
- complete 与明确 gap 备份、私有 staging/目标精确长度和 `TargetContainerIdentity` 相等、数据库一致性及临时文件清理；
- 文件名和公共头不泄露内容或计数。

### DATA-131：恢复测试

- 干净安装、有现有数据、应用锁开启、权限拒绝、旧格式和未来格式；
- 损坏头、截断载荷、manifest 意外路径字段、symlink staging、重复成员、哈希不符和恶意超大尺寸声明；
- 第一遍前不能取得 handle、两遍间替换/关闭/修改 staging 的 TOCTOU、第二遍没有 completion evidence 不能 preview/activate；
- defensive flags/limits/authorizer 任一缺失即拒绝；所有已发布 portable version 只经签名只读 mapper 进入 fresh candidate，输入 trigger/view/SQL/migration 永不执行；
- candidate 排除六类通知设备投影与设备基线，保留 Plan/Instance/业务 dedupe；穷举 DATA-046 六条 first-match mapper、future/past、pause reason 和字段清理；seal 前恰有一个 gate 为空、绑定 target epoch/revision 0/pair digest 的 dormant coordinator task；
- 在 validating control 写入、first-open、marker transaction 每个 statement/commit/FULL sync/close/read-back、active control、Repository reopen、ActivationOpenReceipt 的每个边界 kill/IO error；marker-only、task-only、owner-only、少/多 pair 不得成为 committed 可见状态；
- `validating` 无 marker 只回 previous 且 task 不运行；有 marker 只在 marker/task/revision-0 owner/精确 pending pair 全匹配时完成 same target epoch，否则 integrity-blocked；`active` 无 receipt 重验后才开放，有 receipt 后不得把合法新 revision 重置为 0；
- 对 DATA-047 每个终态验证 API code、用户文案、可取消性和可访问数据集一致；迟到取消永不把 new active 报 canceled，integrity-blocked 不展示旧/新内容；
- Installation/LocalActor 语义、密钥重封装、receiving DeviceStateOverlay/pair digest、索引和提醒重建；overlay 在 marker 后改变必须全 pair revision `+1` 一次，不因 replacement 增加 environment generation；
- 旧 `notificationDatasetEpoch` 回调/action 永久 no-op；任一 notification pair 失败只发布完整 degraded run、无成功水位并保留 coordinator；通知、搜索、今天投影、索引或缩略图重建失败只产生提交后 degraded reconciliation；
- 只有 Repository 可重新打开、完整初始化 read-back 和 matching ActivationOpenReceipt 均成立才报告成功；激活前每类失败都不以 candidate 覆盖 active。

### DATA-132：删除与迁移测试

- active/archived 删除与恢复、30 天边界、时钟倒退和清理重试；
- 绑定删除离线待确认、设备时间提前、本地估算与服务端期限对齐、恢复后迟到删除确认；
- 有附件、关联、模板来源、库存流水和周期历史的永久删除；
- Tombstone 不含业务内容、generation 滚动后旧设备以 baseServerVersion=0 仍不能复活 ID；
- 清除本机数据的密钥销毁、通知取消和新空空间；
- 每个已发布 Schema/备份 fixture 的升级和往返；
- 同一任务重复执行不误删新 revision 数据。

## 17. 变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| v1.4 | 2026-07-26 | 区分 degraded pair 的 current Decision 可解释状态与不可展示的成功水位。 |
| v1.3 | 2026-07-26 | 排除六类通知设备投影，固定不可信 portable 的只读 mapper、dormant coordinator、marker 中 owner/全 pair 原子初始化、ActivationOpenReceipt、用户终态矩阵和 kill-point 验证。 |
| v1.2 | 2026-07-26 | 对齐两遍认证、provider 目标身份、previous generation、通知 epoch、取消/成功边界及完整兼容选择器。 |
| v1.1 | 2026-07-26 | 对齐库存意图/权威流水、同步恢复 generation、导入 ID 映射、服务端回收站时钟和无内容墓碑。 |
| v1.0 | 2026-07-26 | 定义本地数据集、临时数据、版本化加密备份、原子恢复、未加密导出、P1 导入、删除清理、云端扩展和迁移兼容。 |

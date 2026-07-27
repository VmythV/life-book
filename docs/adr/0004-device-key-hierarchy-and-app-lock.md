# TD-004：设备密钥层级与应用锁

> Status：`Accepted`  
> Date：2026-07-26  
> Decision owners：安全负责人、移动端技术负责人  
> Scope：P0 安装锚点、设备静态加密与应用锁，并约束 P1/P2 设备密钥延续<br>
> Related requirements：PD-006、PR-500～502、DATA-001、DATA-021～022、DATA-045、DATA-090～092、QR-070～072、FLOW-130～131、SCR-002、SCR-451、SCR-903<br>
> Related ADRs：[TD-003](0003-encrypted-local-database.md)、[TD-005](0005-encrypted-attachment-store.md)、[TD-006](0006-cross-platform-scalar-representations.md)、[TD-010](0010-sqlite-snapshot-migration-and-atomic-restore.md)、[TD-011](0011-backup-container-and-cryptography.md)、TD-019<br>
> Decision gate：实现必须完成威胁模型、双平台真机 key-loss/credential-change、presence/bootstrap 双槽、clear/reinstall 与 active-anchor kill-point 测试和独立安全评审；P0 不提供产品方密钥找回

## Context

生活有谱需要同时解决两个不同问题：

1. **静态数据保护**：数据库和附件即使被复制出 App 私有目录，也不能在没有设备数据密钥时读取；
2. **界面访问门禁**：用户主动开启后，App 前台内容需要 Face ID、Touch ID、指纹或设备凭据解锁，并对高风险操作重新认证。

生物特征由操作系统管理，App 只能获得认证结果，不能读取指纹/面容。把数据库 key 直接从生物特征或低熵 App PIN 派生既不可移植，也会在凭据变更、锁定或传感器不可用时造成永久数据丢失。反过来，只有一个可后台读取的数据库 key 又不能自动等于“界面已解锁”。因此数据密钥、设备包装密钥、应用锁会话和备份口令必须分层。

首次安装与“既有密钥/数据库损坏”也不能都表现为路径不存在：前者应创建唯一 Installation/LocalActor/default space，后者必须 fail closed。DATA-091 清除本机又要求保留 Installation 身份、彻底销毁内容 key，并在崩溃后继续到一个新 incarnation；卸载重装则可能遇到 iOS Keychain 遗留项，却必须生成全新 Installation。为此还需要一个不具备内容解密能力、可跨 clear 保留并与 app-container presence 配对的安装锚点。

## Decision

使用**独立安装锚点密钥 + 随机数据密钥 + 设备绑定包装密钥 + 独立应用锁会话**：

```text
OS Keychain / Android Keystore
        ├── Installation Anchor Key (IAK, this-device-only)
        │       ├── authenticates InstallPresenceRecord
        │       └── protects double-slot InstallationBootstrapRecord
        │           (no content key; retained across DATA-091 clear)
        └── Device Wrapping Key (DWK, this-device-only, per incarnation)
                ├── wraps DatabaseDataKey
                ├── wraps AttachmentRootKey
                ├── wraps DatasetControlKey
                └── wraps other device-local secrets by purpose

Backup operation (separate; never wrapped/derived by DWK)
        passphrase → PassphraseWrappingKey → wraps BackupRootKey
        BackupRootKey → HKDF purpose keys → wraps SnapshotDataKey slot

System Local Authentication
        └── grants in-memory AppLockSession / FreshAuthGrant
                └── gates UI queries and high-risk commands
```

数据库/附件密钥由密码学安全随机源生成，彼此独立，不由设备密码、生物特征、账号密码、Installation ID 或备份口令派生。IAK 只认证无内容的安装/presence 锚点，不能解密数据库、附件、control 或备份；DATA-091 清除本机保留 IAK 与 Installation ID，但轮换 installation incarnation、DWK 和全部数据 key。卸载重装没有当前 app-container presence 时，即使系统安全存储残留旧 IAK/record，也必须建立新 Installation 与新 IAK。IAK/DWK 均不可同步、不进入系统/产品备份；Android 使用 Android Keystore 中不可导出的对称 key，并在可用时硬件保护；iOS 使用当前 App 默认 access group 的 ThisDeviceOnly Keychain 项及适用访问控制，不启用 iCloud Keychain 同步。

应用锁是访问门禁，不是数据库加密 key 本身。它使用系统提供的设备所有者认证创建短期、进程内、不可持久化的授权；后台受限任务和 UI 使用不同 capability，不能因为后台可对账就让页面绕过锁。

## Decision details

### 1. 密钥与用途隔离

| 名称 | 生成/保存 | 用途 | 禁止用途 |
| --- | --- | --- | --- |
| `InstallationAnchorKey` | 真正首次安装随机创建；唯一随机 key ID；Keychain/Keystore，this-device-only。DATA-091 clear 保留，卸载重装新建。 | 认证 `InstallPresenceRecord`，保护双槽 `InstallationBootstrapRecord`，签发安装状态 capability。 | 包装/派生任何内容 key；解密数据库、附件、control 或备份；同步/备份；把旧 orphan 当当前安装。 |
| `DeviceWrappingKey` | 每个 installation incarnation 随机创建；Keychain/Keystore，this-device-only。 | 包装当前 incarnation 的设备本地 DEK/根密钥。 | 直接加密数据库页、附件或备份；跨 incarnation 复用；同步到账号。 |
| `DatabaseDataKey` | 256-bit 随机；仅以 envelope 持久化。 | SQLCipher raw key。 | 附件、备份、API token。 |
| `AttachmentRootKey` | 256-bit 随机；仅以 envelope 持久化。 | 派生/包装每附件独立 key。 | 数据库、备份容器。 |
| `DatasetControlKey` | 256-bit 随机；由 DWK 包装，仅以 envelope 持久化。 | 认证加密 TD-010 双槽 `DatasetControlRecord`。 | 数据库页、附件、备份、普通设置。 |
| `PassphraseWrappingKey` | TD-011 规范化口令 + 每备份 salt 经固定 Argon2id 派生；operation-scoped。 | 只包装该容器随机 `BackupRootKey`。 | 设备 envelope、manifest/payload 直接加密、持久化。 |
| `BackupRootKey` / purpose keys | 每备份随机 root；TD-011 HKDF 派生 manifest、payload、key-slot keys。 | 单个 `.lifebook` 容器。 | 设备在线解锁、跨备份复用、进入 JS/Keychain。 |
| `SnapshotDataKey` | TD-010 请求 Key Manager 每备份随机生成；operation/session-scoped opaque handle。 | 只加密 portable SQLCipher DB，并由 TD-011 key slot 包装。 | 活动数据库、附件、脱离 session 保存或复用。 |
| `AppLockSession` | 系统认证成功后在内存创建。 | 允许前台内容查询/呈现。 | 加密数据、跨进程持久化、证明账号身份。 |
| `FreshAuthGrant` | 高风险动作前系统认证；operation-scoped。 | 提交指定高风险命令。 | 作为通用长期登录或跨设备授权。 |

本节 envelope 格式只指 **DWK 包装的设备本地 key envelope**：逻辑字段至少包含格式版本、`installationId`、`installationIncarnationId`、key purpose、key ID、wrapping-key ID、包装算法版本、nonce/IV、密文、认证标签和创建时间，不含用户内容；认证 AAD 固定包含产品 domain、Installation/incarnation、purpose、key ID 和 wrapping-key ID。envelope 位于数据库外私有元数据，采用双槽 sequence、临时文件 + fsync/平台等价 + 原子替换和 read-back，并以 operation journal 支持 rewrap 中断。任何 Installation/incarnation/purpose 不匹配必须在 unwrap 前失败。TD-011 公共头的 `rootKeyEnvelope` 和加密 manifest 内的 SnapshotDataKey slot 由 container-v1 唯一规定，不复用本设备 envelope 格式。

### 2. 安装 presence 与 bootstrap anchor

数据库路径缺失永远不是首次安装证据。原生 `InstallationAnchorStore` 在固定 no-backup 根中维护两组受 IAK 认证加密的双槽文件；路径、slot 和 AAD 由 adapter 固定，JS 不可传入：

```text
installation-anchor/
  install-presence-a.bin
  install-presence-b.bin
  bootstrap-a.bin
  bootstrap-b.bin
  journals/<validated-operation-id>.bin
```

每个 slot 使用随机 96-bit nonce 的 AES-256-GCM。文件没有额外 binary framing：全部 bytes 恰为单个 UTF-8、无 BOM/换行/尾随 bytes、最长 64 KiB 的 JCS object。外层字段恰含 `envelopeFormatVersion=1`、`recordKind=install_presence|installation_bootstrap`、`slotId=a|b`、`installationAnchorKeyId`、`nonce`、`ciphertext`、`tag`；后三项使用 canonical base64url、无 padding，nonce/tag 分别固定 12/16 bytes。`installationAnchorKeyId` 是 16 random bytes 的 canonical base64url；原生 parser 在解密前只解析并验证这组 exact plaintext header 字段、确认 `recordKind/slotId` 与固定物理路径相同，再以固定 OS alias `life-book.installation-anchor.v1/<installationAnchorKeyId>` 做单项 lookup，不能枚举或接受任意 alias。header 在 tag 通过前没有安装权威。

AAD 精确为 `UTF8("life-book/installation-anchor/aead/v1\0") || UTF8(JCS({"applicationId":<signed-build applicationId>,"envelopeFormatVersion":1,"installationAnchorKeyId":<header value>,"recordKind":<header value>,"slotId":<header value>}))`；JCS 规定 object key 顺序，因此没有另一个连接顺序或长度编码。payload 为下述 record 的 RFC 8785 canonical JSON；TD-006 `LongCounter` 编码为规范十进制字符串，optional 字段必须显式编码为 JSON `null`。nonce 不得在同一 IAK 下复用。写入协议固定为：checked sequence/headroom → inactive slot 同目录随机 temp → 文件 flush → 平台 durability barrier → atomic replace → 父目录同步 → read-back AEAD、canonical re-encode、digest 与全部 invariant；不支持所需原子/屏障语义时阻止初始化或状态推进。两个 slot sequence 相同但 canonical digest 不同、存在但无法 AEAD/解析、或 identity 不一致均为 integrity-blocked，不能删除后伪装 fresh。

`InstallPresenceRecord` 的逻辑字段恰为：

```text
formatVersion
presenceSequence                 -- TD-006 LongCounter; fresh=0, clear checked +1
installationAnchorKeyId
installationId
installationIncarnationId
incarnationBootstrapOperationId
presenceNonce                    -- 32 random bytes, canonical base64url without padding
applicationId                    -- signed build package/bundle identifier
createdAt
```

`formatVersion` 是 JSON integer `1`；三个业务/operation ID 使用 TD-006 canonical `EntityId` 文本，`createdAt` 使用 TD-006 canonical `Instant`，`applicationId` 必须逐字等于签名 build 常量。除 `presenceSequence` 按 clear 协议推进外，同一 presence payload 不可 patch；新 incarnation 重新生成 operation、nonce 与时间。

presence digest 固定为 `SHA-256("life-book/install-presence/v1\0" || UTF8(JCS(payload)))`。只有 AEAD、应用 ID、IAK ID、sequence 与 canonical encoding 全部合法的 slot 才进入 valid candidate 集；一个 invalid + 一个 valid candidate 可以继续解析，但 **presence 不得独立按最高 sequence 成为 current**。`presenceSequence=0` 只允许真正 fresh；DATA-091 clear 在旧 record 有一个剩余值时写同一 IAK/Installation、新 incarnation/bootstrap operation/nonce 的 checked `+1`。稳定 current record 到 MAX 仍可正常打开当前数据集，只拒绝再次 clear/record transition。

`InstallationBootstrapRecord` 的逻辑字段必须与 TD-010 完全相同且恰为：

```text
formatVersion
bootstrapSequence                -- TD-006 LongCounter
installationIncarnationId
installationId
incarnationBootstrapOperationId
stateOperationId?
activeOperationId?
notificationDatasetEpoch
phase: initializing | initialized | clearing
installPresenceRecordDigest
candidateGenerationId?
initializedGenerationId?
initializedControlSequence?
activationOpenReceiptDigest?
appBuildId
createdAt
```

`formatVersion` 同样固定为 JSON integer `1`；全部 ID、counter、Instant 逐项使用 TD-006 canonical adapter，所有 SHA-256 digest 编码为恰好 64 个小写 ASCII hex 字符；未知 enum/字段、错误 nullability 或非 canonical scalar 全部拒绝。

bootstrap digest 固定为 `SHA-256("life-book/installation-bootstrap/v1\0" || UTF8(JCS(payload)))`。IAK ID 来自 slot header/AAD，不重复进入逻辑 payload。bootstrap 与 presence 只有在 `installPresenceRecordDigest`、IAK、Installation/incarnation/bootstrap operation 全部一致时才形成 compatible pair；current anchor 由下列联合选择器决定，不允许两个 record 各自取最高：

1. 先验证所有物理 slot 和 operation journal，形成 valid presence candidates、valid bootstrap candidates 与 compatible pairs；任一 kind 内相同 sequence、不同 canonical digest 立即 integrity-blocked；
2. 若存在 valid clear journal，按 journal phase 联合选择且只签发 recovery capability：`prepared + exact initialized source` 选择 source 并继续 whole-record CAS 到 clearing；`prepared + exact clearing source` 表示 CAS 已落盘并幂等推进 journal；`source_clearing|data_erased|target_presence_written` 在 target realm bootstrap 尚未完整时要求 journal 绑定的 clearing source，已写的 target presence 只是 pending；一旦 journal 预留 sequence/identity 对应的新-incarnation bootstrap pair 已完整 durable/read-back，选择该 target realm 内 sequence 最高且 phase 合法的 pair 并推进 journal；`target_bootstrap_written|initialize_handed_off|completed` 缺 target pair、或任一阶段出现其他 unmatched/higher candidate 均阻断；
3. 若是 fresh/initialize presence-only 中间态，只允许 journal 精确绑定的唯一 presence candidate 继续同一 handshake，且不签发 Repository；
4. 其他状态选择 `bootstrapSequence` 最高的 compatible pair，并要求没有未被同一 journal 解释的更高 valid presence/bootstrap candidate；一个 invalid slot 加一个完整 valid pair 可继续；
5. 没有 compatible pair 且任一 canonical record 文件物理存在时为 integrity-blocked；只有 presence/bootstrap 文件都物理不存在，才把“records absent”交给 TD-010 strict all-absent classifier 继续评估。

不属于 selected/journal-bound pair 的旧 Keychain item、IAK alias、bootstrap slot 或 envelope 是 orphan，只能在 TD-010 允许的安全阶段隔离/退休，绝不能恢复旧 Installation、key 或数据。`clearing` source pair 优先于 control；target initializing pair 完整后才逻辑切换到新 incarnation，因而 presence→bootstrap 两次写之间任一 crash 都有唯一可续状态。

clear journal 由同一 IAK 认证、原子写/read-back，且在进入 clearing 前固定绑定 `clearOperationId`、source presence/bootstrap 全 digest+sequence、预留的四个 bootstrap sequence、target presence sequence+digest、target Installation/incarnation/`incarnationBootstrapOperationId`、target initializing bootstrap digest、candidate-bound/initialized 两个后续 sequence、new DatasetControlKey realm 和 `phase=prepared|source_clearing|data_erased|target_presence_written|target_bootstrap_written|initialize_handed_off|completed`。`prepared` 是正常 write-ahead 状态，source 可以仍为 exact initialized，不能误报损坏；每个实际写点 durable 而 journal 落后一步时，重启只可按 exact target 幂等推进 journal。journal 超前于耐久 pair、digest/sequence 第三值或未登记 candidate 一律阻断。`completed` 仅在新 initialized anchor durable 后写，随后才按 retention 规则删除旧 pair/journal。

同一 incarnation 内 `installationId`、`installationIncarnationId`、`incarnationBootstrapOperationId`、`installPresenceRecordDigest`、`appBuildId` 和 `createdAt` 不可修改；`appBuildId/createdAt` 表示创建该 incarnation 的签名构建/时间，不随普通升级改写。`notificationDatasetEpoch` 只在成功 restore/manual rollback anchor CAS 时从 current checked `+1`；migration 和 `activation_abort` 保持，clear/reinstall 的新 incarnation 从 `0` 开始。任何非 phase/active-anchor 允许字段的变化都使 whole-record CAS 失败。

phase invariant 与唯一 sequence 消耗为：

| phase | 必需字段 | 必为空字段 | 唯一转换 |
| --- | --- | --- | --- |
| `initializing` | `stateOperationId=incarnationBootstrapOperationId`、epoch `0`；candidate 绑定后须等于同 journal。 | `activeOperationId` 和三个 initialized/receipt 字段为空；candidate 绑定前可空。 | fresh record 从 sequence `0` 开始；candidate binding checked `+1`。 |
| `initialized` | `activeOperationId`、generation、control sequence、receipt digest 全非空，并与 TD-010 active control/receipt 精确匹配。 | `stateOperationId`、candidate 为空。 | TD-010 receipt durable 后 guard-CAS expected digest，checked `+1`。 |
| `clearing` | `stateOperationId=clearOperationId`，保留旧 active operation/generation/control/receipt/epoch，并匹配 clear journal。 | candidate 为空。 | 只由 initialized 在 FreshAuth/clear journal 后 checked `+1` 进入。 |

普通 migrate/restore/manual rollback/`activation_abort` 不改变 presence 或 `incarnationBootstrapOperationId`，只在 terminal receipt 后 guard-CAS `activeOperationId` 和 active generation/control/receipt/epoch；CAS 的 expected 值必须是 marker/abort journal 已耐久绑定的 bootstrap digest。initialize 改 phase，其他 operation 只推进 active anchor。若 record 已等于 target，CAS 是成功的幂等 read-back；仍等于 expected prior 才可写 target；任何第三值阻断。Repository 在 matching active control、`ActivationOpenReceipt` 与 updated bootstrap anchor 三者全部 read-back 前只能取得 TD-010 activation-recovery capability。

sequence 预留遵守 TD-010：fresh initialize 从 bootstrap `0` 预留 candidate-bound、initialized 两次增量；普通 dataset operation 预留一次 terminal anchor CAS；clear 在写 `clearing` 前同时预留一个 presence 增量和四个 bootstrap 增量，覆盖 clearing、新 incarnation initializing、candidate-bound、initialized。clear 后的 bootstrap sequence 在同一 Installation/IAK realm 内继续单调，不能因新 incarnation 归零；只有真正重装创建新 Installation/IAK realm 才从 `0` 开始。每次 crash 重用已经持久化的 sequence，不重复加一；没有完整 headroom 时必须在第一笔状态写前失败。sequence 达 MAX 的稳定 initialized anchor 仍可开放普通 Repository，只阻止下一次 anchor transition。

真正 fresh 的唯一 handshake 是：TD-010 strict all-absent classifier → 生成新 IAK/key ID、Installation/incarnation/bootstrap operation 与 journal → 写/read-back presence sequence 0 → 写/read-back initializing bootstrap sequence 0 → 创建同身份 DWK 与三个 data-key envelopes → 签发一次性 bootstrap capability。presence-only 只有 matching incarnation-bootstrap journal 才可续跑；bootstrap-only、已 initialized、任一 canonical control/artifact 或未知 journal 都不是 fresh。卸载重装 app-container 全空时，旧 IAK/secure-store alias 均为 orphan，新建 Installation/IAK；不得利用 iOS Keychain 可能残留的旧项“找回”本地数据。

### 3. 平台实现

#### iOS

- IAK/DWK Keychain 项使用 App 自己的默认 access group，不与其他 App/extension 共享；`kSecAttrSynchronizable=false`，alias/item attributes 只含随机 key ID 和版本，不含 Installation、用户或空间信息；
- 使用 `...ThisDeviceOnly` 可访问级别；后台确需使用的 IAK/DWK wrapper 在设备首次解锁后可用，不能迁移到另一设备；App 重装若没有 matching presence，遗留 item 必须隔离/删除而非复用；
- presence/bootstrap/envelope/journal 固定根设置 `NSURLIsExcludedFromBackupKey=true` 并在 release archive/runtime 自检；IAK 项不进入 iCloud Keychain 或产品备份；
- 应用锁使用 LocalAuthentication 的 `deviceOwnerAuthentication`，允许系统按能力提供生物识别或设备密码；
- 高风险动作给出具体、本地化 `localizedReason`，每次按当前 access control 重新评估，不能假设先前成功必然继续有效；
- Face ID 使用说明只在用户开启相应功能时出现，文案与实际用途一致；
- 不声称所有 Keychain key 都由 Secure Enclave 硬件保存；实现记录可用保护等级但不降低产品基本行为。

#### Android

- IAK/DWK 在 `AndroidKeyStore` 中分别生成，key material 不导出；首选 AES-256-GCM、随机 nonce 和仅 encrypt/decrypt purpose，alias 使用随机 key ID 且不含领域信息；
- 查询并记录 key 是否硬件/StrongBox 支持，但硬件不可用不静默改成把 key 写普通 preferences；是否允许受控软件 Keystore 由最低系统安全门决定；
- 应用锁使用 AndroidX `BiometricPrompt`，优先 `BIOMETRIC_STRONG`，并允许系统设备凭据回退；
- Android 10 对 authenticator 组合有限制，adapter 必须按 API level 使用受支持的 BiometricPrompt/Keyguard flow，不自制 PIN 页面；
- 生物识别 enrollment、锁屏凭据清除、系统升级、Keystore reset 和设备迁移导致的 key invalidation 分别测试并映射；
- `InstallationAnchorStore` 和 envelope 使用 `noBackupFilesDir`；Android Auto Backup/data extraction rules 另显式排除 presence、bootstrap、journal、envelope、数据库、附件和相关 preferences，并在 release 产物验证。

平台 adapter 对上只返回：`available | not_enrolled | no_device_credential | temporarily_locked | permanently_unavailable | cancelled | failed | success` 等受控结果，不暴露系统异常或生物特征细节。

### 4. 原生 Key Manager 边界

- IAK/DWK 生成、presence/bootstrap 分类与 CAS、wrap/unwrap、设备 envelope 原子替换和数据库/附件/数据集控制 key handle 全部位于受审查的原生 Key Manager；
- `InstallationAnchorStore.classify()` 只返回受控的 `clearing | initializing | initialized | fresh_eligible | reinstall_orphans | integrity_blocked | key_unavailable` 与不透明 evidence/capability；它先验证 presence/bootstrap，`clearing` 优先，绝不把路径缺失、AEAD 失败或 orphan alias 翻译成 fresh；
- fresh/clear bootstrap capability 必须绑定 IAK ID、presence/bootstrap digest、Installation/incarnation、`incarnationBootstrapOperationId`、candidate、LocalActor seed ID 和精确 key-envelope 集，只能由 TD-010 `operationKind=initialize` 消费一次；
- active-anchor CAS API 只接受 expected bootstrap digest、typed marker 或 abort-journal evidence、matching `ActivationOpenReceipt` digest 与 target active tuple；不提供“设置当前 generation/sequence”的任意写接口；
- Key Manager 为 TD-010 生成 operation-scoped `SnapshotDataKeyHandle`，为 TD-011 second-pass session 接收其解封的同类 handle；session terminal 后销毁，不能转换为普通设备 envelope；
- JS 层只持有不透明 handle、授权 capability 和受控错误，不读取 IAK、DWK、`DatasetControlKey`、presence/bootstrap 明文、任何 raw DEK 或备份 operation key；
- Database Adapter 使用 handle 在原生边界给 SQLCipher 设置 key；Attachment Adapter 使用独立 handle 执行流式 AEAD；
- Database/Attachment/DatasetControl key handle 全部绑定 Installation/incarnation/key purpose/operation scope；Dataset Control Adapter 只能用 matching `DatasetControlKeyHandle` 认证/解密受控 slot DTO，不提供任意 AEAD oracle；Backup Container Adapter 只能按 TD-011 固定 suite 使用 operation handle；
- 若底层第三方 API 暂时要求 key bytes 穿过 JS，该实现不得进入 production gate；先补原生窄模块，而不是用不可擦除字符串长期持有；
- 内存清零为 best effort，不能声称能消除运行时、交换区或已被攻陷进程的全部副本；主要控制是缩短生命周期、限制边界和禁止日志。

### 5. 应用锁状态

应用锁默认由用户主动开启；未开启也始终执行数据库/附件静态加密和后台无内容遮罩。设置保存在 `AppPreferences`，但认证事实和 session 不持久化。

```text
disabled
  └── 用户认证并开启 → enabled + locked

enabled + locked
  └── 系统认证成功 → enabled + unlocked(session)
  ├── 取消/失败 → 保持 locked
  └── 凭据不可用 → recovery_locked

enabled + unlocked
  ├── 超过自动锁定时机 / 进程终止 → locked
  ├── 用户主动锁定 → locked
  └── 认证后关闭设置 → disabled
```

规则：

- App 进入后台立即替换为无内容遮罩并清除页面敏感 view model；是否在回前台再次认证由已保存的自动锁定策略和单调时钟决定；
- 进程重启/被杀后，只要应用锁开启就视为 locked，不恢复序列化 session；
- session 只授予当前 Installation/incarnation 的前台 Presentation capability；clear/reinstall/incarnation 改变立即失效。它不是账号 token、家庭成员身份或加密 key；
- 深链接/通知先进入锁屏，解锁后重新查询不透明目标 ID；锁屏不得显示标题、类型、日期、数量或家庭名；
- 认证取消属于安全返回，不记为错误、不改变设置、不执行业务命令；
- 关闭应用锁、改变为更宽松自动锁定策略必须 fresh auth；更严格策略保存后立即生效；
- 设备没有可用系统凭据时不能新开启应用锁；已开启后凭据永久不可用时不得旁路，只提供受支持凭据恢复、加密备份恢复或安全清除。

自动锁定选项和默认值由安全规范/领域设置统一定义；实现使用枚举和 monotonic elapsed time，不用可回拨 wall clock 计算前台授权剩余时间。

### 6. 前台与后台 capability

为了滚动提醒、文件清理和后续同步，系统可能在没有 UI 解锁时给予短暂后台机会。采用最小 capability：

| Capability | 可做 | 不可做 |
| --- | --- | --- |
| `ForegroundUnlocked` | 在 capability 绑定的 Installation/incarnation 内查询/编辑/呈现内容。 | 跨 incarnation；绕过单条敏感或高风险再次认证。 |
| `BackgroundMaintenance` | 在绑定 incarnation 内按 ID 计算/对账通知、完成已提交文件/索引任务、P1 加密同步。 | 跨 incarnation；渲染 UI、生成内容日志、导出/分享、放宽隐私、接受深链接页面。 |
| `FreshHighRisk(operation, scope, expiresAt)` | 提交一个匹配操作/范围的命令。 | 复用于其他对象、成员、空间或超时后提交。 |

Application use case 必须显式要求 capability，不能用全局 `isUnlocked` boolean 保护所有路径。后台 adapter 只读取任务需要的最小列；系统日志和通知仍遵守敏感策略。

### 7. 近期重新认证

永久删除、清空回收站、恢复覆盖、清除本机、包含敏感内容的导出、放宽敏感/AI 保护、家庭创建/删除/所有权/成员移除及安全设置放宽使用 `FreshAuthGrant`：

- 用户进入最终影响确认后触发系统认证，不在页面打开时提前认证；
- grant 绑定 Installation/incarnation、operation kind、目标 ID/space、actor/session 和当前影响摘要 hash；
- 最长 5 分钟且只可成功消费一次；App 后台、账号/成员状态变化、影响摘要改变、认证上下文失效时立即作废；
- 服务端高风险操作仍需要自己的 recent-auth 证明；设备认证成功不替代服务端账号授权；
- 批量操作可以绑定一次已预览的明确集合，集合改变必须重新认证。

### 8. 初始化、恢复与密钥丢失

#### 首次初始化

```text
TD-010 strict all-absent classifier 返回 fresh_eligible
→ 生成 Installation / incarnation / bootstrap operation / IAK
→ 持久化 operation journal
→ 写并 read-back InstallPresenceRecord sequence 0
→ 写并 read-back initializing InstallationBootstrapRecord sequence 0
→ 创建当前 incarnation 的 DWK
→ 分别生成 DatabaseDataKey / AttachmentRootKey / DatasetControlKey
→ 写并验证全部 identity-bound envelopes
→ 签发一次性 bootstrap capability
→ TD-010 构建、验证并绑定 EmptyCandidateEvidence
→ initialize validating control sequence 0
→ marker + dormant task + notification owner/精确 pair 原子事务
→ active control + ActivationOpenReceipt
→ guard-CAS BootstrapRecord 为 initialized active anchor
→ 才开放普通 Repository 与首笔业务写
```

IAK 必须在 presence 前生成，presence/bootstrap/data-key envelopes 都绑定同一 Installation/incarnation/bootstrap operation；IAK 本身不属于 strict all-absent 前的既有证据，因为它由 matching fresh journal 明确拥有。若进程恰在 IAK 创建后、fresh journal durable 前终止，严格空 app-container 中的 IAK-only alias 只能作为 orphan 删除并从 strict classifier 重试；一旦出现任一 app-container artifact 就不得套用该例外。一次性 bootstrap capability 还绑定 exact presence/bootstrap digest 与 nonce、candidate generation、待生成 LocalActor ID 和三类 data-key envelope identity，只能创建 TD-010 签名空 candidate，不能转换为 migrate/restore capability。

任一步失败都不展示初始化成功，也不向 ORM/Repository 暴露 activation-recovery handle。重入只按 matching journal/record/sequence 清理或重建 operation-owned 临时物，不能扫描目录猜 candidate、重新生成另一 Installation/LocalActor/default space，或把存在但非法的 slot 当 fresh。初始化完成必须消耗 bootstrap sequence `0→1→2`；candidate replacement 重试在写 binding 前重新验证仍有 binding + final CAS 两个值。

#### 产品备份恢复

恢复入口是 TD-011 pass 1 完整认证后产生的 `VerifiedBackupHandle`，不是 `BackupKey` 或明文目录。TD-010 用该 handle 开启一次性 pass 2；session-scoped `SnapshotDataKeyHandle` 只打开受控 portable SQLCipher staging，认证附件流直接由 TD-005 用**接收设备当前 DatabaseDataKey/AttachmentRootKey**重加密到可丢弃 candidate。恢复与 key/cipher rotation 是两个 operation；需要换 key 时先后走独立 TD-010 migration，不能在 restore mapper 中暗换。只有 `Pass2CompletionEvidence`、portable defensive validation 和 candidate seal 全部通过，TD-010 才能执行原子 activation。

恢复不会导入、替换或重新派生接收设备的 IAK、presence、Installation/incarnation、DWK、DatabaseDataKey、AttachmentRootKey、`DatasetControlKey`、AppLockSession、FreshAuthGrant、账号会话、生物注册、系统权限或平台调度 ID。候选 generation 使用接收设备当前 key hierarchy；应用锁设置只按 DATA-045 的设备语义处理。任何 pass/candidate 失败只删除 staging，不能触碰当前 active key/envelope/control slot。

restore/manual rollback 保持当前 IAK、presence、Installation/incarnation、DWK、DatabaseDataKey、AttachmentRootKey 与 DatasetControlKey；成功 replacement 只由 TD-010 在 receipt 后推进 `notificationDatasetEpoch` 与 bootstrap `activeOperationId/generation/control/receipt`，失败或取消不写 anchor。migration 和 `activation_abort` 保持 incarnation/epoch；abort 只消费 operation 预留的同一个 bootstrap sequence，把 prior generation 的 recovery receipt 重新锚定，绝不创建/替换 key。成功 CAS 与 abort CAS 竞争同一个 whole-record expected digest，只能有一个获胜。

#### 密钥丢失/失效

若 IAK/bootstrap 仍可验证，但活动数据的 DWK/envelope 无法使用：

- 不创建新同名数据库，不尝试猜 key，不上传文件；
- 显示通用恢复状态与诊断 ID，不泄露数据内容；
- 可从用户持有且口令正确的加密备份恢复到新数据集；
- 用户确认安全清除后按 clearing journal 删除无法读取的数据；保留可验证的 Installation/IAK，但轮换 incarnation、DWK/data keys、LocalActor/default space，并走完整 initialize；
- P0 产品方没有密钥托管/找回，客服不能承诺恢复；
- P1 已有云端副本时，恢复仍按账号、E2EE 决定和数据认领流程，而非直接替换本地。

若当前 presence 或任何 data/control artifact 存在，而 IAK/bootstrap slot 缺失、损坏或无法使用，状态为 `integrity_blocked | key_unavailable`，绝不能生成新 IAK、Installation 或空库。v1 不支持此状态下的 App 内 DATA-091 clear：没有 IAK 就无法认证 `clearing`/journal，也不能让 FreshAuth 充当耐久密钥。用户只能恢复平台安全存储可用性，或按明确支持指引通过 OS 卸载/清除应用数据后重新安装；后者在 app-container 严格全空时创建新 Installation，不能悄悄声称保留旧安装。若未来提供 `anchor_loss_erase`，必须以新 ADR 定义独立耐久授权、抗伪造 journal、崩溃恢复和 TD-010 启动优先级。

### 9. 轮换与撤销

- IAK record envelope、device-key envelope、DWK、DEK 和算法分别有版本；App 启动只读取签名 build 明确支持的组合，未知必需字段/算法安全失败；
- v1 不支持 IAK 原地轮换：它横跨 presence/bootstrap classifier，不能套用 DWK rewrap。需要更换 IAK 算法或 key 时必须先建新 ADR，定义双 key journal、presence/bootstrap 各自 sequence 消耗、启动优先级和 kill-point；不得在旧 record 损坏时临时生成 IAK。DATA-091 clear 仍保留 IAK，真正重装才自然生成新 IAK；
- 常规设备包装策略升级优先生成新 DWK、重新包装现有 DEK，验证双槽后删除旧 wrapper，无需重加密全部内容；
- DB DEK/cipher 轮换只能按 TD-010 在隔离 candidate generation 使用受控 `sqlcipher_export`/等价复制、完整性检查和 atomic activation；不得对 active generation 原地 `rekey`、覆盖或 rename；
- AttachmentRootKey 轮换由 TD-005 的 per-file key envelope 渐进完成；旧 key 在全部引用迁移前保留受控读取；
- DatasetControlKey 轮换必须生成新 key/envelope，并作为 TD-010 migrate operation 用预留的 validating/active control sequence、typed marker/receipt 和 bootstrap active-anchor CAS 激活；新 control 明确引用新 key ID，旧 key/slot 保留到 matching receipt/anchor 与冷启动 read-back 后才退休。普通轮换不重置 sequence 或 incarnation；只有完成 clear 后的新 DatasetControlKey realm 可从 sequence 0 开始；
- 清除本机按 DATA-091 固定为：预检一个 presence + 四个 bootstrap headroom → FreshAuth/clear journal → whole-record CAS 到 `clearing` → 关闭 Repository/通知 → 删除旧 generation/control/artifact 并销毁旧 DWK、DatabaseDataKey、AttachmentRootKey、DatasetControlKey → 确认 canonical control 全部物理不存在 → 持久化新 incarnation-bootstrap journal → 用同一 IAK 写/read-back 新 presence → 写新-incarnation initializing bootstrap record → 创建新 DWK/data-key envelopes → 走完整 TD-010 initialize/receipt/anchor CAS → 最后完成 clear journal。保持 Installation ID/IAK，轮换 incarnation、bootstrap operation、nonce、LocalActor/default space 和全部数据 key；新 DatasetControlKey realm 的 control sequence 与 notification epoch 从 0 开始，但 installation-wide bootstrap sequence 继续单调。半清除永远由 `clearing` 优先续跑，不能开放空 Repository；
- `activation_abort` journal 不随失败 candidate 删除，至少保留到下一次 non-abort active anchor 或 clear；它的 anchor CAS 保持 prior incarnation/epoch/key identity，并绑定 recovery receipt，不能被实现成删除 validating slot后直接用旧 receipt 开库；
- 真正卸载重装只在当前 app-container presence/data/control/artifact 严格 all-absent 时创建新 Installation、IAK、incarnation、DWK 和 data keys。平台可能残留的旧 Keychain/Keystore alias/record 只可隔离/删除，不能复用；产品不依赖卸载完成外部备份删除，也不把 orphan 当 fresh 的充分证据。

## Alternatives considered

### 用 DWK 保护初始化/清除 marker

DATA-091 必须销毁 DWK，而清除恢复状态又必须在销毁后可认证；把 bootstrap record 放在 DWK 下会形成循环，并把“内容 key 丢失”误成 fresh。拒绝，IAK 与 DWK 同级且不能解密内容。

### 复用卸载后残留的 Keychain Installation

iOS 可能保留 Keychain 项，而 app-container/presence 已消失；复用会把一次真正重装错误地接回旧身份和 sequence，并可能与残留密文混合。拒绝，只有 matching current presence 才赋予 IAK/bootstrap 安装归属，orphan 只能隔离。

### 由 App PIN/设备密码派生数据库 key

App 无法读取设备密码；自定义 PIN 熵低且需要找回/限次/迁移。改变 PIN 会强迫全库 rekey。拒绝，系统凭据只负责门禁，随机 DEK 负责加密。

### 生物特征直接保护唯一数据库 key

生物 enrollment、传感器损坏、系统锁定或凭据变化可能使唯一 key 永久失效，也阻断必要后台维护。应用锁 session 与数据密钥解耦，仍对高风险动作使用 fresh auth。

### 把 raw key 直接存通用 JS SecureStore

实现简单，但 key 作为可长期存在的 JS 字符串跨 bridge，难以限制调用者和清理。普通非内容 token 可经受控 SecureStore adapter 保存；数据库/附件根 key 使用原生 Key Manager。

### 一个 key 加密数据库、附件和备份

会扩大泄露影响，使轮换、恢复和分块加密相互绑定；备份还会把设备 key 带出设备。按用途隔离。

### 账号/服务端托管设备 key

与 P0 免登录和 OQ-005 默认不找回冲突，并新增服务端信任边界。P1 若引入恢复/托管必须另建安全 ADR，不改变已存在备份含义。

### 只做应用锁、不做静态加密

应用锁只是运行时 UI 门禁，无法保护被复制文件。违反 PR-500，拒绝。

## Consequences

### Positive

- 数据密钥随机、按用途隔离，设备凭据改变通常只影响门禁/包装，不要求从低熵秘密重建；
- 静态加密始终存在，应用锁开关不会产生明文迁移；
- 系统认证 UI 与设备凭据回退符合平台习惯，App 不接触生物模板；
- 备份口令、账号会话与设备 key 各自独立，恢复和撤销边界清楚；
- presence/bootstrap/active receipt 形成可崩溃恢复的安装事实链，缺文件不再被误当首次安装；
- 后台维护可受限运行，同时前台内容继续遵守应用锁。

### Negative

- 需要自有原生 Key Manager、IAK/presence/bootstrap/envelope 双槽格式和双平台错误映射；
- Keychain/Keystore/OEM 差异与凭据变化场景测试成本高；
- App Lock 不是针对已完全攻陷进程的密码学沙箱，后台 capability 必须严格审查；
- 设备 key 丢失且没有有效备份时数据无法恢复；
- 使用系统设备凭据意味着共享设备凭据的人可能解锁 App，产品不提供独立 App 密码身份。

## Risks and mitigations

| 风险 | 缓解 |
| --- | --- |
| Keychain/Keystore 项被系统失效或丢失 | this-device-only、平台错误分类、双槽 envelope、真实升级/凭据测试、备份提示。 |
| IAK/bootstrap 损坏被误判为首次安装 | presence/bootstrap/control/artifact 严格分类；存在但非法或 mixed evidence 一律 integrity-blocked；Database Manager 无建库权。 |
| 卸载后旧 Keychain alias 被复用 | 当前 presence digest 是安装归属门；app-container 严格全空才隔离 orphan，并生成新 Installation/IAK。 |
| stale/竞争 CAS 指向错误 generation | whole expected-record digest、预留 bootstrap sequence、typed marker/abort journal、receipt 与 target control 全量 guard-CAS；第三值阻断。 |
| clear 进行到一半耗尽 sequence | 在 `clearing` 前一次预留一个 presence 和四个 bootstrap 增量；无 headroom 不写第一笔不可逆状态。 |
| 生物 enrollment 造成数据锁死 | 不用 biometric-current-set 保护唯一 DEK；使用 device owner auth 门禁和设备凭据回退。 |
| 后台 capability 被滥用读取内容 | 窄 use case、依赖检查、无 Presentation 接口、敏感查询裁剪与安全测试。 |
| JS/日志泄露 raw key | 原生 handle API、release 禁止 secret logging、crash/redaction 测试和最短内存生命周期。 |
| 认证重放到另一危险动作 | operation/scope/summary hash 绑定、一次消费、5 分钟上限、后台即失效。 |
| 用户误以为产品能找回 | 创建备份、锁定失败和支持文案明确 OQ-005；不提供虚假“忘记密码”。 |
| 无设备锁屏的设备 | 不允许开启应用锁，说明设置设备凭据；数据仍使用可用 OS key store，但明确降低保证范围。 |
| abort 后用旧 receipt 直接开放 prior generation | `activation_abort` terminal control、新 recovery receipt、active-anchor CAS 三件套；journal 延迟 GC，恢复 handle 不进入业务层。 |

## Implementation constraints

- Key Manager API 不允许“导出所有 keys”或按任意 alias 读取；每个调用是固定 purpose；
- IAK 不受 AppLock/biometric user-presence flag 约束，保证启动恢复可运行；这不授予内容读取，因为它不能 unwrap DWK/data key；
- presence/bootstrap parser 必须拒绝重复/未知字段、非法 Unicode/ID/base64url/时间/LongCounter、非 JCS 输入、错误 application/IAK ID 和非 null optional 表示；digest 在 canonical re-encode 后比较；
- record writer 只能 whole-record CAS，不能 patch 单字段；sequence/headroom 使用 TD-006 exact integer，不能在 JavaScript `number` 中比较或先写后判 overflow；
- 只有 TD-010 strict classifier/capability 可以创建生产 Installation、DWK/data-key envelopes 和 initialize candidate；Database Manager、Repository、UI 与测试 flag 都无“路径不存在则建库”入口；
- key/envelope migration、activation receipt 与 bootstrap anchor CAS 在 Repository 开放前完成，失败保持安全遮罩；activation-recovery capability 不能传给 ORM/业务 use case；
- `InstallationAnchorStore`、operation/clear/abort journal、全部 key envelope、数据库/control/附件根均进入双平台 no-backup 产物检查；IAK/DWK 的安全存储项均 non-sync/this-device-only；
- 任何远程配置、调试菜单、deep link 或测试 flag 都不能在 release 绕过 app lock/fresh auth；
- 自动化测试使用平台测试 key provider，不把固定测试 key 编译进 production；
- AppLockSession 与 FreshAuthGrant 不写 SQLite、preferences、Redux persistence、日志或备份；
- 系统认证 prompt 只由用户动作或锁屏恢复触发，不在后台/循环自动弹出；
- 用户取消、传感器临时不可用和系统 lockout 分开处理，不通过重复 prompt 对抗系统限次；
- Root/越狱、调试注入或已攻陷进程不在绝对保护承诺内，但检测信号只能告警/收紧，不能擅自销毁数据。

## Verification

### Key lifecycle matrix

两平台最低支持和主流真机覆盖：首次创建 IAK/DWK/DB/Attachment/DatasetControl key、正常重启、进程 kill、设备重启前/后首次解锁、系统升级、App 升级、关闭/开启应用锁、添加/移除生物特征、改变/移除设备凭据、Biometric lockout、Keystore/Keychain 返回各错误、磁盘满、presence/bootstrap/device-envelope/control slot 截断和每种轮换 kill point。

通过标准：

1. 正常场景同一数据可解密；错误场景不产生空库/第二身份；
2. Swift/Kotlin 对 outer JCS bytes、plaintext header lookup、AAD bytes、payload JCS、presence/bootstrap digest 使用同一 golden fixture；拒绝 BOM/尾随 byte、超长文件、unknown/duplicate field、非 canonical、错误物理 slot/key alias、nonce/tag 长度与 digest mismatch；
3. presence 每个 temp/flush/barrier/rename/parent-sync/read-back kill；bootstrap A/B 覆盖同 sequence 不同内容、一个 valid、两个 invalid、两个物理不存在，只有严格 all-absent 能 fresh；
4. strict all-absent、presence-only matching/mismatching journal、bootstrap/IAK-only orphan、initialized + control 缺失、未知 artifact 与 clearing；mixed/invalid evidence 一律不创建 Installation、空库或第二默认空间；
5. clear joint selector 在“新 presence durable、新 bootstrap 未写”时仍选择旧 clearing pair，在 target pair 完整后切到新 initializing pair；未被 journal 绑定的 higher/unmatched candidate 阻断；
6. bootstrap `MAX-4...MAX`、presence `MAX-1...MAX`：initialize binding/重绑/final CAS、普通 success/abort CAS、clear 四次 transition 都先验证完整 headroom；稳定 initialized MAX 仍能打开 matching Repository；
7. success active-anchor CAS 与 `activation_abort` CAS 竞争、receipt 已写/CAS 未写、CAS 已为 target、CAS 第三值、terminal control/recovery receipt/anchor 每个 kill；只能一个结果且旧 receipt 不能直接开库；
8. clear 在 clearing、key destruction、control 全删、新 journal、新 presence、新 bootstrap、新 envelopes、candidate binding、receipt/anchor 每点 kill；最终保持 Installation/IAK、轮换 incarnation/DWK/data keys，并只创建唯一 LocalActor/default space；
9. 卸载重装在遗留/不遗留 iOS Keychain alias、Android app-data/Keystore 清理差异下都生成新 Installation/IAK；旧 orphan 从不复用，且存在 app-container artifact 时不得伪装重装；
10. raw/unwrapped key、设备本地 envelope 和 plaintext 不进入日志、崩溃、`.lifebook`、剪贴板或 JS 可枚举全局；容器只允许 TD-011 定义的 wrapped BackupRootKey envelope 与 wrapped SnapshotDataKey slot；
11. 复制 DB/附件/presence/bootstrap/设备 envelope/control slot 到另一设备，或跨 IAK/purpose/incarnation/Installation 替换，必须在 AEAD/identity gate 失败；
12. App Lock 开启后，进程重启、深链接、通知和后台返回都先经过安全门；clear/reinstall 后旧 session/grant/capability 全部失效；
13. 背景任务只能执行 allowlist 能力，测试无法经它返回记录 DTO 或跨 incarnation；
14. FreshAuthGrant 过期、后台、目标/摘要/incarnation 变化、重复使用时被拒绝；
15. DWK 凭据永久不可用时只有备份恢复/clear；IAK/bootstrap 不可用时 App 内 clear 也被拒绝，只能恢复平台存储或按指引 OS 重装；
16. TD-011 两遍恢复及其任一失败不改变接收设备 IAK、presence、Installation/incarnation、DWK、DatasetControlKey、AppLock/session、权限或账号状态，SnapshotDataKey handle 在 session terminal 后不可再用；成功后只按 TD-010 推进 active anchor。

### Security review

审阅原生 key 代码、accessibility/authenticator flags、随机源、AEAD envelope、nonce 唯一性、错误与日志、内存边界、backup exclusions、debug/release 差异和依赖安全公告。动态测试尝试 method hooking、截屏/后台快照、deep link 绕过和对后台 capability 的越权调用；发现绕过为发布 blocker。

## Rollout and rollback

首个真实数据库创建前必须同时发布 IAK、presence/bootstrap 双槽、strict all-absent classifier、incarnation-bound DWK/data envelopes、TD-010 `EmptyCandidateEvidence`/sequence-0 initialize 和 receipt→active-anchor CAS；不发布固定 key、明文 key preferences、Database Manager 自动建库或以后再在线补锚点的过渡版。已有内部开发库只能经一次性可丢弃 importer 进入新 generation，不能冒充 fresh。

包装策略升级通过新 envelope 双写/验证/切换，保留旧 wrapper 直到新 wrapper 成功打开；失败回滚读取旧 wrapper。DEK/cipher 轮换必须先创建加密备份或隔离副本并按 TD-010 原子激活。bootstrap/presence 格式升级必须是签名 build 内、Repository-open 前的 typed migration，提供旧/新 canonical fixture、headroom 和每个写点恢复；未知 version 不可忽略。任何 rollback 二进制都必须理解当前 IAK、record、envelope、control 与 receipt 版本；否则阻止安装/启动，不能通过回退丢弃新 key、锚点或 incarnation fence。

## References

- [Apple：Local Authentication](https://developer.apple.com/documentation/localauthentication)
- [Apple：Restricting keychain item accessibility](https://developer.apple.com/documentation/security/restricting-keychain-item-accessibility)
- [Apple：deviceOwnerAuthentication](https://developer.apple.com/documentation/localauthentication/lapolicy/deviceownerauthentication)
- [Android：Android Keystore system](https://developer.android.com/privacy-and-security/keystore)
- [Android：Show a biometric authentication dialog](https://developer.android.com/identity/sign-in/biometric-auth)
- [RFC 8785：JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785)

平台认证与 key flags 会随系统/兼容库变化。提高最低系统、改变 AndroidX Biometric、加入 extension/widget 或升级原生安全库时重新核验官方行为和真机矩阵。

## Revision notes

| 日期 | 说明 |
| --- | --- |
| 2026-07-27 | 将尚未建立的 TD-019 改为纯编号引用，保留账号与设备会话的计划关系但不创建破链。 |
| 2026-07-26 | 新增独立 InstallationAnchorKey、presence/bootstrap 精确双槽格式、稳定 bootstrap/可变 active operation、sequence headroom、clear/reinstall incarnation 与 activation-abort/active-anchor CAS。 |
| 2026-07-26 | 加入 DatasetControlKey，移除单一 BackupKey，按 TD-011 分离备份 root/用途 key/SnapshotDataKey，并固定两遍恢复不改变接收设备 key hierarchy。 |
| 2026-07-26 | 接受随机分层密钥、this-device-only 包装、原生 Key Manager、应用锁 session 和操作级近期认证。 |

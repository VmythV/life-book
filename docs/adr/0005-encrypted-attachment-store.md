# TD-005：加密附件存储

> Status：`Accepted`  
> Date：2026-07-26  
> Decision owners：客户端数据负责人、安全负责人  
> Scope：P0～P2 移动端附件字节、缩略图、临时文件、完整性和清理  
> Related requirements：PR-105、PR-500、领域模型 §7.3、BR-023～024、DATA-012、DATA-020～022、DATA-082、DATA-122、QR-012、QR-020、QR-070、QR-100～101  
> Related ADRs：[TD-003](0003-encrypted-local-database.md)、[TD-004](0004-device-key-hierarchy-and-app-lock.md)、[TD-010](0010-sqlite-snapshot-migration-and-atomic-restore.md)、[TD-011](0011-backup-container-and-cryptography.md)、TD-021
> Decision gate：原生密码库、安全评审、恶意文件、崩溃/空间不足和 50 MB 流式真机测试通过后才能开放附件

## Context

附件可能来自照片、相机和系统文件提供者，具有不可信大小、类型、名称和生命周期。P0 单附件上限 50 MB，长期设计容量 5 GB；不能把完整文件加载进 JS 内存，也不能依赖外部 URI 永久可读。用户取消、系统回收权限、App 被杀、磁盘满、数据库事务失败和记录删除都可能发生在字节处理的中间阶段。

附件还需满足：数据库/附件静态加密、独立缩略图、备份恢复、敏感遮罩、引用完整性和永久清理。SQLite 与文件系统没有跨系统原子事务，因此必须有显式操作日志和可恢复提交协议，不能用“先写文件再插一行”假装原子。

## Decision

附件二进制存放在 App 私有、排除系统备份的文件树中，不进入普通 SQLite BLOB。每个附件生成独立 256-bit 随机 `FileDataKey`，用 `AttachmentRootKey` 包装；文件正文使用 **libsodium `crypto_secretstream_xchacha20poly1305`** 以固定 256 KiB 明文块流式认证加密，最后一块必须带 `TAG_FINAL`。缩略图是独立附件对象、独立 key 和独立密文。

所有导入使用“受控读取 → 加密暂存 → 完整验证 → 原子提升 → SQLite 事务绑定”的可恢复流水线。活动文件名为随机、不透明 locator，不含用户文件名、记录 ID、MIME 或内容 hash；用户可见名称只在加密数据库元数据中保存。

## Decision details

### 1. 密钥与封装

```text
AttachmentRootKey (ARK, TD-004)
    └── XChaCha20-Poly1305 AEAD wraps FileDataKey
            └── secretstream XChaCha20-Poly1305 encrypts file chunks
```

- `FileDataKey` 由 libsodium 安全随机源生成，不从内容 hash、附件 ID、文件名或 ARK 直接确定性派生；
- key envelope 使用 `crypto_aead_xchacha20poly1305_ietf`、每次随机 nonce，并把 `attachmentId + keyPurpose + envelopeVersion` 作为 associated data；
- envelope 保存在 SQLCipher 内的附件技术元数据中；不会单独解密正文，也不进入日志/遥测；
- root key 与 file key 仅经 TD-004 原生 handle API 使用，不返回可长期存活的 JS 字符串；
- 复制记录时创建新 Attachment、FileDataKey 和密文；P0 不做密文内容去重；
- ARK 轮换只重新包装 FileDataKey；真正 FileDataKey 轮换时写新密文并原子切换 locator，不能就地改写。

### 2. 私有文件格式

每个活动密文文件是一个版本化内部容器：

```text
fixed magic
formatVersion
algorithmId
plaintextChunkSize = 262144
secretstreamHeader
repeated: ciphertextChunkLength + ciphertextChunk
final authenticated chunk with TAG_FINAL
```

规则：

- header 不含原文件名、MIME、记录/空间 ID、hash、时间或其他用户内容；
- 规范化外层 header、attachment ID 与 file-key envelope ID 作为每个 secretstream chunk 的 associated data；它们不必写入可见 header，但解密上下文必须一致，防止把合法密文替换到另一 Attachment；
- parser 先验证 magic、支持版本、固定上限和剩余长度，再分配缓冲区；
- 非最终明文块必须恰为 256 KiB，最终块可以较小；空文件使用一个空 `TAG_FINAL` 块；
- 每个 ciphertext 长度必须等于对应 plaintext 长度加 secretstream overhead；不接受负数、溢出、超大声明或尾随数据；
- 解密必须看到且只看到一个最终块；认证失败、截断、重排、重复、错误 key 或 FINAL 后仍有字节一律标记 corrupt；
- 私有格式版本与领域 Attachment、备份格式和同步协议分别版本化，不把 libsodium 版本号当容器版本；
- 不自创 nonce/rekey 算法；由 secretstream 生成 header、nonce 演进和内部 rekey。

`ContentHash` 使用解密后原始字节的 SHA-256，边读边算，只用于完整性、备份清单和重复提示。它保存在 SQLCipher/加密 manifest 内，不作为文件名、公开 ETag、日志字段或用户身份；hash 相同不能跳过权限、引用或附件创建。

`CiphertextIdentity` 与 `ContentHash` 是两个不能互换的值。前者采用版本化 canonical tuple `privateFormatVersion + exactCiphertextByteLength + SHA-256(完整密文文件字节)`，在 promote 后关闭/重开文件流式计算并写入 SQLCipher 技术元数据；sealed root manifest 和条件 GC 使用它确认 locator 没有被替换。它同样不得出现在公开文件名、日志、遥测或未加密诊断中。

### 3. 目录布局

```text
attachments/
  active/aa/<randomLocator>
  staging/<operationId>.part
  quarantine/<randomLocator>
  plaintext-cache/<sessionRandom>
```

目录名 `active` 只表示 object 已完成 promote，不表示它只属于当前 dataset generation；该共享不可变 object store 跨 generation 使用。可见性由当前数据库引用决定，保留性由动态/冻结 root 与 operation lease 决定，generation 切换不移动、覆盖或批量重命名附件。

- 只有 File Store 可以解析路径；所有调用者传不透明 locator/operation ID；
- locator 使用安全随机受控编码并在 adapter 内做完整正则/根目录归属校验，不接受用户路径、`..`、绝对路径、URI 或软链接；
- 目录和文件权限取平台最严格 App 私有默认；iOS 密文使用适合首次解锁后后台维护的文件保护，临时明文使用 complete protection；
- iOS 每次创建/原子替换后重新设置 backup exclusion，因为文件操作可能重置属性；Android 同时配置 API 31+ data extraction rules 与 API 30- full-backup rules；
- unknown file 不自动打开或递归删除；先移入 quarantine、只记录无内容诊断，确认不被任何操作/元数据引用后按保留规则清理；
- 删除函数只接受验证后的单文件 locator，不暴露“删除任意目录/递归根目录”API。

### 4. 选择与输入边界

用户明确选择文件后：

1. 取得最小、短期读取授权；不把外部 URI 当永久 storage locator；
2. 读取 provider 声明的大小/MIME/名称，但全部视为不可信提示；
3. 用内容 sniffing、解码器和 allowlist 确认实际类型；扩展名不决定 MIME；
4. 在读取前预检单附件/记录上限、可用空间和预计密文/缩略图空间；读取中继续硬计数，防 provider 虚报；
5. 显示名去除路径分隔/控制字符并按领域长度处理，只用于 UI；
6. 流式复制并加密，取消时关闭源、清密码状态并删除已写暂存密文；
7. 完成后释放 security-scoped/persistable URI 授权；除非另有已确认能力，不长期保留相册/文件 provider 权限。

压缩包、图片、PDF/文件等内容还需防解压/解码炸弹、超大尺寸、恶意 metadata 和 parser 漏洞。P0 不主动解压用户压缩包，也不执行附件脚本、宏或嵌入内容。

### 5. 导入与记录提交协议

`AttachmentFileOperation` 是技术操作日志，不是用户 Attachment：

```text
reserved
→ encrypting
→ encrypted_verified
→ promoted
→ bound

任一步 → cancelled | terminal_failed
```

完整流程：

1. 生成 attachment ID、operation ID、随机 locator/FileDataKey/envelope；在短事务写 `reserved`，不建立 Record 关系；
2. 从外部源流式写 `staging/*.part`，同步计算 plaintext size/hash；更新阶段只记录非内容信息；
3. 关闭后从头流式解密验证 header、每块认证、FINAL、大小和 hash；状态到 `encrypted_verified`；
4. fsync 文件/平台等价，原子 rename 到 `active`，fsync/确认父目录，状态到 `promoted`；
5. 用户保存表单时，在同一 SQLite 事务创建 Attachment 元数据、关系、key envelope，并把 operation 标为 `bound`；只有此事务提交后 UI 才报告记录含附件保存成功；
6. 事务失败或用户取消时，promoted 文件成为有明确 operation 的 orphan，由立即清理/恢复任务处理；不能建立 missing Attachment；
7. 崩溃恢复按 operation + staging/active 事实推进或回滚，绝不重新读取已经失效的外部 URI 猜测完成。

必要附件在 `encrypted_verified/promoted` 前失败时，表单保留并让用户移除失败附件或取消保存，符合 BR-023。一个记录多附件保存时，所有待绑定文件必须先 promoted，SQLite 关系在一个事务提交；部分字节 orphan 可清理，但业务关系不得部分创建。

restore/migration candidate 产生的新密文即使尚未绑定 active DB，也必须由 candidate/operation root lease 保护。取消、崩溃恢复或 orphan 扫描只能提交 `ConsiderAttachmentForGc`，并在重新求得全部 roots/leases 后决定是否回收；不得凭“尚未出现在 active DB”直接删除。

### 6. 附件状态与读取

领域 `Attachment.status` 仍是 `processing | available | missing | corrupt`：

- 正常保存只在文件已 promoted 后创建 `available` Attachment；
- P1 下载/恢复中可以创建 `processing` 元数据，但详情明确不可查看；
- 元数据存在而 locator 不存在为 `missing`；
- header、auth、FINAL、大小/hash 不符为 `corrupt`；
- 状态修复通过受控重下/恢复/移除命令，不允许 UI 把字段改回 available。

读取顺序为授权/应用锁 → 查元数据与状态 → 取得 key handle → 打开受控 locator → 流式认证解密。任何明文都不能在认证前交给 decoder/viewer；失败的部分输出立即丢弃，不能展示“前几块看起来正常”。

### 7. 图片与缩略图

- 先完成原文件加密，再从受控解密流使用维护中的原生 decoder 读取；
- 在 decode 前检查像素尺寸、颜色/帧数和内存预算；超限不生成缩略图但保留合法原附件；
- 按 EXIF orientation 正确旋转，缩略图移除 GPS、相机序列号和非显示所需 metadata；
- 默认生成不放大、最长边受控的展示缩略图；具体尺寸由设计/性能测试配置，不改变原图；
- 缩略图拥有独立 Attachment ID、FileDataKey、hash、locator 和 `thumbnailAttachmentId` 关系；
- 原图删除/损坏时缩略图不能冒充可恢复原件；缩略图可随时删除重建；
- sensitive/locked 状态在查询前不解密缩略图，UI 使用通用安全占位。

### 8. 临时明文与系统查看/分享

优先通过内存/原生 stream 解码，不创建明文文件。确有系统 API 只接受 URL 时：

- 仅在用户已解锁并明确打开/分享后，在 `plaintext-cache` 创建随机名文件；
- 使用最严格可用文件保护、no-backup/no-index 标记，不复用原文件路径；
- 不在明文文件名包含标题/家庭名；分享时可以通过系统 display name 元数据提供安全名称；
- App 进入后台/锁定、分享回调、查看关闭、进程下次启动或最迟 15 分钟时尝试删除；
- 操作日志只记随机 temp ID/过期时间，不能记录内容；
- 系统/接收 App 已复制的内容无法由生活有谱撤回，分享前说明；
- 删除是 best effort，安全承诺不依赖闪存物理覆写；最小生命周期和加密源文件是主要控制。

### 9. 移除、回收站与垃圾回收

- Record 移到回收站时附件关系和密文保留，供 30 天恢复；
- 普通“移除附件”先删除可见关系并保留撤销状态，撤销窗口结束后持久任务检查所有引用；
- active generation 中所有仍需保留字节的 locator-bearing `Attachment` 行是当前动态 GC root，包含权威原附件和仍被引用的本地派生缩略图；candidate/capture 和 active 即将变为 previous 时，由 TD-010 在写 gate 内生成受认证、冻结的 locator + expected `CiphertextIdentity` manifest；sealed generation 只必须保留权威原附件，派生缩略图可以清空引用并在再次 activation 后重建；
- 只有 active 动态 root、sealed previous/candidate/capture manifest 以及 backup/restore/manual-rollback/upload/导入/未完成 bind operation lease 都不引用时，才能删除密文和 key envelope；activation 时的 candidate root 不能在开放业务写入后代替 active 动态 root；
- 永久 purge 在数据库事务移除关系/元数据并写 `ConsiderAttachmentForGc(locator, expectedCiphertextIdentity)` 任务；任务执行时重新求全部 roots/leases，后来又被引用则成功 no-op/延后，文件已不存在可幂等成功，locator/identity 不匹配则停止并隔离，绝不能按入队时 refcount 直接删除；
- 删除 thumbnail 不影响原件；删除原件同时排队其派生缩略图；
- orphan scanner 只遍历受控 attachments 子目录，对比全部动态/冻结 root 和 operation lease，设至少 24 小时安全年龄，绝不删除刚完成但事务尚未提交、备份正在读取或回滚检查点仍保留的文件；
- 失败清理可重试并显示存储仍占用，不把删除失败恢复成业务 Attachment。

### 10. 备份、恢复与同步

- P0 备份的 File Store 输入只能是 TD-010 在同一写 gate 中冻结并认证的 `available` 权威原附件 manifest + read/root lease；逐项通过 locator 与 `CiphertextIdentity` 打开、认证解密并直接送入 TD-011 独立备份密钥保护的载荷流，lease 持有到容器成功或失败清理完成。来源随后 purge 也不能删除 lease 内对象；容器不得包含设备密文、FileDataKey/ARK envelope、storage locator 或内部路径；
- 缩略图是派生附件，不进入 portable DB 或备份载荷；projector 删除其 Attachment 行并清空原附件的 `thumbnailAttachmentId`，恢复 activation 后排队重建；
- 恢复在隔离区验证备份 auth/hash 后为每个原附件生成接收设备的新 FileDataKey、envelope、locator 和密文，置于 candidate root lease；TD-010 只有在 candidate 数据库与附件 root 全部验证后才原子切换逻辑数据集；
- 导出是明确的未加密副本，走临时明文规则和风险确认；
- P1 上传/下载协议由 TD-021 决定，不能默认把设备私有密文直接当跨设备格式；
- OQ-006 未关闭前，设备静态加密不等于云端 E2EE，也不把 ARK 上传服务端；
- CloudBackup、同步附件和本地 `.lifebook` 是三条不同文件路径，operation type/namespace 分开。

## Alternatives considered

### SQLite BLOB

事务绑定方便，但大文件扩大 WAL、备份、迁移和内存压力，难以独立流式处理/GC；不适合 5 GB 设计容量。元数据留 DB，字节独立。

### App 私有目录明文文件

平台沙箱/文件保护是外层控制，但不能覆盖复制、错误备份和不同锁定状态，也与 PR-500 不符。密文仍使用平台文件保护作为 defense in depth。

### 每文件一次性 AES-GCM

需要完整文件或自行设计 chunk framing；50 MB 尚可但未来更大、取消/续传/内存不稳。拒绝整文件缓冲。

### 自行分块 AES-GCM

必须自己正确处理 nonce、顺序、截断、FINAL、重排和 rekey，容易产生协议缺陷。使用成熟 secretstream 原语和版本化外围容器。

### 只从 AttachmentRootKey + ID 确定性派生 key

减少 envelope，但 root 泄露影响全部文件，ID 重用/上下文绑定和独立轮换更难；也不支持按文件撤销。选择随机 per-file key + wrap。

### 内容寻址去重

可节省重复图片，但 hash/file existence 泄露相等关系，引用/删除/密钥共享更复杂。P0 不做；未来必须保留独立 Attachment 语义并经安全/生命周期评审。

## Consequences

### Positive

- 固定内存流式处理 50 MB 及未来更大附件，支持取消和进度；
- secretstream 验证每块、顺序、截断和最终边界，不自创 nonce 方案；
- 每文件 key 缩小轮换/损坏影响，缩略图可独立删除重建；
- 文件与数据库之间通过 operation journal 恢复，不会静默产生半绑定记录；
- 私有 locator、无明文 sidecar 和系统备份排除降低元数据/内容泄露。

### Negative

- 需要维护 libsodium 原生构建/绑定、私有容器和跨平台文件原子语义；
- 每附件 envelope/验证增加元数据和两遍读取成本；
- 缩略图独立密文增加存储，P0 不做去重；
- 某些系统 viewer 需要短期明文文件，无法做到“从未落明文”；
- DB 与文件系统仍非真正原子，必须长期维护 operation/orphan 清理协议。

## Risks and mitigations

| 风险 | 缓解 |
| --- | --- |
| nonce/key/stream 使用错误 | 只用 libsodium keygen/secretstream/AEAD API；固定格式；独立密码学评审和 tamper fixtures。 |
| 恶意 provider 虚报大小/MIME | 流式硬上限、内容 sniffing、decoder limit、取消并删暂存。 |
| 崩溃留下 orphan/半状态 | 持久 operation、fsync+atomic rename、重启状态机、全 generation/lease root 集合、24h 安全年龄。 |
| path traversal/symlink 误删 | 随机 locator、根目录 canonical 验证、单文件 API、拒绝用户路径和软链接。 |
| 临时明文泄露 | 仅显式操作、complete protection/no-backup、短 TTL、锁定清理、无内容文件名。 |
| 缩略图泄露敏感内容 | 独立加密；锁定查询不解密；截图/可访问树用通用占位。 |
| 存储不足破坏记录 | 写前/写中预算、预留 overhead、原记录事务不提交、已有文件不删。 |
| libsodium 供应链/ABI | 固定维护版本、官方 source/checksum、许可/SBOM、双平台 release symbol 与已知向量测试。 |

## Implementation constraints

- 只有 Attachment File Store 可以打开内部附件路径；Presentation/Domain 只见 ID、metadata、stream handle；
- File Store 只提供 opaque locator 的 promote/open/identity/lease/root-enumeration/conditional-GC 能力；`generation-root.enc`、control slot、generation activation 和 root 保留策略由 TD-010 Dataset Controller 拥有，File Store 不自行切换数据集；
- 密码操作、hash、文件 IO、图片 decode 不在 JS/UI 主线程；进度节流，不能逐块触发渲染；
- 加密失败不得保留明文 fallback；解密 auth 失败不得返回部分内容；
- `storageLocator` 是不透明值，序列化/备份/同步时不能误当跨设备路径；
- release 包不包含“导出原始 attachment directory”调试能力；
- 文件上限同时在 UI、application、native reader 和备份/同步 parser 执行；
- 远程配置只能收紧小于编译硬上限的上传/选择限制，不能提高密码 parser 的硬上限；
- P0 适用类型/数量仍由路线图控制，通用 Attachment 模型不自动开放所有页面。

## Verification

### Cryptographic/container tests

- 官方/自建固定 fixture 跨 iOS/Android round-trip；空、1 byte、边界±1、50 MB；
- wrong key/header、每一块单 bit 修改、截断、重复、重排、删除 FINAL、两个 FINAL、尾随字节、超大/溢出 length 全部拒绝且无部分明文；
- envelope nonce/key/associated-data 不匹配拒绝；同一明文两次加密产生不同密文；
- 完整密文 byte length/digest 任何变化都会改变 `CiphertextIdentity`；root/metadata expected identity 不匹配只能隔离，不能打开或删除另一个对象；
- root rewrap 和 file-key full rotation 在每个 kill point 可恢复；
- release 日志/崩溃/heap instrumentation 不出现 key、文件名和明文样例。

### Lifecycle tests

- provider 取消/权限撤销、读中断、磁盘满、fsync/rename/DB commit 失败、App 在每阶段被杀；
- 多附件事务只有全部关系或一个都没有；orphan 在安全窗口后清理，刚提交文件不误删；
- record trash/restore/purge、附件 remove/undo/copy、thumbnail corrupt/rebuild、backup/restore 往返；portable 备份没有 thumbnail 行/字节且恢复后可重建；
- active 新增/移除附件与 GC 并发，previous/candidate/capture/backup/restore/upload root/lease 保留期间不得误删，释放最后 root 后才可按安全年龄清理；
- 锁屏/后台/截屏时敏感图片不从 UI、可访问树或明文缓存泄露；
- iOS backup exclusion 在 rename 后仍为 true，Android cloud/D2D 规则都排除；
- path traversal、symlink、恶意 MIME/图片尺寸、压缩炸弹和随机 private directory 文件不会越界读/删。

### Performance

最低与主流设备测量 1/10/50 MB 加密、二次验证、解密首屏、缩略图、取消和备份流。主线程无长任务，选择后 300 ms 内有占位，内存随 chunk 上限稳定；并以 5 GB/10,000 metadata 做扫描和 GC 分页测试。

## Rollout and rollback

首个附件即使用 v1 私有容器，不落明文过渡文件。容器 v2 采用双读、新写 v2、后台逐文件迁移；读取/验证新文件后原子切 metadata，旧文件在安全窗口后清理。回滚二进制必须仍能读当前写入格式，否则禁止发布该回滚。密码库升级不自动改变容器算法；改变算法新建 ADR/格式版本并保留旧读 fixture。

## References

- [libsodium：Encrypted streams and file encryption](https://doc.libsodium.org/secret-key_cryptography/secretstream)
- [libsodium：XChaCha20-Poly1305 AEAD](https://doc.libsodium.org/secret-key_cryptography/aead/chacha20-poly1305/xchacha20-poly1305_construction)
- [Apple：Encrypting Your App’s Files](https://developer.apple.com/documentation/uikit/encrypting-your-app-s-files)
- [Apple：isExcludedFromBackup](https://developer.apple.com/documentation/foundation/urlresourcevalues/isexcludedfrombackup)
- [Android：Security recommendations for backups](https://developer.android.com/privacy-and-security/risks/backup-best-practices)

升级 libsodium、文件 provider、图片 decoder、target SDK 或平台备份规则时重新核验官方资料和恶意 fixture；文档示例不替代对实际 native binding 的审计。

## Revision notes

| 日期 | 说明 |
| --- | --- |
| 2026-07-27 | 将尚未建立的 TD-021 改为纯编号引用，保留云附件与云备份传输的计划关系但不创建破链。 |
| 2026-07-26 | 增加 CiphertextIdentity、共享 object store 语义与重新求根的条件 GC；冻结 snapshot lease 和 Dataset Controller/File Store 所有权。 |
| 2026-07-26 | 对齐 TD-010/011：区分 active 动态 root 与 sealed generation manifest，补齐全部 GC lease，并冻结 portable 原附件重加密与缩略图重建规则。 |
| 2026-07-26 | 接受 per-file key、secretstream 256 KiB 分块、加密暂存/原子提升、独立缩略图和可恢复 GC。 |

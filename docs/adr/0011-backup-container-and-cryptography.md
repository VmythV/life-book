# TD-011：备份容器与密码学

> Status：`Accepted`
> Date：2026-07-26
> Decision owners：安全负责人、客户端数据负责人、质量负责人
> Scope：P0～P2 用户持有 `.lifebook` 文件的口令处理、密钥层级、二进制容器、manifest、载荷认证、资源上限、兼容读取和安全错误
> Related requirements：PD-006、PD-012、DATA-020～022、DATA-030～052、QR-020、QR-030～032、QR-070～072、QR-100～101、QR-110～112
> Related ADRs：[TD-004](0004-device-key-hierarchy-and-app-lock.md)、[TD-005](0005-encrypted-attachment-store.md)、[TD-006](0006-cross-platform-scalar-representations.md)、[TD-010](0010-sqlite-snapshot-migration-and-atomic-restore.md)
> Decision gate：独立密码学评审、固定向量与双平台 byte fixture、恶意容器 fuzz、最低支持真机 Argon2 内存/耗时、5 GiB 流式恢复、外部 provider 故障和全部历史格式恢复测试通过后，才允许生成用户可长期保留的备份

## Context

P0 必须在无账号、无网络且可跨设备的条件下完整备份生活数据。文件会离开 App 私有目录，可能进入云盘、聊天、桌面或不可信文件提供者；攻击者可以无限复制并离线猜测口令，也可以修改头部长度、KDF 参数、成员顺序、密文块或尾随内容。系统不能依赖 App 端限速阻止离线攻击，不能把设备安全存储密钥放进文件，也不能让损坏/恶意长度耗尽内存或磁盘。

备份包含两类不同字节：TD-010 生成、由每备份 `SnapshotDataKey` 加密的 portable SQLCipher 数据库，以及 TD-005 认证解密后的权威原附件内容。复制设备活动数据库或设备附件密文会携带自由页、设备表、locator 和设备 key envelope；把整个备份解密为明文目录又扩大泄露和路径穿越面。因此容器需要流式认证、明确成员边界、独立 key slot 和精确 EOF，但不能发明新的密码原语。

格式还必须长期读取。算法升级、manifest 变化和 portable data migration 是三件不同的兼容问题；若都塞进一个版本号，旧 App 会误判或用错误 parser 读取。公共头只能暴露解锁所需最小元数据，内容计数、标题、附件名、账号和空间信息必须在认证加密后。

本 ADR 决定密码套件和容器分层。TD-010 拥有一致快照、portable 投影、候选恢复和 atomic activation；[容器 v1 规范](../../specs/backup/container-v1.md)拥有精确 byte offset/framing；[manifest Schema](../../specs/backup/manifest.schema.json)拥有认证后的机器字段。

## Decision

P0 使用自定义、顺序读取的 `.lifebook` v1 加密容器，不使用 ZIP/TAR，也不复制活动 DB 或设备附件密文：

```text
fixed 256-byte public header
→ passphrase-wrapped random BackupRootKey
→ XChaCha20-Poly1305 encrypted canonical manifest
→ one secretstream XChaCha20-Poly1305 payload
→ exactly one FINAL and exact EOF
```

用户口令按版本化 RFC 8265 `OpaqueString` profile 处理，再以固定 Argon2id v1.3 profile `m=65536 KiB, t=3, p=1` 派生 256-bit `PassphraseWrappingKey`。每份备份随机生成独立 256-bit `BackupRootKey`，口令派生 key 只包装 root key；root key 通过 HKDF-SHA-256 派生 manifest、payload stream 和 SnapshotDataKey-slot 三个用途 key。manifest 和 root envelope 使用 XChaCha20-Poly1305-IETF，载荷使用 libsodium `crypto_secretstream_xchacha20poly1305`，固定 256 KiB 明文消息，最后且只能有一个 `TAG_FINAL`。

manifest 在认证后是严格 UTF-8、RFC 8785 JCS canonical JSON。载荷按 manifest 稳定顺序连续放置一个 portable SQLCipher DB 和 0～10,000 个权威原附件，不含路径或 ZIP entry。v1 不压缩、不选择成员、不合并恢复，也不存在产品方、账号或设备恢复槽；忘记口令无法恢复。

## Decision details

### 1. 所有权与原生边界

```text
BackupCoordinator (application)
  ├─ TD-010 PortableSnapshotHandle + AttachmentReadLease
  ├─ user-selected provider handle
  └─ progress/cancel state without content
              │
              ▼
BackupContainerPort (audited native module)
  ├─ passphrase profile + Argon2id
  ├─ random BackupRootKey + HKDF-derived purpose keys
  ├─ header / AEAD manifest / secretstream
  ├─ exact-length parser + resource gates
  └─ VerifiedBackupHandle / one-shot second-pass session/evidence
              │
              ├─ TD-010 candidate importer
              └─ TD-005 attachment stream re-encryption
```

- TypeScript/JS 可以编排阶段、进度、provider 和受控 DTO，但不得取得 `PassphraseWrappingKey`、`BackupRootKey`、`SnapshotDataKey` 或派生 key raw bytes；
- 口令从专用 UI 只经非日志 bridge 传入 native 一次，不进入 Redux、持久状态、analytics、crash breadcrumb 或通用错误对象；传入后立即清空 UI state。由于 JS string/系统剪贴板不能保证物理清零，文案只承诺最小驻留，不声称绝对擦除；
- native 使用 libsodium guarded memory/平台等价能力，按阶段 `sodium_memzero`/释放可控副本；清零是 defense in depth，不替代最小生命周期；
- TD-011 只有在私有密文 staging 的 header、manifest、全部 member、唯一 `TAG_FINAL` 和精确 EOF 完成首遍认证后，才向 TD-010 返回绑定该 staging 身份的 `VerifiedBackupHandle`；handle 只能开启一次 second-pass import session；portable DB/附件流和 `SnapshotDataKeyHandle` 都受该 session 生命周期约束，不能独立返回或复用；完整结束才产生一次消费的 `Pass2CompletionEvidence`，始终不暴露 raw key、任意文件系统路径或“解压到目录”；
- `.lifebook` parser 和未加密导入/ZIP parser 是不同入口、不同 MIME/extension、不同端口和测试集，不能自动 fallback。

### 2. 口令 profile

v1 `passphraseProfileId = opaque-string-u17-v1`，其 PRECIS derived-property 表、General_Category 和 normalization 数据固定为 Unicode 17.0.0；两端使用项目锁定且有同一 fixture 的实现，不能调用版本不明的系统 locale/Unicode API。精确程序为：

1. 把输入解码为 Unicode scalar 序列；孤立 surrogate、非法 UTF 编码直接拒绝。先对**原始序列**执行 `1..256` code point 和 UTF-8 `1..1024` bytes 的资源门；
2. 按 RFC 8265 OpaqueString preparation，确认每个 code point 都由固定 Unicode 17.0.0 PRECIS FreeformClass 明确允许；disallowed/unassigned、NUL 和控制字符拒绝；
3. width mapping 为 none，不把全角/半角字符映射为 compatibility decomposition；
4. 把除 U+0020 外、General_Category 为 `Zs` 的每个非 ASCII space 映射为 U+0020；没有其他 additional mapping；
5. case mapping 为 none；随后应用 Unicode NFC；directionality/Bidi rule 为 none；
6. 对**规范结果**再次执行 `1..256` code point 和 UTF-8 `1..1024` bytes 的 reader 资源门；创建端另要求至少 10 个 code point。最少 10 是 writer/UI 的新备份策略，不是 reader 解锁既有 profile 的接受门；
7. 两次确认比较规范 UTF-8 bytes。流程不 trim、不移除 U+0020、不做 case fold 或 NFKC；空格、大小写、emoji 和前后空格都是口令的一部分，UI 不静默纠错。

profile ID、Unicode/PRECIS 处理、reader 资源门、writer 强度策略和 KDF profile 分别版本化。改变 mapping、Unicode 表或 normalization 必须新增 passphrase profile 并永久保留旧 reader；改变创建端最小长度不重解释旧文件。

### 3. KDF 与 root envelope

v1 唯一可写 KDF profile：

| 字段 | 值 |
| --- | --- |
| `kdfProfileId` | `argon2id-v1-m65536-t3-p1` |
| algorithm | libsodium `crypto_pwhash_ALG_ARGON2ID13` |
| Argon2 version | `0x13` / 1.3 |
| salt | 每备份随机 16 bytes |
| memory | 65,536 KiB |
| iterations/opslimit | 3 |
| parallelism | 1 |
| output | 32 bytes |

这是项目的 libsodium profile，不称为“完全采用 RFC 9106 第二推荐参数”；RFC 的相应推荐使用 `p=4`，而本项目固定的 libsodium API profile 为 `p=1`。创建端不得调用随依赖变化的 `ALG_DEFAULT`、interactive/default 常量或远程参数。

流程：

```text
normalized passphrase + header salt
→ Argon2id → PassphraseWrappingKey
random 32-byte BackupRootKey
→ XChaCha20-Poly1305 wrap under PassphraseWrappingKey
→ fixed rootKeyEnvelope in public header
```

- root wrap nonce 每份备份随机 24 bytes；envelope 是 32-byte root key + 16-byte tag；
- root envelope、manifest、key slot、payload plan 和 chunk AAD 的完整 byte projection 只由 container-v1 规范拥有，ADR 不另定义第二套投影：root/manifest AAD 不额外 prepend label，其 256-byte header 中的 magic/version/suite 就是 domain discriminator；key-slot/chunk AAD 使用规范内的精确 label，member-plan JCS 使用精确 `domain` property；不允许“至少绑定”或实现自选字段；
- writer 先生成所有 nonce、key、secretstream header 和 manifest framing，再构造 256-byte provisional header：只把 48-byte `rootKeyEnvelope` 区间置零，`rootWrapNonce`、reserved 和其他 bytes 保持最终值。root envelope AAD 是该完整 provisional header；包装后把 envelope 写回形成 final header；manifest AAD 是完整 final header，包括 envelope 与全零 reserved；
- reader 先验证固定 header、文件上限和**已登记的精确 profile**，再运行 Argon2；不接受用户文件任意指定 memory/time/parallelism；
- root envelope 未认证前，错误口令、envelope 篡改和相关截断统一映射为 `backup_unlock_failed`，用户文案不证明口令是否正确；
- App 端尝试延迟只能缓解交互式误试，不能宣传为防止拿到文件后的离线猜测。

### 4. Root key 用途隔离

每份备份生成随机 256-bit `BackupRootKey`，使用 HKDF-SHA-256：

```text
PRK = HKDF-Extract(salt = containerId, IKM = BackupRootKey)
manifestKey      = HKDF-Expand(PRK, "life-book/backup/v1/manifest-key", 32)
payloadStreamKey = HKDF-Expand(PRK, "life-book/backup/v1/payload-stream-key", 32)
keySlotWrapKey   = HKDF-Expand(PRK, "life-book/backup/v1/key-slot-wrap-key", 32)
```

- label 是精确 ASCII bytes，不含结尾 NUL；任何改变需要新 suite；
- TD-010 每次备份请求 Key Manager 随机生成 operation-scoped 256-bit `SnapshotDataKey`，只加密 portable SQLCipher DB；它不是 HKDF 派生 key，以 opaque handle 交给 TD-011，再用 `keySlotWrapKey` + 随机 XChaCha nonce 包装，slot 位于加密 manifest；
- key-slot AAD 按 container-v1 的精确二进制投影绑定 suite、container、slot、portable schema 和 portable member；任何字段、顺序或编码改变都需要新 suite；
- attachment 原文只受外层 payload stream 保护，不携带原设备 `FileDataKey`/ARK envelope；恢复时 TD-005 生成接收设备新 key；
- `PassphraseWrappingKey` 不加密 manifest/payload，`SnapshotDataKey` 不加密附件，三个 HKDF 子 key 不互换；
- P0 只有一个 passphrase recipient，不包含产品方托管、账号恢复、设备隐藏槽、口令提示或 escrow。新增 recipient 必须新建安全 ADR 和容器版本。

### 5. v1 公共头

v1 header 固定 256 bytes、network byte order，未使用 reserved bytes 必须全零。精确 offset、整数宽度和 AAD 投影由 `specs/backup/container-v1.md` 唯一维护；语义字段至少为：

```text
magic = 8-byte ASCII "LIFEBOOK"
headerVersion = 1
headerLength = 256
containerFormatVersion = 1
suiteId
passphraseProfileId
kdfProfileId
criticalFeatureBitmap
containerId = random 16 bytes
argon2Version / memoryKiB / iterations / parallelism / salt
rootWrapNonce / rootKeyEnvelope
manifestNonce / manifestCiphertextLength
payloadSecretstreamHeader
payloadPlaintextChunkSize = 262144
reserved = all zero
```

公共头只暴露格式/算法标识、随机值、KDF 成本和密文 framing；不出现 snapshot 时间、App build、记录/附件数量、账号、空间、标题、文件名或内容 hash。所有影响解析/密码学的字段同时进入 root envelope 和 manifest AAD；未知 critical bit、非零 reserved、非 canonical integer、字段/profile 不一致或 header length 不符均在 KDF 前拒绝。

`headerVersion` 只选择固定 header 布局，`containerFormatVersion` 选择成员/framing 语义，`suiteId` 选择密码算法与全部 AAD 投影；三者是独立 registry，v1 writer 只写各自登记值。`criticalFeatureBitmap` 的 bit 由 container registry 分配，v1 值必须为零；任何未知置位 bit 在 KDF 前拒绝。header 不是可扩展任意 TLV。未来增加必须字段时提升 header/container version；reader 不忽略未知 header 尾部。全局 parser 可以支持未来 header，但任何 header 绝对上限为 4 KiB。

### 6. 加密 manifest

manifest plaintext 是严格 UTF-8、无 BOM、RFC 8785 JCS canonical JSON。创建端先按 [manifest Schema](../../specs/backup/manifest.schema.json) 构造，再 JCS 序列化；读取端必须：

1. 先用 `manifestKey`、header 的随机 24-byte nonce 和完整 final header AAD 完成 XChaCha20-Poly1305-IETF 认证；`manifestCiphertextLength` 包含 16-byte AEAD tag，公共 gate 只接受 `16..16 MiB + 16`；
2. 在认证前不 JSON parse、不按声明分配大对象、不返回字段级错误；
3. 使用能检测 duplicate property、非法 UTF-8/Unicode、过深对象和数字语义漂移的 parser；
4. 重新 JCS 序列化并与原 plaintext bytes 做 constant-time/固定路径 byte equality；非 canonical 即拒绝；
5. 通过固定版本 JSON Schema 和额外跨字段 invariant；未知 required feature/member 拒绝。

manifest Schema 使用 JSON Schema Draft 2020-12、根及所有业务对象 `additionalProperties: false`；`format` 不是安全断言，所有 UUID、Instant、hash、十进制整数和二进制字段还须由明确 pattern/range 与语义 parser 验证。唯一前向扩展面是受预算的 `extensions` 集合和 `extension` member；不存在到处散落的未知 property。字段族必须完整表达：

- `manifestSchemaVersion`、`portableDataSchemaVersion`、`scalarEncodingVersion`；
- `containerId`、snapshot Instant、生成 App/build、minimum reader capability；
- `requiredFeatures`、受控 non-critical extensions 和 completeness；未知 required feature 拒绝，未知但结构有效且在预算内的 non-critical extension 认证后忽略；
- portable DB member、portable cipher profile、`SnapshotDataKey` wrapped slot；
- 按稳定顺序的 member `typeCode/memberId/required/byteLength/sha256`；
- 五种记录、模板、附件、active/archived/trashed 数量和总量；
- pending `StockChangeIntent`、未确认 `SyncMutation` 的精确计数，以及绑定/provenance 是否存在的布尔/枚举摘要；摘要仅用于恢复预览，不携带 secret、token、设备 ID 或内容；
- `complete | recoverable_with_attachment_gaps`，以及 missing/corrupt attachment 数量；
- member/payload 计数、总 plaintext length 和 payload plan digest。

TD-006 long counter 和 byte length 使用无前导零规范十进制字符串；hash 是 64 个 lowercase hex；Instant、EntityId、ExactDecimal 等使用对应 scalar canonical encoding。JSON number 只用于 Schema 明确限制在安全小整数的版本/enum，不保存路径或任意 provider metadata。

Schema 之外仍必须验证以下跨字段不变量：manifest `containerId` 与 header 完全相等；snapshot ID、portable schema、mutation counter 和 portable member 身份与解密后的 portable DB meta 完全相等；portable DB 中每个 `available` 权威原附件恰有一个同 ID attachment member，`missing/corrupt` 没有 member；member ID/`(typeCode, memberId)` 不重复；所有分类计数与 portable DB 验证结果相等；`complete` 当且仅当 gap 数为零；member length 和、payload 总长、plan digest、message count 与实际流完全相等。任一展示摘要不一致也拒绝，而不是只修正文案。

除 byte 上限外，parser 还固定最大 nesting 32、JSON token 200,000、object property 100,000、单 string 4,096 UTF-8 bytes（受控 build/version 字段另收紧）、数组 10,016、根 extensions 16 项且 canonical plaintext 合计不超过 64 KiB；binary 字段统一用 Schema 指定的小写 hex，并在 decode 后复核固定长度。更细的字段上限由 manifest Schema 唯一维护，reader 在 materialize 大对象前计数。

### 7. Member plan 与载荷

所有成员以 `(typeCode ASC, memberIdBytes ASC)` 形成唯一总序；`memberIdBytes` 是 manifest `memberId` 的严格 ASCII bytes，不做 locale/Unicode collation：

1. `typeCode=0` 为恰好一个 `portable_database`，保留 `memberId="database"`、`required=true`；
2. `typeCode=1` 为 0～10,000 个 `authoritative_attachment`，`memberId` **就是** portable DB 中 Attachment 的 TD-006 EntityId，即 36-byte lowercase hyphenated UUID ASCII，`required=true`；
3. `typeCode=2..32767` 在 container v1 保留，出现即拒绝；`32768..65535` 为通用 non-critical extension member，必须 `required=false`，ID/大小/数量受 manifest Schema 限制。当前 writer 不生成 extension member；未来 writer 也按同一二元组插入，旧 reader 必须完整认证、计入长度/hash 后丢弃其明文；
4. `(typeCode, memberId)` 全局唯一且实际数组必须已经严格升序；payload 末消息使用唯一 `TAG_FINAL`，之后立即 EOF。

容器没有 member header、路径、文件名或每附件独立公开 frame。manifest 的长度把连续 payload 映射回成员；成员可以跨 256 KiB stream message 边界。这里的 member hash 是“送入外层 stream 的 bytes”：portable DB 成员 hash 覆盖仍由 SnapshotDataKey 加密的 SQLCipher 文件，附件成员 hash 覆盖 TD-005 认证解密后的权威原附件 bytes。

载荷使用一个 libsodium `crypto_secretstream_xchacha20poly1305` state：

- 固定 plaintext message size 262,144 bytes，只有最后一条可以更短；v1 不主动发送 `TAG_REKEY`；
- 所有非最终消息使用 ordinary message tag，最后且只能有一个 `TAG_FINAL`；
- `payloadPlanDigest = SHA-256(JCS(container-v1 定义的 ordered member plan projection))`；投影只包含固定字段且 Schema 不允许实现自选字段；
- `manifestCiphertextDigest = SHA-256(manifest ciphertext bytes)`，覆盖 ciphertext 与 16-byte Poly1305 tag、不覆盖已在 header 中的 nonce；每条消息 AAD 按 container-v1 的固定二进制投影绑定 domain label、suite、containerId、该 digest、payloadPlanDigest、u64 chunk index、u32 实际 plaintext length 和 final byte；
- secretstream 顺序状态、manifest 总长度/成员 hash、逐 chunk AAD、唯一 FINAL 和精确 EOF 共同拒绝删除、重复、重排、交换、截断和追加；
- writer 在流式读取时重新计算每个 member hash/size并与预先认证 manifest 比较，不信数据库元数据；不一致立即失败，不能事后改 manifest 或把文件标为完整；
- v1 不压缩。SQLCipher 与常见图片/PDF收益有限，禁用压缩也避免解压炸弹、比例上限和额外算法兼容面。

如果 snapshot 预检发现 missing/corrupt 附件，用户只能选择先修复/中止，或明确创建 `recoverable_with_attachment_gaps`。后一种 manifest 保留逻辑元数据和缺口计数，但不为无字节对象生成 payload member。原本标为 available 且已列入 member plan 的读取失败必须中止；不能在写流中静默降级。

### 8. 资源硬上限与长度证明

以下是 v1 编译期 parser 上限；签名配置/远程配置只能收紧创建侧产品上限，不能让 reader 接受更大密码输入：

| 项目 | v1 上限 |
| --- | ---: |
| v1 header | 固定 256 bytes；所有版本绝对 4 KiB |
| manifest plaintext | 16 MiB |
| JSON nesting depth | 32 |
| member 总数 | 10,016：1 database + 最多 10,000 attachment + 最多 15 extension |
| payload plaintext message | 256 KiB |
| 单权威原附件 | 50 MiB |
| 权威原附件数 | 10,000 |
| 权威原附件总量 | 5 GiB |
| portable DB member | 2 GiB |
| 单 extension member / 合计 | 16 MiB / 64 MiB |
| payload plaintext 总量 | 8 GiB |
| 整个 container | 8 GiB + 32 MiB |
| passphrase | 256 code points 且 1,024 UTF-8 bytes |

- 外部 provider 的 MIME、扩展名、declared size、seekability 和 length 都是不可信提示；按实际读取 byte 计数；
- 所有长度/计数用 overflow-safe u64/TD-006 ExactInteger 运算；任何加法、乘法、ceil-div 或 bridge 转换溢出即拒绝；
- header 未认证长度只能用于常量小缓冲或与硬上限比较，不能直接分配；manifest 认证后仍按 Schema/跨字段上限流式处理；
- 解密 manifest 后先证明 member sum、总 payload、chunk 数和文件总长一致，再读 payload；
- v1 portable DB 必须非空，因此 `payloadPlaintextLength > 0`、`messageCount = ceilDiv(payloadPlaintextLength, 262144)`；最后一条明文长度始终在 `1..262144`，整除时最后一条仍是完整 262,144 bytes 并携带 `TAG_FINAL`；reader 明确拒绝 `TAG_PUSH`、`TAG_REKEY` 和任何非末尾 `TAG_FINAL`；`manifestCiphertextLength = manifestPlaintextLength + 16`，v1 `secretstreamABYTES = 17`；
- v1 实际文件长度必须精确等于 `256 + manifestCiphertextLength + payloadPlaintextLength + messageCount × 17`；secretstream header/root envelope 已在 256-byte header 中。任何短读、长读、尾随 byte、缺/双 FINAL 都拒绝；
- 创建仍执行 DATA-035 的临时空间公式，至少预留预计最终输出 1.5 倍，并在写中处理实际 `FULL/IOERR/short write`。

### 9. 创建流程与成功边界

```text
collect + normalize + confirm passphrase; prepare provider handle
→ TD-010 current-device capture + portable allowlist projection
→ freeze authoritative-attachment manifest/read lease
→ validate counts, hashes, completeness and resource budget
→ derive wrapping key without further human input
→ generate BackupRootKey/nonces/containerId and encrypted manifest
→ stream portable DB + original attachments into one secretstream
→ write FINAL; close/sync private encrypted staging
→ reopen staging and verify header/root/manifest/every payload byte/EOF
→ release snapshot/attachment lease
→ copy/commit to user-selected provider handle
→ close and reopen target; verify exact size + whole-container identity
→ record success; clear keys and queue staging/partial cleanup
```

口令确认和 provider 交互必须在取得 TD-010 maintenance/attachment lease **之前**完成；用户思考、二次输入、文件选择器和分享面板期间不冻结数据集。选择目标/取得 handle 只表示预备，不算成功。容器始终先在 App 私有 no-backup 区形成完整密文 staging；不得依赖通用 provider 支持 filesystem atomic rename。私有验证时计算 `TargetContainerIdentity = SHA-256(完整容器密文字节)`，目标重读必须得到相同 exact length 和 identity。短写、权限撤销、close/commit 失败、无法重新读取或 identity 不同都算失败；外部 partial best-effort 删除，删不掉也不把操作标成功。该 identity 不显示、不持久化到普通业务数据或日志。

portable DB 始终是 SQLCipher 密文；附件明文从 TD-005 解密 stream 直接进入 backup secretstream，不落明文 staging。创建只从 capture 开始持有 TD-010 snapshot/attachment lease，并在私有 staging 完整复验后释放；慢速 provider copy/commit/重读期间不再冻结数据集。私有复验前失败则在清理 operation root 后释放。

### 10. 恢复解析与 TD-010 交接

选择外部文件后先按实际 byte 上限复制为 App 私有 no-backup **密文** staging，关闭写 handle，以 `NOFOLLOW`/平台等价检查拒绝 symlink，并保留只读 descriptor/平台文件身份，避免 provider 内容或授权在验证中变化。恢复使用严格两遍协议：

```text
strict public-header/resource gate
→ passphrase profile + exact Argon2id
→ authenticate root envelope
→ derive subkeys and authenticate canonical manifest
→ verify version/features/member plan/exact expected length
→ pass 1: authenticate every payload chunk/member hash/length, unique FINAL and exact EOF
→ bind containerId + exact length + whole-container SHA-256 + private file identity
→ seal and return VerifiedBackupHandle
→ open one-shot pass-2 session: re-authenticate exact staging while TD-010 builds disposable candidate
→ verify pass-2 member hashes/FINAL/EOF/whole-container identity and sink receipt
→ issue Pass2CompletionEvidence bound to operation + handle + plan + candidate
→ preview + fresh auth
→ TD-010 atomic activation
```

- `VerifiedBackupHandle` 不能在 pass 1 完成前构造，也不能引用可由调用方替换的 path；关闭/替换 staging、文件身份变化、任一 byte 改变或第二遍 identity 不一致都会使 handle 永久失效；
- pass 1 不创建 candidate、不写业务数据、不重排通知或搜索；pass 2 只能写 TD-010/TD-005 管理的可丢弃 staging，完整结束前不产生 preview、activation 或外部副作用；
- `Pass2CompletionEvidence` 是 process-local、不可伪造、一次消费的 native capability，精确绑定 operation ID、candidate generation、`VerifiedBackupHandle` 文件身份 tuple、manifest/member-plan digest、sink completion receipt 和第二遍 whole-container identity；缺失、不匹配、重复消费或取消都不能 seal candidate/生成 preview；
- `BackupContainerPort` 不把整个载荷解密到目录；portable DB outer bytes 写入受控 SQLCipher staging 后只以 session-scoped opaque `SnapshotDataKeyHandle` 打开，附件流直接由 TD-005 重新加密；session terminal 后销毁该 handle；
- container 认证不等于 portable SQLite 可信；TD-010 仍使用 defensive readonly reader、allowlist copy 和 fresh candidate；
- 任何 payload/candidate 失败只清 staging/candidate，当前 active dataset 不变；
- P0 不允许选择/跳过已认证必需成员、逐条合并、标题去重或把 `.lifebook` 当普通导入源；
- 恢复解锁后展示 snapshot 时间、范围、completeness 和来源 build，由用户确认。v1 无可信防回滚服务，无法密码学阻止攻击者替换为另一份更旧但有效的备份；设备时钟也不是反回滚证明。

### 11. 错误、取消与后台

错误分层：

| 阶段 | 可公开错误 |
| --- | --- |
| KDF 前公共 gate | 非本产品文件、明确不支持的 container/suite/KDF/profile、超过编译硬上限、读取失败。 |
| root envelope 未认证 | 统一“无法解锁此备份，请检查口令或文件”；内部稳定码 `backup_unlock_failed`。 |
| root 已认证、manifest 前后 | manifest/payload 损坏、未来 manifest/data feature、成员不完整、空间不足、portable migration/validation 失败。 |
| activation | 当前数据已变化、fresh auth 失效、TD-010 switch/integrity blocked。 |

日志、analytics、crash 和支持诊断只允许 operation ID、stage、稳定 code、格式/profile 版本、大小/耗时分桶和无内容计数；禁止口令、key、nonce/envelope bytes、路径、文件名、标题、EntityId、member/content hash、SQL row 或原始 parser 错误。

- create capture/project/member stream、restore pass 1、restore pass 2 和 candidate validation 只在安全 batch/chunk/member boundary 响应取消；取消使 handle/session terminal，清理 staging/candidate，不产生 `Pass2CompletionEvidence`；
- create 的 `FINAL + close/durability barrier` 与 `provider commit + close/reopen identity verify` 分别是短不可中断临界段；进入后返回实际 succeeded/failed，不把已经成功的文件报告为 canceled；
- TD-010 activation 开始后不再接受普通取消或返回手势；迟到 cancel 不改变 old active/new active/integrity-blocked 的实际确定终态；
- secretstream partial 不支持从任意位置 append。App 进程仍存活时可以在安全 chunk 边界暂停；进程被终止后，仅当加密 operation journal 和 opaque root/key handle 能安全恢复才续跑，否则删除 partial 并从头创建；
- P0 默认不持久化可跨进程解封的 BackupRootKey，因此创建进程被杀后从头开始。未来跨进程 resume 需要 device-wrapped operation key、nonce/state 防重用、生命周期和新安全评审；
- incomplete private/target file 永不重命名为成功备份，任何 failure/cancel 后 active 数据保持不变。

### 12. 版本与扩展

兼容性由独立 selector 明确组合，不存在一个万能 `formatVersion`：

| Selector | 唯一职责 |
| --- | --- |
| `headerVersion` | 公共头 layout、offset、宽度和 reserved 语义。 |
| `containerFormatVersion` | member 排序、payload chunk/tag framing 与 EOF。 |
| `suiteId` | HKDF、AEAD、nonce/tag、root/manifest/key-slot/plan/chunk AAD projection。 |
| `passphraseProfileId` | Unicode/PRECIS mapping 与 normalization。 |
| `kdfProfileId` | Argon2 算法、version、参数、单位和输出长度。 |
| `manifestSchemaVersion` | 认证 JSON 字段、通用 extension envelope 和 Schema 内条件。 |
| `portableDataSchemaVersion` | portable SQLCipher 逻辑表、列、meta 和迁移 mapper。 |
| `portableCipherProfileId` | manifest `portableDatabase.cipherProfileId` 指向的 SQLCipher settings。 |
| `scalarEncodingVersion` | TD-006 portable 标量 canonical encoding。 |
| `databaseSchemaVersion` | 接收设备 active/candidate 内部存储；不是备份输入格式 selector。 |

- v1 reader 只接受已登记的 header/container/suite/passphrase/KDF/manifest/portable-data/portable-cipher/scalar selector 组合，不做任意算法协商；
- 任一 unknown selector 要求升级；unknown critical feature/member 拒绝；
- unknown non-critical member 仍必须按 plan 完整认证、计长和校验 hash，之后才可按长度丢弃；
- `criticalFeatureBitmap` 和 manifest `requiredFeatures` 是 capability gate，不替代上述 selector；未知 critical/required 值拒绝；
- v1 在整个 1.x 产品生命周期保持可读。算法升级采用 old-read/new-write，不原地重新解释 v1；
- 改口令 mapping/Unicode 表只新增 `passphraseProfileId`；改 KDF 只新增 `kdfProfileId`；改 HKDF/AEAD/AAD projection 只新增 `suiteId`；改 header offset 只新增 `headerVersion`；改 member/chunk/EOF framing 只新增 `containerFormatVersion`；每项都带对应 golden fixture，不无关联地抬升所有 selector；
- 仅使用 Schema 1 已预留的 bounded non-critical extension envelope 不提升 manifest version；新增根字段或改变 envelope 才新增 `manifestSchemaVersion`。portable schema/cipher/标量变化分别提升自己的 selector，不提升 container version；
- writer 永远只写当前批准格式；停止旧 reader 必须遵守 DATA-051 公告和转换路径。

## Alternatives considered

### 1. 不提供离线备份

实现最简单，但设备丢失、换机或清除数据后没有 P0 用户可控恢复路径，不满足 PD-006/DATA-030。拒绝。

### 2. 直接保存活动 SQLCipher DB 与设备附件密文

可以少做一次转换，但会携带设备表、自由页、搜索/投递投影、locator 和设备 key envelope；跨设备还依赖源设备 key。拒绝，采用 TD-010 fresh portable projection 和附件重新加密。

### 3. ZIP/TAR 后整体加密或逐 entry 加密

成熟 archive 有工具生态，但路径、重复 entry、central directory、压缩炸弹和 entry 加密组合增加 parser 面；逐 entry 还公开数量/边界。P0 不需要随机访问/选择恢复，选择无路径的单一顺序流。

### 4. 口令派生 key 直接加密全部数据

少一层 key，但无法清晰隔离 manifest/payload/key slot，用新口令重包装或未来多 recipient 也更困难。选择随机 root key + 单用途 wrapping key。

### 5. 整文件一次性 AES-GCM/XChaCha AEAD

要求持有/重读巨大单个消息，难以 5 GiB 流式、进度和固定内存。选择 secretstream；不自行设计 nonce/chunk AEAD。

### 6. AES-CTR/CBC + 独立 HMAC 或自定义 chunk GCM

必须自行证明 nonce、顺序、截断、重排、FINAL 和组合安全，错误面大。选择维护中的 libsodium AEAD/secretstream。

### 7. 可调任意 Argon2 参数

为未来留弹性，但恶意 header 可触发任意资源，跨实现也易漂移。只接受登记的精确 profile；升级新增 ID。

### 8. v1 压缩

SQLCipher、图片和 PDF 通常已压缩，收益不稳定；引入解压炸弹、比例限制、更多依赖和兼容负担。v1 不压缩。

### 9. 产品方/账号/设备恢复槽

可以找回口令，但改变 P0 无账号与不托管信任边界；隐藏设备槽还会让跨设备恢复失败或产生虚假承诺。P0 只有口令槽，未来需新安全 ADR。

## Consequences

正面结果：

- 每份随机 root 和精确用途隔离使口令只承担 root 解锁，不复用设备 key；
- manifest 内容和成员边界保持机密，单一 stream 以固定内存验证大文件；
- fixed header/profile/resource gates 可在昂贵 KDF/分配前拒绝恶意输入；
- portable DB 与附件各自保留合适的内层/外层保护，跨设备不依赖源设备；
- container、manifest、portable data、active DB 分别演进，旧读新写可测试；
- 无路径、无压缩、精确 EOF 显著缩小 archive parser 攻击面。

成本和长期负担：

- 需要维护受审 native crypto/parser、binary spec、JCS、JSON Schema 和每版 fixture；
- 创建前需要已知所有 member size/hash，附件写入时仍需再次流式验证，I/O 较多；
- 64 MiB Argon2 与全容器双遍验证在低端设备耗时明显，必须展示进度并做真机门；
- 忘记口令不可恢复，产品/客服不能绕过；
- 自定义容器不能被通用归档工具读取，必须长期维护 reader/转换工具；
- v1 不支持跨进程创建续跑、选择恢复或合并。

## Risks and mitigations

| 风险 | 缓解 |
| --- | --- |
| 弱口令被离线猜测 | 最少 10 code point、Argon2id 64 MiB/t3、强度提示/密码管理器；明确无法阻止弱口令离线攻击。 |
| Unicode 口令跨端不一致 | RFC 8265 profile + NFC、固定 fixture、raw/normalized 上限；不用 locale/trim/case fold。 |
| header 参数造成内存/CPU DoS | 只接受精确登记 profile，先校验固定长度和硬上限再 KDF。 |
| nonce/key 用途混用 | 每份随机 key/nonce、HKDF labels、opaque typed handles、静态类型和独立密码学评审。 |
| 截断/重排/追加仍被接受 | secretstream state + chunk AAD + plan length/hash + unique FINAL + exact EOF。 |
| manifest parser differential | AEAD first、duplicate-key parser、JCS byte equality、Schema + invariant、双实现/fuzz corpus。 |
| provider 短写/内容变化 | 私有密文 staging、close/commit、目标 reopen + identity verify；失败不记成功。 |
| 大文件耗尽 RAM/磁盘 | 固定 256 KiB stream、compile limits、overflow-safe length proof、写中计数、空间预检。 |
| 日志暴露口令/内容 | typed redaction、禁止 raw parser/crypto error、release secret scan 和 crash/heap 测试。 |
| 有效旧备份替换新备份 | 解锁后显示 snapshot 元数据并明确确认；v1 不宣称反回滚。 |
| 算法/库老化 | dependency/SBOM 监测、old-read/new-write suite、历史 fixture、独立安全重审。 |

## Implementation constraints

- 只使用受审、固定版本的 libsodium Argon2id/XChaCha/secretstream 和成熟 HKDF-SHA-256/JCS 实现；不复制博客代码或自写 primitive；
- build/lockfile/SBOM 固定依赖、源码 checksum、许可和 release symbols；升级必须重跑全部向量/fixture/fuzz；
- RNG 只能使用平台 CSPRNG/libsodium randombytes；生产不能注入 deterministic seed，测试 RNG 只存在 test binary；
- nonce 在相同 key 下不得复用；每份 backup root 随机，manifest/root/key-slot nonce 独立随机；
- parser 是 explicit state machine，每个 read 有 exact upper bound，所有 enum exhaustive，失败进入 terminal state；
- JSON Schema 不是 canonical/duplicate/invariant 的替代；binary header 也不由 JSON Schema 定义；
- secretstream plaintext/ciphertext、attachment stream 和 portable DB copy 不跨 JS bridge；JS 只收 bounded progress/count；
- 任何 path、SQL、provider URI、filename、MIME、member name 都不能来自 manifest 并传给文件 API；v1 manifest 出现 path 字段直接拒绝；
- crypto comparison 使用 constant-time API；用户错误不包含 KDF/AEAD 原始文本；
- 远程配置不得改变 KDF、suite、chunk、passphrase mapping、hard limit 或旧格式接受范围；
- release 禁止 debug key dump、任意容器 inspector、跳过认证/完整性、明文 fallback 和“尽力恢复损坏成员”；
- `container-v1.md`、manifest Schema、golden binary fixtures 和 parser tests 必须在同一版本变更中更新，任何字段只有一个 owner。

## Verification

### 1. 密码学与 canonical encoding

- RFC 9106 Argon2id、RFC 5869 HKDF、libsodium XChaCha/secretstream、RFC 8785 JCS 和 SHA-256 官方向量；
- 固定 RNG/clock/portable bytes 的 iOS/Android byte-identical container fixture；
- RFC 8265/OpaqueString：组合/预组字符、非 ASCII space、大小写、前后空格、emoji、禁止码点、9/10/256/257 code point、1024/1025 UTF-8 byte；
- 同口令同内容创建两次得到不同 salt/root/nonces/ciphertext；每个派生 key/label 不同；
- root/manifest/key-slot wrong key、wrong AAD、nonce/envelope/slot swap 全部拒绝；
- BackupRootKey/SnapshotDataKey/派生 key 不出现在 JS、日志、crash、heap snapshot 或诊断包。

### 2. Parser、篡改与 fuzz

- 对 header、root envelope、manifest 和每个 payload byte 单点 bit flip；
- magic/version/header length/reserved/critical bit/KDF 参数/manifest length/member count/十进制数字溢出；
- manifest invalid UTF-8、BOM、duplicate key、非 JCS、非法 Unicode、深层对象、Schema/跨字段不一致；
- chunk 截断、重复、删除、重排、交换、错 length/AAD、缺 FINAL、双 FINAL、FINAL 后尾随；
- member hash/size/order/id/type/requiredness、payload sum 和实际文件长度不一致；
- corpus fuzz 覆盖 binary state machine、JSON parser、JCS、Schema、native bridge，失败无 crash/OOM/越界和部分明文输出。

### 3. 生命周期与 provider

- 空数据、QR-020 最大数据、10,000 附件、单附件 50 MiB、附件总量 5 GiB、portable DB/manifest/container 各上限±1；
- available 附件在两次 hash 间改变、missing/corrupt 的 abort 与明确 gap 两条路径；
- create 的 capture/project/header/manifest/每 chunk/FINAL/fsync/private verify/provider copy/close/reopen 任一点 kill；
- provider 权限撤销、短读/短写、不可 seek、内容替换、同名覆盖、空间耗尽和 target 无法重开；
- pass 1 完成前无法构造/伪造 `VerifiedBackupHandle`；两遍之间或第二遍读取中 staging byte/descriptor/identity 变化会失败且不留下可激活 candidate；
- pass 2 未完成、sink receipt 缺失、evidence 绑定不匹配/重复消费时不能 preview/activate；pass 2 cancel 和 activation late cancel 保持实际确定终态；
- foreground chunk pause；进程 kill 后 partial 不续成成品而从头开始；
- 干净安装与已有数据整体恢复，失败后当前 active 可打开且无混合 dataset；
- 每个旧 container/manifest/portable fixture 恢复，再创建当前格式并在干净安装往返。

### 4. 跨 ADR 恢复

- TD-010 portable DB defensive read、candidate migration、每个 activation kill point和 previous rollback；
- TD-005 原附件 plaintext hash、接收设备新 FileDataKey/locator、candidate/root lease 和缩略图排除/重建；
- TD-004 备份口令不能解封设备 envelope，恢复不改变 AppLock/session/permission/telemetry device state；
- TD-008 search/FTS/task/counter、TD-009 delivery/action/platform ID 都不在 portable 数据，activation 后重建/epoch fence；
- snapshot time/范围/gap/旧有效备份替换的预览与 fresh auth；P0 无 member selection/merge 路径。

### 5. 生产门

- 独立密码学和 untrusted-parser review 关闭所有 blocker/high；
- 最低支持 iOS/Android 真机测 Argon2 64 MiB 的峰值内存、P95、thermal、后台行为和 UI responsiveness；
- release 产物 SBOM、license、symbol、no-debug/no-backup/secret/log scan；
- parser/KDF 失败码、支持诊断和用户文案无法泄露口令正确性或内容；
- 正式格式 byte fixture 只从通过门的 release-equivalent native build 生成并签入版本库。

## Rollout and rollback

首个公开备份直接写 container v1，不产生未版本化试验文件。内部 pre-v1 文件不承诺读取，也不能误用 `.lifebook` 正式 MIME。v1 writer 只有全部生产门通过才启用；此前 UI 不提供可保留备份成功承诺。

算法或 manifest 升级采用“先发布能读旧/新、仍写旧 → 验证恢复覆盖 → 下一兼容版本开始写新”的顺序。回滚二进制必须仍能读取已经写出的 container/suite/manifest/portable version；否则不得发布为可回滚构建。发现 writer 缺陷时可停止新建，但 reader、手动功能和现有数据继续；发现 reader 安全缺陷时禁用受影响格式并进入安全更新，不使用宽松 parser fallback。

P0 没有官方口令恢复。以后若增加账号/托管 recipient、跨进程 resume、压缩、随机访问、member selection 或云端格式，必须创建新安全 ADR、威胁模型、迁移/撤销方案和旧 fixture；不得在 v1 reserved bytes 中静默开启。

## References

- [RFC 9106：Argon2 Memory-Hard Function](https://www.rfc-editor.org/rfc/rfc9106.html)
- [libsodium：Password hashing](https://doc.libsodium.org/password_hashing/default_phf)
- [RFC 8265：Preparation, Enforcement, and Comparison of Internationalized Strings](https://www.rfc-editor.org/rfc/rfc8265.html)
- [Unicode 17.0.0](https://www.unicode.org/versions/Unicode17.0.0/)
- [Unicode Standard Annex #15：Normalization Forms](https://www.unicode.org/reports/tr15/tr15-57.html)
- [RFC 5869：HKDF](https://www.rfc-editor.org/rfc/rfc5869.html)
- [libsodium：XChaCha20-Poly1305](https://doc.libsodium.org/secret-key_cryptography/aead/chacha20-poly1305/xchacha20-poly1305_construction)
- [libsodium：Encrypted streams and file encryption](https://doc.libsodium.org/secret-key_cryptography/secretstream)
- [libsodium：Secure memory](https://doc.libsodium.org/memory_management)
- [RFC 8785：JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html)
- [NIST FIPS 180-4：Secure Hash Standard](https://csrc.nist.gov/pubs/fips/180-4/upd1/final)
- [SQLite：Online Backup API](https://www.sqlite.org/backup.html)

标准和依赖会更新。实现与发布前必须以固定源码/二进制、官方向量和独立评审核验；本文选择成熟原语和分层，不把任一库的 mutable default 当格式合同。

## Revision notes

| 日期 | 说明 |
| --- | --- |
| 2026-07-26 | 以 container-v1/manifest Schema 收敛无额外 label 的 header AAD、domain-tagged plan、session-scoped SnapshotDataKey、`Pass2CompletionEvidence`、取消边界和独立兼容 selector。 |
| 2026-07-26 | 固定 Unicode 17 OpaqueString 步骤、两阶段 header AAD、member 总序/扩展预算、parser 预算和先全量认证再二遍导入的 `VerifiedBackupHandle` 边界。 |
| 2026-07-26 | 接受 OpaqueString + 固定 Argon2id profile、随机 BackupRootKey、HKDF 用途隔离、XChaCha manifest、单 secretstream payload、无路径/无压缩容器和独立版本/资源门。 |

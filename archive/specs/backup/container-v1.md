# `.lifebook` Container v1 字节规范

> Status：`Normative`
> Version：`1.0.0`
> Date：2026-07-26
> Owner：客户端安全与数据基础设施
> Applies to：`containerFormatVersion = 1`、`headerVersion = 1`、`suiteId = 1`
> Decision source：[TD-011：备份容器与密码学](../../docs/adr/0011-backup-container-and-cryptography.md)
> Authenticated manifest：[manifest.schema.json](manifest.schema.json)

## 1. 目的与规范词

本文是 `.lifebook` v1 的唯一 binary wire-format 来源，固定公共头 offset、整数编码、密码 profile registry、AEAD additional data、成员投影、secretstream framing、长度证明和读取状态机。产品范围、生命周期与信任边界由 TD-011 和 TD-010 拥有；manifest JSON 字段由配套 Schema 拥有。

“必须”“不得”“应”“可以”分别对应 RFC 2119/8174 的 MUST、MUST NOT、SHOULD、MAY。除非字段明确标为文本，所有值都是 bytes；所有多字节整数均为 unsigned、big-endian/network byte order。实现不得使用 native struct layout、隐式 padding、locale collation 或平台默认字符集。

推荐文件扩展名为 `.lifebook`，provider MIME hint 为 `application/vnd.life-book.backup`。扩展名和 MIME 都不是信任依据；reader 只以本规范 magic、认证结果和资源门判断。

## 2. 基础编码与常量

本文使用以下无歧义记号：

| 记号 | 定义 |
| --- | --- |
| `u8(x)` | 单个 unsigned byte。 |
| `u16be(x)` | 2-byte unsigned big-endian。 |
| `u32be(x)` | 4-byte unsigned big-endian。 |
| `u64be(x)` | 8-byte unsigned big-endian。 |
| `ascii(s)` | `s` 的精确 US-ASCII bytes；不含 BOM、长度或结尾 NUL。 |
| `lp16(s)` | `u16be(len(ascii(s))) || ascii(s)`。 |
| `hex(bytes)` | 每 byte 两位 lowercase ASCII hex，无 `0x`、空白或分隔符。 |
| `JCS(value)` | RFC 8785 canonical JSON 的 UTF-8 bytes。 |
| `SHA256(bytes)` | 32-byte SHA-256 digest。 |
| `||` | byte concatenation。 |

v1 suite 常量：

| 常量 | 精确值 |
| --- | ---: |
| `HEADER_LENGTH` | 256 bytes |
| `GLOBAL_HEADER_MAX` | 4,096 bytes |
| `MANIFEST_PLAINTEXT_MAX` | 16,777,216 bytes |
| `MANIFEST_CIPHERTEXT_MAX` | 16,777,232 bytes |
| `PAYLOAD_CHUNK_PLAINTEXT` | 262,144 bytes |
| `PAYLOAD_PLAINTEXT_MAX` | 8,589,934,592 bytes |
| `CONTAINER_MAX` | 8,623,489,024 bytes |
| `XCHACHA_KEY_BYTES` | 32 |
| `XCHACHA_NONCE_BYTES` | 24 |
| `XCHACHA_ABYTES` | 16 |
| `SECRETSTREAM_HEADER_BYTES` | 24 |
| `SECRETSTREAM_ABYTES` | 17 |
| `SHA256_BYTES` | 32 |

所有 length、offset、count、加法、乘法和 ceil-division 必须在 checked u64 中完成。转换到平台 `size_t`、Java/Kotlin `Long`、Swift `Int` 或 JavaScript 精确整数前必须再次证明可表示；禁止先转换再检查。

## 3. Registry

### 3.1 公共头 registry

| Registry | v1 值 | 语义 | 其他值 |
| --- | ---: | --- | --- |
| `headerVersion` | 1 | 本文第 4 节固定 256-byte 布局。 | `0` 非法；未知值停止并要求升级。 |
| `containerFormatVersion` | 1 | 本文成员顺序、载荷与 EOF 语义。 | `0` 非法；未知值停止并要求升级。 |
| `suiteId` | 1 | 本文 Argon2id/HKDF/XChaCha/secretstream/AAD 全套组合。 | `0` 非法；未知值停止并要求升级。 |
| `passphraseProfileId` | 1 | TD-011 `opaque-string-u17-v1`。 | `0` 非法；未知值停止并要求升级。 |
| `kdfProfileId` | 1 | `argon2id-v1-m65536-t3-p1`。 | `0` 非法；未知值停止并要求升级。 |
| `criticalFeatureBitmap` | 0 | v1 没有公共 critical feature。 | 任一 bit 置位都在 KDF 前拒绝。 |

第 3.1 节五个 header registry 的值 `65535` 保留给本地测试，生产 writer 不得生成，release reader 不得接受；这条不限制第 3.2 节独立的 member type range。新增 header registry 值必须有新 ADR、更新本文/fixture，并采用 old-read/new-write 发布顺序。

### 3.2 Member type registry

| `typeCode` | `memberId` | `required` | v1 reader 行为 |
| ---: | --- | --- | --- |
| `0` | 精确 ASCII `database` | 必须 `true` | 恰好一个 portable SQLCipher DB；必须是第一项。 |
| `1` | TD-006 canonical Attachment EntityId：36-byte lowercase UUID ASCII | 必须 `true` | 权威原附件；0～10,000 项。 |
| `2..32767` | — | — | 保留 critical range；出现即拒绝。 |
| `32768..65535` | Schema 规定的 namespaced ASCII extension ID | 必须 `false` | 完整认证、计长、验 hash 后丢弃；最多 15 项。 |

所有成员按 `(typeCode 数值 ASC, memberId ASCII byte lexicographic ASC)` 严格升序，pair 不得重复。不得用 UUID 解码后的 16 bytes、locale、Unicode normalization 或 case-insensitive 比较代替 ASCII 文本排序。

### 3.3 Key slot registry

v1 恰好一个 `slotId = 1` 的 `snapshot_data_key` slot。`0` 非法，其他值未知即拒绝；v1 不存在设备、账号、产品方或 escrow slot。

## 4. 256-byte 公共头

文件从 offset `0` 开始，先是恰好 256-byte header。payload 之外没有 padding、footer、member header、目录或 trailing metadata。

| Offset | Length | Field | v1 精确约束 |
| ---: | ---: | --- | --- |
| 0 | 8 | `magic` | ASCII `LIFEBOOK`，即 hex `4c494645424f4f4b`。 |
| 8 | 2 | `headerVersion` | `u16be(1)`。 |
| 10 | 2 | `headerLength` | `u16be(256)`。 |
| 12 | 2 | `containerFormatVersion` | `u16be(1)`。 |
| 14 | 2 | `suiteId` | `u16be(1)`。 |
| 16 | 2 | `passphraseProfileId` | `u16be(1)`。 |
| 18 | 2 | `kdfProfileId` | `u16be(1)`。 |
| 20 | 8 | `criticalFeatureBitmap` | `u64be(0)`。 |
| 28 | 16 | `containerId` | 每份文件独立的 CSPRNG bytes。manifest 表示为 32 lowercase hex。 |
| 44 | 1 | `argon2Version` | `u8(0x13)`。 |
| 45 | 1 | `argon2Parallelism` | `u8(1)`。 |
| 46 | 2 | `kdfReserved` | 两个 zero bytes。 |
| 48 | 4 | `argon2MemoryKiB` | `u32be(65536)`。 |
| 52 | 4 | `argon2Iterations` | `u32be(3)`。 |
| 56 | 16 | `argon2Salt` | 每份文件独立的 CSPRNG bytes。 |
| 72 | 24 | `rootWrapNonce` | XChaCha20-Poly1305-IETF nonce，CSPRNG。 |
| 96 | 48 | `rootKeyEnvelope` | 32-byte `BackupRootKey` ciphertext + 16-byte tag。 |
| 144 | 24 | `manifestNonce` | XChaCha20-Poly1305-IETF nonce，CSPRNG。 |
| 168 | 8 | `manifestCiphertextLength` | `u64be`；含 16-byte tag，范围 `16..16777232`。 |
| 176 | 24 | `payloadSecretstreamHeader` | `crypto_secretstream_xchacha20poly1305_init_push` 返回的 header。 |
| 200 | 4 | `payloadPlaintextChunkSize` | `u32be(262144)`。 |
| 204 | 52 | `reserved` | 全部 zero；任一非零 byte 拒绝。 |

`containerId`、salt、nonce 和 secretstream header 是 opaque bytes。`containerId` 不是 TD-006 EntityId/UUID，manifest 只用 `hex(header.containerId)`；不得经过 GUID mixed-endian、UUID variant/version 或文本解析。CSPRNG 生成器必须由平台或固定 libsodium 实现提供；测试 deterministic RNG 不得进入 production binary。

### 4.1 永久 preamble 与读取

全格式 reader 可以先读取前 12 bytes 得到 magic、`headerVersion` 和 `headerLength`，但：

- magic 不匹配时返回 `not_lifebook_container`，不得尝试 ZIP/SQLite/普通导入 fallback；
- `headerLength < 12`、大于 4,096、未知 `headerVersion` 或读不到声明长度时返回 unsupported/malformed；
- v1 只接受 `headerLength = 256`，不得忽略尾部；
- 第 4 节所有固定 registry、KDF 参数、chunk size、reserved 与公开 length/resource gate 必须在 Argon2 前完成；exact file-length 证明只能在 manifest 认证后完成；
- 公共头是攻击者可修改的，认证前不得把其中 nonce、ID、profile 或长度记录到普通日志，也不得据它分配超限内存。

## 5. 口令、KDF 与 root envelope

### 5.1 口令输入

`passphraseProfileId = 1` 使用 TD-011 定义的 Unicode 17.0.0 RFC 8265 OpaqueString 精确程序。Argon2 的 password bytes 是该程序产出的规范 UTF-8 bytes；不得含结尾 NUL。reader 执行 profile 的资源门但不执行 writer 的“至少 10 code point”创建策略。

### 5.2 Argon2id profile

使用 Argon2id version 1.3，结果 32 bytes：

```text
PassphraseWrappingKey = Argon2id(
  password = normalized UTF-8 bytes,
  salt = header[56..71],
  memory = 65536 KiB = 67108864 bytes,
  iterations/opslimit = 3,
  parallelism = 1,
  outputLength = 32
)
```

实现可以调用输出兼容的 `crypto_pwhash_ALG_ARGON2ID13`：传给 libsodium `memlimit` 的值必须是 `67108864` **bytes**，`opslimit=3`、输出 32 bytes；不得把 header 的 `65536 KiB` 数字未经单位换算直接当 byte 参数，也不得调用 mutable `ALG_DEFAULT` 或把文件内参数直接传给可任意配置 API。发布 fixture 必须证明实现输出与本 profile 固定向量一致。

### 5.3 Root envelope 的两阶段 header

writer 独立随机生成 32-byte `BackupRootKey`。在 root wrap 前，header 中除 `rootKeyEnvelope` 外的每个字段都必须已经是最终值，包括 `rootWrapNonce`、manifest length、secretstream header、chunk size 和全零 reserved。payload/member length 与 count 只存在于加密 manifest，公共头不重复明示；文件总长度本身仍会泄露粗略大小，v1 不承诺 padding 隐藏。

```text
provisionalHeader = finalHeader with bytes [96, 144) replaced by 48 zero bytes
rootKeyEnvelope = XChaCha20-Poly1305-IETF-Encrypt(
  key = PassphraseWrappingKey,
  nonce = header.rootWrapNonce,
  plaintext = BackupRootKey,
  aad = provisionalHeader
)
finalHeader = provisionalHeader with bytes [96, 144) replaced by rootKeyEnvelope
```

AAD 恰好是 256 bytes，不加额外 domain label、长度、NUL 或 hash；header 自身的 `magic + headerVersion + containerFormatVersion + suiteId` 是 domain discriminator。nonce 不在置零范围，reserved 也参与 AAD。envelope 使用 combined mode，恰好 48 bytes。reader 从收到的 header 复制 256 bytes、仅清零 `[96,144)` 构造同一 AAD；失败统一映射 `backup_unlock_failed`。

## 6. Root key 派生与 key slot

### 6.1 HKDF-SHA-256

所有输入都是 raw bytes：

```text
PRK = HKDF-Extract-SHA256(
  salt = header.containerId,
  IKM = BackupRootKey
)

manifestKey = HKDF-Expand-SHA256(
  PRK, ascii("life-book/backup/v1/manifest-key"), 32
)
payloadStreamKey = HKDF-Expand-SHA256(
  PRK, ascii("life-book/backup/v1/payload-stream-key"), 32
)
keySlotWrapKey = HKDF-Expand-SHA256(
  PRK, ascii("life-book/backup/v1/key-slot-wrap-key"), 32
)
```

三个 info literal 不含引号、长度或结尾 NUL。任何 label、salt 或输出长度变化都不是 suite 1。

### 6.2 SnapshotDataKey slot

TD-010 提供独立随机 32-byte `SnapshotDataKey`。manifest 中 slot 1 的 `nonce` 为 24-byte CSPRNG、`ciphertext` 为 combined-mode 48 bytes，均以 lowercase hex 保存。

精确 AAD：

```text
keySlotAAD =
  lp16("life-book/backup/v1/key-slot-aad") ||
  u16be(1) ||                         # suiteId
  header.containerId ||               # 16 raw bytes
  u16be(1) ||                          # slotId
  u32be(manifest.portableDataSchemaVersion) ||
  u16be(0) ||                          # database member typeCode
  lp16("database") ||                 # portable memberId
  lp16(manifest.portableDatabase.cipherProfileId) ||
  u64be(databaseMember.byteLength) ||
  decodeHex(databaseMember.sha256)     # 32 raw bytes
```

```text
slot.ciphertext = XChaCha20-Poly1305-IETF-Encrypt(
  key = keySlotWrapKey,
  nonce = decodeHex(slot.nonce),
  plaintext = SnapshotDataKey,
  aad = keySlotAAD
)
```

`portableDataSchemaVersion` 必须在 `1..2147483647`，`cipherProfileId` 必须是 Schema 接受且 reader registry 已知的 ASCII token，database length/hash 必须来自唯一 `typeCode=0` member；这些值在包装前均已冻结，不形成循环。它们与 portable DB 的认证 meta/实际 bytes 必须相同。slot 解锁失败、长度不符或字段不一致时整个恢复失败；不得尝试其他 AAD 或 key。

## 7. Manifest 区

manifest ciphertext 紧接 header：

```text
manifestOffset = 256
payloadOffset = checkedAdd(256, manifestCiphertextLength)
```

manifest plaintext 必须先由 [manifest.schema.json](manifest.schema.json) 验证，再按 RFC 8785 JCS 产生 UTF-8；禁止 BOM、padding、压缩或结尾换行。加密为：

```text
manifestCiphertext = XChaCha20-Poly1305-IETF-Encrypt(
  key = manifestKey,
  nonce = header.manifestNonce,
  plaintext = manifestJCS,
  aad = finalHeader
)
```

manifest AAD 恰好是文件中的最终 256-byte header，包括 root envelope 和 zero reserved；不加额外 label、长度或 NUL，header 的 magic/version/suite 字段就是 domain discriminator。combined ciphertext 包含结尾 16-byte tag，且：

```text
manifestCiphertextLength = len(manifestJCS) + 16
manifestCiphertextDigest = SHA256(manifestCiphertext)
```

digest 覆盖 ciphertext 和 tag，不覆盖 header 中的 nonce。reader 必须先完整认证再 parse JSON；重新 JCS 序列化后的 bytes 必须与解密 plaintext exact equal。

## 8. Member plan

### 8.1 Canonical plan projection

`manifest.members` 本身必须已按第 3.2 节严格排序。payload plan projection 是一个恰好含 `domain`、`members` 两个 property 的 JSON object；`domain` 固定为精确 ASCII string `life-book/backup/v1/member-plan`，`members` 是同顺序的新 array，每项只保留以下五个、且恰好以下五个字段：

```json
{
  "domain": "life-book/backup/v1/member-plan",
  "members": [
    {
      "byteLength": "4096",
      "memberId": "database",
      "required": true,
      "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "typeCode": 0
    }
  ]
}
```

值直接复制自已通过 Schema 的 member，不做 parse 后再格式化以外的转换：

```text
payloadPlanDigest = SHA256(JCS(planProjection))
```

manifest 的 `payload.planSha256` 必须等于 `hex(payloadPlanDigest)`。任何额外 member metadata、extensions 或展示计数都不进入 projection。

### 8.2 成员与 payload bytes

payload plaintext 是 `members` 所指 bytes 的无间隔 concatenation：

```text
payloadPlaintext = member[0].bytes || member[1].bytes || ... || member[n-1].bytes
```

- 恰好一个 database member，`byteLength > 0`，其 SHA-256 覆盖 SnapshotDataKey 加密的完整 portable SQLCipher 文件；
- available 权威附件 member 的 SHA-256 覆盖 TD-005 验证并解密后的原附件 plaintext；`memberId` 就是 portable DB Attachment ID；
- missing/corrupt attachment 没有 payload member；gap 只存在于 portable DB metadata 和 manifest completeness/counts；
- 每个 member `byteLength > 0`。extension 单项最多 16 MiB、合计最多 64 MiB；
- 所有 member length 的 checked sum 必须等于 manifest 的 payload plaintext length；
- member 可以跨 secretstream message boundary；不得为对齐插入 padding。

writer 在真正送入 secretstream 时必须重新计算每个 member 的 byte count/hash，并与已冻结 plan 比较；不一致时终止并删除 partial，不得改写已加密 manifest。

## 9. Secretstream payload framing

### 9.1 初始化与消息长度

使用 libsodium `crypto_secretstream_xchacha20poly1305`：

```text
pushState, payloadSecretstreamHeader = init_push(payloadStreamKey)
```

header 的 24 bytes 写入公共头 `[176,200)`。文件不另写该 header。令 `P` 与 `N` 分别为已认证 manifest `payload.plaintextLength`、`payload.messageCount` 规范十进制文本解析后的 checked u64：

```text
S = 262144
expectedMessageCount = ceilDiv(P, S) = 1 + floor((P - 1) / S)
```

必须 `P > 0` 且 `N == expectedMessageCount`。对 zero-based `i`：

```text
isFinal(i) = (i == N - 1)
plainLen(i) = if !isFinal(i) then S else P - S * (N - 1)
cipherLen(i) = plainLen(i) + 17
```

因此最后明文长度总在 `1..262144`；当 `P` 可被 `S` 整除时，最后一条仍为完整 262,144-byte message，不创建空 FINAL message。

### 9.2 每条消息 AAD 与 tag

精确 AAD：

```text
chunkAAD(i) =
  lp16("life-book/backup/v1/payload-chunk-aad") ||
  u16be(1) ||                            # suiteId
  header.containerId ||                  # 16 raw bytes
  manifestCiphertextDigest ||            # 32 raw bytes
  payloadPlanDigest ||                    # 32 raw bytes
  u64be(i) ||
  u32be(plainLen(i)) ||
  u8(if isFinal(i) then 1 else 0)
```

- suite 1 固定完整枚举：`TAG_MESSAGE=0`、`TAG_PUSH=1`、`TAG_REKEY=2`、`TAG_FINAL=3`；
- `i < N-1` 使用 `TAG_MESSAGE`；pull 后必须以完整 byte equality 得到 `0`；
- `i = N-1` 使用且只能使用一次 `TAG_FINAL`；pull 后必须以完整 byte equality 得到 `3`；
- `TAG_FINAL` 的值等于 `TAG_PUSH | TAG_REKEY`，实现**不得**用 bitmask 判定 tag；v1 writer/reader 明确拒绝 `1`、`2`、提前 `3`、末条 `0` 和任何其他 byte；
- message ciphertext 按 index 直接 concatenation，没有 length prefix；reader 由已认证 header/manifest 和上述公式 exact-read；
- 最后一条 ciphertext 后必须立即 EOF。不得接受 padding、第二个 stream、footer 或尾随 byte。

`secretstream` 顺序 state 不可跳转、克隆用于重排或从中间恢复。进程终止后的 partial v1 writer 默认删除并从头创建。

## 10. 文件长度证明

公共头刻意不包含 payload/member 大小或数量。Argon2 前，reader 只能使用私有 staging 的实际长度 `F` 与公开 manifest framing 执行以下硬门：

```text
290 <= F <= 8623489024
16 <= manifestCiphertextLength <= 16777232
checkedAdd(256, manifestCiphertextLength, 18) <= F
```

最小 `18` 是一个 1-byte plaintext secretstream message 加 17-byte overhead；这些检查只防资源滥用，不证明文件完整。manifest 认证后，reader 从其规范十进制字段取得 `P` 和 `N`，再执行 checked u64：

```text
expectedFileLength =
  256 +
  manifestCiphertextLength +
  P +
  N * 17
```

并证明：

1. 所有第 2、4 节单项范围成立，且 `1 <= P <= 8589934592`；
2. `N == 1 + floor((P - 1) / 262144)`；
3. `expectedFileLength <= 8623489024`；
4. App 私有 staging 的实际 regular-file length `F` 与 expected exact equal；
5. manifest 的 member count/length sum、payload `P/N` 与 plan projection exact equal。

任一 overflow、underflow、short read、long read 或 provider declared length 不一致均失败。provider length 只用于预检；复制 staging 时仍以实际 byte count 和 EOF 为准。

## 11. Writer 状态机

writer 必须按以下顺序，失败后进入 terminal state：

1. 应用层先完成口令双输确认和 provider handle 预备，再取得 TD-010 snapshot/attachment lease；
2. 生成 portable DB、冻结附件集合，读取/校验全部 member size/hash，构造严格排序的 plan；
3. 接受 TD-010 已生成的独立 `SnapshotDataKey`；生成 `containerId`、Argon2 salt、三个 AEAD nonce 和 `BackupRootKey`，执行 Argon2 并派生三个 root subkey；
4. 包装 SnapshotDataKey，构造 manifest、plan digest，并 JCS 序列化；证明全部资源/长度；
5. `init_push(payloadStreamKey)` 取得 secretstream header；构造 provisional header；包装 root key并形成 final header；
6. 以 final header 为 AAD 加密 manifest，确认 ciphertext length；写 exact final header + manifest ciphertext；
7. 按 plan 重读 member，固定 chunk 推入 secretstream；重算每 member hash/length；末 chunk 唯一 FINAL；
8. close、flush、平台 durability barrier 后，以独立 reader 完整验证私有 staging 和 exact EOF；计算整个容器 SHA-256；
9. 释放 snapshot/attachment lease，再复制/commit 到 provider；close/reopen 目标，验证 exact length 与整个容器 SHA-256；
10. 只有第 9 步通过才记录成功；随后清 key、handle、staging 和可删除 partial。

不得在 manifest 加密后改变 plan，不得因读取失败把 available 附件静默转成 gap，不得把明文 portable DB/附件落到普通 staging。

## 12. Reader、两遍认证与 `VerifiedBackupHandle`

### 12.1 私有 staging

外部输入先复制到 App 私有 no-backup 密文 staging，限制实际总 byte，关闭写 handle，拒绝 symlink/非 regular file，并保留平台 file identity 和只读 descriptor。后续不得再次按用户可替换 path 打开文件。

### 12.2 Pass 1

1. 读取并执行 public gate、长度证明；
2. 执行 passphrase profile/Argon2，认证 root envelope；
3. 派生 key，认证 manifest，执行 UTF-8、duplicate-key、JCS、Schema、资源和跨字段检查；
4. 从 payload offset 初始化 pull state，按精确 chunk AAD/tag 解密；plaintext 只进入 per-member byte counter/hash sink并立即丢弃，不写 candidate、不调用业务 adapter；
5. 验证每 member hash/length、唯一 FINAL、exact EOF，同时按文件原始顺序计算 `SHA256(header || manifestCiphertext || payloadCiphertext)`；
6. 复核 descriptor/file identity、actual length 未变化后，才能 seal `VerifiedBackupHandle`。

handle 是 process-local、non-serializable native capability。其不可变文件身份 tuple **恰好**是 `(containerId, exactFileLength, wholeContainerSha256, platformFileIdentity)`；任何一项不同都不是同一已验证对象。capability 另外持有下列认证结果和受控状态，不能减少身份字段或改变判等：

```text
containerId
exactFileLength
wholeContainerSha256
platformFileIdentity + retained readonly descriptor
authenticated manifest digest/model
opaque BackupRootKey handle
terminal/consumed state
```

它不暴露 path、raw key、plaintext、nonce、member hash 或 provider URI给 JS。取消、descriptor 关闭/替换、进程终止、identity 变化或 terminal failure 都使其不可恢复地失效。

### 12.3 Pass 2

TD-010 通过 handle 的 `openSecondPassImport(operationId, candidateSinkHandle)` 开启一次性第二遍。reader 从同一只读对象重新读取 final header/manifest，使用 handle 内 opaque root key 重新派生并认证 manifest，在 session 内解封 operation-scoped `SnapshotDataKeyHandle`，再逐 chunk 认证 payload；SnapshotDataKey handle 不能脱离该 session、复用到另一 candidate 或返回 JS。只有每条 chunk 认证成功后才能把该 chunk 对应的 member bytes 送到受控 sink：

- database bytes 只进入 TD-010 disposable SQLCipher staging；
- attachment bytes 只进入 TD-005 重新加密 staging；
- unknown non-critical extension bytes 进入 hash/count sink后丢弃；
- sink 不能激活 generation、提升附件、发送通知、改搜索或产生外部副作用。

第二遍结束必须再次验证全部 member hash/length、tag、EOF、whole-container SHA-256、file identity 和 exact length，并从 sink 取得 terminal completion receipt。只有此时 native module 才可签发 process-local、不可伪造、一次消费的 `Pass2CompletionEvidence`，其不可变绑定为：

```text
operationId
candidateGenerationId
VerifiedBackupHandle identity tuple
manifestCiphertextDigest
payloadPlanDigest
memberCount
candidateSinkCompletionId
secondPassWholeContainerSha256
```

第二遍 SHA-256 必须等于 handle 的首遍值。TD-010 只有消费该 evidence 才能 seal candidate、生成 preview；evidence 与 operation/candidate/handle 任一不匹配、重复消费或 session 未正常结束都失败并删除 candidate/staging。第二遍不能以“首遍已经验证”为由跳过 AEAD 或 hash。

### 12.4 取消边界

pass 1 与 pass 2 只在安全 chunk/member boundary 响应取消；取消使 session/handle terminal，清理 private staging/candidate，且绝不生成 `Pass2CompletionEvidence`。writer 的 member stream 可以在 chunk boundary 取消；FINAL + close/durability barrier 与 provider commit + close/reopen identity verify 分别是短不可中断段，进入后必须报告实际 succeeded/failed，不能把已经验证成功的目标报告为 canceled。TD-010 activation 的更强取消边界由 TD-010 独占。

## 13. Manifest 与 portable DB 跨层不变量

JSON Schema 不能表达的规则由 reader 在 payload pass 与 TD-010 defensive portable reader 中强制：

- header/manifest `containerId`、format/suite exact equal；manifest payload length/count 与实际 framing exact equal；
- portable DB meta 的 snapshot ID、portable schema version、scalar encoding version、capture mutation counter 与 manifest exact equal；
- database member ID 固定 `database`，slot 指向它，slot 解出的 key 能以唯一登记 portable cipher profile 打开该 DB；
- portable DB 每个 `available` 权威附件恰有一个同 EntityId member，且 logical plaintext length/hash 与实际 member 一致；gap 附件没有 member；
- manifest 五种记录、模板、附件、状态、pending intent/unconfirmed mutation 计数与 defensive read 的实际行分类 exact equal；
- `complete` 当且仅当 missing/corrupt 均为零，否则只允许 `recoverable_with_attachment_gaps`；
- extension 预算、requiredness、成员顺序、plan digest 和全部 byte sum 成立。

计数摘要虽只用于预览，仍属于认证合同；不一致时拒绝，不以数据库值覆盖 manifest 或相反。

## 14. 错误、资源与日志

| Gate | 稳定分类 | 对用户披露 |
| --- | --- | --- |
| magic/公共 registry/硬上限/读取 | `backup_format_unsupported`、`backup_resource_limit`、`backup_read_failed` | 可以说明非本产品、版本过新、文件过大或读取失败。 |
| Argon2/root envelope | `backup_unlock_failed` | 统一“无法解锁，请检查口令或文件”；不得区分 tag/口令。 |
| 已认证 root 后的 manifest/payload | `backup_manifest_invalid`、`backup_payload_invalid`、`backup_feature_unsupported` | 可以说明备份损坏或能力不支持，不输出内部字段。 |
| pass 2/candidate | `backup_candidate_invalid`、`backup_space_insufficient` | 当前数据未改变；可以给安全修复动作。 |

parser 必须遵守 TD-011 的 16 MiB manifest、depth/token/property/string/array/extension 预算。AEAD 认证前不得 parse manifest；认证后仍不得一次性按不可信 member length 分配内存。payload 固定小缓冲流式处理。

日志、analytics、crash 和支持包禁止口令、raw key、nonce/envelope、路径/URI、文件名、EntityId、member/content hash、manifest/SQL 内容和原始 crypto/parser 错误。允许 operation ID、稳定 stage/code、格式 registry 值以及大小/耗时/数量分桶。

## 15. Conformance 与 fixture

实现只有同时通过下列测试才是 container v1 conforming：

- 固定 password/salt 的 Unicode 17 OpaqueString + Argon2id 输出、HKDF 三个 key、root/key-slot/manifest AEAD 和 chunk AAD 官方/项目向量；
- 固定 RNG、clock、portable DB/attachment bytes 时，iOS 与 Android 产生 byte-identical header、manifest、plan digest、chunk ciphertext 和整文件 SHA-256；
- payload 长度 `1`、`262143`、`262144`、`262145`，验证 full-size FINAL 与 message-count 公式；
- member 恰在 chunk 边界结束和跨边界；空 member、重复/乱序 member、attachment UUID 文本与错误 16-byte 排序均为拒绝 fixture；
- 每个 header/reserved/envelope/manifest/payload byte flip，wrong nonce/key/AAD、tag swap、MESSAGE/PUSH/REKEY/提前 FINAL/缺 FINAL/双 FINAL/尾随 byte；
- 长度/加乘/ceil-div 上下界与 overflow，manifest parser depth/token/property/string/extension 预算；
- pass 1 尚未完成时不能取得 handle；两遍之间和第二遍中替换/truncate/append staging 时不能产生 `Pass2CompletionEvidence`；evidence 的 operation/candidate/handle mismatch、重复消费和 late cancel 均保持确定终态；
- 每个已发布 `containerFormatVersion/manifestSchemaVersion/portableDataSchemaVersion` fixture 永久读取，writer 只输出当前批准组合。

Golden fixture 必须附带不含 secret 的说明 JSON：版本、输入 fixture ID、预期 header field、各 projection digest、file length 和 whole-container SHA-256。deterministic RNG/key 只允许在 test target；正式备份不得复用 fixture randomness。

## 16. 变更与兼容

兼容 selector 按唯一职责提升，不能把变化塞进 v1 reserved bytes，也不能无关地联动所有版本：

- header offset、宽度或字段语义改变：新增 `headerVersion`；
- OpaqueString/Unicode mapping 改变：新增 `passphraseProfileId`；
- Argon2 算法或参数改变：新增 `kdfProfileId`；
- HKDF salt/info、AEAD、nonce/tag 或任一 AAD/projection 改变：新增 `suiteId`；
- member 排序、chunk/tag framing 或 EOF 语义改变：新增 `containerFormatVersion`；
- 认证 JSON 字段/envelope 改变：新增 `manifestSchemaVersion`；
- portable 表/列/mapper 或 portable SQLCipher settings 改变：分别新增 `portableDataSchemaVersion` 或 `portableCipherProfileId`。

只使用 manifest Schema 1 已预留的 bounded non-critical extension data/member，可以同时保持 container v1 与 `manifestSchemaVersion = 1`，旧 reader 仍按本规范认证并丢弃。新增根字段或改变 extension 通用 envelope 才提升 manifest Schema；旧 reader 可以在认证后明确报版本过新，但不得宽松猜测。增加 required member/feature 或改变 portable DB 逻辑 schema 分别遵循 TD-011 的版本矩阵。任何 writer 升级必须先发布能读旧/新的 reader，并保留全部旧 fixture。

## References

- [RFC 2119：Key words for use in RFCs](https://www.rfc-editor.org/rfc/rfc2119.html)
- [RFC 8174：Ambiguity of Uppercase vs Lowercase](https://www.rfc-editor.org/rfc/rfc8174.html)
- [RFC 5869：HKDF](https://www.rfc-editor.org/rfc/rfc5869.html)
- [RFC 8265：OpaqueString](https://www.rfc-editor.org/rfc/rfc8265.html)
- [RFC 8785：JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html)
- [RFC 9106：Argon2](https://www.rfc-editor.org/rfc/rfc9106.html)
- [libsodium：XChaCha20-Poly1305](https://doc.libsodium.org/secret-key_cryptography/aead/chacha20-poly1305/xchacha20-poly1305_construction)
- [libsodium：Secretstream](https://doc.libsodium.org/secret-key_cryptography/secretstream)

## Revision notes

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-07-26 | 1.0.0 | 冻结 container v1 header、registry、密码投影、单 secretstream framing、精确 EOF、两遍恢复与兼容门。 |

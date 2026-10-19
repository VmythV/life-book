# Life Book Android device-key envelope 协议 v1

> Contract status：`Draft`  
> Authority：`CANDIDATE`  
> Stable identities：`deviceKeyEnvelopeVersion = 1`、`scalarEncodingVersion = 1`  
> Platform scope：Android 10+；iOS 不在当前实现范围  
> Owner：客户端安全与数据基础设施  
> Decision source：[TD-004：设备密钥层级与应用锁](../../docs/adr/0004-device-key-hierarchy-and-app-lock.md)  
> Paired Schema：[device-key-envelope-v1.schema.json](device-key-envelope-v1.schema.json)  
> Oracle：[fixtures/v1/manifest.json](fixtures/v1/manifest.json)

## 1. 状态与用途

本文为 TD-004 已决定的 Android DWK 本地 key envelope 提供 exact JCS candidate。它只包装
当前 installation incarnation 的 `DatabaseDataKey`、`AttachmentRootKey`、
`DatasetControlKey`；不用于 InstallationAnchorKey、数据库页、附件内容、备份
`BackupRootKey` 或 `SnapshotDataKey`。

当前为 `Draft + CANDIDATE`。治理 registry 已明确 paired Schema 路径只有在 TD-004 的
JCS encoding authority 完成迁移后才能激活；在此前，本文不能成为生产 writer。

## 2. Android key hierarchy

`DKEY-0001`：每个 installation incarnation 随机创建一个 256-bit AES DWK，存于
`AndroidKeyStore`，purpose 仅 encrypt/decrypt、GCM、NoPadding、randomized encryption，
material 不导出、不进入 JS/backup。alias 固定为：

```text
life-book.device-wrapping.v1/<deviceWrappingKeyId>
```

ID 是 16 random bytes canonical base64url，alias 不包含 Installation、用户、空间或 purpose。
adapter 只做已验证 ID 的单项 lookup，不提供枚举/任意 alias API。

`DKEY-0002`：三类 content key 分别由 CSPRNG 生成 32 bytes，互相独立，也不从设备凭据、
生物特征、Installation ID、IAK、DWK、账号或备份口令派生。DWK 只包装 key，不直接加密
SQLite page/attachment/backup。

## 3. Envelope bytes 与字段

`DKEY-0101`：文件位于固定 `noBackupFilesDir` 私有 metadata 根，按 purpose 使用 A/B
双槽。每个文件恰为 paired Schema object 的 RFC 8785 JCS UTF-8 bytes，无 BOM、换行、
padding、framing 或 trailing bytes，最大 65,536 bytes。parser 拒绝 duplicate/unknown field，
并要求 re-encode 与 original bytes 相等。

`DKEY-0102`：`envelopeFormatVersion=1`、`recordKind=device_key`、slot/sequence 与固定物理
path 一致。key purpose 只允许：

```text
database_data_key | attachment_root_key | dataset_control_key
```

`keyId`、`deviceWrappingKeyId` 均为 16 random bytes canonical base64url；nonce 为 12 bytes；
ciphertext 解码恰为 32 bytes content key；tag 为 16 bytes。所有 base64url 无 padding并执行
decode/re-encode canonical check。

`DKEY-0103`：`envelopeSequence` 是 scalar v1 LongCounter。fresh purpose slot 从 `"0"`
开始；rewrap/rotation checked `+1` 写 inactive slot。stable MAX 可继续 unwrap，但不能再变更。
同 sequence 不同 canonical digest 阻断；一个 invalid + 一个 valid 可以选 valid；两个 absent
只有在 matching bootstrap journal 明确尚未创建该 purpose 时才是可续初始化，否则阻断。

## 4. AEAD 与 AAD

`DKEY-0201`：`wrappingAlgorithm` 唯一为 `aes_256_gcm_v1`。nonce 由 CSPRNG 生成，在同
一 DWK 下不得复用；ciphertext/tag 分离存储。

`DKEY-0202`：AAD bytes 精确为：

```text
UTF8("life-book/device-key-envelope/aead/v1\0") ||
UTF8(JCS({
  "deviceWrappingKeyId": <envelope.deviceWrappingKeyId>,
  "envelopeFormatVersion": 1,
  "envelopeSequence": <envelope.envelopeSequence>,
  "installationId": <envelope.installationId>,
  "installationIncarnationId": <envelope.installationIncarnationId>,
  "keyId": <envelope.keyId>,
  "keyPurpose": <envelope.keyPurpose>,
  "recordKind": "device_key",
  "slotId": <envelope.slotId>,
  "wrappingAlgorithm": "aes_256_gcm_v1"
}))
```

domain label 末尾是单个 NUL byte。JCS 决定 key 顺序；不增加长度、hash、application ID、
createdAt 或 plaintext。Installation/incarnation/purpose/key ID/DWK ID/slot/sequence/algorithm
替换都必须在 unwrap 前或 GCM gate 失败。

`DKEY-0203`：unwrap 顺序为 resource/JCS/Schema → fixed physical purpose/slot match →
expected Installation/incarnation/purpose/key ID match → fixed DWK alias lookup → AEAD → plaintext
length exactly 32。错误不返回 plaintext、system exception、alias 或 ciphertext。

## 5. 原子写、选择与 rewrap

`DKEY-0301`：writer 执行 checked headroom → inactive slot same-directory random temp → file
flush → durability barrier → atomic replace → parent sync → read-back JCS/AAD/AEAD/identity/plaintext
digest。缺原语时失败；不允许 in-place mutation 或在 read-back 前删除 active slot/DWK。

`DKEY-0302`：同 purpose 选择 valid sequence 最高 slot；same-sequence/different-digest、跨
purpose file、unknown version/algorithm、unmatched higher candidate 一律阻断。一个 valid +
一个 invalid 可继续，但 invalid 仅在安全 retention 阶段隔离。

`DKEY-0303`：每个 fresh bootstrap capability 精确绑定三类不同 `keyId`、同一
Installation/incarnation/bootstrap operation 和 DWK ID；必须三个 envelope 全部 durable/read-back
后才可交给 TD-010 initialize。部分集合不签发 Repository/bootstrap success。

`DKEY-0304`：DWK rewrap journal 在写入前绑定 old/new DWK ID、三个 purpose/key ID、每个
expected/target sequence 与 digest。先用 old unwrap、用 new 包装并逐一 read-back，完整集合切换
后才退休 old DWK/slot。任一 kill 从 exact journal 继续；不得生成新 content key 冒充 rewrap。

`DKEY-0305`：DATA-091 clear 在 durable clearing journal 和 Repository close 后销毁旧 DWK 与
三类 content key/envelope，随后为新 incarnation 生成全新 DWK/keys/envelopes；保留
Installation/IAK。真正 reinstall 生成全新 Installation/IAK/DWK/keys，orphan 永不复用。

## 6. Native handle boundary

`DKEY-0401`：Key Manager 只返回 purpose/incarnation/operation-bound opaque handles。Database
adapter 只可用 DatabaseDataKey handle 给 SQLCipher 设置 raw key；attachment/control adapter
各用对应 handle；不提供 export/list/arbitrary AEAD method。

`DKEY-0402`：raw key、plaintext、DWK alias、envelope bytes/ID/nonce/tag 不进入 JS、日志、
exception、clipboard、crash report、telemetry、`.lifebook` 或普通 preferences。内存清零是
best effort，主要控制为原生窄边界与短生命周期。

`DKEY-0403`：设备凭据变化不被假定会删除或失效 DWK。Android adapter 把 Keystore 结果映射
为 `available|temporarily_locked|permanently_unavailable|failed`，并按可验证 anchor 进入恢复/
clear，不自动创建空库。真机 spike 中 PIN 变化后 key preserved 只是 capability 观察，不改变本
合同 fail-closed 行为。

## 7. 固定错误分类与 oracle

| Code                                     | 含义                                                   |
| ---------------------------------------- | ------------------------------------------------------ |
| `device_envelope_malformed`              | bytes/JCS/Schema/base64url/physical routing 非法。     |
| `device_envelope_identity_mismatch`      | Installation/incarnation/purpose/key/DWK/slot 不匹配。 |
| `device_envelope_authentication_failed`  | GCM tag 失败。                                         |
| `device_wrapping_key_unavailable`        | matching AndroidKeyStore key 不可用。                  |
| `device_envelope_sequence_exhausted`     | 没有完整 transition headroom。                         |
| `device_envelope_integrity_blocked`      | slot/journal/集合冲突或部分 bootstrap。                |
| `device_envelope_durability_unavailable` | 原子/屏障/read-back 原语不足。                         |

`DKEY-0501`：oracle 必须固定 exact JCS、AAD、AES-GCM KAT、三个 purpose 的 key isolation、
slot/sequence/identity substitution、partial set、wrong key/tamper/nonce、clear/reinstall/rewrap
预期，并由不 import 产品 Key Manager 的实现重算。

`DKEY-0502`：candidate oracle PASS 不等于 Android Keystore implementation conformance；生产
启用仍要求 authority 激活、native release/physical device/kill-point/no-backup evidence 和独立
安全评审。

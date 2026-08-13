# Life Book Android installation anchor 协议 v1

> Contract status：`Draft`  
> Authority：`CANDIDATE`  
> Stable identities：`installationAnchorEnvelopeVersion = 1`、`installationAnchorPayloadVersion = 1`、`scalarEncodingVersion = 1`  
> Platform scope：Android 10+；iOS 不在当前实现范围  
> Owner：客户端安全与数据基础设施  
> Decision source：[TD-004：设备密钥层级与应用锁](../../docs/adr/0004-device-key-hierarchy-and-app-lock.md)  
> Paired Schema：[installation-anchor-v1.schema.json](installation-anchor-v1.schema.json)  
> Oracle：[fixtures/v1/manifest.json](fixtures/v1/manifest.json)

## 1. 状态与边界

本文把 TD-004 的 installation presence/bootstrap 编码、identity fence 与启动分类决定固化为
Android 候选合同。当前为 `Draft + CANDIDATE`；paired contracts、security oracle、
`security-and-privacy.md`、persistence contracts 及 registry authority migration 未完成前，
不得创建生产 Installation、密钥或真实数据库。

本合同拥有：anchor slot JCS bytes、AAD、payload digest、presence/bootstrap payload 字段、
phase invariant、compatible-pair selector、headroom/fresh/clear/reinstall 分类。TD-010 拥有
DatasetControl、candidate、marker、receipt 与 active generation 的具体合同；应用锁 UI/授权由
安全规范拥有。所有 ID/Instant/LongCounter 必须先符合
[Scalar v1](../scalars/v1.md)。

## 2. Android 固定存储与 key alias

`ANCH-0001`：原生 `InstallationAnchorStore` 只使用 `noBackupFilesDir` 下编译期固定根：

```text
installation-anchor/
  install-presence-a.bin
  install-presence-b.bin
  bootstrap-a.bin
  bootstrap-b.bin
  journals/<validated-operation-id>.bin
```

JS/intent/deep link 不得传目录、文件名、slot 或 alias。symlink、非 regular file、未知文件、
path traversal 与大小超过 65,536 bytes 的文件阻断分类。

`ANCH-0002`：IAK 在 `AndroidKeyStore` 中随机生成 256-bit AES key，purpose 仅为
encrypt/decrypt、GCM、NoPadding、随机 nonce，key material 不导出、不要求 user
authentication、不进入备份。固定 lookup alias 为：

```text
life-book.installation-anchor.v1/<installationAnchorKeyId>
```

`installationAnchorKeyId` 是 16 random bytes 的 canonical base64url。adapter 只按 slot
header 的已验证 ID 单项 lookup，不枚举或接受调用方 alias。硬件/StrongBox 不可用不能降级为
preferences 明文 key。

## 3. Slot 文件、JCS 与 AEAD

`ANCH-0101`：每个 `.bin` 文件恰为一个 RFC 8785 JCS object 的 UTF-8 bytes；无 BOM、
前后空白、换行、NUL、额外 framing 或 trailing bytes。parser 必须保留原 bytes，解析时拒绝
duplicate/unknown field，并要求 `JCS(parsed) == originalBytes`。

outer object 字段恰为 paired Schema 的七项。`nonce` 解码恰好 12 bytes，`tag` 恰好
16 bytes；所有 base64url 均无 `=` padding，decode 后 re-encode 必须逐字相同。
`recordKind/slotId` 必须与固定物理文件一致：

| Physical file            | `recordKind`             | `slotId` |
| ------------------------ | ------------------------ | -------- |
| `install-presence-a.bin` | `install_presence`       | `a`      |
| `install-presence-b.bin` | `install_presence`       | `b`      |
| `bootstrap-a.bin`        | `installation_bootstrap` | `a`      |
| `bootstrap-b.bin`        | `installation_bootstrap` | `b`      |

`ANCH-0102`：outer object 只提供 lookup/routing 信息，在 tag 验证前没有 Installation
authority。v1 使用 AES-256-GCM，ciphertext 是 payload JCS bytes，tag 采用 detached 16-byte
字段。nonce 在同一 IAK 下不得复用。

`ANCH-0103`：AAD bytes 精确为：

```text
UTF8("life-book/installation-anchor/aead/v1\0") ||
UTF8(JCS({
  "applicationId": <signed Android applicationId>,
  "envelopeFormatVersion": 1,
  "installationAnchorKeyId": <outer.installationAnchorKeyId>,
  "recordKind": <outer.recordKind>,
  "slotId": <outer.slotId>
}))
```

字符串内的 `\0` 是一个 byte `00`，不是两个字符。JCS key 序为
`applicationId,envelopeFormatVersion,installationAnchorKeyId,recordKind,slotId`；不增加
长度、换行或二次 hash。`applicationId` 来自签名 build 常量，不接受 payload/JS 值。

`ANCH-0104`：decrypt 后 bytes 必须是 paired Schema 对应 record 的 exact JCS。read path
依次执行：文件资源门 → outer duplicate/JCS/Schema → physical path match → build
application ID → fixed alias lookup → AEAD → payload duplicate/JCS/Schema → scalar/cross-field
invariant → digest。任何失败都不能删除后重试成 fresh。

## 4. Presence payload 与 digest

`ANCH-0201`：`InstallPresenceRecord` 恰含 paired Schema 声明的九个必需字段。
`installationAnchorKeyId` 必须等于 outer/AAD ID；`applicationId` 必须等于签名 build；三个
UUID 均为不同品牌身份但共用 scalar v1 encoding。`presenceNonce` 是 32 random bytes 的
canonical base64url。

`ANCH-0202`：fresh presence 的 `presenceSequence` 为 `"0"`。DATA-091 clear 只可在
current 可验证且 counter 有一个 headroom 时写同一 IAK/Installation 的 checked `+1`，并
更换 incarnation、bootstrap operation、presence nonce 和 `createdAt`。同一 presence payload
不支持 patch。

`ANCH-0203`：presence digest 为：

```text
SHA-256(
  UTF8("life-book/install-presence/v1\0") ||
  UTF8(JCS(InstallPresenceRecord))
)
```

编码为 64 lowercase hex。domain label 的 NUL 同样是单 byte `00`。

## 5. Bootstrap payload、phase 与 digest

`ANCH-0301`：`InstallationBootstrapRecord` 恰含 paired Schema 声明的 16 个字段；所有
optional 字段仍必须存在，并以 JSON `null` 表示 absent。IAK ID 只在 outer/AAD，不重复进入
payload。

`ANCH-0302`：phase cross-field invariant：

| Phase          | 必需关系                                                                                                        | 必须为 `null`                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `initializing` | `stateOperationId == incarnationBootstrapOperationId`；epoch `"0"`；candidate 可在 journal-bound binding 后非空 | active、initialized generation/control、receipt |
| `initialized`  | active operation、initialized generation/control、receipt 全非空并匹配 TD-010                                   | state operation、candidate                      |
| `clearing`     | state operation 是 clear journal operation；保留旧 active/generation/control/receipt/epoch                      | candidate                                       |

`ANCH-0303`：bootstrap digest 为：

```text
SHA-256(
  UTF8("life-book/installation-bootstrap/v1\0") ||
  UTF8(JCS(InstallationBootstrapRecord))
)
```

`ANCH-0304`：同一 incarnation 内 `installationId`、incarnation、bootstrap operation、
presence digest、`appBuildId` 与 `createdAt` 不可修改。普通 migrate/restore/manual rollback/
activation abort 只在 terminal receipt 后通过 whole-record guard-CAS 推进 active tuple；任何
第三个 digest 返回 `integrity_blocked`。

## 6. Compatible pair 与双槽选择

`ANCH-0401`：presence/bootstrap 形成 compatible pair 当且仅当：

- 同一 verified IAK ID；
- `bootstrap.installPresenceRecordDigest == digest(presence)`；
- Installation、incarnation、bootstrap operation 三个 ID逐字相同；
- phase/counter/journal invariant 完整。

presence 和 bootstrap 不得各自先选最高再拼接。

`ANCH-0402`：每种 record 先收集 AEAD/Schema/invariant valid candidates。同 kind、同
sequence、不同 digest 立即 `integrity_blocked`。一个 invalid slot + 一个 valid compatible
pair 可以继续；两个物理都 absent 才是该 kind absent，存在但 invalid 不是 absent。

`ANCH-0403`：无 clear/fresh journal 时，从 compatible pairs 中选择 bootstrapSequence
最高者，并要求没有未解释的 higher/unmatched valid record。没有 compatible pair但任一
canonical slot 存在时阻断。

`ANCH-0404`：valid clear journal 优先：source `clearing` pair 保持 current，直到 journal
预留 identity/sequence 的 target presence + target initializing bootstrap 已完整 durable 且
compatible；然后切到 target realm。只有 target presence、还没有 target bootstrap 时不得切换。
未绑定的 higher candidate、journal 超前或第三种 sequence 阻断。

## 7. 分类、headroom 与 crash protocol

`ANCH-0501`：`classify()` 仅返回：

```text
clearing | initializing | initialized | fresh_eligible |
reinstall_orphans | integrity_blocked | key_unavailable
```

`fresh_eligible` 还要求 TD-010 strict all-absent：presence/bootstrap/control/data/artifact/journal
全部物理 absent。路径缺失、AEAD failure、bootstrap-only、presence-only without matching
journal、unknown artifact 均不能单独生成 fresh。

`ANCH-0502`：真正 fresh 顺序固定为：strict all-absent → 创建 IAK/identity → durable
journal → presence sequence `0` → initializing bootstrap sequence `0` → current-incarnation DWK
和三类 key envelopes → one-shot bootstrap capability。任一 kill 只按 exact journal/identity
续跑；不能重新生成第二 Installation/LocalActor/default space。

`ANCH-0503`：fresh initialize 必须预留 bootstrap `0→1→2`；普通 dataset terminal CAS
预留一个值；clear 在第一笔 transition 前同时证明一个 presence 和四个 bootstrap 值可用。
stable initialized counter 在 MAX 仍可读 current dataset，只拒绝下一 anchor transition。

`ANCH-0504`：slot 写入为 checked headroom → inactive-slot same-directory random temp →
file flush → platform durability barrier → atomic replace → parent directory sync → read-back
AEAD/JCS/digest/invariants。缺任一原语时阻止 transition；不得用 in-place write 或 rename
完成即成功替代 read-back。

`ANCH-0505`：卸载/清除应用数据后的 app-container strict all-absent 即使发现旧 Keystore
alias，也必须返回 `reinstall_orphans`，隔离/删除 orphan 并创建全新 Installation/IAK realm；
不恢复旧 ID/key。DATA-091 应用内 clear 则保留 IAK/Installation，轮换 incarnation、DWK、
三类 data key、LocalActor/default space，并延续 installation-wide bootstrap counter。

`ANCH-0506`：IAK/bootstrap 不可用且 app-container 有任何 anchor/data/control artifact 时
返回 `key_unavailable|integrity_blocked`；v1 不提供 App 内 anchor-loss erase，也不得用
FreshAuth 伪造耐久授权。

## 8. Native capability boundary

`ANCH-0601`：IAK、payload plaintext、raw key、digest selector 与 arbitrary alias 不进入 JS。
JS 只能收到受控 classification、不透明 evidence/capability 与错误。bootstrap capability 绑定
IAK/presence/bootstrap digest、Installation/incarnation/bootstrap operation、candidate、
LocalActor seed 和三类 envelope identity，并只能消费一次。

`ANCH-0602`：Repository 只有在 matching active control、ActivationOpenReceipt 与 updated
initialized bootstrap anchor 全部 read-back 后才可打开；此前仅 activation-recovery capability
可用，且不得传给 ORM/业务 use case。

`ANCH-0603`：anchor、journal、key envelope、database/control/attachment roots 进入 Android
Auto Backup/data-extraction exclusion 与 release artifact audit。日志仅记录允许的错误码和版本，
不记录 alias、nonce、ciphertext、payload、digest、ID 或路径。

## 9. 固定错误分类

| Code                            | 含义                                                                  |
| ------------------------------- | --------------------------------------------------------------------- |
| `anchor_malformed`              | bytes、JCS、Schema、base64url 或 physical routing 非法。              |
| `anchor_authentication_failed`  | IAK lookup 成功但 GCM tag 失败。                                      |
| `anchor_key_unavailable`        | matching IAK 不存在、失效或暂不可用。                                 |
| `anchor_identity_mismatch`      | build/IAK/Installation/incarnation/operation/presence digest 不一致。 |
| `anchor_sequence_exhausted`     | transition 缺所需完整 counter headroom。                              |
| `anchor_integrity_blocked`      | 冲突 slot、unmatched/higher candidate、journal 或 mixed evidence。    |
| `anchor_durability_unavailable` | 平台无法提供所需 flush/barrier/atomic replace/read-back。             |

## 10. 激活门

`ANCH-0701`：oracle 必须固定 outer/payload JCS、AAD bytes、digest、AES-GCM KAT、
duplicate/noncanonical/tamper、phase/pair/sequence、strict absent、partial bootstrap、clear/reinstall
矩阵，并由不 import 产品 Key Manager 的 checker 重算。

`ANCH-0702`：candidate oracle PASS 只证明预期可执行。生产启用仍要求本合同/Schema 与
device envelope 成套转 `Normative + ACTIVE`，Android 原生实现和 Keystore/kill-point/
no-backup conformance evidence，以及 TD-010 persistence Gate 全部通过。

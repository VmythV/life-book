# TD-004：设备密钥层级与应用锁

> Status：`Accepted`  
> Date：2026-07-26  
> Decision owners：安全负责人、移动端技术负责人  
> Scope：P0 设备静态加密与应用锁，并约束 P1/P2 设备密钥延续  
> Related requirements：PD-006、PR-500～502、DATA-021～022、DATA-045、DATA-090～092、QR-070～072、FLOW-130～131、SCR-002、SCR-451、SCR-903  
> Related ADRs：[TD-003](0003-encrypted-local-database.md)、[TD-005](0005-encrypted-attachment-store.md)、[TD-011](0011-backup-container-and-cryptography.md)、[TD-019](0019-account-authentication-and-device-sessions.md)  
> Decision gate：实现必须完成威胁模型、双平台真机 key-loss/credential-change 测试和独立安全评审；P0 不提供产品方密钥找回

## Context

生活有谱需要同时解决两个不同问题：

1. **静态数据保护**：数据库和附件即使被复制出 App 私有目录，也不能在没有设备数据密钥时读取；
2. **界面访问门禁**：用户主动开启后，App 前台内容需要 Face ID、Touch ID、指纹或设备凭据解锁，并对高风险操作重新认证。

生物特征由操作系统管理，App 只能获得认证结果，不能读取指纹/面容。把数据库 key 直接从生物特征或低熵 App PIN 派生既不可移植，也会在凭据变更、锁定或传感器不可用时造成永久数据丢失。反过来，只有一个可后台读取的数据库 key 又不能自动等于“界面已解锁”。因此数据密钥、设备包装密钥、应用锁会话和备份口令必须分层。

## Decision

使用**随机数据密钥 + 设备绑定包装密钥 + 独立应用锁会话**：

```text
OS Keychain / Android Keystore
        └── Device Wrapping Key (DWK, this-device-only)
                ├── wraps Database DEK
                ├── wraps Attachment Root Key
                └── wraps other device-local secrets by purpose

System Local Authentication
        └── grants in-memory AppLockSession / FreshAuthGrant
                └── gates UI queries and high-risk commands
```

数据库/附件密钥由密码学安全随机源生成，彼此独立，不由设备密码、生物特征、账号密码、Installation ID 或备份口令派生。DWK 不可同步、不进入系统/产品备份；Android 使用 Android Keystore 中不可导出的对称 key，并在可用时硬件保护；iOS 使用当前 App 默认 access group 的 ThisDeviceOnly Keychain 项及适用访问控制，不启用 iCloud Keychain 同步。

应用锁是访问门禁，不是数据库加密 key 本身。它使用系统提供的设备所有者认证创建短期、进程内、不可持久化的授权；后台受限任务和 UI 使用不同 capability，不能因为后台可对账就让页面绕过锁。

## Decision details

### 1. 密钥与用途隔离

| 名称 | 生成/保存 | 用途 | 禁止用途 |
| --- | --- | --- | --- |
| `DeviceWrappingKey` | 每次有效本地数据生命周期随机创建；Keychain/Keystore，this-device-only。 | 包装设备本地 DEK/根密钥。 | 直接加密数据库页、附件或备份；同步到账号。 |
| `DatabaseDataKey` | 256-bit 随机；仅以 envelope 持久化。 | SQLCipher raw key。 | 附件、备份、API token。 |
| `AttachmentRootKey` | 256-bit 随机；仅以 envelope 持久化。 | 派生/包装每附件独立 key。 | 数据库、备份容器。 |
| `BackupKey` | 由独立备份口令和每备份随机 salt 派生。 | 单个 `.lifebook` 容器。 | 设备数据库/附件在线解锁。 |
| `AppLockSession` | 系统认证成功后在内存创建。 | 允许前台内容查询/呈现。 | 加密数据、跨进程持久化、证明账号身份。 |
| `FreshAuthGrant` | 高风险动作前系统认证；operation-scoped。 | 提交指定高风险命令。 | 作为通用长期登录或跨设备授权。 |

每个 envelope 至少包含格式版本、key purpose、key ID、包装算法版本、nonce/IV、密文、认证标签和创建时间；不包含用户内容。envelope 存在数据库外的私有元数据文件，采用临时文件 + fsync/平台等价 + 原子替换，并保留双槽/恢复标记以支持 rewrap 中断。

### 2. 平台实现

#### iOS

- Keychain 项使用 App 自己的默认 access group，不与其他 App/extension 共享；`kSecAttrSynchronizable=false`；
- 使用 `...ThisDeviceOnly` 可访问级别；后台确需使用的 DWK wrapper 在设备首次解锁后可用，不能迁移到另一设备；
- 应用锁使用 LocalAuthentication 的 `deviceOwnerAuthentication`，允许系统按能力提供生物识别或设备密码；
- 高风险动作给出具体、本地化 `localizedReason`，每次按当前 access control 重新评估，不能假设先前成功必然继续有效；
- Face ID 使用说明只在用户开启相应功能时出现，文案与实际用途一致；
- 不声称所有 Keychain key 都由 Secure Enclave 硬件保存；实现记录可用保护等级但不降低产品基本行为。

#### Android

- DWK 在 `AndroidKeyStore` 中生成，key material 不导出；首选 AES-256-GCM、随机 nonce 和仅 encrypt/decrypt purpose；
- 查询并记录 key 是否硬件/StrongBox 支持，但硬件不可用不静默改成把 key 写普通 preferences；是否允许受控软件 Keystore 由最低系统安全门决定；
- 应用锁使用 AndroidX `BiometricPrompt`，优先 `BIOMETRIC_STRONG`，并允许系统设备凭据回退；
- Android 10 对 authenticator 组合有限制，adapter 必须按 API level 使用受支持的 BiometricPrompt/Keyguard flow，不自制 PIN 页面；
- 生物识别 enrollment、锁屏凭据清除、系统升级、Keystore reset 和设备迁移导致的 key invalidation 分别测试并映射；
- Keystore alias 不含用户/空间信息，Android Auto Backup 明确排除 envelope、数据库、附件和相关 preferences。

平台 adapter 对上只返回：`available | not_enrolled | no_device_credential | temporarily_locked | permanently_unavailable | cancelled | failed | success` 等受控结果，不暴露系统异常或生物特征细节。

### 3. 原生 Key Manager 边界

- Key 生成、wrap/unwrap、envelope 原子替换和数据库/附件 key handle 位于受审查的原生 Key Manager；
- JS 层只持有不透明 handle、授权 capability 和受控错误，不读取 DWK 或长期保存 raw DEK；
- Database Adapter 使用 handle 在原生边界给 SQLCipher 设置 key；Attachment Adapter 使用独立 handle 执行流式 AEAD；
- 若底层第三方 API 暂时要求 key bytes 穿过 JS，该实现不得进入 production gate；先补原生窄模块，而不是用不可擦除字符串长期持有；
- 内存清零为 best effort，不能声称能消除运行时、交换区或已被攻陷进程的全部副本；主要控制是缩短生命周期、限制边界和禁止日志。

### 4. 应用锁状态

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
- session 只授予当前安装的前台 Presentation capability，不是账号 token、家庭成员身份或加密 key；
- 深链接/通知先进入锁屏，解锁后重新查询不透明目标 ID；锁屏不得显示标题、类型、日期、数量或家庭名；
- 认证取消属于安全返回，不记为错误、不改变设置、不执行业务命令；
- 关闭应用锁、改变为更宽松自动锁定策略必须 fresh auth；更严格策略保存后立即生效；
- 设备没有可用系统凭据时不能新开启应用锁；已开启后凭据永久不可用时不得旁路，只提供受支持凭据恢复、加密备份恢复或安全清除。

自动锁定选项和默认值由安全规范/领域设置统一定义；实现使用枚举和 monotonic elapsed time，不用可回拨 wall clock 计算前台授权剩余时间。

### 5. 前台与后台 capability

为了滚动提醒、文件清理和后续同步，系统可能在没有 UI 解锁时给予短暂后台机会。采用最小 capability：

| Capability | 可做 | 不可做 |
| --- | --- | --- |
| `ForegroundUnlocked` | 授权范围内查询/编辑/呈现内容。 | 绕过单条敏感或高风险再次认证。 |
| `BackgroundMaintenance` | 按 ID 计算/对账通知、完成已提交文件/索引任务、P1 加密同步。 | 渲染 UI、生成内容日志、导出/分享、放宽隐私、接受深链接页面。 |
| `FreshHighRisk(operation, scope, expiresAt)` | 提交一个匹配操作/范围的命令。 | 复用于其他对象、成员、空间或超时后提交。 |

Application use case 必须显式要求 capability，不能用全局 `isUnlocked` boolean 保护所有路径。后台 adapter 只读取任务需要的最小列；系统日志和通知仍遵守敏感策略。

### 6. 近期重新认证

永久删除、清空回收站、恢复覆盖、清除本机、包含敏感内容的导出、放宽敏感/AI 保护、家庭创建/删除/所有权/成员移除及安全设置放宽使用 `FreshAuthGrant`：

- 用户进入最终影响确认后触发系统认证，不在页面打开时提前认证；
- grant 绑定 operation kind、目标 ID/space、actor/session 和当前影响摘要 hash；
- 最长 5 分钟且只可成功消费一次；App 后台、账号/成员状态变化、影响摘要改变、认证上下文失效时立即作废；
- 服务端高风险操作仍需要自己的 recent-auth 证明；设备认证成功不替代服务端账号授权；
- 批量操作可以绑定一次已预览的明确集合，集合改变必须重新认证。

### 7. 初始化、恢复与密钥丢失

#### 首次初始化

```text
创建 initializing marker
→ 创建 DWK
→ 生成 DB/Attachment keys
→ 写并验证 envelopes
→ 创建加密数据库/附件根
→ 提交 initialized marker
```

任一步失败都不展示初始化成功；重入根据 marker 清理未引用临时物后重试，不生成两套默认空间。

#### 产品备份恢复

备份从 BackupKey 解密到隔离区，通过完整性/迁移后，使用**接收设备当前或新生成的 DB/Attachment keys**重新加密。备份不会恢复原设备 DWK、DEK、应用锁 session、生物注册或系统权限；应用锁设置只按 DATA-045 的设备语义处理。

#### 密钥丢失/失效

若活动数据存在而 DWK/envelope 无法使用：

- 不创建新同名数据库，不尝试猜 key，不上传文件；
- 显示通用恢复状态与诊断 ID，不泄露数据内容；
- 可从用户持有且口令正确的加密备份恢复到新数据集；
- 用户确认安全清除后删除无法读取的数据并建立新空本地身份；
- P0 产品方没有密钥托管/找回，客服不能承诺恢复；
- P1 已有云端副本时，恢复仍按账号、E2EE 决定和数据认领流程，而非直接替换本地。

### 8. 轮换与撤销

- envelope、DWK、DEK 和算法分别有版本；App 启动只读取当前受支持组合；
- 常规设备包装策略升级优先生成新 DWK、重新包装现有 DEK，验证双槽后删除旧 wrapper，无需重加密全部内容；
- DB DEK 轮换使用 SQLCipher 受控 rekey/隔离复制、完整性检查和 crash recovery；不能直接覆盖活动文件；
- AttachmentRootKey 轮换由 TD-005 的 per-file key envelope 渐进完成；旧 key 在全部引用迁移前保留受控读取；
- 清除本机按 DATA-091：先记录不可逆 clear marker、取消通知、关闭 DB、删除活动/临时数据，再销毁 keys；崩溃重启发现 marker 时继续清除，不能初始化空库并遗留旧密文；
- 卸载后的 App 私有数据/Keychain/Keystore 行为由平台控制，产品不依赖卸载完成外部备份删除。

## Alternatives considered

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
- 后台维护可受限运行，同时前台内容继续遵守应用锁。

### Negative

- 需要自有原生 Key Manager、envelope 格式、双槽轮换和双平台错误映射；
- Keychain/Keystore/OEM 差异与凭据变化场景测试成本高；
- App Lock 不是针对已完全攻陷进程的密码学沙箱，后台 capability 必须严格审查；
- 设备 key 丢失且没有有效备份时数据无法恢复；
- 使用系统设备凭据意味着共享设备凭据的人可能解锁 App，产品不提供独立 App 密码身份。

## Risks and mitigations

| 风险 | 缓解 |
| --- | --- |
| Keychain/Keystore 项被系统失效或丢失 | this-device-only、平台错误分类、双槽 envelope、真实升级/凭据测试、备份提示。 |
| 生物 enrollment 造成数据锁死 | 不用 biometric-current-set 保护唯一 DEK；使用 device owner auth 门禁和设备凭据回退。 |
| 后台 capability 被滥用读取内容 | 窄 use case、依赖检查、无 Presentation 接口、敏感查询裁剪与安全测试。 |
| JS/日志泄露 raw key | 原生 handle API、release 禁止 secret logging、crash/redaction 测试和最短内存生命周期。 |
| 认证重放到另一危险动作 | operation/scope/summary hash 绑定、一次消费、5 分钟上限、后台即失效。 |
| 用户误以为产品能找回 | 创建备份、锁定失败和支持文案明确 OQ-005；不提供虚假“忘记密码”。 |
| 无设备锁屏的设备 | 不允许开启应用锁，说明设置设备凭据；数据仍使用可用 OS key store，但明确降低保证范围。 |

## Implementation constraints

- Key Manager API 不允许“导出所有 keys”或按任意 alias 读取；每个调用是固定 purpose；
- key/envelope migration 在 Repository 开放前完成，失败保持安全遮罩；
- 任何远程配置、调试菜单、deep link 或测试 flag 都不能在 release 绕过 app lock/fresh auth；
- 自动化测试使用平台测试 key provider，不把固定测试 key 编译进 production；
- AppLockSession 与 FreshAuthGrant 不写 SQLite、preferences、Redux persistence、日志或备份；
- 系统认证 prompt 只由用户动作或锁屏恢复触发，不在后台/循环自动弹出；
- 用户取消、传感器临时不可用和系统 lockout 分开处理，不通过重复 prompt 对抗系统限次；
- Root/越狱、调试注入或已攻陷进程不在绝对保护承诺内，但检测信号只能告警/收紧，不能擅自销毁数据。

## Verification

### Key lifecycle matrix

两平台最低支持和主流真机覆盖：首次创建、正常重启、进程 kill、设备重启前/后首次解锁、系统升级、App 升级、关闭/开启应用锁、添加/移除生物特征、改变/移除设备凭据、Biometric lockout、Keystore/Keychain 返回各错误、磁盘满、envelope 截断和轮换每个 kill point。

通过标准：

1. 正常场景同一数据可解密；错误场景不产生空库/第二身份；
2. key/envelope/原文不进入日志、崩溃、备份、剪贴板或 JS 可枚举全局；
3. 复制 DB/附件/envelope 到另一设备或普通工具不可读取；
4. App Lock 开启后，进程重启、深链接、通知和后台返回都先经过安全门；
5. 背景任务只能执行 allowlist 能力，测试无法经它返回记录 DTO；
6. FreshAuthGrant 过期、后台、目标/摘要变化、重复使用时被拒绝；
7. 凭据永久不可用时只有备份恢复/清除路径，不存在隐藏旁路；
8. 清除本机在任一 kill point 后最终同时清除数据和 keys，再创建唯一空空间。

### Security review

审阅原生 key 代码、accessibility/authenticator flags、随机源、AEAD envelope、nonce 唯一性、错误与日志、内存边界、backup exclusions、debug/release 差异和依赖安全公告。动态测试尝试 method hooking、截屏/后台快照、deep link 绕过和对后台 capability 的越权调用；发现绕过为发布 blocker。

## Rollout and rollback

首个真实数据库创建前完成 key hierarchy；不发布固定 key、明文 key preferences 或以后再迁移的过渡版。包装策略升级通过新 envelope 双写/验证/切换，保留旧 wrapper 直到新 wrapper 成功打开；失败回滚读取旧 wrapper。DEK/cipher 轮换必须先创建加密备份或隔离副本并可原子恢复。任何 rollback 二进制都必须理解当前 envelope 版本，不能通过回退丢弃新 key。

## References

- [Apple：Local Authentication](https://developer.apple.com/documentation/localauthentication)
- [Apple：Restricting keychain item accessibility](https://developer.apple.com/documentation/security/restricting-keychain-item-accessibility)
- [Apple：deviceOwnerAuthentication](https://developer.apple.com/documentation/localauthentication/lapolicy/deviceownerauthentication)
- [Android：Android Keystore system](https://developer.android.com/privacy-and-security/keystore)
- [Android：Show a biometric authentication dialog](https://developer.android.com/identity/sign-in/biometric-auth)

平台认证与 key flags 会随系统/兼容库变化。提高最低系统、改变 AndroidX Biometric、加入 extension/widget 或升级原生安全库时重新核验官方行为和真机矩阵。

## Revision notes

| 日期 | 说明 |
| --- | --- |
| 2026-07-26 | 接受随机分层密钥、this-device-only 包装、原生 Key Manager、应用锁 session 和操作级近期认证。 |

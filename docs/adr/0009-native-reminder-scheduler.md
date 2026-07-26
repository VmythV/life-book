# TD-009：原生提醒调度与平台通知适配

> Status：`Accepted`
> Date：2026-07-26
> Decision owners：客户端架构负责人、提醒负责人、安全负责人、质量负责人
> Scope：P0 iOS/Android 本地系统通知，兼容 P1 多设备投递与远程推送去重
> Related requirements：REM-001～132、REM-140～142、DOM-070、QR-003、QR-010、QR-030～031、QR-050～052、QR-070～072、QR-100～101、QR-110～112
> Related ADRs：[TD-001](0001-mobile-client-stack.md)、[TD-002](0002-offline-first-client-architecture.md)、[TD-004](0004-device-key-hierarchy-and-app-lock.md)、[TD-006](0006-cross-platform-scalar-representations.md)、[TD-007](0007-time-recurrence-engine.md)、[TD-012](0012-http-api-and-contract-versioning.md)、[TD-022](0022-remote-push-routing.md)
> Decision gate：两平台真机能力探测、权限/重启/升级/时区矩阵、Expo 原生实现兼容测试、调度预算和全部中断点恢复测试通过后，才允许系统提醒进入公开构建

## Context

生活有谱的提醒事实保存在加密本地数据库，系统通知队列只是可丢失、不可事务化且受权限控制的外部副本。保存记录成功不等于通知已经被系统接受，系统接受也不等于准时展示，更不能证明用户看到。调度器必须在 App 获得运行机会时，从领域事实确定性重建未来窗口，并准确展示能力和失败状态。

iOS 可以读取本 App 当前 pending requests，但通知仍受 Focus、摘要、系统设置和设备状态影响。Android 普通应用不能枚举 `AlarmManager` 中自己的全部闹钟；Expo Notifications 当前只把已提交请求登记在 App 私有 `SharedPreferences`，读取接口返回该登记表，而不是内核实际队列。Android 撤销精确提醒特殊访问还会停止应用并删除未来精确闹钟，撤销时不向已停止进程提供可依赖的回调，登记表可能仍显示旧请求。因此“查询系统队列并做差”不能成为跨平台正确性假设。

通知动作还跨越锁屏、进程终止、重复回调和已变化的业务状态。当前 Expo Android 实现不完整支持 action 的 authentication/destructive 语义，不能仅凭平台按钮配置执行完成、跳过或库存写入。通知 payload、调度登记表和已展示通知也会形成数据库之外的内容副本，隐私变严、归档和删除必须优先清理这些副本。

本 ADR 把[提醒与系统通知规范](../reminders-and-notifications.md)映射为可替换的平台适配器；提醒语义、实例状态和用户文案仍由该规范与领域模型拥有。

## Decision

P0 使用固定版本的 `expo-notifications` 实现本地通知，并置于项目自有 `NotificationPlatformPort` 后；只调度一个绝对目标时刻的一次性请求，不使用操作系统原生重复触发器。另建一个不接触用户内容的薄原生 `ReminderEnvironmentModule`，只报告 Android 精确提醒能力、打开对应设置、采集系统时间/时区/权限环境变化并推进持久化 generation。

业务数据库是唯一提醒事实。`ReminderReconciler` 在一个固定快照上计算未来 30 日期望集合，按保守预算选择请求，用稳定 request ID 和完整 schedule fingerprint 幂等替换；平台调用不放在数据库事务中，结果通过可重放任务和投递记录收敛。iOS pending 列表可作为实际待处理证据；Android 列表只视为 Expo adapter registry，任何可能清空真实闹钟的环境变化都强制重新挂载全部仍期望的请求。

Android 声明 `SCHEDULE_EXACT_ALARM`，不声明 `USE_EXACT_ALARM`；允许时使用当前 adapter 的 exact 路径，不允许时明确降级 approximate。P0 不使用闹钟式全屏界面、`setAlarmClock`、绕过勿扰、critical alert 或 time-sensitive interruption，也不承诺分钟级送达。

所有会改变领域状态的通知快捷动作都先打开 App，把不透明响应写入加密 action inbox，并经过应用锁、当前授权和最新业务状态校验后执行。敏感通知只提供“打开”。

## Decision details

### 1. 组件和事实边界

```text
Domain transaction
  ├─ writes ReminderPlan / ReminderInstance / source state
  └─ enqueues ReconcileReminders(reason, targetRevision)
                              │
                              ▼
                      ReminderReconciler
                  ┌───────────┴───────────┐
                  ▼                       ▼
          @life-book/time          ContentPolicy
       desired one-shot set      minimal snapshot
                  └───────────┬───────────┘
                              ▼
                  NotificationPlatformPort
                       │              │
                    iOS UN*      Android AlarmManager
                       └──── expo-notifications ────┘

System/environment event → ReminderEnvironmentModule
                         → environmentGeneration / dirty flag
                         → next permitted reconcile

Notification response → encrypted ActionInbox
                      → unlock + authorization + current-state command
```

- `ReminderPlan`、`ReminderInstance`、来源状态和用户设置是业务事实；
- 平台 pending request、Expo registry、已展示通知、投递尝试、对账水位和 environment generation 都不是业务事实；
- TD-007 负责时区、重复与 `scheduledFor` 计算；本适配器只接受一个已经解析的 TD-006 `Instant`；
- 系统事件只能标记环境变脏，不能在 receiver/observer 中自行推导发生项、读取标题或修改业务状态；
- Presentation 不能直接调用 Expo Notifications；所有查询、调度、取消、动作响应都经过 application port；
- P1 远程推送和本地调度共享逻辑 ReminderInstance/deduplicationKey，但各自拥有 delivery；远程适配不得复用本 ADR 的平台登记表作为服务端事实。

### 2. 平台端口

端口的语义接口固定为：

```ts
interface NotificationPlatformPort {
  getCapabilitySnapshot(): Promise<NotificationCapabilitySnapshot>;
  ensureChannelsAndCategories(contractVersion: number): Promise<void>;
  listManagedPending(): Promise<ManagedPendingSnapshot>;
  upsertOneShot(request: OneShotNotificationRequest): Promise<SubmitReceipt>;
  cancelPending(requestId: PlatformRequestId): Promise<CancelReceipt>;
  dismissDelivered(requestId: PlatformRequestId): Promise<DismissReceipt>;
  openSystemSettings(target: NotificationSettingsTarget): Promise<void>;
  requestPermission(request: PermissionRequest): Promise<PermissionResult>;
}
```

实现可以扩展 DTO，但不得削弱以下约束：

- `requestPermission` 只能由明确用户动作调用，对账、启动、后台任务和 receiver 不得弹系统权限；
- `upsertOneShot` 是按项目 request ID 达到“至多一个当前请求”的幂等意图，不暴露 Expo 自动生成 ID；
- `listManagedPending` 返回 `source = ios_pending_queue | android_adapter_registry`，调用者不得把两者解释为同等证据；
- `cancelPending` 对不存在的 ID 成功且幂等；取消后仍执行登记表复核，必要时产生可重试失败；
- `dismissDelivered` 只尽力清除通知中心副本，不改变 ReminderInstance 状态；
- 原生/Expo 错误先映射为稳定、无内容的项目错误码，未知原始消息只进入本机受限调试环，不进入普通日志或诊断包；
- 端口不得接收任意 SQL、领域对象、附件、正文或认证令牌。

### 3. 能力快照

能力不是一个布尔值。每次前台对账以及提交前取得同一轮快照：

```text
posting:
  not_determined | denied | allowed | provisional

presentation:
  normal | noninterruptive | summary | channel_blocked |
  system_restricted | unknown

precision:
  exact | approximate | not_applicable
```

- iOS `notDetermined` 映射为 `not_determined`；`authorized` 为 allowed；`provisional` 单列，不能写成正常打扰；`ephemeral` 仅在将来确有 App Clip 场景时支持，P0 不产生该状态；
- Android 13+ posting 来自通知运行时权限，并结合用户提醒 channel 是否可用；更低版本仍需读取 App/channel 状态，不能按系统版本假设 allowed；
- Android `precision` 每轮通过 `canScheduleExactAlarms()` 查询；iOS 为 `not_applicable`，不能把它显示成“保证精确”；
- Focus、摘要、勿扰、厂商省电等无法完整获知时使用最保守可说明状态，不伪造 normal；
- capability snapshot 带 `observedAt`、OS/app/adapter version 和 `environmentGeneration`，但不持久化用户内容；
- 一次对账使用固定快照。执行期间能力 generation 变化时放弃最终水位并重新入队。

用户界面把三个维度分别解释为“能否发布”“可能怎样呈现”“Android 时间精度”，不能折叠为绿色的“通知正常”。

对账执行分支固定为：

| posting / presentation | 平台动作 | 领域与界面结果 |
| --- | --- | --- |
| `not_determined` | 不提交；定向取消可能由恢复/旧版本留下的 managed 请求；后台不请求权限。 | 计划保持 planned，显示“尚未允许”；只有用户正在保存真实提醒并继续说明流程时才可请求。 |
| `denied` | 不提交；定向取消当前 managed 请求。 | 计划保持 planned，显示“需开启通知”和设置入口；权限变化后只重挂未来目标。 |
| `allowed/provisional` + `channel_blocked` | Android 不提交并定向取消该 channel 的 managed 请求。 | 计划保持 planned，显示“提醒渠道已关闭”和设置入口。 |
| `provisional` + 其他状态 | iOS 可提交普通一次性请求。 | 明确标为非打扰/可能静默呈现；P0 不主动请求 provisional。 |
| `allowed` + `normal/noninterruptive/summary/system_restricted/unknown` | 按 precision 分支提交；系统控制的呈现状态不改时间。 | 保存实际能力说明；`unknown` 不显示正常保证。 |

取消只作用于项目 managed ID，不删除 ReminderInstance。`precision = approximate` 使用近似 adapter；`exact` 使用 exact adapter；`not_applicable` 只适用于 iOS。能力组合非法或未知枚举时停止新增提交、保留计划并进入可诊断状态，不猜测更宽松能力。

### 4. 稳定请求身份和指纹

平台 request ID 只由非内容身份确定：

```text
requestId = "lbr1:" + lowercaseHex(
  SHA-256(UTF8(
    "life-book/reminder-request/v1\u0000" +
    installationId + "\u0000" +
    reminderInstanceId + "\u0000" +
    recipientSlot
  ))
)
```

- `installationId` 是 this-device-only 安装身份，恢复到另一设备后重新生成；
- P0 `recipientSlot = local`；P1 使用稳定 subscription/device delivery 槽位，不能放邮箱、家庭名等可识别内容；
- 普通编辑保持 ReminderInstance 和 request ID，只替换时间/内容；snooze 创建新 ReminderInstance，因此有新 ID；
- ID 计算使用固定 UTF-8、NUL 分隔和完整 256-bit digest；不得用 Java/JavaScript 非密码学 `hashCode`；
- 平台返回的内部 ID 若不同，只存为 adapter metadata，不能成为跨重建身份。

每个期望请求计算 `scheduleFingerprint`，至少覆盖：

```text
target Instant
precision mode
content policy version + rendered-content digest
privacy mode
action/category contract ID
payload contract version + canonical payload digest
sound/channel/interruption policy
recipient slot
```

fingerprint 使用版本化 canonical encoding 后 SHA-256，不保存标题或正文。任一字段改变即 replace；title 本身不得出现在投递诊断、任务 key 或 request ID。

### 5. 一次性触发映射

所有 occurrence、重要日期、follow-up 和 snooze 都先物化为 ReminderInstance，再提交一次性请求：

- iOS 使用 calendar trigger，显式给出目标 UTC 的 year/month/day/hour/minute/second、`timeZone = UTC`、`repeats = false`；提交前用 Expo `getNextTriggerDateAsync` 验证解析结果恰等于目标 Instant，不相等则拒绝提交并记录稳定错误；
- Android 使用 Date trigger。当前固定 Expo 版本在 exact capability 可用时走 `RTC_WAKEUP + setExactAndAllowWhileIdle`，否则走 `setAndAllowWhileIdle`；这属于 adapter 合同测试，不是永久平台事实；
- 两平台把毫秒截断到秒，业务层在生成目标时显式采用整秒；若旧数据含毫秒，向不早于目标的下一秒取整并在 migration fixture 固定；
- `scheduledFor <= fixedNow` 的请求永不重新挂载。错过处理遵守 REM-032，只进入应用内状态，防止重启、恢复或权限变化造成通知洪水；
- 低库存 `state_entered` 的系统目标是进入状态后的下一个完整分钟；如果提交时已过该目标，只保留应用内关注，不补发系统通知；
- 时区和重复规则只在 TD-007 解析；原生 calendar repeat、daily/weekly/monthly trigger 均禁用；
- Expo/平台返回接受只代表 adapter 接受请求，不代表到点展示。

Android approximate 调度不早于目标，但在正常系统限制下也可能接近一小时后才执行，Doze 或厂商策略下可能更久。产品统一使用“可能在设定时间附近提醒”，不显示虚构误差范围或分钟级倒计时保证。

### 6. 通知渠道、类别和呈现

#### 6.1 Android channel

P0 建立不可变语义 channel `user_reminders_v1`：

```text
importance = DEFAULT
sound = system default
bypassDnd = false
showBadge = false
lockscreenVisibility = PRIVATE
```

- 首次请求 Android 13+ 通知权限前先创建 channel，使系统场景可理解；
- 已创建 channel 的用户设置由系统拥有，App 不重复删除/创建或尝试覆盖；
- 若默认行为将来改变，创建 `user_reminders_v2` 并迁移未来请求，保留旧 channel 的解释和清理期；
- 不使用 full-screen intent、alarm clock、持续通知、critical/time-sensitive 或绕过勿扰；
- channel 被关闭时 posting/presentation 分别反映真实限制，计划仍保存。

#### 6.2 iOS 呈现

- 第一次真实提醒场景请求 alert + sound，不请求 badge；
- P0 不主动申请 provisional authorization；系统已返回 provisional 时可以非打扰提交并准确说明；
- interruption level 保持普通 active/default，不使用 critical 或 time-sensitive entitlement；
- 前台 handler 仍按 REM-063 决定应用内反馈，不把前台回调当作用户已读证据。

#### 6.3 category 版本

- `ensureChannelsAndCategories` 在接收响应和首次调度前幂等注册全部当前及仍可能回调的上一兼容版本；
- category ID 包含语义版本，旧版本至少保留到其最后 pending/delivered 生命周期和发布兼容窗口结束；
- 非敏感通知可以展示 REM-060 的动作，但所有 mutating action 都配置为打开前台；
- 敏感通知映射到只含 Open 的受控 category variant，不出现完成、跳过、知道了、稍后或加入采购清单；
- Android 当前忽略 authentication-required/destructive flags，因此两平台共同安全基线不能依赖这些 flag。iOS 可额外增加保护，但不能绕过 App 内校验。

### 7. 通知内容、平台副本与备份

可见内容由 `NotificationContentPolicy` 在调度时生成，只允许 REM-070 的三种模式；payload 严格限制为 REM-071。adapter 接口对 title/body 设置长度上限并按 Unicode grapheme 安全截断，不从任意对象序列化 payload。

当前 Expo Android scheduler 为重启恢复把完整 `NotificationRequest` 序列化到普通 App 私有 `SharedPreferences`。因此：

- 该文件是受控平台副本，不是持久化模型；只保存已经明确允许进入系统通知的最小快照；
- 敏感记录始终使用通用隐藏文案；附件、正文、清单内容、数量、认证信息和文件路径永不进入请求；
- 精确识别该 dependency 版本生成的 preferences 文件并通过 Android data-extraction/backup rules 排除 Auto Backup 和 device-to-device transfer；构建测试必须解包 APK/AAB 校验规则；
- 取消、归档、删除、永久删除、成员失权和隐私变严格时，先取消 pending，再 dismiss delivered，最后写入新的成功水位；
- 普通内容编辑使用同 ID replace；隐私收紧或删除采用 cancel-first，不能让旧快照在 replace 失败后继续存在；
- adapter registry 不复制到诊断包、日志、崩溃事件或业务备份；清除本机数据按 TD-004 先取消通知再销毁密钥/文件；
- 每次 Expo 升级必须检查 Android/iOS 原生源码、存储文件名/格式、备份属性、receiver、触发选择和取消语义；不依赖未声明的内部格式进行业务读取；
- 安全评审必须接受或替代 Android 私有明文 request 副本后才能公开发布。若目标威胁模型不接受，替代为项目维护的最小原生 scheduler/store，并以新 ADR 记录。

iOS/Android 系统本身保存通知请求是系统功能的必要副本，无法由 SQLCipher 覆盖。产品通过内容模式、系统权限、应用锁入口和及时清理降低暴露，不声称系统通知内容由应用数据库加密保护。

### 8. 对账算法

每个 installation 只允许一个 reminder reconcile lease。任务以 reason set 合并，不因高频编辑无限排队：

```text
1. acquire bounded lease
2. capture fixed now, timezone, tzdb, app/domain revision,
   capability snapshot and environment generation
3. read valid plans/sources and compute desired instances for [now, now + 30 days]
4. filter past, terminal, paused, cancelled, invalid and unauthorized sources
5. apply the capability decision table; retain domain plans even when platform set is empty
6. select ordinary requests and reserve slots by REM-092
7. derive requestId and scheduleFingerprint for each selected request
8. list managed pending/registry and the latest local attempt for every request ID
9. cancel invalid, unauthorized and privacy-tightening requests first
10. upsert requests without sufficient current success evidence
11. if environment generation requires rebuild, force re-arm every desired request
12. cancel remaining undesired managed requests; never global cancel-all in normal reconcile
13. dismiss obsolete delivered sensitive/deleted/unauthorized requests where supported
14. persist NotificationDelivery receipts, capability evidence and scheduled-through watermark
15. if domain revision, environment generation or relevant settings changed, enqueue rerun
16. release lease
```

平台调用永远不放在 SQLite transaction 内。每个外部动作前后写短事务 checkpoint；进程在任意一步终止后可以重复执行。任务 revision guard 保证旧任务不能把新编辑标记为已安排。

#### 8.1 差分和强制重挂

- iOS `listManagedPending` 返回本 App 当前 pending，可按 request ID/fingerprint adapter metadata 做差；
- Android 返回 Expo registry，只能证明 adapter 曾登记，不能证明 AlarmManager 仍有闹钟。投递状态仍可记 `accepted`，但证据必须为 `android_registry_only`，界面不能声称“系统队列已确认”；
- 当前 Expo Android 路径可能先写 registry、再调用 AlarmManager。Android 只有同时满足“registry 中 request/fingerprint 匹配”和“最新 attempt 是同 fingerprint、precision、capability/environment generation 的 `accepted` 成功回执”时才允许跳过 upsert；单独 registry 条目永远不产生 `accepted`；
- 每次外部提交前先以递增 attempt sequence 写 `requested` checkpoint，AlarmManager/adapter 正常返回后才写 `accepted`。最新 attempt 为 `requested`、`rejected`、`missing`、`cancelled`，或没有对应成功回执时，一律同 ID 重挂；不能回退采用更早的 accepted；
- Android 在 boot、App/Expo 升级、恢复检测、time/timezone change、exact capability/environment generation 变化后，忽略 registry 的“存在”结论，对全部 selected desired 执行同 ID re-arm；
- exact 权限撤销可能直接停止 App、删除 exact alarms 且没有可依赖的撤销回调。下一次系统允许 App 运行时重新查询 capability，转 approximate 并强制重挂；不得承诺撤销瞬间自动恢复；
- exact 权限授予广播只标记 generation；receiver 不直接读取数据库或安排内容；
- schedule 成功而 accepted 回执写入前崩溃时，最新 attempt 仍为 requested，下一轮同 ID 重试；registry 已写而 AlarmManager 失败/进程终止时也因缺少当前成功回执重试；
- 不在正常对账使用平台全量 cancel，因为这会扩大隐私清理失败和调度空窗；清除本机等明确不可逆流程除外。

#### 8.2 预算

总 pending product budget：

| 平台 | 总预算 | 普通候选上限 | snooze/近期编辑预留 |
| --- | ---: | ---: | ---: |
| iOS | 48 | 40 | 8 |
| Android | 200 | 180 | 20 |

- 48 是产品保守预算，不是对历史“64 条”说法的依赖，也不代表 Apple 公共 API 的永久保证；
- 普通候选按 REM-092 稳定排序占用普通上限；未用预留可以在本轮末尾借给普通候选，但必须在下轮能被高优先级动作抢占；
- snooze 或近期编辑可以逐个驱逐最远且优先级最低的普通请求，但总数永不超过平台预算；被驱逐实例保持 planned/waiting-capacity，并更新水位；
- 权限、channel、OS/OEM 或真机证据要求更低预算时，使用带版本、本地签名/构建内配置下调，不能远程提高到未经测试的值；
- 预算不限制数据库实例数；覆盖不足显示已安排水位和待补齐数量。

### 9. 环境变化原生模块

`ReminderEnvironmentModule` 只提供：

```ts
interface ReminderEnvironmentModule {
  getEnvironmentSnapshot(): Promise<{
    generation: number;
    dirtyReasons: EnvironmentReason[];
    canScheduleExactAlarms?: boolean;
  }>;
  openExactAlarmSettings(): Promise<void>;
  acknowledgeHandledGeneration(generation: number): Promise<void>;
}
```

原生层监听/桥接：

- Android `ACTION_TIME_SET`、`ACTION_TIMEZONE_CHANGED`、系统允许的 boot/package replace 事件，以及 `ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED`；
- iOS significant time change、time-zone change 和 App lifecycle 可观察事件；
- App 前台时主动复核通知权限、channel 和 exact capability，不依赖事件完整性。

每次事件只以单调 UInt32/受溢出处理的 generation 和 bitset reason 写入不含内容的小型持久存储；App 活着时唤醒已注册 reconcile signal，否则保留 dirty flag。模块不得保存标题、Reminder ID、计划时间、时区业务选择或 payload，不得调用 `@life-book/time`，不得直接调度/取消通知。

Android exact permission state broadcast 只可靠表示获得能力；撤销路径按“无通知、下次运行检测”设计。generation 丢失、存储损坏或版本不认识时采用全量未来窗口重挂的安全默认。

### 10. 动作响应与幂等

通知 response 的第一站是 TD-003 加密数据库中的 `NotificationActionInbox`：

```text
responseId / platformRequestId
actionContractId
opaque reminder/source identifiers from REM-071 payload
receivedAt
payloadContractVersion
processingState
non-content platform metadata
```

- action inbox 唯一键为 `SHA-256("life-book/notification-action/v1" + action + requestId + actionContractVersion)`；重复 response 返回既有结果；
- adapter 先校验 payload 大小、版本、category/action allowlist 和 ID 格式，未知输入只允许安全打开首页，不执行命令；
- mutating action 必须打开 App；应用锁开启时先进入无内容锁屏，解锁后重新读取 ReminderInstance、来源、space membership/tenure 和权限；
- 当前状态有效后才转换为 application command，命令自身继续使用领域幂等键；平台回调绝不能直接 update 表；
- response 持久化成功后清除 Expo last notification response，防止冷启动重复；若清除失败，inbox 唯一键吸收重放；
- 来源已终态、删除、失权或动作过期时写安全 no-op 结果，并清理残留 pending/delivered；
- “打开”只导航到不透明 ID，仍经过 TD-004 深链锁和当前授权查询；
- P1 来自远程通知的 response 复用同一 inbox/命令合同，但必须带可验证的 transport/source 类型，不能把远程 payload 当本地可信事实。

### 11. 投递记录和用户状态

`NotificationDelivery` 记录提交/取消尝试，不记录可见文案：

```text
reminderInstanceId
installation/device delivery slot
requestId
scheduleFingerprint
requestedAt / acceptedAt / observedAt / cancelledAt
requestedPrecision
status: requested | accepted | observed_trigger | observed_action |
        cancelled | rejected | missing
evidence: ios_pending | android_registry_only | adapter_receipt | none
stableErrorCode?
adapterContractVersion
environmentGeneration
```

具体物理表由持久化 Schema 文档定义。`ReminderInstance.state` 是收件人范围内的逻辑生命周期，不保存“本设备正常”。P0 只有一个 installation 时，当前非失效 delivery accepted 后可进入 scheduled；P1 同一实例跨多个 Device 共享，至少一个当前适用设备存在 accepted delivery 时才可聚合为 scheduled，单台设备失败不能把共享实例改成 failed。每台设备的已安排、近似、等待权限、registry-only、预算不足和失败状态始终从该设备 `NotificationDelivery` 派生；accepted 不表示展示或用户已读。

`scheduledThrough` 必须同时带 platform、预算、能力 generation、tzdb/recurrence version 和完成时间；任一输入变化即失效。诊断只输出随机/不透明 ID、时间、稳定错误、能力和水位，不输出 title/body/payload 或 Expo registry 原文。

## Alternatives considered

### 1. 直接在 feature 中调用 `expo-notifications`

实现快，但会把生成、权限、平台登记表、动作和 UI 文案耦合；Expo 行为变化会渗入领域，测试也无法注入队列丢失。拒绝。

### 2. P0 自研完整 iOS/Android 通知模块

可以完全控制 Android 存储与 receiver，但初期原生维护面、升级成本和错误风险明显更高。当前 Expo 能覆盖一次性调度、pending/cancel、category 和 response，配合薄环境模块可达到边界；若安全评审或契约测试失败，再以替代 ADR 转向自研 adapter。

### 3. 使用原生重复 trigger

平台重复语义不能表达生活有谱的例外、结束规则、DST policy、完成/跳过和稳定 occurrence identity，也难以在编辑后清理。拒绝；全部展开成滚动窗口单次请求。

### 4. Android 只用近似提醒

权限和实现更简单，但会放弃用户明确选择的分钟级目标。P0 保留用户主动授权的 exact 路径，同时把拒绝作为完整可用降级。

### 5. Android 声明 `USE_EXACT_ALARM` 或使用 alarm-clock/full-screen 能力

这些能力面向受限的核心闹钟/日历场景，并带来更高商店政策、打扰和权限风险；生活管理提醒不应冒充闹钟。拒绝。

### 6. 把 Expo registry 当作 Android 真实系统队列

普通应用无法据此证明 AlarmManager 仍持有闹钟，尤其在 exact 权限撤销后会出现假阳性。拒绝；使用 registry 做 adapter bookkeeping，并在环境变化后强制重挂。

### 7. 服务器推送替代本地提醒

违反 P0 离线要求，引入账号、网络、服务可用性、地区与隐私依赖，也不能保证展示。拒绝作为 P0 事实；P1 只能补充且按逻辑实例去重。

### 8. 不提供系统通知，只做 App 内今天页

无法满足用户明确提醒的核心价值。保留 App 内关注作为所有失败/拒绝场景的降级，但不作为唯一方案。

## Consequences

正面结果：

- 时间和平台副作用严格分层，领域测试不需要真实系统通知；
- 同 ID、fingerprint、任务和环境 generation 让编辑、崩溃、重启、升级和权限变化可以收敛；
- Android 登记表假阳性、exact 撤销和 OEM 延迟被诚实建模；
- 通知内容、动作和诊断都有最小化/应用锁边界；
- P1 可以复用逻辑去重而替换 delivery transport。

成本与兼容负担：

- 需要维护一个薄原生模块、Expo 原生源码契约测试和 Android backup exclusion；
- 调度状态是多维且最终一致，UI、测试和客服文案比单一“已开启”更复杂；
- 滚动窗口要求 App 获得运行机会，长时间不打开时覆盖水位可能不足；
- 平台副本不能由 SQLCipher 完整控制，必须接受明确的威胁模型余留风险；
- category、payload、request ID、fingerprint 和 action inbox 一经发布都成为版本兼容合同。

## Risks and mitigations

| 风险 | 缓解 |
| --- | --- |
| Android registry 存在但 alarm 已被删除 | 环境 generation 后全量 re-arm；状态标注 registry-only；真机注入假阳性。 |
| exact 权限被撤销时 App 被停止 | 不依赖撤销回调；下次运行主动查询并以 approximate 强制重挂。 |
| Expo 升级改变内部存储/触发器/receiver | 固定版本与 integrity；源码审阅、原生契约测试、解包产物验证和分阶段升级。 |
| 通知内容留在系统或私有 preferences | REM-070/071 最小化；敏感通用文案；备份排除；privacy tighten/delete cancel-first + dismiss。 |
| 快捷动作绕过应用锁或重复执行 | 全部 mutation 打开 App；加密 inbox 双层幂等；当前授权/状态复核。 |
| 调度预算挤掉近期提醒 | 分级选择、固定 tie-break、预留和水位警告；snooze 只驱逐最远普通项。 |
| 对账中进程终止产生半完成 | 平台调用外置、短事务 checkpoint、稳定 ID、revision guard 和可重放 lease。 |
| 系统时钟/时区变化造成旧触发 | 薄原生 generation + 前台主动复核；固定 TimeContext 重算并重挂。 |
| 用户误解“accepted”为准时/已读 | 能力三维状态、registry-only 证据和受控文案；从不产生 delivered 业务事实。 |
| 近似闹钟过度延迟 | 清晰降级、应用内今天页/状态、设置入口和 OEM 排查；不虚构 SLA。 |
| receiver 在锁屏/启动前读取内容 | 原生模块仅写无内容 generation；实际对账使用 TD-004 BackgroundMaintenance capability。 |
| request ID/fingerprint 编码漂移 | 固定版本 canonical fixture；跨 Swift/Kotlin/TypeScript 黄金向量。 |

## Implementation constraints

- P0 固定 `expo-notifications` 到经锁文件和 integrity 验证的版本；决策日官方 SDK 页面推荐线为 `~57.0.7`，创建工程时必须与 TD-001 的 Expo SDK 兼容矩阵共同锁定，不能仅复制本文版本；
- 只允许 adapter package import `expo-notifications`，ESLint/dependency rule 阻止 feature/domain 直接引用；
- `SCHEDULE_EXACT_ALARM`、boot receiver、notification permission、channel 和 backup rules 必须从最终 merged manifest/产物验证，不能只看源码模板；
- 禁止 `USE_EXACT_ALARM`、full-screen intent、DND bypass、critical/time-sensitive entitlement、后台轮询和 native repeating trigger；
- 调度目标只接收 TD-006 Instant；不得把 `Date.now()`、设备默认时区或 locale 隐式带入；
- schedule/cancel/dismiss/permission/settings platform call 不得位于数据库事务；
- normal reconcile 不得调用 cancel-all；清除本机流程必须有独立授权和中断恢复；
- `listManagedPending` 的 evidence 类型为必填 exhaustive enum，Android 不能返回 `system_queue`；
- 所有 title/body/payload/category/channel 构造只能来自受控 mapper；日志 API 接收 DTO 时必须自动裁剪内容字段；
- action inbox processor 只能调用 application commands，不能直接访问 repository implementation；
- environment generation 的 wrap/corruption 视为 changed，并强制重挂；
- 对账 lease 使用 wall-clock-independent expiry 或带 boot/session identity 的安全恢复，不能因用户回拨时钟永久占用；
- 物理 Schema、索引和 retention 在本地持久化文档定义；接口 JSON/错误码在契约文档定义，本 ADR 不成为第二份字段权威；
- Expo 内部实现不是公共 API。任何依赖内部事实的测试必须在升级失败时阻止合并，而不是在生产静默适配。

## Verification

### 1. 自动化合同

- request ID、canonical fingerprint、秒取整、排序、预算/预留、驱逐和 scheduled-through 黄金向量；
- 30 日窗口、过去目标、低库存下个整分钟、DST gap/overlap、时区/tzdb 变化与 TD-007 fixture 联测；
- 同 ID edit replace、新 ID snooze、privacy tighten cancel-first、删除/归档/失权 dismiss；
- 对每个 reconcile 外部调用前后注入 kill，重启后无重复领域动作、无旧隐私内容、最终 pending 集合收敛；
- domain revision/environment generation 在执行中变化会重新排队；旧任务不能提交新 revision 的旧内容；
- Android registry 假阳性、空 registry/有 alarm 不可见、exact revoke、permission grant、channel blocked 和 adapter error mapping；
- action response 重放、未知 action/version、过期来源、删除、成员失权、锁定/解锁和 Expo last response 重放；
- payload/schema fuzz、长度边界、Unicode 截断和日志/诊断无内容断言；
- Android backup/restore 测试证明 notification preferences、environment this-device state 和 installation ID 不迁移；
- dependency test 对 Expo Android 源码/行为断言 exact/approx API、registry delete、boot restore 和 action option 支持范围。

### 2. 真机矩阵

- iOS 16、17、18 及当前最新支持版本；authorized/denied/provisional、Focus、摘要、重启、升级、时区/显著时钟变化、App 前台/后台/终止；
- Android API 29、31、33、34、35 及当前 target/latest，覆盖 exact 默认拒绝、授予、撤销、通知拒绝、channel 关闭、Doze、reboot、package replace、force-stop 后恢复；
- 与发行渠道相关的 Google 系、华为、小米、OPPO/vivo 至少三类 OEM，记录省电/自启动差异，不把单一模拟器作为证据；
- 预算下限、恰好上限、超出 1、大幅超出，snooze 预留与最远项驱逐；
- 连续至少 14 天包含重启、升级、时间/时区切换和 30 天不打开后的恢复；
- 已展示普通/敏感通知在编辑、隐私收紧、删除、清除本机和成员失权后的清理；
- Android 15+ force-stop/权限变化以及未来平台行为按发布矩阵重新核验。

### 3. 安全与发布检查

- 独立审阅 manifest 权限、receiver exported 属性、intent 输入、action inbox、应用锁、payload 和 deep link；
- 解包 release APK/AAB/IPA，确认没有禁止 entitlement/permission、backup exclusion 生效、debug receiver/日志关闭；
- 在锁屏、进程终止、数据库迁移和 key 暂不可用时攻击 mutating actions，不能绕过认证或产生未授权写入；
- 扫描系统日志、崩溃报告、诊断包和 adapter preferences，内容必须符合 REM-070/071；
- 依赖许可证、SBOM、安全公告、Expo SDK/React Native/target SDK 兼容性通过 TD-017 release gate；
- 商店提交前重新核验 Apple/Android 通知、exact alarm 和后台政策，行为改变必须更新 ADR/规范与用户文案。

## Rollout and rollback

首次启用时先迁移/生成未来 ReminderInstance 和 reconcile tasks，不立即在 migration transaction 调平台；数据库可用后注册 category/channel、取得能力快照，再按预算渐进提交。内部构建先启用只读 diff/诊断模式，验证期望集合，再打开 platform writes；公开构建不得依赖远程开关才能调度基本本地提醒。

adapter contract、payload、category、request ID 和 fingerprint 都有独立版本。升级时新旧 category/parser 并存；同 request ID replace 到新 fingerprint，隐私收紧先 cancel。回滚二进制必须仍能识别已发布 payload/category，未知新版本只允许打开首页和安全清理，不能执行 mutation。

若新 Expo/原生 adapter 出现重复、丢失或隐私风险：

1. 构建内/签名配置暂停新 platform writes，但保留计划、今天页和 action 安全解析；
2. 对确认泄露风险的 managed IDs 执行定向 cancel/dismiss，不普通全量 cancel；
3. 回退到最后通过合同测试的 adapter 版本并推进 environment generation；
4. 下次运行从业务事实强制重挂未来窗口，不补发过去请求；
5. 数据格式需要改变时以新 ADR 和 migration 发布，不能让旧 registry 成为恢复依赖。

exact 权限不可用、channel 被关闭或平台行为不确定时自动回落 approximate/应用内提醒；绝不回退到更高权限、全屏或绕过系统控制的实现。

## References

- [Expo Notifications SDK](https://docs.expo.dev/versions/latest/sdk/notifications/)
- [Expo Android scheduling delegate source](https://github.com/expo/expo/blob/main/packages/expo-notifications/android/src/main/java/expo/modules/notifications/service/delegates/ExpoSchedulingDelegate.kt)
- [Expo Android SharedPreferences notification store source](https://github.com/expo/expo/blob/main/packages/expo-notifications/android/src/main/java/expo/modules/notifications/service/delegates/SharedPreferencesNotificationsStore.kt)
- [Android Developers：Schedule alarms](https://developer.android.com/develop/background-work/services/alarms)
- [Android AlarmManager：exact-alarm permission state action](https://developer.android.com/reference/android/app/AlarmManager#ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED)
- [Apple：UNUserNotificationCenter](https://developer.apple.com/documentation/usernotifications/unusernotificationcenter)
- [Apple：UNNotificationRequest identifier](https://developer.apple.com/documentation/usernotifications/unnotificationrequest/identifier)

外部实现和平台政策会变化。依赖升级、target SDK 提升和商店提交时重新核验上述资料；正文固定的是适配边界、降级和验证责任，不把当前内部实现当作永久 API。

## Revision notes

| 日期 | 说明 |
| --- | --- |
| 2026-07-26 | 澄清权限能力决策表、Android registry 与同代成功回执双重判断、崩溃后强制重试，以及 P1 共享实例和设备投递的状态边界。 |
| 2026-07-26 | 接受 Expo Notifications + 自有端口 + 薄环境原生模块；固定一次性滚动调度、稳定身份、预算、Android registry 证据、强制重挂、动作 inbox 与隐私边界。 |

# TD-009：原生提醒调度与平台通知适配

> Status：`Accepted`
> Date：2026-07-26
> Decision owners：客户端架构负责人、提醒负责人、安全负责人、质量负责人
> Scope：P0 iOS/Android 本地系统通知，兼容 P1 多设备投递与远程推送去重
> Related requirements：REM-001～132、REM-140～142、DOM-070～075、QR-003、QR-010、QR-030～031、QR-050～052、QR-070～072、QR-100～101、QR-110～112
> Related ADRs：[TD-001](0001-mobile-client-stack.md)、[TD-002](0002-offline-first-client-architecture.md)、[TD-004](0004-device-key-hierarchy-and-app-lock.md)、[TD-006](0006-cross-platform-scalar-representations.md)、[TD-007](0007-time-recurrence-engine.md)、[TD-010](0010-sqlite-snapshot-migration-and-atomic-restore.md)、TD-012、TD-022
> Decision gate：两平台真机能力探测、权限/重启/升级/时区矩阵、Expo 原生实现兼容测试、调度预算和全部中断点恢复测试通过后，才允许系统提醒进入公开构建

## Context

生活有谱的提醒事实保存在加密本地数据库，系统通知队列只是可丢失、不可事务化且受权限控制的外部副本。保存记录成功不等于通知已经被系统接受，系统接受也不等于准时展示，更不能证明用户看到。调度器必须在 App 获得运行机会时，从领域事实确定性重建未来窗口，并准确展示能力和失败状态。

iOS 可以读取本 App 当前 pending requests，但通知仍受 Focus、摘要、系统设置和设备状态影响。Android 普通应用不能枚举 `AlarmManager` 中自己的全部闹钟；Expo Notifications 当前只把已提交请求登记在 App 私有 `SharedPreferences`，读取接口返回该登记表，而不是内核实际队列。Android 撤销精确提醒特殊访问还会停止应用并删除未来精确闹钟，撤销时不向已停止进程提供可依赖的回调，登记表可能仍显示旧请求。因此“查询系统队列并做差”不能成为跨平台正确性假设。

通知动作还跨越锁屏、进程终止、重复回调和已变化的业务状态。当前 Expo Android 实现不完整支持 action 的 authentication/destructive 语义，不能仅凭平台按钮配置执行完成、跳过或库存写入。通知 payload、调度登记表和已展示通知也会形成数据库之外的内容副本，隐私变严、归档和删除必须优先清理这些副本。

本 ADR 把[提醒与系统通知规范](../reminders-and-notifications.md)映射为可替换的平台适配器；提醒语义、实例状态和用户文案仍由该规范与领域模型拥有。

## Decision

P0 使用固定版本的 `expo-notifications` 实现本地通知，并置于项目自有 `NotificationPlatformPort` 后；只调度一个绝对目标时刻的一次性请求，不使用操作系统原生重复触发器。另建一个不接触用户内容的薄原生 `ReminderEnvironmentModule`，只报告 Android 精确提醒能力、打开对应设置、采集系统时间/时区/权限环境变化并推进持久化 generation。

业务数据库是唯一提醒事实。`ReminderReconciler` 在绑定 TD-010 active dataset generation、完整 notification realm 与 `NotificationInputRevision` 的固定快照上计算未来 30 日期望集合，按保守预算选择请求，用稳定 request ID 和完整 schedule fingerprint 幂等替换；平台调用不放在数据库事务中，结果通过可重放任务、投递记录和完整 sealed SchedulingRun 收敛。iOS pending 列表可作为实际待处理证据；Android 列表只视为 Expo adapter registry，任何可能清空真实闹钟的环境变化都强制重新挂载全部仍期望的请求。

Android 声明 `SCHEDULE_EXACT_ALARM`，不声明 `USE_EXACT_ALARM`；允许时使用当前 adapter 的 exact 路径，不允许时明确降级 approximate。P0 不使用闹钟式全屏界面、`setAlarmClock`、绕过勿扰、critical alert 或 time-sensitive interruption，也不承诺分钟级送达。

所有带目标的通知 response（包括默认“打开”）都先通过 bounded parser、当前 Installation/incarnation/epoch 与 request ID fence；只有通过后才能写入加密 action inbox、导航到目标或执行命令。会改变领域状态的快捷动作必须先打开 App，再经过应用锁、当前授权和最新业务状态校验。敏感通知只提供“打开”。

## Decision details

### 1. 组件和事实边界

```text
Domain transaction
  ├─ writes ReminderPlan / ReminderInstance / source state
  └─ locks current NotificationDatasetState owner
     ├─ atomically advances NotificationInputRevision once
     ├─ invalidates every registered pair state
     └─ upserts one ReconcileRemindersCoordinator(realm, revision, pairSetDigest)
                              │
                              ▼
                ReminderReconcileCoordinator
                  └─ one pair runner per registered
                     transport/platform pair
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

Notification response → short Lease A realm/request/category fence
                      → encrypted ActionInbox → release Lease A
                      → unlock → fresh Lease B → command/navigation
```

- `ReminderPlan`、`ReminderInstance`、来源状态和用户设置是业务事实；
- 平台 pending request、Expo registry、已展示通知、六类通知设备投影、对账任务/水位、environment generation 和 notification dataset epoch 都不是提醒业务事实；
- **notification realm** 恒定指 `(installationId, installationIncarnationId, notificationDatasetEpoch)`；current/same/target realm 要求三项逐字段相同，dataset generation、revision、environment generation 或 pair digest 都不能替代任一项。`installationIncarnationId` 是 TD-006 EntityId，只能判定缺失、非法或不匹配，不存在“future incarnation”比较；
- `notificationDatasetEpoch` 来自 TD-010 当前 active `DatasetControlRecord`。每个新 incarnation 初始化为 `0`；普通编辑、schema/cipher migration 和 `activation_abort` 保持 incarnation/epoch；只有提交成功的整体 restore/manual rollback 在保持接收设备 Installation/incarnation 时对 epoch checked `+1`。DATA-091 clear 保留 Installation ID 但轮换 incarnation，reinstall 同时新建 Installation/incarnation，两者的新 epoch 都为 `0`。epoch 不从 portable backup 恢复，也不是 `environmentGeneration`；后者只是平台状态，generation 只是 lease 活动数据库，revision 只是 realm 内输入并发序，都不能代替 realm；
- 每个 notification realm 恰有一个 device-only `NotificationDatasetState`，它唯一拥有 `NotificationInputRevision`、`revisionState=active|exhausted`、registered pair set/version/digest 和 `forcePresentationRefreshRevision?`；pair state、run、Decision 与 task 只能镜像这些值，不得各自成为 revision 或 marker 真值；
- `NotificationInputRevision` 是 owner 内从 `0` 开始的 branded TD-006 LongCounter。任何候选、内容、排序、预算、设置、权限、channel、时区/tzdb、capability、pair registry 或任一 pair 专属合同输入变化，都必须在拥有输入与 owner 的一个短事务中 checked `+1` **一次**，更新 pair set/适用 receiving baseline，删除不再 registered 的 current pair state（历史 run/delivery 独立保留），把精确全部 registered pair 的 ReconciliationState 创建或置 pending、镜像同 revision/digest、清 `publishedRunId/scheduledThrough/inputFingerprint/failureCode`，再 upsert 唯一 `(installationId, installationIncarnationId, epoch, revision, pairSetDigest)` coordinator task；即使只影响一个 transport 也全 fan-out，不得先改变输入后延迟隐藏旧 Decision；
- 业务/设置事务发现 owner revision 已为 TD-006 上限时拒绝整条命令。OS 权限、时区、capability/environment 或签名 pair registry 变化是已经发生、不能拒绝的外部事实；其失效事务在上限时必须原子把 owner 置 `revisionState=exhausted`、保留最大 revision、记录最新 runtime pair set/digest，删除不再 registered 的 current pair state，把该精确集合的全部 pair state 创建或置 pending，清 `publishedRunId/scheduledThrough/inputFingerprint/failureCode`，保存新 `environmentGeneration`；若规范化 capability snapshot 可得，还保存各 pair 新的非空 `capabilityFingerprint/budget`，不可得时只把 last-observed fingerprint 作为非当前诊断值。随后写 `notification_revision_exhausted` 耐久维护任务，并停止全部新 platform write/current publish，直到受审迁移或新 notification realm 重置；绝不回绕、清空 capability fingerprint 或继续展示旧成功；
- 只有 TD-004 bootstrap/presence anchor 与 active control 的 Installation/incarnation 相同、control `phase=active` 且 Repository 已开放时才可签发绑定 Installation/incarnation/generation/epoch 的 notification `DatasetReadLease`；`validating`、integrity-blocked 或 Repository 未开放期间停止调度、动作入箱和命令执行；
- epoch 和 input revision 按 TD-006 long counter 在 JS/native/SQLite/payload 边界使用无前导零的规范非负十进制字符串，incarnation 使用 TD-006 EntityId 规范 ASCII，绝不把 counter 转为 JavaScript `number`；任一值缺失、非法或溢出都安全失败，counter 不回绕；
- TD-007 负责时区、重复与 `scheduledFor` 计算；本适配器只接受一个已经解析的 TD-006 `Instant`；
- 系统事件只能标记环境变脏，不能在 receiver/observer 中自行推导发生项、读取标题或修改业务状态；
- Presentation 不能直接调用 Expo Notifications；所有查询、调度、取消、动作响应都经过 application port；
- P1 远程推送和本地调度共享逻辑 ReminderInstance/deduplicationKey，但各自拥有 delivery；远程适配不得复用本 ADR 的平台登记表作为服务端事实。

registered pair 集合的规范成员恰为：

```text
{"mode":<active|retiring>,"platform":<ios|android>,"transport":<local_notification|remote_push>}
```

尖括号是 schema 记法，不进入实际字节；每个实际字段值必须恰为其中一个 ASCII 枚举，字段外不得出现扩展键。

集合只含当前 installation incarnation 的实际 OS platform；P0 恰有该平台的 active `local_notification`，P1 仅在远程合同启用时增加同平台 active `remote_push`，绝不构造 iOS×Android 笛卡尔积。transport 被禁用但 native adapter 仍报告无内容 `hasManagedEvidence=true` 时，该 pair 以 retiring 模式保留并只运行空 desired 清理；确认无 managed evidence 后，下一次全局 revision 才能删除。权限、channel 或临时平台失败不改变成员资格。

`registeredPairSetVersion=1`。先按 `(UTF8(transport), UTF8(platform), UTF8(mode))` 字节字典序排列，拒绝未知枚举、重复 `(transport,platform)`、非当前 platform 或空集合，再计算：

```text
registeredPairSetDigest = H(
  "life-book/notification-registered-pairs/v1",
  {"pairs":[...sorted exact objects...],"registeredPairSetVersion":1}
)
```

`H` 由第 8.1 节定义；digest、完整排序集合和 version 必须共同持久化在 owner，task/run/pair state 使用同一 digest。签名 build 的 pair registry 决定允许的 transport/platform/mode 与 digest 算法，runtime set 由当前 OS、transport enablement 和无内容 managed-evidence 摘要派生。

### 2. 平台端口

端口的语义接口固定为：

```ts
interface NotificationOperationRealm {
  installationId: InstallationId;
  installationIncarnationId: EntityId;
  notificationDatasetEpoch: LongCounter;
}

interface NotificationPlatformEnvelope<T> {
  operationRealm: NotificationOperationRealm;
  value: T;
}

interface NotificationPlatformPort {
  getCapabilitySnapshot(query: NotificationPlatformEnvelope<CapabilitySnapshotQuery>):
    Promise<NotificationPlatformEnvelope<NotificationCapabilitySnapshot>>;
  ensureChannelsAndCategories(command: NotificationPlatformEnvelope<EnsurePresentationContractsCommand>):
    Promise<NotificationPlatformEnvelope<EnsurePresentationContractsReceipt>>;
  listManagedPending(query: NotificationPlatformEnvelope<ListManagedPendingQuery>):
    Promise<NotificationPlatformEnvelope<ManagedPendingSnapshot>>;
  listManagedDelivered(query: NotificationPlatformEnvelope<ListManagedDeliveredQuery>):
    Promise<NotificationPlatformEnvelope<ManagedDeliveredSnapshot>>;
  upsertOneShot(command: NotificationPlatformEnvelope<OneShotNotificationRequest>):
    Promise<NotificationPlatformEnvelope<SubmitReceipt>>;
  cancelPending(command: NotificationPlatformEnvelope<CancelPendingCommand>):
    Promise<NotificationPlatformEnvelope<CancelReceipt>>;
  dismissDelivered(command: NotificationPlatformEnvelope<DismissDeliveredCommand>):
    Promise<NotificationPlatformEnvelope<DismissReceipt>>;
  openSystemSettings(command: NotificationPlatformEnvelope<OpenNotificationSettingsCommand>):
    Promise<NotificationPlatformEnvelope<OpenNotificationSettingsReceipt>>;
  requestPermission(command: NotificationPlatformEnvelope<PermissionRequest>):
    Promise<NotificationPlatformEnvelope<PermissionResult>>;
}
```

实现可以扩展 DTO，但不得削弱以下约束：

- `requestPermission` 只能由明确用户动作调用，对账、启动、后台任务和 receiver 不得弹系统权限；
- `upsertOneShot` 是按项目 request ID 达到“至多一个当前请求”的幂等意图，不暴露 Expo 自动生成 ID；
- `listManagedPending` 返回 `source = ios_pending_queue | android_adapter_registry`，调用者不得把两者解释为同等证据；
- 每个 platform-port 调用/返回都使用显式 `NotificationPlatformEnvelope`；adapter 必须逐字段原样回显调用方提供的 `operationRealm=(installationId, installationIncarnationId, notificationDatasetEpoch)`，application 在接收任何结果前再次比对 active realm，不匹配结果整体丢弃且不得落业务状态。该 realm 只表示发起、守卫和接收本次操作的 current realm，不声称平台 artifact 属于它；`CancelPendingCommand`、`DismissDeliveredCommand` 和相应 receipt 还必须显式携带 target request ID。`listManagedPending/listManagedDelivered` 的每个 artifact 另外只返回 request ID、request/payload contract version、`artifactIdentityStatus=parsed|legacy|invalid`、可空 `artifactIncarnationId?`/`artifactEpoch?`、fingerprint 和必要非内容 platform metadata，不把原始 title/body/payload 返回 application，也不为旧平台项伪造历史 Installation/incarnation/epoch。application 从 current `operationRealm` 重算 request ID；`OneShotNotificationRequest` 和持久 submit/cancel/dismiss receipt 都绑定 operation realm、target request ID 与 artifact parse status/可得 identity。artifact identity 缺失/非法/不匹配的 legacy/stale 项只能枚举、定向清理并在确认前占用预算，不能成为 current evidence；
- `cancelPending` 对不存在的 ID 成功且幂等；取消后仍执行登记表复核，必要时产生可重试失败；
- `dismissDelivered` 只尽力清除通知中心副本，不改变 ReminderInstance 状态；
- 原生/Expo 错误先映射为稳定、无内容的项目错误码，未知原始消息只进入本机受限调试环，不进入普通日志或诊断包；
- 端口不得接收任意 SQL、领域对象、附件、正文或认证令牌。

### 3. 能力快照

能力不是一个布尔值。每次前台对账以及提交前，为本轮每个 registered pair 取得固定快照：

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
- Android `local_notification` 的 posting 来自通知运行时权限，并结合用户提醒 channel 是否可用；更低版本仍需读取 App/channel 状态，不能按系统版本假设 allowed；
- Android `local_notification` 的 `precision` 每轮通过 `canScheduleExactAlarms()` 查询；iOS local 为 `not_applicable`，不能把它显示成“保证精确”。`remote_push` 只有 TD-022 注册其完整能力映射后才能进入 runtime pair set，precision 固定为 `not_applicable`；
- Focus、摘要、勿扰、厂商省电等无法完整获知时使用最保守可说明状态，不伪造 normal；
- 每个 pair capability snapshot 带 `observedAt`、OS/app/adapter version、共享 `environmentGeneration` 和对 transport/posting/presentation/precision/budget/adapter 能力计算的无内容 `capabilityFingerprint`，但不持久化用户内容；不新建含义重叠的 `capabilityGeneration`；
- App 首次观察到任一 pair 的 `environmentGeneration` 或 `capabilityFingerprint` 变化时，以第 1 节 owner 事务推进 NotificationInputRevision 一次并隐藏全部 pair 旧 published run。一次 pair runner 使用固定快照；执行期间任一 guard 变化时放弃其最终发布并保留 coordinator task。

`capabilityFingerprint = H("life-book/notification-capability/v1", projection)`，其中 `H` 见第 8.1 节，projection 恰含 `capabilityContractVersion=1`、`transport`、`platform`、`posting`、`presentation`、`precision`、`totalBudget`、`ordinaryCandidateLimit`、`reservedSlotCount`、`environmentGeneration`、`adapterContractVersion`、`presentationRegistryVersion`。generation 和三个数量均用无前导零十进制字符串，object 不得增删 key；`observedAt` 仅为诊断，不进入 fingerprint。

用户界面把三个维度分别解释为“能否发布”“可能怎样呈现”“Android 时间精度”，不能折叠为绿色的“通知正常”。

对账执行分支固定为：

| posting / presentation | 平台动作 | 领域与界面结果 |
| --- | --- | --- |
| `not_determined` | 不提交；定向取消可能由恢复/旧版本留下的 managed 请求；后台不请求权限。 | 计划保持 planned，Decision=`permission_blocked`，主状态统一显示“等待通知权限”，详情说明“尚未允许”；只有用户正在保存真实提醒并继续说明流程时才可请求。 |
| `denied` | 不提交；定向取消当前 managed 请求。 | 计划保持 planned，Decision=`permission_blocked`，主状态统一显示“等待通知权限”，详情提供系统设置入口；权限变化后只重挂未来目标。 |
| `allowed/provisional` + `channel_blocked` | Android 不提交并定向取消该 channel 的 managed 请求。 | 计划保持 planned，Decision=`channel_blocked`，显示“提醒渠道已关闭”和设置入口。 |
| `provisional` + 其他状态 | iOS 可提交普通一次性请求。 | 明确标为非打扰/可能静默呈现；P0 不主动请求 provisional。 |
| `allowed` + `normal/noninterruptive/summary/system_restricted/unknown` | 按 precision 分支提交；系统控制的呈现状态不改时间。 | 保存实际能力说明；`unknown` 不显示正常保证。 |

取消只作用于项目 managed ID，不删除 ReminderInstance。`precision = approximate` 使用近似 adapter；`exact` 使用 exact adapter；本地调度中的 `not_applicable` 只适用于 iOS，remote pair 则按 TD-022 固定为 `not_applicable`。能力组合非法或未知枚举时停止新增提交、保留计划并进入可诊断状态，不猜测更宽松能力。

### 4. 稳定请求身份和指纹

平台 request ID 只由非内容身份确定：

```text
requestId = "lbr3:" + lowercaseHex(
  SHA-256(UTF8(
    "life-book/reminder-request/v3\u0000" +
    installationId + "\u0000" +
    installationIncarnationId + "\u0000" +
    canonicalNotificationDatasetEpoch + "\u0000" +
    transport + "\u0000" +
    reminderInstanceId + "\u0000" +
    recipientSlot
  ))
)
```

- `installationId` 是 this-device-only 安装身份，恢复到另一设备后重新生成；`installationIncarnationId` 是当前 TD-004 bootstrap/control realm 的规范 EntityId，DATA-091 clear 后即使 Installation ID 与 epoch `0` 重复也必须产生不同 request ID；
- `canonicalNotificationDatasetEpoch` 是当前 active control 的 TD-006 long-counter 字符串；同一实例跨 restore/manual rollback 必须产生不同 ID。旧 `lbr1:`/`lbr2:` 和缺失 incarnation 的请求不得推定为任何 current realm 的可执行请求，只能定向清理；
- `transport` 是 canonical `local_notification | remote_push` ASCII 枚举；显式进入身份，不能只靠 recipientSlot 命名约定隔离本地与远程请求；
- `recipientSlot` 必须匹配 `[a-z0-9][a-z0-9._:-]{0,63}`；P0 固定为 `local`，P1 使用稳定 subscription/device delivery 槽位，不能放邮箱、设备名、家庭名等可识别内容；
- 当前 writer 只能生成 `requestIdentityContractVersion=3` 与 `lbr3:`；prefix、domain label、有序输入列表和版本必须整体升级，不得在 v3 下静默改字节。
- 普通编辑保持 ReminderInstance 和 request ID，只替换时间/内容；snooze 创建新 ReminderInstance，因此有新 ID；
- ID 计算使用固定 UTF-8、NUL 分隔和完整 256-bit digest；不得用 Java/JavaScript 非密码学 `hashCode`；
- 平台返回的内部 ID 若不同，只存为 adapter metadata，不能成为跨重建身份。

每个期望请求按第 8.1 节的 `H` 计算下列规范摘要：

```text
renderedContentDigest = H(
  "life-book/notification-rendered-content/v1",
  {"body": <string-or-null>, "title": <string-or-null>}
)

payloadDigest = H(
  "life-book/notification-payload/v3",
  <the exact REM-071 payload JSON object>
)

scheduleFingerprint = H(
  "life-book/notification-schedule/v2",
  {
    "actionContractVersion": ...,
    "adapterContractVersion": ...,
    "categoryContractId": ...,
    "categoryContractVersion": ...,
    "contentPolicyVersion": ...,
    "effectivePrivacyMode": ...,
    "interruptionPolicy": ...,
    "installationIncarnationId": ...,
    "notificationDatasetEpoch": ...,
    "payloadContractVersion": ...,
    "payloadDigest": ...,
    "platform": ...,
    "platformChannelId": <string-or-null>,
    "platformRequestId": ...,
    "presentationRegistryVersion": ...,
    "recipientSlot": ...,
    "renderedContentDigest": ...,
    "requestIdentityContractVersion": ...,
    "requestedPrecision": ...,
    "scheduleFingerprintContractVersion": 2,
    "soundPolicy": ...,
    "targetInstant": ...,
    "transport": ...
  }
)

baseRenderedContentDigest = H(
  "life-book/notification-privacy-independent-content/v1",
  {"body": <full-mode-policy-body-or-null>,
   "title": <full-mode-policy-title-or-null>}
)

baseBusinessPayloadDigest = H(
  "life-book/notification-privacy-independent-payload/v2",
  {
    "deduplicationKeyHash": ...,
    "installationIncarnationId": ...,
    "notificationDatasetEpoch": ...,
    "payloadContractVersion": ...,
    "reminderInstanceId": ...,
    "requestIdentityContractVersion": ...,
    "sourceId": <current-authorized-business-source-id-or-null>,
    "sourceType": <current-business-source-type>,
    "spaceId": <current-authorized-space-id-or-null>
  }
)

privacyIndependentFingerprint = H(
  "life-book/notification-privacy-independent/v2",
  {
    "adapterContractVersion": ...,
    "baseBusinessPayloadDigest": ...,
    "baseRenderedContentDigest": ...,
    "contentPolicyVersion": ...,
    "interruptionPolicy": ...,
    "installationIncarnationId": ...,
    "notificationDatasetEpoch": ...,
    "payloadContractVersion": ...,
    "platform": ...,
    "platformChannelId": <string-or-null>,
    "platformRequestId": ...,
    "presentationRegistryVersion": ...,
    "privacyIndependentFingerprintContractVersion": 2,
    "recipientSlot": ...,
    "requestIdentityContractVersion": ...,
    "requestedPrecision": ...,
    "soundPolicy": ...,
    "sourceActionContractVersion": ...,
    "sourceCategoryContractId": ...,
    "sourceCategoryContractVersion": ...,
    "targetInstant": ...,
    "transport": ...
  }
)
```

上述每个 object 的 key 集合恰好如此，不得省略或添加实现自选 key；iOS 无 channel 时 `platformChannelId=null`，其他枚举/版本必须来自受控 registry。schedule fingerprint 的 privacy/category/action/payload 值均取本次实际提交的 effective contract，不能在纯隐私放宽时偷换为更宽松值。base content 使用同一内容策略在 `full` 模式下生成的当前授权文案，不代表允许向平台展示；base business payload 使用隐私映射前的当前业务来源，不使用 `hidden` 哨兵。二者只在内存计算摘要，原值不持久化。任一普通 schedule 字段改变即 replace；标题/正文只在本机短暂参与 digest，原文和所有摘要都不得进入日志、诊断、同步、备份或导出，title 本身也不得出现在 task key 或 request ID。

隐私比较不能先要求 schedule fingerprint 相等。对 current desired request，`privacyComparisonCandidate` 是同一完整投递身份（不含 `attemptSequence`）的 latest attempt；它必须 `status=accepted`，且 current realm、`lbr3` request identity/payload v3、platformRequestId、requestedPrecision、environmentGeneration、capabilityFingerprint 和 adapterContractVersion 全匹配。初筛**刻意不比较 scheduleFingerprint**；latest requested/rejected/missing/cancelled、身份/guard 不匹配、跨 incarnation 或缺行都表示 candidate 不存在。

隐私严格度固定为 `hidden > title_only > full`，effective contract 按以下顺序唯一决定：

1. 先计算 current desired 的 base content/business payload 和 `privacyIndependentFingerprint`，并按上一段选 candidate；
2. desired 比 candidate 的实际 effective privacy 更严格，或 candidate 不存在、base 指纹不同、owner 有 force marker 时，采用 current desired privacy/category/action/payload 映射；
3. 只有 desired 严格更宽松、base 指纹相同且 owner 无 marker 时，才沿用 candidate 的 `effectivePrivacyMode/category/action` 作为 `effectiveScheduledPresentationContract`，不向平台扩大内容或动作；
4. 用选定 effective contract 重算 rendered payload、schedule fingerprint，再按普通 current-evidence 谓词比较。只有重算 fingerprint 相等才可跳过提交；不得先用“matching accepted”寻找 candidate 形成循环。

用户明确选择“更新已安排通知”时，同一 owner 事务 checked 推进 NotificationInputRevision，并把 `forcePresentationRefreshRevision=<new revision>` 写入 `NotificationDatasetState`；coordinator task 只镜像该值用于唤醒，不是 marker 真值。后续 input revision 必须继承原 marker；平台调用、receipt、进程终止、单 pair publish 或 guard 失败都不能清除。只有 global finalize 验证 current realm 的精确 registered pair 全集均为同 current revision/digest 的 succeeded，且 marker 要求的全部适用 replace/cancel 已确认时，才在同一事务清 marker 并完成 coordinator；permission/channel/capacity/unsupported 候选必须先确认其适用旧请求已取消，任一 pair 平台/cleanup error 只能 degraded 并保留 marker/task。旧 open-only 只是仍授权目标的严格导航子集，永不恢复业务 mutating action。

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

- `categoryContractId` 是 REM-060 登记的稳定逻辑 ID，`categoryContractVersion` 是正整数语义版本；二者共同标识 category 合同，不把 `.vN` 拼接约定泄漏为领域身份；
- `NotificationPresentationContractRegistry` 分别登记不可变 channel 合同与 category 合同；其中 `CategoryContractRegistration` 至少携带上述二元组、`actionContractVersion`、受控 `actionId` allowlist 与 adapter contract version。adapter 可把二元组映射为平台原生 ID，但必须通过受控登记表无歧义反查；
- `ensureChannelsAndCategories` 在接收响应和首次调度前幂等注册全部当前及仍可能回调的上一兼容版本；旧版本至少保留到其最后 pending/delivered 生命周期和发布兼容窗口结束；
- 非敏感通知可以展示 REM-060 的动作，但所有 mutating action 都配置为打开前台；
- payload 交叉合同必须在 adapter 进入 Lease A 前验证：`sourceType=hidden` 当且仅当 `categoryContractId=open_only`，该组合必须同时使用 `categoryContractVersion=1`、`actionContractVersion=1`、`sourceId=null`、无 `spaceId`，且 response 只允许 `actionId=open`；
- 敏感通知固定使用上述 hidden/open-only 组合，不携带来源类别，不出现完成、跳过、知道了、稍后或加入采购清单；非敏感通知也只能在 effective contract 选择更严格 open-only 时使用该组合；
- Android 当前忽略 authentication-required/destructive flags，因此两平台共同安全基线不能依赖这些 flag。iOS 可额外增加保护，但不能绕过 App 内校验。

### 7. 通知内容、平台副本与备份

可见内容由 `NotificationContentPolicy` 在调度时生成，只允许 REM-070 的三种模式；payload contract v3 严格限制为 REM-071 的命名字段 allowlist，必填 `payloadContractVersion=3`、`requestIdentityContractVersion=3`、TD-006 EntityId 规范的 `installationIncarnationId`、规范十进制 `notificationDatasetEpoch`、`reminderInstanceId`、受控 `sourceType`/可空 `sourceId`、`categoryContractId`、`categoryContractVersion`、`actionContractVersion` 和 `deduplicationKeyHash`，P2 才可带不透明 `spaceId`。`deduplicationKeyHash = H("life-book/reminder-deduplication-key/v1", {"deduplicationKey": <exact stored canonical string>})`，必须保留完整 SHA-256 并编码为 64 个小写 ASCII hex 字符，不得截断。不把 `installationId` 显式写入系统 payload；parser 从当前受认证 bootstrap/control 取得它并重算 request ID。`OneShotNotificationRequest` 必须携带解析后的合同版本、incarnation 和 epoch；adapter 接口对 title/body 设置长度上限并按 Unicode grapheme 安全截断，不从任意对象序列化 payload。缺失、非法或不匹配的 incarnation，以及缺失、非法、溢出或不匹配的 epoch，一律作为 legacy/stale，不尝试用 current 值补全或修复。

hidden payload 只能是第 6.3 节的完整组合；解锁后只用 `reminderInstanceId` 在 fresh Lease B 下反查当前授权目标，`sourceType=hidden` 是隐私哨兵而不是业务来源类型。不完整、半隐藏或版本不匹配的组合只能无目标安全清理。

当前 Expo Android scheduler 为重启恢复把完整 `NotificationRequest` 序列化到普通 App 私有 `SharedPreferences`。因此：

- 该文件是受控平台副本，不是持久化模型；只保存已经明确允许进入系统通知的最小快照；
- 敏感记录始终使用通用隐藏文案；附件、正文、清单内容、数量、认证信息和文件路径永不进入请求；
- 精确识别该 dependency 版本生成的 preferences 文件并通过 Android data-extraction/backup rules 排除 Auto Backup 和 device-to-device transfer；构建测试必须解包 APK/AAB 校验规则；
- 取消、归档、删除、永久删除、成员失权和隐私变严格时，先取消 pending，再 dismiss delivered；只有第 8 节最终 guard-CAS 成功后才写入新的成功水位；
- 普通内容编辑使用同 ID replace；隐私收紧或删除采用 cancel-first。mandatory pending cancel 失败时仍继续尝试同 ID upsert 更严格快照，但本轮必须 degraded、保留清理任务且不发布成功水位；delivered dismiss 是 best effort，失败同样进入受控重试和 degraded；
- 只有当前 effective presentation contract 已撤销旧 category/action（例如转 hidden/open-only）时，旧副本清理前到达的 response 才在 fresh Lease B 下消费为 `business_noop`；仅 `full→title_only` 且 category/action 不变时，动作仍按当前授权、来源和业务状态决定；
- adapter registry 不复制到诊断包、日志、崩溃事件或业务备份；DATA-091 clear 在耐久 clear journal 与 TD-004 `phase=clearing` 下先尽力 cancel/dismiss，再销毁旧 key/data 并轮换 incarnation。清理失败不改变安全边界；新 incarnation 使旧 callback 即使同 Installation ID/业务 ID/epoch `0` 也永久无目标；
- 每次 Expo 升级必须检查 Android/iOS 原生源码、存储文件名/格式、备份属性、receiver、触发选择和取消语义；不依赖未声明的内部格式进行业务读取；
- 安全评审必须接受或替代 Android 私有明文 request 副本后才能公开发布。若目标威胁模型不接受，替代为项目维护的最小原生 scheduler/store，并以新 ADR 记录。

iOS/Android 系统本身保存通知请求是系统功能的必要副本，无法由 SQLCipher 覆盖。产品通过内容模式、系统权限、应用锁入口和及时清理降低暴露，不声称系统通知内容由应用数据库加密保护。

### 8. 对账算法

每个 notification realm 同时至多一个 coordinator lease，每个 registered pair 同时至多一个 runner lease；实现可以串行运行 pairs。coordinator task 身份固定为 `(installationId, installationIncarnationId, epoch, notificationInputRevision, registeredPairSetDigest)`，reason set 只作合并解释，不参与身份，也不因高频编辑无限排队。输入事务必须先按第 1 节推进 owner revision、全 pair 失效并入队；原生能力变化在 App 首次接收后的短事务做同一 fan-out。coordinator/runner 的 task、lease、checkpoint、receipt、run、state 和 watermark 都携带 realm，并按以下顺序执行：

```text
1. acquire coordinator lease and TD-010 DatasetReadLease bound to active
   installation+incarnation+generation+epoch; verify TD-004 bootstrap/presence and
   DatasetControl match, then read NotificationDatasetState and require revisionState=active
2. require task realm/revision/pairSetDigest to equal owner; enumerate the exact persisted
   registered pair set, rejecting missing/extra/duplicate state rows
3. skip a pair already guarded succeeded for this exact owner revision/digest; for every other
   pair, acquire its runner lease, capture fixed owner revision/digest, pair mode,
   transport/platform, now, timezone/tzdb, pair capability/environment and all contracts,
   compute inputFingerprint v2, and CAS pending/degraded/recovered-running to running while
   clearing the current pointer/watermarks/inputFingerprint/failureCode
4. list this pair's managed pending/registry and delivered; classify lbr1/lbr2,
   missing/invalid/mismatched incarnation, or missing/invalid/mismatched epoch as stale;
   never infer a current incarnation for a legacy item
5. cancel stale pending and dismiss stale delivered before adding current requests
6. for active mode, read plans/sources and compute desired instances for [now, now+30 days];
   for retiring mode, desired is the empty set
7. filter past, terminal, paused, cancelled, invalid and unauthorized sources
8. derive recipientSlot, requestId, base content/business payload digests and
   privacyIndependentFingerprint for every candidate; create a building SchedulingRun bound
   to owner realm/revision/digest with expectedDecisionCount
9. apply the capability table, budget and REM-092 stable selection, counting stale entries
   whose cleanup is unconfirmed as consuming capacity
10. read the latest same-realm, v3-contract attempt for every request ID; select any
    privacyComparisonCandidate, decide the effective presentation contract, then compute the
    rendered payload and final scheduleFingerprint before ordinary fingerprint matching
11. attempt mandatory cancel-first for invalid, unauthorized and privacy-tightening
    current-realm requests; checkpoint every outcome
12. upsert selected requests without sufficient current success evidence; even if a
    privacy-tightening cancel failed, still attempt stricter same-ID upsert; environment
    rebuild or applicable force marker re-arms every selected request
13. cancel remaining undesired managed requests and dismiss obsolete delivered copies;
    never global cancel-all in normal reconcile
14. persist real receipts/checkpoints; after all applicable outcomes are known, write exactly
    one final Decision per candidate; a retiring pair can only succeed after empty cleanup is confirmed
15. verify exact row count, one Decision per candidate and decisionSetHash; atomically seal
    the immutable run
16. re-read lease, active Installation/incarnation/generation/epoch, owner active
    realm/revision/digest, pair membership,
    capability/environment and every fingerprint guard; changed guards retain real receipts
    only as non-current evidence, discard the run, CAS a still-matching running row back to
    pending, and keep coordinator queued; a newer owner transaction/state is never overwritten
17. otherwise use one same-realm pair guard-CAS to change sealed→published and set that
    ReconciliationState.publishedRunId; error-free completion publishes pair succeeded and
    lastSucceededAt, plus scheduledThrough only for positive coverage; mandatory platform/
    cleanup failure publishes pair degraded with a complete Decision run and no success watermark
18. release pair runner; after all available runners, global finalize re-reads same-realm
    owner/task and the exact state set. Only when every registered pair is same realm/revision/digest succeeded and
    every force-required replace/cancel is confirmed may it clear owner marker and complete task;
    degraded/pending/running/missing/extra state keeps the coordinator durable
19. release coordinator/DatasetReadLease; any guard mismatch remains queued for a fresh run
```

平台调用永远不放在 SQLite transaction 内。每个外部动作前后写短事务 checkpoint；进程在任意一步终止后可以重复执行。中间 receipt 可以保存为某次尝试的历史证据，但只有第 17 步 pair guard-CAS 能发布该 pair pointer/state，且只有 succeeded 可发布 `scheduledThrough/lastSucceededAt`。pair publish 不完成 coordinator、不清 force marker。building、未被指向的 sealed、discarded、旧 realm/revision/pair-set digest 行永不可见，可在安全保留期后回收。

`state=running` 必须有同 realm/revision/digest、boot/session-fenced 的耐久 runner lease。App 启动或 coordinator 接管时，lease 缺失、session 不匹配或单调期限已过的 running row 以短事务退回 pending 并继续；不得用墙钟回拨延长所有权，也不得因孤儿 running 永久卡住 coordinator。当前 succeeded pair 在其他 pair 重试时可以保留，不重复平台写，除非 force/环境 guard 要求重挂。

TD-010 activation exclusive gate 只等待已签发的短 parser/action/coordinator/runner lease 和已进入事务的提交/回滚；parser 入箱后即释放 Lease A，应用锁或用户等待不占 gate。gate 取得后不再签发新 lease；尚未取得 Lease B 的 action 保持 inbox pending 并 defer，不误标 stale/no-op。lease 失效后所有 runner 立即停止新 platform write/current publish。task/checkpoint/platform receipt/watermark/run/state 都绑定 realm/revision/pair-set digest，旧 incarnation 的任务不能把新编辑或新数据集标记为已安排。

#### 8.1 输入与 Decision 集合的规范哈希

本 ADR 中 `JCS` 表示 RFC 8785 JSON Canonicalization Scheme 的 UTF-8 bytes；`H(label, value) = lowercaseHex(SHA-256(UTF8(label) || 0x00 || JCS(value)))`。所有 UUID、Instant、LongCounter、枚举和 hash 在进入投影前先按 TD-006 规范化，LongCounter/environment generation 用无前导零十进制字符串；hash 保留完整 256-bit SHA-256，并编码为恰好 64 个小写 ASCII 十六进制字符。拒绝非规范或 Unicode 非法值。

`inputFingerprint = H("life-book/notification-reconcile-input/v2", inputProjection)`，`inputProjection` 是恰含以下 key 的 JSON object（key 由 JCS 排序）：

```text
inputContractVersion = 2
installationId
installationIncarnationId
datasetGenerationId
notificationDatasetEpoch
notificationInputRevision
registeredPairSetVersion = 1
registeredPairSetDigest
pairMode
forcePresentationRefreshRevision // canonical LongCounter string or explicit null
transport
platform
fixedNow
timeZoneId
tzdbVersion
recurrenceEngineVersion
environmentGeneration
capabilityFingerprint
budgetProfileVersion
adapterContractVersion
presentationRegistryVersion
contentPolicyVersion
payloadContractVersion
requestIdentityContractVersion
scheduleFingerprintContractVersion = 2
privacyIndependentFingerprintContractVersion = 2
decisionProjectionVersion = 2
```

不允许实现自选/省略 key；新 guard 需要进入 hash 时必须增加 `inputContractVersion`。`registeredPairSetDigest` 必须由第 1 节精确集合重算，`pairMode` 必须是该 digest 中当前 transport/platform 的实际 mode。业务/设置变化由 NotificationDatasetState 的单一权威 `notificationInputRevision` 防并发，不另造未定义的全局时钟或 pair-local revision；sticky refresh marker 不存在时必须写显式 JSON `null`，存在时写 owner 中最初 target revision，即使 task 合并到后续 input revision 也不改写该身份。`fixedNow` 是本轮计算输入，最终 CAS 不要求墙钟仍等于该值。

每个 run 的 Decision 先按 `(UTF8(recipientSlot), canonical reminderInstanceId ASCII)` 升序排列；两者相同即为重复候选并拒绝 seal。每行投影恰含：

```text
installationId
installationIncarnationId
notificationDatasetEpoch
notificationInputRevision
transport
platform
recipientSlot
reminderInstanceId
reconciliationRunId
platformRequestId          // string or explicit null
scheduleFingerprint
decision
reasonCode                 // controlled string or explicit null
requestedPrecision
environmentGeneration
inputFingerprint
computedAt
```

`decisionSetHash = H("life-book/notification-decision-set/v2", {"decisionProjectionVersion":2,"decisions":[...]})`。对象不得带额外 key，可空值必须使用显式 JSON `null`，不得省略。seal 事务重新从持久行构造投影，同时验证 `expectedDecisionCount`、候选一对一和 hash；sealed 后 run header 与 Decision 行不可更新/删除，只能由发布事务改 phase。黄金向量必须覆盖 0/1/多行、null 字段、非 ASCII/invalid recipientSlot 拒绝，以及 Swift/Kotlin/TypeScript 字节一致性。

#### 8.2 差分和强制重挂

- iOS `listManagedPending` 返回本 App 当前 pending，可按 request ID/fingerprint adapter metadata 做差；
- Android 返回 Expo registry，只能形成独立 `android_registry_only` snapshot/observation，不能单独创建或改写任何 `accepted` attempt，也不能证明 AlarmManager 仍有闹钟；`accepted` 只来自同次 `upsertOneShot` 正常返回的 `adapter_receipt`；
- 当前 Expo Android 路径可能先写 registry、再调用 AlarmManager。Android 只有同时满足“registry 中 request ID/schedule fingerprint/incarnation/epoch 与 current realm 匹配”和“同一完整投递身份的 latest attempt 是同 realm、schedule fingerprint、precision、`environmentGeneration`、`capabilityFingerprint`、adapter contract 的 `accepted` 成功回执”时才允许跳过 upsert；单独 registry 条目、缺 incarnation 的旧版条目或第 4 节尚未重算的 privacy candidate 永远不产生 ordinary current evidence；
- 每次外部提交前先以递增 TD-006 LongCounter `attemptSequence` 写 `requested` checkpoint，AlarmManager/adapter 正常返回后才写 `accepted`。最新 attempt 为 `requested`、`rejected`、`missing`、`cancelled`，或没有对应成功回执时，一律同 ID 重挂；不能回退采用更早的 accepted；
- Android 在 boot、App/Expo 升级、恢复检测、time/timezone change、`environmentGeneration/capabilityFingerprint` 变化后，忽略 registry 的“存在”结论，对全部 selected desired 执行同 ID re-arm；owner force marker 适用时所有 pair runner 同样不得用旧 accepted 跳过所需 replace；
- exact 权限撤销可能直接停止 App、删除 exact alarms 且没有可依赖的撤销回调。下一次系统允许 App 运行时重新查询 capability，转 approximate 并强制重挂；不得承诺撤销瞬间自动恢复；
- exact 权限授予广播只标记 generation；receiver 不直接读取数据库或安排内容；
- schedule 成功而 accepted 回执写入前崩溃时，最新 attempt 仍为 requested，下一轮同 ID 重试；registry 已写而 AlarmManager 失败/进程终止时也因缺少当前成功回执重试；
- 不在正常对账使用平台全量 cancel，因为这会扩大隐私清理失败和调度空窗；清除本机等明确不可逆流程除外。

#### 8.3 预算

总 pending product budget：

| 平台 | 总预算 | 普通候选上限 | snooze/近期编辑预留 |
| --- | ---: | ---: | ---: |
| iOS | 48 | 40 | 8 |
| Android | 200 | 180 | 20 |

- 48 是产品保守预算，不是对历史“64 条”说法的依赖，也不代表 Apple 公共 API 的永久保证；
- 普通候选按 REM-092 稳定排序占用普通上限；未用预留可以在本轮末尾借给普通候选，但必须在下轮能被高优先级动作抢占；
- snooze 或近期编辑可以逐个驱逐最远且优先级最低的普通请求，但总数永不超过平台预算；被驱逐实例保持 `planned`，并发布 `capacity_deferred` Decision；
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

通知 response 先经过 notification realm fence，通过后第一处持久化才是 TD-003 加密数据库中的 `NotificationActionInbox`：

```text
bounded response parse + size/version/ID grammar + category/action allowlist
→ validate hidden/open-only and all exact cross-field combinations
→ acquire short TD-010 parser lease bound to active Installation/incarnation/generation/epoch
→ payload incarnation+epoch == current bootstrap/control notification realm
→ revalidate current category registry interpretation
→ recompute transport-bound lbr3 request ID and constant-time compare
→ idempotently persist realm-bound encrypted ActionInbox and release parser lease
→ unlock without holding a DatasetReadLease
→ acquire a fresh action/navigation Lease B bound to the then-active notification realm + generation;
  if temporarily unavailable, keep inbox pending and defer
→ look up the same-realm inbox in the then-active Repository
  ├─ dataset changed / row absent / realm mismatch: targetless no-op; never open previous
  └─ row present: CAS claim pending/failed_retryable inbox with attempt + owner session + token
→ recheck current request identity
  ├─ changed within the same realm: persist terminal stale_noop without resolving a target
  └─ current: recheck authorization/category/action/source state
       ├─ no longer allowed: consume as business_noop
       └─ allowed: create fresh NavigationIntent or enter command transaction
```

缺失/非法/不匹配 incarnation、旧/缺失/非法/future epoch、`lbr1:`/`lbr2:` 或 payload/request ID 不一致不得进入业务 inbox、目标导航或 mutation；在 active Repository 下可以打开无目标首页，随后安全清除 Expo last response 并定向清理旧通知。若 control 为 `validating`、integrity-blocked 或 Repository 未开放，response 是瞬时 `deferred_unclassified`：只做 bounded parse 与平台要求的 completion acknowledgement，不入箱、不写 App 明文暂存、不清 last response/目标通知、不导航。notification subsystem 第一次重新进入 active 必须主动调用 Expo last-response API re-fetch 并从 bounded parser 重跑；平台无法保留 response 时只能结束到无目标首页并记录无内容诊断，不得记为业务 no-op。

```text
actionInboxId
responseId
platformRequestId
notificationDatasetEpoch
installationId + installationIncarnationId + transport
categoryContractId
categoryContractVersion
actionId + actionContractVersion
reminderInstanceId
payloadContractVersion
requestIdentityContractVersion
sourceType + sourceId?
spaceId?
receivedAt / processedAt?
processingState: pending | processing | applied | business_noop |
                 stale_noop | failed_retryable | failed_terminal
processingAttempt
claimOwnerSessionId? + claimToken? + claimedAt?
resultCode?
```

- `responseId` 是 transport 回调身份，`platformRequestId` 是项目生成的 `lbr3:` 请求身份，二者不得复用；平台内部 adapter ID 另作可空非内容 metadata；
- `categoryContractId + categoryContractVersion` 标识注册类别，`actionId` 标识用户实际选择，`actionContractVersion` 标识动作语义版本；四者缺一不得猜测；
- `actionInboxId`/唯一键为 NUL 分隔 canonical UTF-8 bytes 的 `lowercaseHex(SHA-256("life-book/notification-action/v3\u0000" + installationId + "\u0000" + installationIncarnationId + "\u0000" + epoch + "\u0000" + transport + "\u0000" + platformRequestId + "\u0000" + categoryContractId + "\u0000" + categoryContractVersion + "\u0000" + actionId + "\u0000" + actionContractVersion + "\u0000" + payloadContractVersion + "\u0000" + requestIdentityContractVersion))`；整数先转为无前导零 ASCII 十进制，受控文本必须符合各自 ASCII grammar 且不得含 NUL，digest 保留完整 256 bit 并编码为 64 个小写 hex 字符；同 realm+同 transport 的相同通知动作重放返回既有结果，跨 incarnation 或 transport 永不碰撞；
- adapter 先校验 payload 大小、版本、category/action allowlist、ID 格式和第 6.3 节交叉合同，未知输入只允许安全打开首页，不执行命令。Inbox 不保存 raw payload、title/body、解析后导航目标或任意原生 metadata；
- mutating action 必须打开 App；应用锁开启时先释放 parser lease 并进入无内容锁屏，绝不让人机等待占用 activation gate。解锁后无法取得 Lease B 时保持 pending/defer。dataset 已替换、current row 缺失或 realm 不匹配时直接 targetless no-op，不访问 previous、也不在 target 伪造 row；同 realm inbox 存在但 request identity 已变时才消费为终态 `stale_noop` 且不解析目标；identity current 但来源、space membership/tenure、category/action 或权限不再允许时消费为 `business_noop`；仅文案从 full 收紧为 title_only 而当前 category/action 仍允许，不得被误判为动作撤权；
- 当前状态有效且执行前 realm 再次匹配后才转换为 application command，命令自身继续使用领域幂等键；平台回调绝不能直接 update 表；
- action processor 必须在一个领域事务中消费 current-realm inbox、提交业务 mutation/幂等结果、推进适用的 NotificationInputRevision 并写后续 reconcile task；command commit 前 lease/realm 改变则整体中止，不留下已消费 inbox 或半个业务动作；
- response 持久化成功后清除 Expo last notification response，防止冷启动重复；若清除失败，inbox 唯一键吸收重放，但处理器仍必须在每次重放时重取 fresh Lease B；
- 来源已终态、删除、失权或动作过期时写安全 no-op 结果，并清理残留 pending/delivered；
- “打开”不持久化解析目标。router 只接受在 fresh Lease B 下重新生成、绑定 current realm 且以 `actionInboxId` 为幂等身份的 `NavigationIntent`，在紧邻导航前经 TD-004 深链锁和当前授权查询；router 接受后将 inbox 置 `applied`。在 router 接受后、数据库写 applied 前崩溃时，重放同 intent 由 router 返回既有接受结果，再收敛 inbox；`stale_noop` response 只能进入无目标首页；
- manual rollback 候选、clear/reinstall 前 realm 或旧数据库中的 inbox 即使存在，也因 realm 不匹配只能清理/no-op，不能重放或迁入新 Repository；portable backup 不包含 inbox；
- Lease A 取得后到 inbox commit 前 realm 改变必须使写入失败并转 `deferred_unclassified`/targetless；入箱后的 clear/restore 只能让该行留在旧 Repository，Lease B 不得跨 realm 查找或 claim。只有 incarnation/epoch 均未改变而 request identity 改变时才是同 realm `stale_noop`；
- P1 来自远程通知的 response 复用同一 realm fence/inbox/命令合同，并带可验证的 transport/source 类型。TD-022 device registration 与 remote payload 必须携带当前设备 incarnation+epoch；服务端尚未获知新 realm 时，旧 realm push 即使展示，其目标动作也只能 no-op，不能让远程 transport 绕过本地校验。

ActionInbox claim 状态机是持久合同：`claimOwnerSessionId/claimToken/claimedAt` 非空当且仅当 `processingState=processing`。只有已取得 Lease B 且在 then-active Repository 找到同 realm row 的 processor，才能以 `(actionInboxId, installationId, installationIncarnationId, notificationDatasetEpoch, processingState=pending|failed_retryable, processingAttempt=expected, claimOwnerSessionId=null, claimToken=null, claimedAt=null)` 为谓词 CAS：把 attempt checked `+1`，设置每个 App 进程新生成的随机 session ID、每次 claim 新 token 和诊断时间，并进入 processing。完成事务必须仍持有同 claim 与同 realm Lease B，才能转 `applied/business_noop/stale_noop/failed_retryable/failed_terminal`；每个退出 processing 的分支都在同一事务清空三个 claim 字段，除 retryable 外均为终态。attempt 已达 TD-006 上限时不得 claim，而在 Lease B 下以 `failed_terminal + resultCode=action_processing_attempt_exhausted` 终结、claim 字段保持全空且不执行业务动作。

App 启动先以 token-fenced CAS 把其他 session 遗留的 processing claim 原子退回 pending 并清空三个 claim 字段；同一 session 用单调时钟 watchdog 做相同回收，不用可回拨墙钟判断所有权。`failed_retryable` 由带上限指数退避的耐久 task 重新入队；Repository 进入 active、App 启动/前台、成功解锁和 retry 到期都幂等扫描 pending/到期 retryable。Lease B 暂不可得时不得 claim，并保留 durable wake-up；因此 processing 崩溃、长期锁屏或 activation 竞态不会永久卡住。

### 11. 投递记录和用户状态

`NotificationDelivery` 只记录真实 adapter/platform 提交、取消或可观察回调尝试，不记录可见文案、raw payload 或原生任意错误：

```text
reminderInstanceId
installationId + installationIncarnationId + deviceId?
transport + platform + recipientSlot
platformRequestId
adapterNativeId?
notificationDatasetEpoch
attemptSequence (TD-006 LongCounter)
scheduleFingerprint
privacyIndependentFingerprint
effectivePrivacyMode
categoryContractId + categoryContractVersion
actionContractVersion + payloadContractVersion + requestIdentityContractVersion
requestedAt / acceptedAt / observedAt / cancelledAt
requestedPrecision
status: requested | accepted | observed_trigger | observed_action |
        cancelled | rejected | missing
evidence: ios_pending | android_registry_only | adapter_receipt | none
failureCode?
adapterContractVersion
environmentGeneration
capabilityFingerprint
```

完整投递身份是 `(reminderInstanceId, installationId, installationIncarnationId, device slot, transport, platform, recipientSlot, notificationDatasetEpoch, platformRequestId)`。只有该身份的最新 `attemptSequence` 为 `accepted`，且 realm、`scheduleFingerprint`、precision、`environmentGeneration`、`capabilityFingerprint` 和 adapter contract 均匹配 current pair 输入时，才是 ordinary current evidence；最新 requested/rejected/missing/cancelled 使较早 accepted 永久失效。第 4 节的 `privacyComparisonCandidate` 只在初筛时刻意忽略 schedule fingerprint，用于先决定 effective contract；它本身不能显示“已安排”或抑制 upsert，重算 schedule fingerprint 后仍须满足本段全部谓词。Android registry 还必须与同一普通证据匹配才能抑制 upsert。权限预检、channel 阻断或预算淘汰没有平台调用，不能伪造 Delivery。

`NotificationDatasetState` 是每 notification realm 唯一 owner，逻辑唯一键为 `(installationId, installationIncarnationId, notificationDatasetEpoch)`，至少持久化 `notificationInputRevision`、`revisionState`、完整 registered pair set/version/digest 和 `forcePresentationRefreshRevision?`。它与第 1 节唯一 coordinator task 一起决定全局是否仍需工作；单条 Delivery、Decision 或 pair state 均不能推进 owner revision、完成 task 或清 marker。

每轮对账另生成 device-only `NotificationSchedulingDecision`。唯一身份绑定 `(installationId, installationIncarnationId, notificationDatasetEpoch, notificationInputRevision, transport, platform, recipientSlot, reminderInstanceId, reconciliationRunId)`，携带 `platformRequestId?`、`scheduleFingerprint`、`decision`、`reasonCode?`、`requestedPrecision`、`environmentGeneration`、`inputFingerprint` 和 `computedAt`；`decision` 固定为 `eligible_selected | permission_blocked | channel_blocked | capacity_deferred | unsupported | retryable_error | terminal_error`。exact 权限不可用但已降级选择 approximate 时仍是 `eligible_selected + requestedPrecision=approximate`。Decision 必须在能力/预算选择与适用平台结果都已确定后写最终值；`eligible_selected` 单独不是“已安排”证据。

Decision 构造是规范算法，不允许 adapter 自选优先级：

1. 先严格校验整轮输入、受控 registry 和 capability snapshot。损坏字段、未知枚举、local Android `precision=not_applicable`、local iOS `precision!=not_applicable`，或 TD-022 remote pair `precision!=not_applicable` 都会拒绝本轮且不得 seal 部分 Decision；它们不是某个候选的 `unsupported`。
2. 对每个有效候选先确定 `requestedPrecision`：iOS local 与任一 remote pair 恒为 `not_applicable`；Android local 只取固定 capability snapshot 的 `exact` 或 `approximate`。然后计算 request ID、effective presentation contract 和 schedule fingerprint。P0 每行 `platformRequestId` 必须为非空 `lbr3:`；可空只为未来由其 ADR 明确定义的非本地 transport 保留。任一值无法规范构造时整轮失败，不用 `null` 或空串凑行。
3. 依下表从上到下首条命中决定最终值；一旦命中不再被较低优先级分支覆盖。

| 优先级与条件 | `decision` | `reasonCode` | 平台提交 |
| --- | --- | --- | --- |
| 有效目标 Instant 超出当前 adapter 的静态可表示范围 | `unsupported` | `target_instant_unsupported` | 不提交。 |
| 当前 adapter 未登记该静态 trigger 合同 | `unsupported` | `trigger_contract_unsupported` | 不提交。 |
| 当前 adapter 未登记该呈现合同且没有安全 fallback | `unsupported` | `presentation_contract_unsupported` | 不提交。 |
| `posting=not_determined` | `permission_blocked` | `posting_not_determined` | 不提交。 |
| `posting=denied` | `permission_blocked` | `posting_denied` | 不提交。 |
| Android `presentation=channel_blocked` | `channel_blocked` | `channel_blocked` | 不提交。 |
| 候选未被普通预算选中 | `capacity_deferred` | `ordinary_budget_exhausted` | 不提交。 |
| snooze/近期编辑候选在总预算与预留/驱逐后仍未选中 | `capacity_deferred` | `reserved_budget_exhausted` | 不提交。 |
| 已选中且本轮所需操作聚合出终态错误 | `terminal_error` | 下述终态错误优先级选出的非空码 | 记录所有真实结果。 |
| 已选中且无终态错误、但聚合出可重试错误 | `retryable_error` | 下述可重试错误优先级选出的非空码 | 记录所有真实结果并保留任务。 |
| 已选中，已有足够 matching accepted 且无需 force/replacement，或本轮 upsert accepted，且没有上述错误 | `eligible_selected` | `null` | 跳过或已提交。 |

已选中候选的 operation aggregate 必须等所有适用结果后再求值。terminal 永远高于 retryable；同一严重度内按 `required_cancel > trigger_validation > submit` 取 Decision reason，但所有 attempt/cleanup receipt 都保留。固定码为 `required_cancel_retryable`、`required_cancel_terminal`、`trigger_validation_retryable`、`trigger_validation_mismatch`、`submit_retryable`、`submit_terminal`。静态合同/范围检查才是 unsupported；trigger validation API 抛出暂时异常是 `trigger_validation_retryable`，API 正常返回但解析 Instant 与目标不等是 `terminal_error + trigger_validation_mismatch`。privacy-tightening cancel-first 失败后仍尝试更严格 upsert；即使新 accepted 已形成 matching Delivery，Decision 仍按 aggregate 为 error、run 为 degraded，UI 可因更强 Delivery 证据显示“已安排”。

`reasonCode` 只能是本节表和 operation aggregate 列出的值；更细的 adapter 错误只进入同 attempt 的 `NotificationDelivery.failureCode` 受控登记值，不得把原生消息塞入 Decision。权限、channel、预算和 unsupported 是一次完整计算的正常结果，本身不使 run degraded。与候选无关的 stale/undesired cleanup/dismiss 失败，或 blocked/deferred/unsupported 候选的定向清理失败，不覆盖该候选的首条 Decision；它们仍使 ReconciliationState 为 degraded、`failureCode=cleanup_retryable|cleanup_terminal`，保留任务且不发布成功水位。平台 accepted 时 Decision 只有在无 operation error 时才为 `eligible_selected`，而用户界面的“已安排”始终只来自第 11 节要求的 latest matching accepted Delivery。

每个 pair runner 另有 `(reconciliationRunId, installationId, installationIncarnationId, epoch, inputRevision, registeredPairSetDigest, transport, platform)` 身份的 `NotificationSchedulingRun`，记录 `phase=building|sealed|published|discarded`、`inputFingerprint`、`expectedDecisionCount`、`decisionSetHash?` 和受控时间。seal/不可变性和哈希严格按第 8.1 节；只有 sealed run 可在 pair 最终事务发布，owner realm/digest 改变时不能移植到新集合。

NotificationDatasetState 的每个 registered `(transport,platform)` 在同 realm 下恰有一行 `NotificationReconciliationState`，逻辑键为 `(installationId, installationIncarnationId, notificationDatasetEpoch, transport, platform)`，非 registered pair 不得存在 current state。它至少保存 owner 镜像 `notificationInputRevision/registeredPairSetDigest`、`state=pending|running|succeeded|degraded`、`publishedRunId?`、`scheduledThrough?`、`lastAttemptedAt?`、`lastSucceededAt?`、`environmentGeneration`、含适用 channel 的 `capabilityFingerprint`、`inputFingerprint?`、budget 与 tzdb/recurrence/adapter 版本。pending/running 的 pointer、水位和 input fingerprint 必须为空；succeeded/degraded 必须指向一个同 realm/revision/digest/transport/platform 且 phase=published 的完整 run；只有 succeeded 的 `scheduledThrough/lastSucceededAt` 可作为该 pair 当前成功展示。任一输入变化只能按第 1/8 节 owner 事务全 pair 隐藏旧 run，本行不得独立递增 revision，也不得依赖 UI 事后过滤。

单条设备状态按固定优先级派生：

1. 完整投递身份的 latest matching accepted Delivery 显示“已安排/近似安排”，呈现模式取它的 effective contract；
2. 否则只有 ReconciliationState 为 succeeded/degraded，且 owner active、realm/input revision/pair-set digest/transport/platform/pointer 全匹配时使用 current Decision：`permission_blocked→等待通知权限`、`channel_blocked→提醒渠道已关闭`、`capacity_deferred→等待补齐`、`eligible_selected/retryable_error→正在重新检查`、`unsupported/terminal_error→失败`；
3. 无 current Decision/pointer 或任一 fence 不匹配时显示“正在重新检查”，不得以 0 代替未知。

每个 pair 的 `scheduledThrough` 和最近成功时间只来自全部 guards 匹配的 same-realm/current-revision/digest succeeded state。degraded 可发布完整 Decision，不抹掉仍匹配的单条 accepted Delivery，但绝不发布该 pair 成功覆盖水位。只有 current realm 的精确 registered pair 全集均为同 owner revision/digest succeeded 才可显示“全部提醒方式已检查”；任一 degraded/pending/running/缺失/额外行都保持全局“正在重新检查”，同时允许展示其他 current pair 的明确状态。accepted 不表示展示或用户已读。

P1 跨 Device 的 scheduled/failed 聚合不能由只看见本机 device-only 行的客户端推断。TD-020/022 必须定义 server-owned、无内容的 `ReminderDeliveryAggregate`、当前适用设备集合/失活期限和并发合并规则后，才允许写收件人范围聚合状态；在该合同落地前只展示当前 installation incarnation 状态，单台设备失败不能把共享实例改成 failed。

具体物理表由持久化 Schema 文档定义。`ReminderInstance.state` 是收件人范围内的逻辑生命周期，不保存“本设备正常”。P0 只有上述 latest matching accepted 才可把本 installation incarnation 聚合为 scheduled，证据失效后回 planned；终态技术失败且无 accepted/待重试才可为 failed。`NotificationDelivery`、`NotificationActionInbox`、`NotificationDatasetState`、`NotificationSchedulingDecision`、`NotificationSchedulingRun` 和 `NotificationReconciliationState` 六类投影均为 device-only，不进入 portable backup/业务同步/用户导出；schema migration 保留 realm 和合法同 realm 设备投影，restore/manual rollback 后旧行不可作为当前证据。诊断只输出随机/不透明 ID、时间、稳定错误、能力和水位，不输出 title/body/payload 或 Expo registry 原文。

### 12. 数据集替换与恢复后收敛

- 只有真正提交的整体 restore/manual rollback 才在保持 Installation/incarnation 时把 `notificationDatasetEpoch` 从激活门内重新读取的当前值 checked `+1`；`activation_abort` 原样保持 prior realm，marker 后完成 target 激活不得再次递增，schema/cipher migration 始终保持 realm；
- TD-010 preflight 用接收设备 `DeviceStateOverlay` 为每个受支持 pair 固定 environment generation、含适用 channel 的 capability fingerprint、budget、transport enablement 和无内容 `hasManagedEvidence`；签名 build 提供 pair registry、tzdb/recurrence/adapter 与 `notificationInitializationContractVersion=2`。initializer 只为当前真实 OS 派生 active pair，把已禁用但仍有 managed evidence 的 pair 标为 retiring，并按第 1 节计算 runtime digest。任一必需基线不可得时不得越过 marker，绝不能从 source/portable 补值；owner/pair key 或 marker/read-back 谓词再变更时必须 checked 递增该版本；
- candidate seal 前恰有一个 dormant coordinator task，完整身份是 `(operationId, candidateGenerationId, installationId, installationIncarnationId, targetEpoch, revision=0, pairSetDigest)`，其 `activationGate/activatedAt` 为空。initialize 的 reason 固定为 `dataset_initialized` 且 `operationId=incarnationBootstrapOperationId`；restore/manual rollback 的 reason 固定为 `dataset_epoch_changed`。marker 前 target realm 不得存在六类通知设备投影；processor 只有同时验证 task gate、matching active control/realm 和 Repository open 才能运行；
- activation-marker DELETE/FULL transaction 必须原子写绑定 operation/generation/root/target realm/task/init contract/pair digest 的 marker，激活上述唯一 task，在同 realm 创建一项 `NotificationDatasetState`（revision 0、revisionState active、精确 pair set/version/digest、force marker null），并为每个 pair 创建一项 ReconciliationState（pending、revision 0、同 digest、per-pair overlay/build baseline，`publishedRunId/scheduledThrough/lastAttemptedAt/lastSucceededAt/inputFingerprint/failureCode=null`）；不得有额外 pair，target realm 内 Run/Decision/Delivery/Inbox/checkpoint/platform receipt/watermark 初始为零。marker/task/owner/全部 pair 必须具有同一 realm 并 all-or-nothing，startup 不得补建部分状态；
- `Initialized`/`RestoreSucceeded` 只在 active control、对应 candidate typed marker、matching `ActivationOpenReceipt` 和 TD-004 bootstrap active-anchor 四项耐久且逐字段匹配，新 Repository 重开与初始化集合 read-back 通过后返回；不等待平台清理/重挂。initialize validating 无 marker 时只能在 matching initializing bootstrap 下重建同 operation 的新空 candidate；其他 validating 无 marker 时必须按 TD-010 写预留的 `activation_abort` terminal active control、复验 prior marker/receipt/counter、写新 recovery receipt 并推进 bootstrap anchor，完成前 prior Repository 也不开放。abort evidence 只能重新认证 prior realm 并返回 `NotActivated`，绝不得返回 `Initialized`/`RestoreSucceeded`。有 candidate marker 或 active 无 receipt/anchor 时必须完整 read-back 后完成同一 target，任一 realm/集合不匹配即 integrity-blocked；
- 新 control 进入 `phase=active` 后，缺失/非法/不匹配 incarnation、旧/缺失/非法/future epoch 或 legacy request identity 的 pending/delivered/response 即刻失效；正确性不依赖平台清理成功。coordinator 按 digest 先定向清理 stale realm，再只挂 current-realm future request；
- 任一 pair 平台/清理失败的恢复 postcondition 为 `RestoreSucceeded + degraded_reconciliation`：该 pair 只可发布完整 current-realm degraded Decision run，且无成功水位，coordinator/force marker 保留并显示“恢复成功，提醒正在重新检查”；guard 变化或崩溃不发布本轮，单 pair succeeded 不完成 task；
- dataset replacement 本身不推进 `environmentGeneration`。Repository open 后若 overlay/pair 输入已变化，先按第 1 节以一个 owner revision `+1` fan-out 全部 current pairs，再做平台写；environment generation 只因权限、系统时间/时区、重启、adapter/OS 能力等平台环境变化推进，不能替代 notification realm；
- portable restore/manual rollback mapper 不从 source/candidate 导入六类通知设备投影、平台 ID、能力/环境/channel/budget、force-presentation 意图或旧 reconcile task/checkpoint/receipt/watermark；它保留 Plan/Instance/业务 dedupe，并只创建上述新的 dormant task。“不导入旧 task”不表示成功恢复后没有新 task；
- schema/cipher migration 不是数据集替换：它保持 realm、合法同 realm 设备投影和实例状态，不执行上述 portable normalization。DATA-091 clear 保留 Installation ID 并轮换 incarnation/keys，reinstall 新建 Installation/IAK/incarnation/key hierarchy，两者都经 TD-010 initialize 在新 realm 从 epoch `0` 启动；旧通知即使业务 ID 和 epoch `0` 相同也永久 targetless。

`ReminderInstance` 规范化只按下表优先级命中第一条；“来源失效”只按 REM-021 穷举谓词，不另造“不可操作”分支：

| 优先级 | source 条件 | target 状态 | 处理 |
| ---: | --- | --- | --- |
| 1 | 原状态 `acknowledged/snoozed/cancelled/expired` | 保持 | 不重建平台请求。 |
| 2 | 其余实例的来源按 REM-021 已失效 | `cancelled` | 离开 paused/failed 时清 `pauseReason/failureCode`。 |
| 3 | `paused` 且暂停原因仍成立 | `paused` | 保留 `pauseReason`，不重建平台请求。 |
| 4 | `paused` 原因已失效，目标未来/已过 | `planned` / `expired` | 清 `pauseReason`，过去目标不补发。 |
| 5 | `scheduled/failed`，来源仍有效，目标未来/已过 | `planned` / `planned` | 清 `failureCode`；过去只派生 application-only 待查看/逾期且永不补发。 |
| 6 | 原状态 `planned` 且来源仍有效 | `planned` | 过去目标永不进入 desired platform set。 |

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
- 单一 owner revision、registered-pair digest、同 ID、fingerprint、任务和环境 generation 让编辑、崩溃、重启、升级和权限变化可以收敛；
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
| 旧数据集通知命中新 realm 的同 ID 实体 | restore/rollback 原子递增 epoch，clear/reinstall 轮换 incarnation；`lbr3`/payload v3/current bootstrap+control 同时校验 realm；旧/legacy response 在 inbox 前 no-op。 |
| 调度预算挤掉近期提醒 | 分级选择、固定 tie-break、预留和水位警告；snooze 只驱逐最远普通项。 |
| 对账中进程终止产生半完成 | 平台调用外置、短事务 checkpoint、稳定 ID、revision guard 和可重放 lease。 |
| 一个 transport 成功过早清全局任务/隐私 marker | marker 只在 NotificationDatasetState；pair 仅独立发布，global finalize 精确验证同 realm/revision/digest 全集 succeeded。 |
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
- request、fingerprint、持久 receipt、task、checkpoint、run、Decision、Delivery、ActionInbox、ReconciliationState 和 watermark 都必须携带 canonical Installation/incarnation/epoch；原始 pending/delivered snapshot 按第 2 节只解析 incarnation/epoch，不伪造 Installation ID。task/checkpoint/run/Decision/ReconciliationState 还必须携带 canonical NotificationInputRevision，task/run/ReconciliationState 必须携带 registered pair-set digest；旧 `lbr1`/`lbr2` 只能枚举/定向清理，不能执行动作或作为 current evidence；
- 所有 title/body/payload/category/channel 构造只能来自受控 mapper；日志 API 接收 DTO 时必须自动裁剪内容字段；
- action inbox processor 只能调用 application commands，不能直接访问 repository implementation；
- response parser、action processor、coordinator 和 pair runner 都只能持有绑定 active Installation/incarnation/generation/epoch 的短 `DatasetReadLease`；parser 写完 inbox 必须释放 lease，任何应用锁/用户等待都不持有 lease，解锁后重取 fresh action/navigation lease；暂时取不到时保持 pending/defer；activation gate 取得后不得新发 lease；
- NotificationInputRevision 的推进、精确全部 pair pointer/水位失效与唯一 coordinator 入队必须为一个 owner 事务；业务/设置 overflow 拒绝整条命令，已发生的原生外部变化则按第 1 节 fail-closed 更新 owner/各 pair 最新可得基线、隐藏投影并进入 `notification_revision_exhausted` 维护，二者都不回绕、清空非空 capability fingerprint 或只更新部分 current pair；
- NotificationDatasetState 是 force marker 与 revision 的唯一真值；task 只能镜像。pair publish、receipt 或进程内事件无权清 marker，global finalize 必须验证 current-realm owner、task 和精确 state 全集；
- 六类通知表、task/checkpoint/receipt/watermark 的 unique/FK/CAS/invariant query 必须把 `installationIncarnationId` 作为非空身份列，禁止跨 incarnation join、pointer publish、claim 或水位命中；该约束同样适用 `remote_push`，不得把 incarnation 只做本地通知字段；
- ActionInbox 数据库约束必须保证三个 claim 字段全空或全非空，并与 `processingState=processing` 等价；所有退出/回收事务清空字段，attempt 上限直接 terminal no-op；
- SchedulingRun 只能沿 `building→sealed→published` 或 `building/sealed→discarded` 迁移；seal 后任何除 phase 以外的 header/Decision 改写必须被数据库约束和 invariant query 拒绝；
- registered pair 集、digest 和 input/run/state 绑定必须由同一共享 canonical 实现生成，并以跨语言黄金向量验证；runtime 只允许当前 OS，retiring pair 不得新增请求；
- environment generation 的 wrap/corruption 视为 changed，并强制重挂；
- 对账 lease 使用 wall-clock-independent expiry 或带 boot/session identity 的安全恢复，不能因用户回拨时钟永久占用；
- 物理 Schema、索引和 retention 在本地持久化文档定义；接口 JSON/错误码在契约文档定义，本 ADR 不成为第二份字段权威；
- Expo 内部实现不是公共 API。任何依赖内部事实的测试必须在升级失败时阻止合并，而不是在生产静默适配。

## Verification

### 1. 自动化合同

- request ID v3、payload v3、ActionInbox v3、deduplicationKeyHash、schedule/privacy-independent v2、inputFingerprint v2、decisionSetHash/projection v2、epoch/input revision `0/1/9007199254740992/9223372036854775807`、registered-pair set/digest、含 transport 的 capability fingerprint、秒取整、排序、预算/预留、驱逐和 scheduled-through 黄金向量；pair fixture 必须覆盖空集合、重复 pair、未知枚举、非法 mode、其他 OS 拒绝，以及 P0 local-only、P1 同平台 local+remote、active→retiring→removed；同实例跨 incarnation、epoch 或 transport ID 必须不同，同 Installation/实例/epoch `0` 但 incarnation 不同时 request ID、ActionInbox ID、fingerprint/投影 identity 必须全部不同；Swift/Kotlin/TypeScript 对 JCS/domain label/NUL/null/空集合产生字节一致结果；
- 30 日窗口、过去目标、低库存下个整分钟、DST gap/overlap、时区/tzdb 变化与 TD-007 fixture 联测；
- 同 ID edit replace、新 ID snooze、privacy tighten cancel-first 后即使 cancel 失败仍尝试 stricter upsert、删除/归档/失权 dismiss；纯 privacy loosen 必须先从**不比较 schedule fingerprint** 的 latest accepted candidate 比较 base，再选 effective contract 并重算 schedule fingerprint，验证不会循环失配或误扩张；force marker 在任一 pair 的 upsert/receipt/publish kill 点持续存在，只有同 realm/revision/digest 全 pair succeeded 的 global finalize 清除。只有新合同撤销旧 action 时旧动作 business_noop，full→title_only 且 action 合同不变仍经 fresh Lease B 正常判定；
- 对每个 pair runner 外部调用前后注入 kill，重启后无重复领域动作、无旧隐私内容、orphan running lease 回 pending，最终各 pair 与 coordinator 收敛；
- P0 local-only、P1 same-platform local+remote、active→retiring→removed 三类集合下，每一类全局或 pair 专属业务/设置/能力/合同输入变化都在一个 owner 事务完成 input revision `+1` 一次、精确全部 pair state=pending、revision/digest 镜像、pointer/水位清空和唯一 task 入队；任一写点 kill 只能看见完整旧或新状态。最大值时业务/设置命令整体失败；外部 capability/environment/registry 变化必须 owner exhausted、更新 runtime set 和最新可得 per-pair environment/capability/budget、清 nullable current 字段、停止全部 publish/platform write，且不清空 capability fingerprint；
- 在每个 building Decision 写点、seal 前后、pair 最终 guard/publish CAS 和 global finalize 的每个写点注入 kill；少行、多行、重复候选、非法排序/hash、旧 pair digest、sealed 后改写均拒绝，只有 pair 全谓词匹配可独立发布，单 pair success/extra/missing state 均不能完成 coordinator 或清 marker；
- owner realm/revision/pair digest、`environmentGeneration`、`capabilityFingerprint` 或任一合同 guard 在执行中变化会丢弃本 pair run 并重新排队；旧 task/run 不能提交新 realm/revision/digest 的旧内容，真实但过期的 receipt 不得成为 current evidence；
- Android registry 假阳性、空 registry/有 alarm 不可见、exact revoke、permission grant、channel blocked 和 adapter error mapping；
- action response 重放、未知 category/action ID 或版本、category 版本篡改、过期来源、删除、成员失权、锁定/解锁和 Expo last response 重放；claim 三字段必须非空当且仅当 processing，CAS 旧值全空、所有退出/跨 session/watchdog 回收全清，attempt 最大值只得 `failed_terminal/action_processing_attempt_exhausted` 且无业务动作；
- 分别改变 Installation/incarnation/epoch/transport/category/action/payload/requestIdentityContractVersion，actionInboxId 必须均不同；穷举 hidden/open-only/version/sourceId/spaceId/actionId 交叉组合，只有第 6.3 节组合可在 Lease A 前通过；旧版本只按旧 allowlist 解释并 terminal/no-op，绝不映射成新版动作；
- committed restore/manual rollback 保持 Installation/incarnation 并使 epoch 恰好递增一次；`activation_abort` 保持 prior realm，marker 后完成 target 不得二次递增，migration 保持 realm；DATA-091 clear 保持 Installation 但轮换 incarnation/epoch `0`，reinstall 新建 Installation/incarnation/epoch `0`；溢出阻止替换且不回绕；
- missing/malformed/mismatched incarnation、old/future/missing/malformed epoch、payload/request-ID 不一致和同业务 ID 的旧 delivered response 在 active control 下全部 targetless no-op；incarnation 不做 future 比较。覆盖 payload、pending、delivered、Android registry、receipt、task、checkpoint、Inbox 和 Delivery；
- action 在 control 切换前后及 inbox 已写未执行的竞态结果只能是完整旧事务、`deferred_unclassified`、dataset 替换后的无 row targetless no-op、同 realm 终态 `stale_noop`、完整 current 事务或 current `business_noop`；activation gate 只等待已签发的短 lease/事务，绝不等待用户或出现半事务；
- parser lease 写 inbox 后立即释放；模拟任意时长锁屏等待和期间 restore/clear/reinstall，Lease B 暂时不可用时必须 pending/defer，取得后 dataset/realm 变化或 current row 缺失只得无 row targetless no-op，同 realm request identity 变化只得 stale_noop，identity current 但授权/来源/动作无效只得 business_noop；在 Lease A 入箱前/后、Lease B claim 前、claim CAS、领域事务和 router accept/applied 的每个边界 kill，验证跨进程 session 回收、同进程 watchdog、retry 退避和 action 至多一次；
- `open` 只使用 fresh NavigationIntent，router 接受后 inbox=applied 且不持久化目标；重放不得绕过 fresh Lease B。validating/integrity-blocked 时不写 App 明文、不清 last response，首次返回 active 必须 re-fetch 重跑；
- RestoreSucceeded 后、平台 stale cleanup 前，旧 response 已因 incarnation+epoch+request-ID fence no-op；coordinator 已耐久但任一 pair 清理/重挂失败只发布同 realm 完整 degraded run、无成功水位并保留 task，API 仍为 `RestoreSucceeded + degraded_reconciliation`；clear/reinstall 的旧 platform response 即使清理失败、业务 ID/epoch `0` 相同也必须 no-op；
- restore/manual rollback 后穷举 REM-021 来源有效/失效、future/past、全部原状态和暂停原因成立/失效：必须按第 12 节首条命中、清理适用 reason、所有过去目标不补发；六类 device-only 投影、设备刷新意图和旧 task/水位均不导入。marker 前只有绑定 operation/candidate/target realm 的唯一 dormant task；marker transaction 后恰有同 realm revision-0 active owner、精确全部 revision-0 pending pair states，且 Run/Decision/Delivery/Inbox/checkpoint/platform receipt/watermark 为零，六个 pointer/time/fingerprint/failure 字段为 null，其余 guard 来自 receiving overlay/current build；task/owner/全部 state/marker all-or-nothing，matching ActivationOpenReceipt 和 bootstrap active-anchor 前不得报告成功，migration 保持合法同 realm evidence；
- permission/channel/capacity 在零 platform call 时仍产生逐实例 Decision；building/旧 realm/revision/pair digest/非 published run 不可见，只有 succeeded/degraded 且 owner active、realm/inputRevision/pairSetDigest/transport/platform/pointer 全匹配时按第 11 节映射全部 Decision；exact 被拒但 approximate accepted 只显示近似安排；
- Decision 表逐分支黄金向量覆盖静态 target/trigger/presentation unsupported、permission、channel、两类 capacity、matching accepted、required cancel、trigger validation exception/mismatch 和 submit error；多错误时必须按 terminal 高于 retryable、同级 cancel→validation→submit 选 reason，cleanup/stricter-upsert 混合结果不得因调用返回顺序不同而漂移；
- 混合 lbr1/lbr2/lbr3-old-incarnation pending、Android registry 和 delivered 的定向 cancel/dismiss、容量占用、崩溃恢复与最终收敛；只有确认 cancel/dismiss 后才释放容量；
- initialize/restore marker、task、owner 或任一 pair 的 incarnation 缺失、多余或不匹配都 integrity-blocked，普通启动不得补行；六类表的 unique/FK/current-query fixture 证明旧 incarnation 的 epoch-0 owner/run/pointer/Delivery/Inbox 不会被新 realm 命中；
- remote registration/push/response 的 incarnation+epoch 篡改、缺失与滞后全部 fail closed；写入 v3 realm-aware schema/state 后，不支持 incarnation 的旧二进制必须被 bootstrap/schema/contract gate 拒绝；
- payload/schema fuzz、长度边界、Unicode 截断和日志/诊断无内容断言；
- Android backup/restore 测试证明 notification preferences、environment this-device state 和 installation ID 不迁移；
- dependency test 对 Expo Android 源码/行为断言 exact/approx API、registry delete、boot restore 和 action option 支持范围。

### 2. 真机矩阵

- iOS 16 最低支持档、其后每个仍在产品支持范围内的 major，以及发行时最新公开稳定版；覆盖 authorized/denied/provisional、Focus、摘要、重启、升级、时区/显著时钟变化、App 前台/后台/终止；
- Android API 29 最低支持档、API 31 exact-alarm 边界、API 33 通知权限边界、API 34 默认授权边界，以及发行时 target SDK 与最新公开稳定版；覆盖 exact 拒绝/授予/撤销、通知拒绝、channel 关闭、Doze、reboot、package replace、force-stop 后恢复；
- 与发行渠道相关的 Google 系、华为、小米、OPPO/vivo 至少三类 OEM，记录省电/自启动差异，不把单一模拟器作为证据；
- 预算下限、恰好上限、超出 1、大幅超出，snooze 预留与最远项驱逐；
- 连续至少 14 天包含重启、升级、时间/时区切换和 30 天不打开后的恢复；
- 已展示普通/敏感通知在编辑、隐私收紧、删除、清除本机和成员失权后的清理；
- Android 15 及更高版本的 force-stop/权限变化和后续平台行为按每次发布矩阵重新核验。

### 3. 安全与发布检查

- 独立审阅 manifest 权限、receiver exported 属性、intent 输入、action inbox、应用锁、payload 和 deep link；
- 解包 release APK/AAB/IPA，确认没有禁止 entitlement/permission、backup exclusion 生效、debug receiver/日志关闭；
- 在锁屏、进程终止、数据库迁移和 key 暂不可用时攻击 mutating actions，不能绕过认证或产生未授权写入；
- 扫描系统日志、崩溃报告、诊断包和 adapter preferences，内容必须符合 REM-070/071；
- 依赖许可证、SBOM、安全公告、Expo SDK/React Native/target SDK 兼容性通过 TD-017 release gate；
- 商店提交前重新核验 Apple/Android 通知、exact alarm 和后台政策，行为改变必须更新 ADR/规范与用户文案。

## Rollout and rollback

新安装或 TD-010 `operationKind=initialize` 必须走受控 bootstrap：candidate seal 前只有一项 `reason=dataset_initialized`、绑定 `(incarnationBootstrapOperationId, candidateGenerationId, installationId, installationIncarnationId, epoch=0, revision=0, runtimePairSetDigest)` 且 gate 为空的 dormant coordinator task；initialize activation transaction 以 `notificationInitializationContractVersion=2` 原子写初始化 marker、激活该 task、在同 realm 创建 revision-0 active `NotificationDatasetState` 和 runtime digest 对应的精确全部 pending pair state。pair 的 environment/capability/channel/budget 来自 receiving-device overlay，tzdb/recurrence/adapter/registry 来自签名 build，pointer、水位、input fingerprint 与 failure 均为空；marker/task/owner/全部 pair 同 realm 且 all-or-nothing。只有 active control、typed marker/evidence、matching `ActivationOpenReceipt`、TD-004 bootstrap active-anchor、Repository reopen 和完整 read-back 全部完成后才接受首个业务写入；marker 后缺失、多余或 realm 不匹配进入 integrity-blocked，不得由普通启动补行，marker 前失败则仅在 matching bootstrap 下重建同 operation 的未激活空 candidate。首次启用时随后迁移/生成未来 ReminderInstance，但不在初始化或 migration transaction 调平台；数据库可用后注册 category/channel、取得能力快照，再按预算渐进提交。内部构建先启用只读 diff/诊断模式，验证期望集合，再打开 platform writes；公开构建不得依赖远程开关才能调度基本本地提醒。

adapter contract、payload、category、request ID 和 fingerprint 都有独立版本。首个可保留开发/公开基线直接使用 lbr3/request v3、payload v3、ActionInbox identity v3、schedule/privacy/input/Decision v2 和 initialization v2；不伪造已发布的 v1/v2 迁移历史。若内测或 fixture 已有 v1/v2 状态，受签名 `projection_reset` migration 保持 current Installation/incarnation/epoch 和 Plan/Instance，但绝不把缺少 `installationIncarnationId` 的六类旧投影反填为 current realm：旧行从新版 current tables 删除；确需审计留存时，只能转为不含内容、不可变且永久 `non_current/terminal_noop` 的 `LegacyNotificationProjectionQuarantine`，并置于所有 current unique/FK/query path 之外。旧 ActionInbox 不迁入新版 ActionInbox，也绝不执行，只能删除或进入该 quarantine；旧 published run/pointer/水位/input fingerprint 全部失效，不得作为 current evidence。migration 仅从经认证的 current realm、current build 与现行 Plan/Instance 重建 owner/pair/task postcondition，不复用任何旧 pointer、水位或 fingerprint；所有 lbr1/lbr2 pending/delivered/registry 是独立的平台遗留物，只能定向 cleanup 并在确认前占用容量，future desired 按 lbr3/payload-v3 重挂。该 migration 不增加 epoch、不轮换 incarnation；一旦写入 realm-aware 状态，不支持 incarnation 的旧二进制不得作为可回滚版本。以后升级时新旧 category/parser 并存，但旧 parser 只负责安全清理；未知新版本只允许打开无目标首页和安全清理，不能执行 mutation。

若新 Expo/原生 adapter 出现重复、丢失或隐私风险：

1. 构建内/签名配置暂停新 platform writes，但保留计划、今天页和 action 安全解析；
2. 对确认泄露风险的 managed IDs 执行定向 cancel/dismiss，不普通全量 cancel；
3. 回退到最后通过合同测试的 adapter 版本并推进 environment generation；
4. 下次运行从业务事实强制重挂未来窗口，不补发过去请求；
5. 数据格式需要改变时以新 ADR 和 migration 发布，不能让旧 registry 成为恢复依赖。

exact 权限不可用、channel 被关闭或平台行为不确定时自动回落 approximate/应用内提醒；绝不回退到更高权限、全屏或绕过系统控制的实现。

## References

- [Expo Notifications SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/)
- [Expo Android scheduling delegate source](https://github.com/expo/expo/blob/main/packages/expo-notifications/android/src/main/java/expo/modules/notifications/service/delegates/ExpoSchedulingDelegate.kt)
- [Expo Android SharedPreferences notification store source](https://github.com/expo/expo/blob/main/packages/expo-notifications/android/src/main/java/expo/modules/notifications/service/delegates/SharedPreferencesNotificationsStore.kt)
- [Android Developers：Schedule alarms](https://developer.android.com/develop/background-work/services/alarms)
- [Android AlarmManager：exact-alarm permission state action](https://developer.android.com/reference/android/app/AlarmManager#ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED)
- [Apple：UNUserNotificationCenter](https://developer.apple.com/documentation/usernotifications/unusernotificationcenter)
- [Apple：UNNotificationRequest identifier](https://developer.apple.com/documentation/usernotifications/unnotificationrequest/identifier)
- [RFC 8785：JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html)

外部实现和平台政策会变化。依赖升级、target SDK 提升和商店提交时重新核验上述资料；正文固定的是适配边界、降级和验证责任，不把当前内部实现当作永久 API。

## Revision notes

| 日期 | 说明 |
| --- | --- |
| 2026-07-27 | 将尚未建立的 TD-012、TD-022 改为纯编号引用，保留 HTTP API 与远程推送的计划关系但不创建破链。 |
| 2026-07-26 | 将 current evidence 升为 Installation/incarnation/epoch 三元 realm；request/payload/ActionInbox identity 升 v3，schedule/privacy/input/Decision 升 v2，并与 TD-004/TD-010 initialization v2 统一。 |
| 2026-07-26 | 增加 NotificationDatasetState 单一 owner、runtime registered-pair digest 与全 pair revision fan-out；拆开 privacy comparison candidate/current evidence，固定全局 finalize、ActionInbox claim 耗尽和 TD-010 原子初始化/receipt 合同。 |
| 2026-07-26 | 将 transport 纳入 lbr2/action 身份，增加隐私无关指纹与耐久 refresh marker、可恢复 ActionInbox claim、完整 restore state、revision 耗尽和无歧义 Decision/cleanup 优先级。 |
| 2026-07-26 | 增加 NotificationInputRevision、字节级 input/Decision 哈希、sealed SchedulingRun、最终 Decision 顺序、fresh Lease B 分类、hidden/open-only 合同、有效呈现合同和确定恢复优先级。 |
| 2026-07-26 | 补齐短 parser/fresh action lease、guard-CAS 成功水位、逐实例 NotificationSchedulingDecision、确定性恢复状态映射及 validating defer。 |
| 2026-07-26 | 将 category 合同统一为稳定 ID + 显式版本，补齐 payload 精确字段、ActionInbox 类别版本幂等输入和 adapter-version 成功证据。 |
| 2026-07-26 | 收紧所有目标 response 的 epoch fence、action inbox 身份/事务边界、activation lease，以及数据集替换后的状态规范化和 durable force-reconcile。 |
| 2026-07-26 | 引入 TD-010 notificationDatasetEpoch fence，升级 lbr2/payload/action/delivery/watermark，并补齐 delivered 枚举、恢复竞态和旧格式清理。 |
| 2026-07-26 | 澄清权限能力决策表、Android registry 与同代成功回执双重判断、崩溃后强制重试，以及 P1 共享实例和设备投递的状态边界。 |
| 2026-07-26 | 接受 Expo Notifications + 自有端口 + 薄环境原生模块；固定一次性滚动调度、稳定身份、预算、Android registry 证据、强制重挂、动作 inbox 与隐私边界。 |

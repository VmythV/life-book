# 生活有谱提醒与系统通知规范

> 项目代号：`life-book` · 版本：v1.10 · 更新日期：2026-07-26 · 状态：文档基线
>
> 权威范围：提醒计划、提醒实例、系统调度、通知动作、去重、权限、降级和可靠性边界
>
> 不负责：重复日期算法、记录字段、界面视觉和具体通知库调用
>
> 依赖文档：[时间与重复规则](time-and-recurrence.md)、[业务规则](business-rules.md)、[领域模型](domain-model.md)、[质量属性基线](quality-attributes.md)、[账号与同步](account-and-sync.md)、[家庭共享](family-sharing.md)、[数据生命周期](data-lifecycle.md)、[TD-009 原生提醒调度](adr/0009-native-reminder-scheduler.md)、[TD-010 原子恢复](adr/0010-sqlite-snapshot-migration-and-atomic-restore.md)

本文严格区分“用户希望被提醒”“产品计算出一次提醒”“已交给操作系统调度”“操作系统可能展示通知”和“用户确实执行动作”。系统通知不是业务唯一事实源，也不能证明用户看到了内容。

## 1. 目标与边界

### REM-001：可靠性的可承诺部分

生活有谱必须保证：

- 提醒时间由统一时间规则确定性计算；
- 提醒计划和实例保存在本地权威数据库；
- 已提交请求可用平台实际提供的 pending 证据或适配器登记证据查询、取消和对账；无法枚举真实系统队列的平台必须能从本地事实强制重建；
- 创建、编辑、处理、归档、删除、恢复、时区变化和升级后能重建期望状态；
- 通知动作幂等，重复回调不重复改变领域数据；
- 整体恢复或手动回滚后，旧数据集通知即使命中相同实体 ID，也不能导航到新数据集目标或执行动作；旧通知清理失败不削弱此保证；
- 权限或平台限制阻止调度时，用户能看到准确状态和修复入口；
- 智能服务、网络或账号不可用不影响已成功本地调度的 P0 提醒。

### REM-002：不能承诺的部分

产品不得承诺：

- 绕过 iOS/Android 系统勿扰、Focus、通知摘要或用户通知设置；
- 在设备关机、系统时间错误、厂商强制省电或权限被撤销时仍按原时刻展示；
- 通过本地回调准确知道每一条通知是否真正显示或被阅读；
- 用户长期不打开 App 时，任意复杂规则在滚动窗口之外仍无限期准点；
- 后台任务一定会在指定时刻执行；
- Android 没有精确提醒特殊权限时仍达到分钟级精确。

这些边界必须出现在帮助与权限说明中，但不能作为产品可控错误的免责理由。

## 2. 概念与状态

### REM-010：提醒与动作分层模型

```text
ReminderPlan（长期意图）
    ↓ 根据业务发生项与时间规则展开
ReminderInstance（一次逻辑提醒）
    ↓ current-epoch 对账选择
NotificationSchedulingDecision（逐设备选择/阻断投影）
    ↓ eligible_selected 才尝试提交
NotificationDelivery（一次平台提交/取消尝试）
    ↓ 操作系统可能展示
NotificationResponse（用户动作回调，若系统提供）
    ↓ dataset epoch + request-ID fence
NotificationActionInbox（只接收 current-epoch response）
    ↓ 解锁、当前授权和最新状态校验
Domain command / safe business no-op
```

页面上的“今天”关注项从业务对象和提醒实例共同派生，不从系统通知列表反推。

### REM-011：提醒计划触发类型

`ReminderPlan.trigger` 必须属于：

| 类型 | 适用来源 | 示例 |
| --- | --- | --- |
| `absolute_schedule` | 备忘 | 2026-08-01 09:00 提醒。 |
| `relative_to_schedule` | 重复事项、清单、重要日期、批次日期 | 截止前 1 天 09:00。 |
| `at_schedule` | 重复事项、清单 | 计划时刻提醒。 |
| `state_entered` | 低库存 | 首次进入不足状态时提醒。 |

P0 不允许一个计划同时含多个触发；多个提前提醒创建多个计划，共享同一来源但拥有独立 ID。

### REM-012：提醒实例状态

```text
planned ──P0 本机接受 / P1 服务端聚合接受──→ scheduled ──用户动作──→ acknowledged
   │                       ├──稍后──→ snoozed → 新 planned 实例
   │                       ├──来源失效──→ cancelled
   │                       ├──确定过期规则──→ expired
   │                       └──范围内全部投递终态失败──→ failed → 可重试 planned
   ├──来源失效────────────→ cancelled
   └────────┐
scheduled ──┴──空间/订阅暂停──→ paused ──恢复且仍在未来──→ planned
                                      └──已到时────────→ expired
```

规则：

- ReminderInstance 状态属于收件人范围内的逻辑生命周期，不表示“本设备通知正常”；本设备的已安排/近似来自 Delivery，等待权限/渠道/容量和失败来自 REM-014 Decision，整体水位来自 ReconciliationState，三者不得互相冒充；
- P0 当前 installation 同一投递身份的最新 attempt 在 epoch、platformRequestId、fingerprint、precision、`environmentGeneration`、`capabilityFingerprint` 和 adapter contract 全匹配且 `status=accepted` 时，实例才可进入 scheduled；证据失效而实例仍有效时回到 planned 等待对账；
- P1 跨 Device 的 scheduled/failed 只能由 TD-020/022 定义的 server-owned、无内容 `ReminderDeliveryAggregate` 按适用设备集合、失活期限和并发规则聚合。该合同落地前客户端只展示当前 installation 状态，不得根据本机 device-only 行写共享聚合状态；单台设备失败永远不能把共享实例改成 failed；
- P0 只有当前 installation 出现不可重试技术拒绝且没有 accepted 或待重试 attempt 时才可进入 failed；P1 只有服务端聚合确认全部当前适用设备满足同一条件时才可进入 failed。权限未询问/拒绝、渠道关闭、预算不足和暂时无活跃设备仍保持 planned，并由 Decision 解释；
- `scheduledFor <= now` 且仍 scheduled 只表示“已经到时且未确认”，不是可可靠观测的 delivered 状态；
- 收到前台通知回调可以记录 delivery observed，但不自动 acknowledged；
- 用户从通知中心清除通知通常不可可靠观测，不得据此完成或确认业务；
- acknowledged、snoozed、cancelled 和 expired 是终态；重试创建新的投递尝试，不改变逻辑实例 ID；
- failed 在问题解决且来源仍有效时可以回到 planned；
- planned/scheduled 可以在空间待删除或 subscription 临时暂停时进入 paused；暂停会取消平台请求但保留实例 ID 和 deduplicationKey。恢复时 scheduledFor 仍在未来则回 planned，已到时则转 expired，禁止补发。

整体 dataset restore/manual rollback 不从 source/candidate 导入 `NotificationDelivery`、`NotificationActionInbox`、`NotificationSchedulingDecision`、`NotificationSchedulingRun`、`NotificationReconciliationState`、平台 ID、能力/环境设备状态或旧 reconcile task/checkpoint/receipt/watermark。`ReminderInstance` 只按下列顺序命中第一条，不得重排或叠加隐式分支：

| 优先级 | source 实例条件 | target 状态 | 必须清理/保留 |
| ---: | --- | --- | --- |
| 1 | 原状态为 `acknowledged/snoozed/cancelled/expired` | 保持原业务终态 | 不重建平台请求。 |
| 2 | 其余实例的来源按 REM-021 已失效 | `cancelled` | 离开 paused/failed 时分别清 `pauseReason/failureCode`。 |
| 3 | `paused` 且原因仍成立 | `paused` | 保留 `pauseReason`，不重建平台请求。 |
| 4 | `paused` 原因已失效，目标在未来/已过 | `planned` / `expired` | 清 `pauseReason`；过去目标不补发。 |
| 5 | `scheduled/failed`，来源仍有效，目标在未来/已过 | `planned` / `planned` | 清 `failureCode`；过去目标只派生 application-only 待查看/逾期，永不补发。 |
| 6 | 原状态为 `planned` 且来源仍有效 | `planned` | 过去目标永不进入 desired platform request。 |

“来源失效”只按 REM-021 的穷举谓词判定；不得另造“不可操作”分支将同一输入写成 `expired`。TD-010 必须另建 dormant target-epoch force task 并在 activation-marker transaction 激活；普通 schema/cipher migration 保持 epoch、合法同 epoch 设备投影和实例状态，不执行此规范化。

### REM-013：通知投递状态

每次真实 adapter/platform 提交、取消或可观察回调尝试形成 `NotificationDelivery`；权限预检、channel 阻断和预算淘汰没有平台调用，只能形成 Decision：

| 状态 | 含义 |
| --- | --- |
| `requested` | 已产生待提交任务。 |
| `accepted` | adapter/platform API 返回成功；可以记录独立的 `adapterNativeId`。只表示接受请求。 |
| `observed_trigger` | App 收到平台触发回调；不是所有系统状态都保证回调。 |
| `observed_action` | App 收到用户动作及动作 ID。 |
| `cancelled` | App 已请求取消；后续按平台可提供的 pending/登记证据复核。 |
| `rejected` | 平台拒绝，保存受控错误码。 |
| `missing` | 本地期望存在，但平台可提供的 managed pending/登记证据中缺失。 |

同一提醒实例可以有多个设备、每个设备可以有多个投递尝试；同一 `(ReminderInstance, installation/device slot, transport, platform, recipientSlot)` 同时至多一个 current `platformRequestId`，同一 request 可有多个 `attemptSequence`。投递必须记录 `notificationDatasetEpoch`、TD-006 LongCounter `attemptSequence`、`scheduleFingerprint`、TD-009 `privacyIndependentFingerprint`、`effectivePrivacyMode`、category/action/payload/request identity 合同快照、精度、`environmentGeneration`、`capabilityFingerprint`、adapter contract version 和证据类型；Android 的 registry 条目只能作为 `android_registry_only` 证据，不能单独证明 AlarmManager 接受。Delivery 不保存 title/body/raw payload 或原生任意错误消息。

同一 `(reminderInstanceId, installation/device slot, transport, platform, recipientSlot, epoch, platformRequestId)` 身份的最新 attempt 必须存在，且其 `status=accepted`、fingerprint、precision、`environmentGeneration`、`capabilityFingerprint` 和 adapter contract 全部匹配当前有效输入，才是当前证据；最新 attempt 为 requested/rejected/missing/cancelled 时，较早 accepted 永不生效。旧 epoch 的 observed trigger/action 不得更新当前 Delivery 或 ReminderInstance；平台内部 ID 只能作为本机清理 metadata，不能取代项目生成的 `platformRequestId`。项目 `lbr2:` 身份必须显式包含 canonical `transport`，不能仅假定 recipientSlot 已自行命名空间化；不同 transport 的 request 与 action inbox 均不得碰撞。

### REM-014：逐实例调度决策

权限预检、channel 阻断和预算淘汰不会调用平台，因此不得伪造 NotificationDelivery。每轮对账为每个设备候选生成 device-only `NotificationSchedulingDecision`，唯一身份绑定 `(installationId, notificationDatasetEpoch, notificationInputRevision, transport, platform, recipientSlot, reminderInstanceId, reconciliationRunId)`，至少记录 `platformRequestId?`、`scheduleFingerprint`、`decision`、受控 `reasonCode?`、`requestedPrecision`、`environmentGeneration`、`inputFingerprint` 和 `computedAt`。`recipientSlot` 是同一 ReminderInstance 下稳定、无内容的收件人/设备投递槽，不得含邮箱、设备名或家庭名。

`decision` 固定为 `eligible_selected | permission_blocked | channel_blocked | capacity_deferred | unsupported | retryable_error | terminal_error`。exact 权限拒绝但已降级选择 approximate 时使用 `eligible_selected + requestedPrecision=approximate`，不写成阻断。Decision 是能力/预算选择和真实平台结果结束后的最终投影：平台 accepted 时仍为 `eligible_selected`，retryable/terminal 失败则必须改为对应 error；`eligible_selected` 本身不能显示“已安排”。

没有 matching accepted Delivery 时，单条显示映射固定为：

| Decision | 用户状态 |
| --- | --- |
| `permission_blocked` | 等待通知权限 |
| `channel_blocked` | 提醒渠道已关闭 |
| `capacity_deferred` | 等待补齐 |
| `eligible_selected` / `retryable_error` | 正在重新检查 |
| `unsupported` / `terminal_error` | 失败 |

### REM-015：输入修订与轮次发布

`NotificationInputRevision` 是每个 installation/epoch 从 `0` 开始的 branded TD-006 LongCounter。任何会改变候选、内容、排序、预算、精度、权限、channel、时区/tzdb 或合同结果的业务/设置/能力输入，必须在持有该输入的短事务中 checked `+1`，同时把相关 ReconciliationState 置 `pending`、清 `publishedRunId/scheduledThrough/inputFingerprint/failureCode` 并耐久入队。业务/设置事务在 revision 已到上限时拒绝整条命令。原生 capability/environment 是不能拒绝的已发生事实；其失效事务遇到上限时必须原子隐藏 pointer/水位、保留最大 revision、写 `notification_revision_exhausted` 耐久维护任务并停止新 platform write/current publish，直到受审迁移或新 dataset epoch 重置，绝不能回绕或继续展示旧成功。原生变化在 App 接收后的首个短事务执行同一失效；输入变化与旧 pointer 不得存在可观察中间态。

每轮对账建立身份绑定 `(reconciliationRunId, installationId, epoch, inputRevision, transport, platform)` 的 `NotificationSchedulingRun`，phase 为 `building | sealed | published | discarded`，并在 building 开始前固定 `inputFingerprint`、`expectedDecisionCount` 和完整候选集。最终 Decision 按 `(recipientSlot, reminderInstanceId)` ASCII 稳定排序后计算 `decisionSetHash`；seal 短事务必须验证行数精确相等、每个候选恰一行且集合 hash 匹配，sealed 后除 phase 的合法终态迁移外，header 其他字段与全部行不可改写或删除。规范 Decision 投影和 hash 编码由 TD-009 唯一定义。

只有最终 guard-CAS 可在同一事务将 sealed run 改为 published，并设置同 epoch/inputRevision/transport/platform 的 `ReconciliationState.publishedRunId`。只有该 state 为 `succeeded/degraded`，pointer 指向的 run 同时匹配当前 active epoch、input revision、transport、platform 和合同时，Decision 才是 current；building、未被指向的 sealed、discarded、部分、旧 epoch 或旧 revision 行永不驱动 UI。`degraded` 可发布完整 Decision 供逐条解释，但不发布全局成功水位，也不抹掉仍全部匹配的单条 accepted Delivery。全部这些投影均为 device-only，不进入 portable backup、业务同步或用户导出。

## 3. 提醒来源与 P0 能力

### REM-020：来源矩阵

| 来源 | 实例依据 | P0 计划数 | 到时后业务状态 | 通知动作类别 |
| --- | --- | ---: | --- | --- |
| 重复事项 | 周期实例 | 1 个主计划；可选重复催促 | 周期 pending，可能派生 overdue | recurring |
| 清单实例 | 截止 ScheduleSpec | 1 个相对/到时计划 | 清单 open/completed 独立 | checklist |
| 备忘 | 独立指定时间 | 1 个或多个计划 | 备忘不完成；提醒等待确认 | memo |
| 重要日期 | 日期发生项 | 多个提前/当天计划 | 日期是事实；提醒等待确认 | important_date |
| 低库存 | 低库存周期 enteredAt | 每周期 1 次 | 低库存持续到恢复 | low_stock |

保质期、保修期和家庭分工上线后复用同一模型，不新增平行通知系统。

### REM-021：来源失效条件

| 来源 | 取消未来提醒的条件 |
| --- | --- |
| 周期实例 | 完成、跳过、取消本次、规则切分移除、根记录归档/删除。 |
| 清单 | 全部有效项目完成、取消截止/提醒、归档/删除。 |
| 备忘 | 计划关闭、归档/删除；编辑正文不取消。 |
| 重要日期 | 计划关闭、日期修改使原发生项失效、归档/删除。 |
| 低库存 | 数量恢复、阈值变化解决周期、归档/删除或加入采购后仅停止重复关注。 |

所有取消先提交领域事务中的任务，再调用平台取消；平台取消失败进入对账，不恢复已经完成的业务对象。

家庭空间进入 `deletion_scheduled` 不是来源永久失效：ReminderSubscription 与适用实例进入 paused；空间进入 deleting/deleted、成员离开或计划永久删除才 cancelled。取消家庭删除只恢复未来实例，暂停期间已经过去的时刻转 expired。

## 4. 提醒时间生成

### REM-030：从计划到实例

每个计划展开实例时：

1. 解析来源的有效 ScheduleSpec 或状态发生项；
2. 按 REC-100 计算日历偏移或持续时间偏移；
3. 处理 DST、时区和过去时间；
4. 生成稳定 deduplicationKey；
5. 查找现有实例，存在则更新期望而不重复创建；
6. 写入 planned 实例和调度任务；
7. 调度器按预算选择并提交平台请求。

`state_entered` 表示即时发生的领域事实，不把提交事务中的“现在”伪装成可调度的未来。低库存实例的系统通知目标固定为 `floor(enteredAt / 1 minute) + 1 minute`，即进入时刻之后的下一个整分钟；若对账固定的 `now` 已达到或越过该目标，只保留应用内关注，不补发系统通知。相同 LowStockEpisode 重试必须复用原 `enteredAt` 和实例身份，不能滚动生成新的未来一分钟。

### REM-031：稳定去重键

逻辑组成至少包括：

```text
reminderPlanId
+ sourceOccurrenceKey / lowStockEpisodeId / one-time source key
+ trigger slot
+ snooze or follow-up generation
+ contract version
```

标题、正文和当前时区解析出的 Instant 不进入身份键；编辑时间后保持逻辑实例身份并替换平台调度，避免旧通知残留。

paused→active 必须保留原 ReminderInstance ID 和 deduplicationKey；恢复过程只重算是否仍在未来，不增加 follow-up generation，也不创建“补发”实例。

### REM-032：过去提醒

- 创建或编辑时计算结果已经过去：显示“提醒时间已过”，不立即补发；用户可改为现在、稍后或关闭。
- App 在目标时刻之后首次获得运行机会，但实例此前从未成功交给系统：不补发超过 24 小时的系统通知，改在应用内“待查看/逾期”展示原因。
- 延迟不超过 24 小时且来源仍有意义时，可以在用户打开 App 时显示应用内提示；不得伪装成准时系统通知。
- 重要日期当天仍在今天展示，和提前提醒是否错过无关。

### REM-033：提醒实例保留

- 终态提醒实例至少随来源记录保留，用于解释去重和历史，直到根记录永久删除；
- 系统投递诊断只保留安全规范允许的期限，不含内容；
- 重复催促的子实例可以在保留期后压缩为次数、首末时间和结果摘要；
- 备份包含业务提醒实例和必要去重状态，不必包含所有平台诊断尝试。

## 5. 默认一次与重复催促

### REM-040：默认一次

每个收件人范围内的提醒实例默认只向系统提交一次。用户没有动作时，业务对象继续按“今天”规则展示，但不自动再发系统通知；家庭成员之间各有独立 subscription，不共享“是否知道了”。

### REM-041：重复催促策略

P0 只有用户明确开启后才创建 `FollowUpPolicy`：

| 字段 | P0 规则 |
| --- | --- |
| `intervalMinutes` | 5 分钟至 24 小时；常用值 10、30、60、120。 |
| `maxFollowUps` | 1–10，必须有限；默认建议 3。 |
| `stopAfter` | 首次提醒后最长 24 小时，或来源自然失效，以更早者为准。 |
| `requiresUnacknowledged` | 固定 true。 |

不提供无限重复催促。医疗或紧急场景需要的保证不属于产品目标。

### REM-042：停止重复催促

以下任一发生时，在该动作适用的收件人范围内取消未触发后续实例：

- 当前收件人知道了或执行稍后之外的个人确认时，只停止该 subscription 的链；
- 完成/跳过共享周期、完成共享清单、加入共享采购清单、库存恢复或其他来源级处理时，停止所有适用 subscription 的链；
- 用户稍后提醒，原链停止，由 snooze 实例重新开始但不自动继承剩余催促，确认页可选择；
- 来源归档、删除、完成、日期失效或低库存解决；
- 达到 maxFollowUps 或 stopAfter；
- 用户全局关闭重复催促；已明确单条开启的计划需提示后再统一关闭。

## 6. 稍后提醒

### REM-050：创建 snooze

- 允许的最早时间是当前 Instant 后 1 分钟，最晚为 30 天后；
- 常用选项根据当前时间显示，例如 10 分钟、1 小时、今晚、明早；所有结果在确认前展示完整日期时间；
- 原实例进入 snoozed，新实例通过 `snoozedFromId` 关联并拥有新去重 generation；
- 不改变周期实例计划、清单截止、重要日期或备忘内容；
- 来源已经失效时拒绝创建并返回当前状态。

### REM-051：多次稍后

- snooze 链最长 20 次；达到后仍可打开记录，但不再从通知提供继续稍后，避免无限链和平台容量耗尽；
- 每次只保留一个当前有效 snooze 子实例；重复动作回调返回已有结果；
- 编辑原提醒计划不会自动改写当前 snooze，页面必须询问保留本次稍后还是按新计划重置。

### REM-052：跨日和来源截止

- 备忘可以稍后到任意允许时间。
- 周期实例可以稍后越过下一周期，但两次实例保持独立，通知文案注明原计划日期。
- 重要日期可以稍后到发生日之后，届时文案使用“回顾”而不是“还有 N 天”。
- 低库存只要当前周期未解决即可稍后；恢复正常后自动取消。

## 7. 通知动作

### REM-060：动作类别

| `categoryContractId` | 类别版本 | 动作版本 | `actionId` allowlist | 领域行为 |
| --- | ---: | ---: | --- | --- |
| `recurring` | 1 | 1 | `complete`、`skip`、`snooze`、`open` | CompleteOccurrence / SkipOccurrence / SnoozeReminder / navigation |
| `checklist` | 1 | 1 | `snooze`、`open` | SnoozeReminder / navigation |
| `memo` | 1 | 1 | `acknowledge`、`snooze`、`open` | AcknowledgeReminder(noted) / SnoozeReminder / navigation |
| `important_date` | 1 | 1 | `acknowledge`、`snooze`、`open` | AcknowledgeReminder(noted) / SnoozeReminder / navigation |
| `low_stock` | 1 | 1 | `add_to_shopping`、`acknowledge`、`open` | AddItemToShoppingChecklist / AcknowledgeReminder(noted) / navigation |
| `open_only` | 1 | 1 | `open` | navigation |

`categoryContractId + categoryContractVersion` 共同标识类别合同；平台 category identifier 由 adapter 的版本化登记表映射，不作为领域身份。类别或动作语义改变时增加对应合同版本，旧版本 parser 只按已发布 allowlist 解释或安全清理，不把未知值映射成当前动作。

payload 的交叉字段合同为：`sourceType=hidden` 当且仅当 `categoryContractId=open_only`；该组合必须同时使用 `categoryContractVersion=1`、`actionContractVersion=1`、`sourceId=null`、省略 `spaceId`，且 response 仅接受 `actionId=open`。敏感通知必须使用该组合；非敏感通知也只能在有效呈现合同主动选择更严格 open-only 时使用。任一非法交叉组合必须在 Lease A 前拒绝。

### REM-061：动作鉴权与锁屏

- 所有带目标的 response（包括默认“打开”）先在 lease 外做 bounded parse，依次校验 payload 大小/结构、必填合同版本、受控 ID grammar、category/action allowlist 以及 hidden/open-only 交叉字段；未知或不兼容输入不入箱、不执行命令。通过后才取得绑定 current active generation + epoch 的短 `DatasetReadLease A`，在 lease 内重验 payload epoch、当前 category registry 解释，并按 TD-009 重算且恒时比较含 transport 的 `lbr2:` platformRequestId；只有全部通过后才能在短事务写入加密 `NotificationActionInbox`，随后立即释放 Lease A。旧/缺失/非法/future epoch 不得先入箱。
- `actionInboxId` 由 TD-009 的版本敏感规范 hash 生成，必须绑定 transport、platform request identity、category/action/payload/request identity 合同版本和用户实际 action；任一 transport 或语义版本改变都不得命中旧 inbox 幂等结果。Inbox 只保存 allowlist 字段与受控结果码，不保存 raw payload、title/body 或任意原生 metadata。
- P0 所有完成、跳过、知道了、稍后和加入采购清单等改变领域状态的快捷动作都只打开 App；平台认证/破坏性标记只作附加防护，不能成为执行授权。
- 等待 SCR-002 应用锁或用户交互期间不得持有 DatasetReadLease。解锁后、读取目标前取得绑定 then-active generation + epoch 的 fresh `DatasetReadLease B`；暂时无法取得 Lease B 时 inbox 保持 `pending` 并 defer，不得误标 stale。取得后重新验证 inbox epoch、完整 request identity、category/action 合同、当前空间授权和最新来源状态。
- fresh Lease B 下 epoch 或 request identity 已改变时，结果是终态 `stale_noop`，不读取或缓存目标；identity 仍 current 但 membership/授权、来源、动作或 category 语义已不允许时，在短事务将 inbox 消费为 `business_noop`。两类结果不得互相代替。
- mutating action 在 Lease B 下以单一领域事务消费 inbox、写业务 mutation/幂等结果和后续 input revision/reconcile task；提交前 epoch/lease 变化则整体回滚。默认 `open` 不持久化解析目标：router 只接收在 Lease B 下重新生成、以 `actionInboxId` 作为幂等身份的 `NavigationIntent`，在紧邻导航前验证并将 inbox 置 `applied`。即使响应已处理，重放也必须再取 fresh Lease B，不能复用旧目标缓存。
- 敏感通知只显示“打开”，不在锁屏提供其他动作；通知 payload 不包含敏感内容。
- 动作回调验证 category/action contract ID 与版本、实例、来源当前状态和幂等键，不能信任客户端按钮名称。

ActionInbox 的可恢复执行状态机固定为：取得 Lease B 后，processor 才以 actionInboxId、expected state、checked `processingAttempt+1`、随机 `claimToken` 和当前 `claimOwnerSessionId` CAS `pending/failed_retryable→processing`；持有同 claim/lease 才能转 `applied/business_noop/stale_noop/failed_retryable/failed_terminal`。每个 App 进程使用新随机 session ID，启动时把其他 session 遗留的 processing claim 原子退回 pending；同一 session 用单调时钟 watchdog 回收超时 claim，不以可回拨墙钟决定所有权。`failed_retryable` 由耐久任务按有上限的指数退避重新入队；Repository 进入 active、App 启动/前台、成功解锁和 retry 到期都幂等扫描。Lease B 暂不可得时不 claim，保持 pending 与耐久唤醒任务。Navigation router 以 actionInboxId 幂等接受 intent，因此“已导航但 applied 尚未提交”崩溃后可安全重放并收敛。

### REM-062：迟到和重复回调

- 已完成实例再次收到完成：返回“已经完成”，不新增历史。
- 已跳过实例收到完成：属于状态冲突，打开详情让用户决定是否撤销跳过，后台不自动覆盖。
- 已解决低库存收到加入采购：打开当前物品状态，不创建过时项目。
- 已删除/永久删除来源收到任何动作：返回不可用，清理残留系统通知。
- 同一动作被 iOS/Android 重放只执行一次。
- Lease A 发现 old、missing、malformed 或 future dataset epoch 时不创建 ActionInbox、不更新 Delivery、不打开目标、不产生 mutation；最多打开无目标首页，清除 last response 并定向清理对应通知。Lease A 后 dataset 才切换的已入箱响应由 fresh Lease B 归类为终态 `stale_noop`，不访问 previous dataset。
- current-epoch response 在入箱后若来源已经终态、删除、失权或动作过期，以 `business_noop` 完成并返回当前状态；不能回退执行旧语义。
- control 为 `validating`、integrity-blocked 或 Repository 未开放时，语法合法但尚不能分类的 response 标记瞬时 `deferred_unclassified`：只做 bounded parse 和平台要求的 completion acknowledgement，不入箱、不写 App 明文暂存、不清 last response/目标通知、不导航。notification subsystem 第一次重新进入 active 必须主动 re-fetch 平台 last response 并从 bounded parse 重跑；平台 adapter 不保证保留时只能进入无目标首页并记录无内容诊断，不得伪装成 `business_noop`。

### REM-063：前台通知

App 正在前台且用户正在查看同一对象时，不重复展示系统横幅；使用温和的应用内反馈并刷新状态。查看其他页面时可以按用户设置显示应用内横幅。是否展示横幅不改变提醒实例的到时状态。

## 8. 通知内容与隐私

### REM-070：内容模式

全局模式：

| 模式 | 标题 | 正文 |
| --- | --- | --- |
| 完整内容 | 记录标题或适用业务标题 | 简短时间/状态信息，不含完整正文。 |
| 只显示标题 | 记录标题 | “打开生活有谱查看详情”。 |
| 完全隐藏 | “生活有谱提醒” | “有一件生活小事该看看了。” |

敏感记录在 P0 强制使用完全隐藏；全局选择完整内容或只显示标题都不能降低这一保护。未来若允许单条降低，必须新增产品决策和风险确认；P0 不提供该入口。

### REM-071：Payload 最小化

系统通知 data payload 只包含以下命名字段；可见 title/body 受 REM-070 约束，不属于 data payload：

- `payloadContractVersion`；
- `requestIdentityContractVersion`；
- `notificationDatasetEpoch`：TD-006 `LongCounter` 的无前导零规范十进制字符串；
- `reminderInstanceId`；
- `sourceType` 与可空 `sourceId`，均为受控类型和不透明 ID；
- `categoryContractId` 与 `categoryContractVersion`；
- `actionContractVersion`；
- `deduplicationKeyHash`：`H("life-book/reminder-deduplication-key/v1", {"deduplicationKey": <exact stored canonical string>})` 的完整 256-bit SHA-256，编码为恰好 64 个小写 ASCII hex 字符；`H` 与 JCS 编码只由 TD-009 定义，不允许截断；
- 可选 `spaceId`（P2，仍为不透明值）。

不得包含记录正文、清单项目、物品名、精确数量、附件路径、API Key、账号邮箱或可直接使用的长期认证令牌。

敏感通知固定使用 `sourceType=hidden`、`sourceId=null`、`categoryContractId=open_only`、category/action version 均为 `1`，并省略 `spaceId`；解锁后只用 `reminderInstanceId` 在 fresh Lease B 下反查当前授权目标，不能让 payload 暴露记录类型或空间关系。`sourceType=hidden` 与 `categoryContractId=open_only` 必须同时成立或同时不成立，不允许半套隐藏组合。

缺失、非法、溢出或未知 `notificationDatasetEpoch` 不得解释成 `0`；未知 payload/request/category/action contract 只能无目标打开与安全清理，不能执行领域命令。

### REM-072：文案来源

通知显示文案在调度时由本地内容策略生成，并保存必要的非权威快照供系统展示。记录后来被编辑、变敏感、归档或删除时必须取消并重新调度/清理旧快照，不能只更新数据库。

### REM-073：角标和声音

- P0 默认不使用 App 图标角标累计未处理数，避免无法准确清除和制造压力。
- 用户明确设置的提醒使用系统默认通知声音；用户可以在系统/产品设置关闭。
- 非用户明确的建议、回顾或服务状态默认静音且遵守应用静默时段。
- 不使用全屏通知、持续震动或绕过勿扰的通道。

## 9. 权限状态与申请

### REM-080：先保存再申请

用户第一次保存含提醒计划的记录时：

1. 先在本地成功保存记录与计划；
2. 展示系统权限前置说明；
3. 用户继续后请求操作系统通知权限；
4. 根据结果调度或标记应用内提醒；
5. 创建成功反馈准确显示“会发送系统通知”或“已记录，需开启通知”。

权限弹窗取消或拒绝不得回滚记录。

### REM-081：iOS 通知状态

按平台返回区分 `not_determined`、`denied`、`authorized`、`provisional` 和 `ephemeral`：

- not_determined：可以在场景说明后请求；
- denied：不重复弹系统请求，提供设置入口；
- authorized：正常调度；
- provisional：可调度但页面说明可能以非打扰方式出现；
- ephemeral：只在平台适用场景使用，不把它当永久授权。

App 每次回到前台检查状态变化并对账。

### REM-082：Android 通知权限

- Android 13 及以上在创建通知渠道后按场景请求通知权限；
- 拒绝后计划仍保存，今天和设置显示应用内状态；
- 用户从系统设置重新允许后，App 回前台时补齐未来调度，不补发已过时通知；
- Android 8 及以上使用有明确名称和说明的渠道，不依赖系统生成的含糊默认渠道。

### REM-083：Android 精确提醒

P0 使用需要用户主动允许的 `SCHEDULE_EXACT_ALARM` 路径，不默认声明受更严格商店限制的 `USE_EXACT_ALARM`：

- 只有用户明确创建分钟级提醒且普通通知权限已具备时，解释并引导到特殊访问设置；
- 每次调度前检查 `canScheduleExactAlarms()`，不能缓存一次授权永久使用；
- 拒绝或被撤销时使用平台允许的近似窗口调度，并在记录确认、详情和设置显示“可能在设定时间附近提醒”；
- 获得授权、设备重启或 App 升级后重建适用精确调度；
- Android 撤销精确提醒访问可能直接停止 App 并删除已安排的精确闹钟，且不能依赖撤销广播。下一次 App 获得运行机会时必须重新查询能力并把仍在未来的期望请求按近似模式强制重挂；不得承诺撤销后立即自动恢复；
- 不主动请求忽略电池优化白名单，只在用户报告问题时提供厂商相关排查说明。

### REM-084：权限优先级

```text
通知权限 denied → 不提交系统通知
通知权限 allowed + Android exact denied → 近似调度
通知权限 allowed + exact allowed/不适用 → 按平台能力精确调度
系统 Focus/摘要/渠道设置 → 产品只展示状态入口，不能覆盖
```

## 10. 调度器与滚动窗口

### REM-090：本地数据库是权威

提醒业务事实来自 active 数据库中的 `ReminderPlan`/`ReminderInstance`；当前通知数据集身份只来自当前 `phase=active` 的受认证 `DatasetControlRecord`。control 不可读、phase 非 active 或 Repository 未开放时，调度、response 入箱和动作处理全部停止。系统待通知队列是可丢失外部副本；App 重装、系统清理、升级、权限变化或厂商行为导致队列丢失时，必须能从业务数据重建。

### REM-091：调度预算

P0 采用保守预算，不依赖平台在超量时选择保留哪条：

| 平台 | 总请求预算 | 其中预留 | 说明 |
| --- | ---: | ---: | --- |
| iOS | 48 | 8 个用于 snooze、近期编辑和立即补齐 | 48 是保守产品预算，不依赖历史上常被引用的 64 条，也不是 Apple 公共 API 的永久保证。 |
| Android | 200 | 20 个用于 snooze 和近期变化 | 控制闹钟与资源数量；平台或厂商更严格时动态降低。 |

预算指当前提交到操作系统的请求，不限制数据库中 planned 实例数量。普通候选上限分别为 iOS 40、Android 180；未使用的预留可临时借给普通候选，但 snooze/近期编辑可以驱逐最远且最低优先级的普通请求。实现不得把数值当作平台永久保证；平台测试发现限制变化时只能通过受控配置下调并更新规范，未经发布矩阵不得远程提高。

### REM-092：选择优先级

调度候选先过滤无效来源，再按以下顺序占用预算：

1. 已由用户稍后提醒且 24 小时内发生；
2. 用户明确设定的未来 24 小时提醒；
3. 未来 7 日提醒；
4. 未来 30 日提醒；
5. 更远提醒按时间先后。

相同时间使用：重复事项、清单、备忘、重要日期、低库存的稳定顺序，再按提醒 ID。敏感状态不降低优先级。

### REM-093：原生重复触发器

P0 一律使用滚动窗口内的单次请求，不启用操作系统原生重复触发器。未来只有同时满足以下条件，并以新 ADR 替代 TD-009 后，才可以对受限规则采用该优化：

- 平台触发语义经契约测试与 REC-* 规则完全一致；
- 规则无结束次数/日期、无仅本次例外、无复杂间隔、无重复催促；
- 动作回调能确定性解析当前来源 occurrence；
- 时区变化和完成/跳过不会造成无法取消的重复提醒；
- 平台版本测试通过月末、DST、重启和升级。

任一条件不满足仍使用单次滚动调度。业务层看不到平台优化差异，已发布规则和实例身份也不得因优化改变。

### REM-094：覆盖范围

- 目标是优先覆盖未来 30 日；预算不足时按 REM-092 保证最近提醒，并在设置显示“已安排到 YYYY-MM-DD”。
- 任一未来 7 日用户提醒无法提交时显示高可见非阻断警告和诊断入口。
- 复杂规则在滚动窗口之外依赖 App 再次获得运行机会补齐；详情必须能预览规则未来发生项，但不假装已全部交给系统。
- P1 远程推送可以作为补充，不取代本地计划和去重。

## 11. 对账与恢复触发

### REM-100：必须对账的时机

- App 初始化完成后；
- schema/cipher migration 保持 dataset epoch，只在调度数据或合同变化时做普通重排；
- App 从后台回到前台；
- 保存、编辑、归档、删除、恢复单条记录或永久删除相关来源后；单条记录恢复只触发普通来源对账，dataset epoch 不变；
- 完成、跳过、知道了、稍后、清单完成或库存变化后；
- 通知/精确提醒权限或 Android 渠道状态变化后；
- 系统时区、显著时钟或时区数据库变化后；
- App 版本升级后；
- Android 设备开机和系统允许的相关广播后；
- P1 同步应用远程变化后；
- Space 进入或取消 deletion_scheduled，ReminderSubscription 的 mode/status/membership tenure 改变后；
- SpaceTransferOperation committed 后，在来源设备取消旧空间投递并在仍有目标权限的设备按目标空间重建；
- 整体 dataset restore/manual rollback 提交成功后，以新的 epoch 和 `reason=dataset_epoch_changed` 强制对账；失败并回 previous 时 epoch 不变且不产生该原因。

除整体 replacement 创建新 epoch 外，上述任一改变只要影响调度输入，必须遵循 REM-015，在变化成为可观察的同一事务推进 NotificationInputRevision、隐藏旧 published run 并入队；不得只发一个可丢的内存事件。

### REM-101：对账算法

```text
取得绑定 active generation + notificationDatasetEpoch 的 DatasetReadLease
→ 固定 epoch、NotificationInputRevision、transport/platform、now、时区/tzdb、能力/环境与全部合同 guards
→ 枚举 pending/delivered；先定向清理 legacy、旧、缺失、非法或 future epoch
→ 读取有效计划和来源
→ 计算并稳定排序滚动窗口内的完整候选集与 platformRequestId/schedule fingerprint
→ 创建 building SchedulingRun，写入 inputFingerprint 和 expectedDecisionCount
→ 按能力、预算和预留选出期望请求
→ 读取 iOS pending 或 Android adapter registry，以及同 epoch 的最新 Delivery attempt
→ 优先取消失效、失权和隐私收紧的 current-epoch 旧请求
→ 提交缺失或 fingerprint 已改变的请求
→ 环境 generation 要求重建时强制重挂全部已选请求
→ 定向取消其余不再期望的 managed 请求
→ 逐项真实平台结果写带 epoch/fingerprint 的 receipt 与 checkpoint
→ 根据预检/选择/最终平台结果为每个候选写恰一条最终 Decision
→ 核对 expected count、候选一对一与 decisionSetHash，将 run seal 为不可变
→ 重读 active generation/epoch、NotificationInputRevision、environment/capability、tzdb/engine/adapter 全部 guards
→ 全匹配时以单一 CAS 发布 run + publishedRunId；完整成功才同时发布 succeeded + scheduledThrough + lastSucceededAt
→ guard 变化时 discarded 且耐久入队；平台失败时可发布 degraded 完整 run，但无当前成功水位
```

整个对账可重复执行。平台调用不位于数据库事务内，被中断后从带 epoch/input revision 的可重放任务和短事务 checkpoint 继续，不以进程内列表作为进度，也不在正常对账调用全量取消。每个外部平台写入前后都重验 lease；epoch 变化后停止写入。真实 receipt 即使随后输入变化也可以保留为非当前技术事实，但只有最终单一 guard-CAS 可以发布 `NotificationReconciliationState.state=succeeded/degraded`、`publishedRunId`，且只有 succeeded 可发布 `scheduledThrough/lastSucceededAt`；CAS 失败、输入 revision 改变或提交前崩溃不得留下部分 Decision 或伪成功水位。尚未确认清理成功的 stale 请求继续占用预算，但永远不取得目标导航或动作权限。

iOS pending 列表可作为当前待处理请求证据；Android 普通应用不能枚举 `AlarmManager` 的真实队列，Expo adapter registry 只证明曾登记。Android 在权限、重启、升级、时钟/时区或其他可能丢失真实闹钟的环境变化后必须强制重挂，不能因 registry 仍有条目而跳过。平台 API 返回成功只形成 `accepted`，不证明准时展示。

Android 只有 registry 中 platformRequestId/fingerprint/epoch 匹配，且最新 attempt 是相同完整投递身份、fingerprint、precision、`environmentGeneration`、`capabilityFingerprint`、adapter contract 的 `accepted` 成功回执时，才可跳过提交。每次平台调用前先写新的 LongCounter `attemptSequence` 与 `requested` attempt；最新 attempt 为 requested/rejected/missing/cancelled 或缺少当前成功回执时，即使 registry 有条目也必须同 ID 重挂，不能采用更早或其他 epoch 的 accepted。

### REM-102：内容变更重排

以下变化即使时间不变也必须替换平台请求：

- 标题或通知摘要改变；
- 敏感状态或通知内容模式变严格；
- category/action contract ID 或版本改变；
- 来源空间或权限改变；
- payload 或 request identity contract version 改变。

隐私收紧、删除、归档或失权必须先尝试取消旧 pending 并尽力清除 delivered，再提交适用的更严格新请求；即使 mandatory cancel 失败，也继续尝试同 ID upsert 更严格快照，但该轮必须 degraded、保留清理重试且不发布成功水位。普通编辑以相同 `platformRequestId` 替换。只有当前有效呈现合同已经撤销旧 category/action（例如转 hidden/open_only）时，收紧前已到达的旧动作 response 才在 fresh Lease B 下消费为 `business_noop`；仅 `full→title_only` 且 category/action 未变时仍按当前授权、来源和业务状态处理。

纯隐私放宽也会推进 NotificationInputRevision 和重新发布 Decision，但不得自动扩大已交给平台的内容或动作。若 TD-009 的 `privacyIndependentFingerprint` 未变且没有耐久 force marker，desired mapper 必须把现有 matching accepted Delivery 的实际 privacy/category/action 快照保留为 `effectiveScheduledPresentationContract`。用户明确选择“更新已安排通知”时，同一事务推进 input revision，并写绑定该 target revision 的 device-only `forcePresentationRefresh` sticky task reason；后续 revision 必须继承该 marker，直到一个 guarded published succeeded run 已确认所有适用 replace/cancel 完成，才在发布事务清除。平台调用或发布前崩溃不得丢失该选择。旧 `open_only` 在来源仍授权时是严格只导航子集，可在 fresh Lease B 下导航，但永不恢复来源类别的 mutating action。

### REM-103：调度失败重试

- 临时平台错误：指数退避并在下次前台对账重试；
- 权限错误：停止自动重试，等待权限变化；
- 预算不足：保留 planned 并按优先级后续补齐；
- 不支持触发器：降级单次调度；仍不支持则显示失败并保留应用内关注；
- 未知错误：记录非敏感错误码和 `platformRequestId`，不能记录通知内容。

### REM-104：整体恢复后的通知收敛

- TD-010 的 activation-marker transaction 必须原子激活绑定 operation/target generation/target epoch 的 `reason=dataset_epoch_changed` force-reconcile task，并为当前 installation/transport/platform 初始化 target-epoch `NotificationReconciliationState`：`state=pending`、`notificationInputRevision=0`，`publishedRunId/scheduledThrough/lastAttemptedAt/lastSucceededAt/inputFingerprint/failureCode=null`；`environmentGeneration/capabilityFingerprint` 取接收设备在 preflight 固定并经 DeviceStateOverlay 传入的当前无内容能力快照，budget 与 tzdb/recurrence/adapter version 取 target build 的固定合同值。该 receiving-device 基线不可得时不得越过 activation marker；绝不能从 portable/source 的设备投影补值。旧 run、Decision 或成功水位不复制。
- TD-010 只在新 Repository 可用且上述 task/state 可耐久读取后返回 `RestoreSucceeded`；不等待平台清理或重挂完成。task 先发起并尽力确认 stale epoch 的定向清理；未确认项继续占预算，但在剩余预算内仍重挂 current epoch，不能因无法证明清理完成而永久阻塞新提醒。新 Decision、SchedulingRun、checkpoint、receipt、watermark 和 ReconciliationState 全部绑定同一 target epoch/input revision；
- 清理或重挂失败时，恢复 API/UI postcondition 为 `RestoreSucceeded + degraded_reconciliation`，实体 `NotificationReconciliationState.state=degraded`，显示“恢复成功，提醒正在重新检查”，幂等重试，不回滚数据集也不把恢复改报失败；
- 本轮只能按 REM-015 封口并发布完整 run。完整成功时才发布 succeeded 水位；平台失败可发布 degraded Decision 但无成功水位；guard 变化或崩溃不发布本轮。degraded 不抹掉仍匹配的单条 accepted Delivery；
- 旧通知的安全性依赖 REM-061/062 epoch fence，而不依赖清理完成；`environmentGeneration` 不因 dataset replacement 推进。

## 12. 应用静默时段与系统勿扰

### REM-110：用户明确提醒不被应用改时

用户明确设置的提醒在应用静默时段内仍按该时间提交。App 可以说明系统勿扰可能影响展示，但不得把 23:00 自动移到次日。

### REM-111：非明确通知

系统建议、备份提示、生活回顾、服务状态和营销类通知：

- P0 不使用系统通知发送备份提示；只在 App 内展示；
- 后续默认遵守应用静默时段；
- 不占用用户提醒的调度预算优先级；
- 用户可以按类别关闭；
- 不得使用“用户提醒”渠道绕过低优先级设置。

### REM-112：系统控制

操作系统 Focus/勿扰、通知摘要、渠道声音、锁屏预览和厂商省电由系统或用户控制。设置页提供跳转和说明，不显示“生活有谱已保证响铃”等无法验证文案。

## 13. P1 远程推送扩展

### REM-120：本地优先、远程补充

P1 远程推送用于：

- 同步后另一设备创建/改变的近期提醒；
- 家庭成员协作事件；
- 本地调度水位不足时符合产品决策的补充；
- 服务状态或安全事件。

远程服务不得成为本地手动提醒的唯一事实源。收到远程推送后先按 deduplicationKey 与本地实例合并，再展示或调度。

### REM-121：跨设备去重

- 用户可以设置某提醒在所有设备或选定设备通知；默认所有活跃设备。
- 每台设备有独立 delivery，但共享逻辑 reminder instance ID。
- 一台设备完成/知道了后同步取消其他设备未来重复催促；已经展示的通知尽力清理。
- 同步延迟可能使两个设备都展示首次提醒，产品不得声称全局恰好一次。

### REM-122：推送内容

默认远程 payload 只携带 REM-071 允许的不透明 ID、合同版本和设备当前 `notificationDatasetEpoch`，由已同步本地数据生成可见内容；服务端尚未获知新 epoch 时发出的旧 push 即使展示，其 response 也必须在本机 fence 前 no-op。若平台要求在服务器生成可见通知，必须遵循最严格隐私模式，且服务端不得持久化完整标题/正文用于推送。

### REM-123：账号和家庭收件人

- P1 个人空间为账号 owner 建立默认 ReminderSubscription；同一账号多个 Device 共享一个收件人范围内的 ReminderInstance，各自拥有 NotificationDelivery；
- P2 家庭 ReminderPlan 属于共享业务记录，每个主动订阅成员拥有独立 subscription 和收件人范围内的 ReminderInstance；
- 创建计划的成员默认订阅，其他成员不因加入家庭自动订阅全部提醒；具体权限和退出规则见 FAMILY-090～FAMILY-092；
- 知道了、打开和稍后只改变当前 membership/subscription 的提醒实例；完成/跳过共享周期、完成共享清单、加入共享采购清单、库存恢复等共享业务动作按来源规则对账所有成员适用的未来实例；
- 一个成员退订不关闭 ReminderPlan 或其他成员订阅；计划关闭、记录归档/删除、来源失效时取消全部订阅实例；
- deduplicationKey 必须包含 subscription 身份或等价收件人槽位，同一账号的多个 Device 不能因此生成不同逻辑实例。

### REM-124：家庭空间暂停

- 家庭进入 deletion_scheduled 时，服务端停止该空间新远程投递，将 active subscription/instance 置 paused；已同步设备取消相应平台调度。
- 离线设备收到空间状态前仍可能展示已安排通知，产品必须说明“联网后停止”，不能承诺远程绝对撤回已经交给系统的通知。
- owner 取消删除时只把原 mode!=off 的 subscription 恢复 active；未来实例回 planned，暂停期间已到时实例转 expired，不补发、不恢复旧平台 ID。
- 家庭到期 deleting/deleted、成员退出或被移除时 subscription 进入终态 cancelled；同账号重新加入会基于新 membership 建立新 subscription，不能恢复旧链。

## 14. 可观察状态与用户诊断

### REM-130：设置页状态

通知设置至少展示：

- 系统通知权限；
- Android 精确提醒权限与近似降级；
- Android 用户提醒渠道是否关闭；
- 只有 active control epoch、当前 NotificationInputRevision、transport/platform 和 pointer 全匹配，且 `NotificationReconciliationState.state=succeeded` 时的 `scheduledThrough/lastSucceededAt`；任一不匹配、状态缺失/pending/running/degraded 时显示“正在重新检查”，不得沿用旧值；
- 只有 state 为 `succeeded/degraded`，且 `publishedRunId` 指向完整 current epoch/input revision/transport/platform run 时，才从其 Decision 汇总失败或容量不足数量；没有 current published run 时显示“当前未知”，不得显示成 0，也不显示敏感标题；
- “重新检查并安排”操作；
- 平台勿扰和厂商省电帮助入口。

### REM-131：单条状态

记录或提醒详情展示：

- 业务提醒时间；
- 系统通知：已安排 / 近似安排 / 等待通知权限 / 提醒渠道已关闭 / 等待补齐 / 正在重新检查 / 失败；
- 已安排时的目标时间和内容隐私模式；
- 平台限制说明入口。

单条“已安排/近似安排”只由完整投递身份 current epoch、全部合同与能力证据匹配且最新 `status=accepted` 的 Delivery 派生；显示的内容隐私模式取由该 Delivery 实际 privacy/category/action 快照构成的 `effectiveScheduledPresentationContract`。否则只在 ReconciliationState 为 `succeeded/degraded` 且 pointer 全部匹配时，按 REM-014 固定映射使用当前 Decision；没有 current Decision/pointer 或任一 fence 不匹配时显示“正在重新检查”。全局 degraded 不抹掉仍匹配的单条 accepted Delivery，但不得展示覆盖水位或最近成功；整体恢复后不得沿用旧 epoch 状态，也不能把“提醒计划已保存”写成“系统通知已安排”。

### REM-132：诊断包

用户主动生成的一次性诊断信息可以包含：

- App/系统版本、时区数据库版本；
- 权限和渠道状态；
- 提醒/投递的随机 ID、时间、状态和错误码；
- 对账水位、预算使用和无内容 Decision/reasonCode 汇总；
- 厂商与设备型号。

不得包含记录标题、正文、清单项目、物品名、附件、精确库存或原始智能输入。发送前展示内容并取得确认。

## 15. 测试矩阵

### REM-140：状态与动作

每个来源至少测试：

- 正常调度、触发观察、打开、适用快捷动作；
- 相同动作重复回调；
- 动作到达前来源被编辑、完成、归档、删除或永久删除；
- 同业务 ID 跨 epoch 或 transport 的 platformRequestId 必须不同；old/future/missing/malformed epoch 不能入箱、导航目标或执行命令；
- 相同 epoch/request/category/action/payload 但不同 categoryContractVersion 必须得到不同 actionInboxId；旧版本只按旧 allowlist 解释；敏感 `open_only` 不能接受来源类别动作；
- 分别改变 category/action/payload/requestIdentityContractVersion，验证 actionInboxId 均不同；穷举 `hidden/open_only/version/sourceId/spaceId/actionId` 交叉组合，只允许 REM-060 规定的组合入箱；
- callback 在 control 切换前、validating 中和 phase=active 后到达，以及 inbox 已写但 command 未执行时 activation 取得 gate；结果只能完整旧事务、`deferred_unclassified`、终态 `stale_noop`、完整 current 事务或 current `business_noop`，绝不出现半事务；
- parser Lease A 入箱后立即释放；模拟任意长锁屏等待及期间 dataset replacement，fresh Lease B 必须阻止旧目标导航/mutation，activation gate 不被用户等待占用；
- Lease B 暂时不可用时 inbox 保持 pending；取得后分别验证 epoch/request 变化只得 `stale_noop`，identity current 但失权/来源终态/动作过期只得 business_noop；在 claim 后、领域提交前后及导航接受前后逐点 kill，跨进程 session 回收、同进程 watchdog 与 retry task 必须最终收敛且业务动作至多一次；
- `open` 成功后不存目标、inbox 置 applied；重放必须重取 Lease B，不得复用 NavigationIntent 或绕过当前授权。validating 期间不写明文/不清 last response，首次 active 必须 re-fetch 重跑；
- 纯隐私放宽保留更严格 effective contract 与 open-only 导航，不恢复 mutating action；明确 refresh marker 在平台调用/receipt/publish 各点崩溃后仍保留并最终清除。隐私收紧仅在新合同撤销旧 category/action 时使旧动作 business_noop；full→title_only 且动作合同未变仍可通过 fresh Lease B；
- stale pending/delivered 清理失败仍不能赋予旧 response 动作权限；
- restore/manual rollback 穷举 REM-021 来源有效/失效、future/past、业务终态、暂停原因成立/失效，验证严格按 REM-012 首条命中、适用 reason 被清理且所有过去目标不补发；
- 稍后一次、多次、跨日、跨下个周期和达到上限；
- 默认一次、重复催促停止条件和预算竞争；
- 敏感/普通与三种通知内容模式；
- 三成员分别知道了低库存、加入共享采购清单、mode=off、paused/cancelled，以及一个成员动作不影响其他成员个人确认状态。

### REM-141：平台与权限

- iOS：not determined、denied、authorized、provisional，Focus、通知摘要、重启、升级、时区/DST；
- Android：通知允许/拒绝、exact 允许/拒绝/撤销、渠道关闭、重启、升级、Doze、主要厂商省电；
- 两平台：App 前台/后台/终止、系统通知被手动清除、系统时钟改变、存储恢复、调度队列丢失；
- committed replacement epoch 恰好递增一次、validating 无 marker 回旧增量为零、marker 后完成不二次递增、migration 增量为零；
- 不把模拟器结果作为真机通知验收。

### REM-142：容量与长期测试

- 预算以下、恰好预算、超过预算 1 和大幅超过预算；
- 多个同一时刻提醒的稳定排序；
- 30 天覆盖水位和滚动补齐；
- 只有 same-epoch `NotificationReconciliationState.state=succeeded` 且 `scheduledThrough` 非空才显示全局覆盖水位；force-reconcile task 耐久但平台清理/重挂失败时保持恢复成功并进入 degraded reconciliation；
- 在最终 guards 读取前后和 Decision/publishedRunId/succeeded 水位 CAS 的每个写点崩溃；只有全谓词匹配的单次提交能发布成功水位，dormant/旧 epoch/非 published run Decision 永不可见；
- 每一类业务/设置/能力/合同输入变化都在同一事务使 input revision `+1`、pointer/水位清空并入队；模拟 LongCounter 溢出必须安全失败，不得回绕；
- 在 building 每个 Decision 写点和 seal/publish 边界崩溃；验证少行、多行、重复候选、排序/hash 不同均不能 seal/publish，sealed 后不可改写；
- 对所有 Decision 枚举验证 REM-014 显示映射，并验证只有 succeeded/degraded 且 epoch/inputRevision/transport/platform/pointer 全匹配的行可见；
- 权限、channel、容量阻断在零 platform call 时仍产生逐实例 Decision；exact 拒绝但 approximate 接受时显示近似安排，不显示等待精确权限；
- 连续 14 天真机测试包含至少一次重启、时区变化和权限切换；
- App 30 天不打开后重新进入，验证不会补发过时洪水且能恢复未来水位；
- 系统限制或库版本变化时先运行契约测试再升级依赖；
- 家庭待删除期间设备离线、恢复联网、取消删除和到期删除，验证暂停期间不生成新投递、恢复只安排未来时刻、重新加入不复活旧 subscription。

## 16. 官方平台依据

以下资料用于解释平台能力，产品规则仍以本文的更严格边界为准：

- [Apple：Scheduling a notification locally from your app](https://developer.apple.com/documentation/usernotifications/scheduling-a-notification-locally-from-your-app)
- [Apple：Configuring background execution modes](https://developer.apple.com/documentation/xcode/configuring-background-execution-modes)
- [Android：Schedule alarms](https://developer.android.com/develop/background-work/services/alarms)
- [Android：Exact alarms are denied by default on Android 14](https://developer.android.com/about/versions/14/changes/schedule-exact-alarms)
- [Android：Request special permissions](https://developer.android.com/training/permissions/requesting-special)
- [Expo：Notifications](https://docs.expo.dev/versions/latest/sdk/notifications/)

平台文档和商店政策会变化。每次提高 target SDK、升级通知模块或提交新发行渠道时重新核验，并把行为变化写入技术决策和测试矩阵。

## 17. 变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| v1.10 | 2026-07-26 | 将 TD-009 的 privacyIndependentFingerprint 纳入逐次 Delivery 证据，支持隐私放宽的跨崩溃确定比较。 |
| v1.9 | 2026-07-26 | 增加 transport 隔离身份、ActionInbox 可恢复状态机、耐久隐私刷新意图、精确 dedup hash、revision 耗尽和完整 restore 初始化合同。 |
| v1.8 | 2026-07-26 | 统一对账只使用 NotificationInputRevision 作为业务与设置输入的并发护栏，并明确 sealed run 的合法 phase 终态迁移。 |
| v1.7 | 2026-07-26 | 增加 NotificationInputRevision、sealed SchedulingRun 和完整 Decision 发布，固定 restore 优先级、Lease B 分类、hidden/open-only 交叉合同、有效呈现合同与单条状态映射。 |
| v1.6 | 2026-07-26 | 增加逐实例调度 Decision、短 parser/fresh action lease、guard-CAS 水位、确定性恢复映射、validating defer 与 P1 聚合边界。 |
| v1.5 | 2026-07-26 | 增加 notificationDatasetEpoch payload/fence、ActionInbox 前置门、同 epoch Delivery/水位、整体恢复状态规范化与提交后 degraded reconciliation。 |
| v1.4 | 2026-07-26 | 明确收件人范围逻辑状态与逐设备投递分离，并增加 Android registry 与同代成功回执的双重对账条件。 |
| v1.3 | 2026-07-26 | 与 TD-009 统一一次性调度、低库存下个整分钟、快捷动作安全门、平台证据、权限撤销、总预算和强制重挂语义。 |
| v1.2 | 2026-07-26 | 增加可恢复提醒暂停，统一家庭 membership 订阅、个人低库存确认和空间待删除对账。 |
| v1.1 | 2026-07-26 | 增加账号多设备与家庭成员订阅的收件人范围，区分个人提醒动作和共享业务动作。 |
| v1.0 | 2026-07-26 | 建立提醒四层模型、状态机、来源动作、重复催促、稍后提醒、隐私、权限、平台调度预算、对账、远程扩展和测试边界。 |

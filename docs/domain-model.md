# 生活有谱领域模型

> 项目代号：`life-book` · 版本：v1.19 · 更新日期：2026-07-26 · 状态：文档基线
>
> 权威范围：逻辑实体、值对象、字段语义、关系、聚合边界和领域不变量
>
> 不负责：数据库表名与索引、JSON 字段拼写、页面布局、时间算法和阶段归属
>
> 依赖文档：[产品需求基线](product-features.md)、[产品路线图](roadmap.md)、[术语表](glossary.md)、[产品决策记录](product-decisions.md)、[提醒规范](reminders-and-notifications.md)、[TD-009 原生提醒调度](adr/0009-native-reminder-scheduler.md)、[TD-010 原子恢复](adr/0010-sqlite-snapshot-migration-and-atomic-restore.md)

本文定义与客户端框架、数据库和服务端实现无关的逻辑模型。物理存储必须映射到这里，不能通过数据库方便性改变领域含义；机器交换格式由 Schema 和接口契约定义。

## 1. 建模原则

1. **记录根与子类型分离**：五种记录共享 `Record` 根实体，各自特有字段位于对应详情实体。
2. **历史事实不可被当前值覆盖**：周期实例、库存流水、操作记录和通知投递拥有独立实体。
3. **无限规则不无限落库**：重复事项和重要日期按规则计算，只有进入物化窗口、被修改或产生状态时才保存实例。
4. **业务状态与投递状态分离**：记录、周期实例、清单、低库存和提醒实例分别维护自己的状态。
5. **本地先生成全局稳定标识**：所有未来可能同步的实体在 P0 就拥有跨设备不冲突的 ID。
6. **删除可恢复、永久删除明确**：回收站状态保存在记录根；永久删除后 P1/P2 只保留必要墓碑。
7. **派生值可缓存但不作唯一事实**：清单进度、当前库存、今天关注项和搜索索引都能从权威数据重建。
8. **模型草稿不等于领域实体**：未经确认的智能草稿只存在于创建会话，不取得正式记录 ID，也不触发提醒或库存流水。

## 2. 基础类型

| 类型 | 语义 | 约束 |
| --- | --- | --- |
| `EntityId` | 全局唯一、不透明、客户端可离线生成的实体标识。 | 创建后不可改变或复用；具体编码由技术决策确定。 |
| `Instant` | 时间轴上的绝对时刻。 | 统一精度至少到毫秒；存储和交换使用 UTC 语义。 |
| `LocalDate` | 不含时刻和时区的日历日期。 | 格式语义为 `YYYY-MM-DD`，显示按地区转换。 |
| `LocalTime` | 不含日期和时区的钟表时间。 | 精度到分钟即可满足 P0；模型保留秒扩展位。 |
| `TimeZoneId` | IANA 时区标识。 | 例如 `Asia/Shanghai`；不得用 `+08:00` 代替。 |
| `ExactDecimal` | 不使用二进制浮点的十进制定点数。 | scale 固定为 3，signed scaled integer 绝对值最多 18 位，因此业务值整数部分最多 15 位、最多 3 位小数；数量计算必须精确。 |
| `SortKey` | 可在相邻对象间插入的稳定排序键。 | 只定义顺序，不向用户展示。 |
| `Revision` | 当前存储副本内的单实体乐观并发版本。 | 正整数，从 1 开始；每次本地持久化业务改变递增，不用于比较不同设备的先后。 |
| `ServerVersion` | 服务端为一个同步实体确认的版本。 | 非负整数；0 表示尚未上传，服务端每次接受改变后单调递增。 |
| `ServerSequence` | 服务端在一个空间内分配的变更顺序。 | 单调递增且不依赖设备时钟；只比较同一空间。 |
| `LongCounter` | 跨 SQLite/native/JS/接口边界的非负单调计数器。 | `0...9223372036854775807`；递增使用 checked `+1`，不得回绕或用 JavaScript `number`；边界编码遵循 TD-006。 |
| `NotificationDatasetEpoch` | 隔离不同 active dataset 通知副作用的 branded `LongCounter`。 | 权威值只来自当前 `phase=active` 的受认证 `DatasetControlRecord`；初始化为 `0`，仅提交成功的整体恢复/手动回滚递增。 |
| `NotificationInputRevision` | current epoch 内使调度结果失效的 branded `LongCounter`。 | 每个 installation/epoch 初始化为 `0`；任何业务、设置、能力或合同输入变化时在入队事务 checked +1，并原子隐藏旧 published run。业务/设置写入遇到上限时拒绝整条命令；已经发生的外部能力变化遇到上限时必须先隐藏旧投影并进入受审维护状态，绝不回绕或沿用旧成功。 |
| `ContentHash` | 内容完整性哈希。 | 用于附件、备份和同步校验，不作为加密。 |

所有用户可见文本使用 Unicode。长度按 Unicode 码点校验；存储不得静默截断。

## 3. 公共元数据

### 3.1 `EntityMeta`

所有可持久化实体都具有：

| 字段 | 类型 | 必填 | 规则 |
| --- | --- | :---: | --- |
| `id` | `EntityId` | 是 | 全局稳定，创建后不可变。 |
| `createdAt` | `Instant` | 是 | 第一次持久化的设备时刻。 |
| `updatedAt` | `Instant` | 是 | 最近一次业务修改时刻，不因只读索引重建改变。 |
| `createdByActorId` | `EntityId` | 是 | P0 指本地身份；未来可映射账号。 |
| `updatedByActorId` | `EntityId` | 是 | 最近业务修改者。 |
| `revision` | `Revision` | 是 | 每次成功业务修改递增。 |

服务端接收客户端时间时可以另存 `serverReceivedAt`，但不能用它改写用户操作发生时间。设备时钟异常的处理见同步和时间规范。

### 3.2 文本约束

| 用途 | 长度 |
| --- | ---: |
| 记录标题/名称 | 去除首尾空白后 1–200 个码点 |
| 分类、标签、清单分组名称 | 1–40 个码点 |
| 清单项目标题 | 1–500 个码点 |
| 单位 | 1–20 个码点 |
| 存放位置 | 0–200 个码点 |
| 一般说明、备忘正文 | 0–100,000 个码点 |
| 单条流水或操作备注 | 0–2,000 个码点 |

换行和中间空白属于内容，不自动折叠；只对标题、名称执行首尾空白去除。空白字符串按缺失处理。

## 4. 上下文总览

```text
LocalActor ── owns ── PersonalSpace
Account    ── joins ── Space ── contains ── Record
                                  │
                                  ├── Category / Tag
                                  ├── Attachment / RecordLink
                                  └── one detail aggregate
                                      ├── RecurringItem → RecurrenceSegment → Occurrence
                                      ├── Checklist → Group → Item
                                      ├── Memo
                                      ├── ImportantDate → DateOccurrence
                                      └── HouseholdItem → StockTransaction → LowStockEpisode

Any supported source → ReminderPlan → ReminderInstance → NotificationSchedulingDecision
                                                   └── eligible_selected → NotificationDelivery
Notification response → Lease A fence → NotificationActionInbox
                                      → unlock → fresh Lease B → command/navigation
Active dataset epoch → NotificationDatasetState revision + registered pair set
                     → each NotificationReconciliationState.publishedRunId
                     → complete current Decision run per pair
```

清单模板归属于空间，但不是 `Record`；它通过快照产生清单实例。

## 5. 身份与空间

### 5.1 `Installation` 与 `LocalActor`

P0 初始化时分别生成当前安装和本地作者身份：

| `Installation` 字段 | 类型 | 规则 |
| --- | --- | --- |
| `id` | `EntityId` | 当前 App 安装的随机标识，不是硬件指纹。 |
| `createdAt` | `Instant` | 本次安装初始化时间。 |
| `appInstallVersion` | 文本 | 首次初始化的 App 版本，只用于兼容和诊断。 |

`Installation` 不进入用户数据备份；卸载重装始终产生新 ID。

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `id` | `EntityId` | 在本次本地数据生命周期内稳定。 |
| `kind` | `local` | P0 固定；未来可以映射到 `Account`。 |
| `claimedByAccountId` | `EntityId?` | P1 认领完成后可设置。 |
| `createdAt` | `Instant` | 初始化时间。 |

清除本机数据会销毁旧本地身份并生成新身份，但保持当前安装 ID。恢复完整备份会恢复备份中的本地身份，同时保持接收设备自己的安装 ID，避免记录创建人失联或把两个安装误认为同一设备。

### 5.2 `Space`

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `id` | `EntityId` | 全局稳定。 |
| `kind` | `personal \| family` | 创建后不可直接改变。 |
| `name` | 文本 | P0 默认显示“个人空间”；家庭可自定义。 |
| `ownerId` | `EntityId?` | personal 时必填，P0 指 LocalActor、认领后可指 Account；family 时为空，唯一 owner 由 active SpaceMembership 表达。 |
| `status` | `active \| deletion_scheduled \| deleting \| deleted` | 个人空间固定 active；家庭删除按 P2 流程。 |
| `deletionScheduledFor` | `Instant?` | family/deletion_scheduled 时必填；取消删除后清空。 |
| 公共元数据 | `EntityMeta` | 适用。 |

#### DOM-001：默认个人空间

每个有效本地数据集始终恰好有一个默认个人空间。P0 所有记录、模板、分类和标签都属于它。清除本机数据后创建新空空间，不产生“无空间”正常状态。

#### DOM-002：空间隔离

任何空间内实体引用的分类、标签、记录、附件和成员关系必须属于同一空间，除非专项规范明确允许跨空间迁移。查询不能仅依赖客户端当前空间过滤来实现授权。

## 6. 记录根实体

### 6.1 `Record`

| 字段 | 类型 | 必填 | 规则 |
| --- | --- | :---: | --- |
| `id` | `EntityId` | 是 | 稳定记录 ID。 |
| `spaceId` | `EntityId` | 是 | 所属空间。 |
| `type` | `recurring_item \| checklist \| memo \| important_date \| household_item` | 是 | 创建后不可改变。 |
| `title` | 文本 | 是 | 使用通用标题约束；物品 UI 显示为“名称”。 |
| `description` | 文本 | 否 | 通用说明；备忘主要正文另存。 |
| `categoryId` | `EntityId` | 否 | 必须属于同一空间。 |
| `sensitivity` | `normal \| sensitive` | 是 | 默认 `normal`。 |
| `aiAccess` | `allowed \| denied` | 是 | 敏感记录创建时默认 `denied`，用户可明确改变。 |
| `isPinned` | 布尔 | 是 | 默认 `false`。 |
| `archivedAt` | `Instant` | 否 | 非空表示归档。 |
| `trashedAt` | `Instant` | 否 | 非空表示进入回收站。 |
| `purgeAfter` | `Instant` | 否 | 本地数据集的有效清理期限；进入回收站时先按 30 个绝对 24 小时计算，绑定空间收到服务端确认后改用 `serverPurgeAfter`。 |
| `serverTrashedAt` | `Instant` | 否 | 绑定空间由服务端确认进入回收站的时刻；未确认或非绑定空间为空。 |
| `serverPurgeAfter` | `Instant` | 否 | 绑定空间的服务端权威清理期限；存在时必须等于 `serverTrashedAt + 30 个绝对 24 小时`。 |
| `trashedFrom` | `active \| archived` | 否 | 用于恢复到删除前状态。 |
| 公共元数据 | `EntityMeta` | 是 | — |

### 6.2 记录生命周期

```text
active ⇄ archived
   │         │
   └──→ trashed ──→ purged（实体删除；同步阶段保留墓碑）
          │
          └── restore → trashedFrom
```

#### DOM-003：生命周期互斥

- `trashedAt != null` 时记录状态一律为 `trashed`，即使保留了 `archivedAt`。
- `purgeAfter` 只有回收站记录可以存在。
- 未绑定空间的有效清理期限为 `purgeAfter`；绑定空间在删除 mutation 未确认前不得永久清理，确认后的有效期限为 `serverPurgeAfter`，并将本地 `purgeAfter` 对齐到该值。
- 恢复必须同时清除 `trashedAt`、`purgeAfter`、`serverTrashedAt` 和 `serverPurgeAfter`；迟到的旧删除确认因版本不匹配不得重新写回。
- 永久删除后的业务实体不可恢复或复用 ID。
- “完成”不是通用记录生命周期；它属于周期实例或清单实例。

#### DOM-004：类型详情完整

每个 `Record` 必须且只能拥有一份与 `type` 匹配的详情实体。记录根与详情在同一聚合事务中创建、删除和迁移。

## 7. 分类、标签、附件与关联

### 7.1 `Category`

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `spaceId` | `EntityId` | 所属空间。 |
| `name` | 文本 | 同一空间内按规范化名称不重复。 |
| `colorToken` | 标准令牌? | 只能引用设计系统允许值。 |
| `sortKey` | `SortKey` | 用户排序。 |
| `isSystem` | 布尔 | P0 默认不创建不可删除的系统分类。 |
| 公共元数据 | `EntityMeta` | — |

一条记录最多一个分类。删除分类时将引用记录的 `categoryId` 置空，不删除记录。

### 7.2 `Tag` 与 `RecordTag`

`Tag` 与分类共享空间、名称、颜色和排序语义；`RecordTag` 保存 `recordId + tagId` 唯一关系。一条记录最多 20 个标签。同一空间按 Unicode 规范化和不区分大小写比较后不得出现重名标签。

### 7.3 `Attachment`

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `spaceId` | `EntityId` | 附件安全与同步边界。 |
| `ownerRecordId` | `EntityId` | P0 一个附件只属于一条记录。 |
| `kind` | `image \| file` | 由实际内容校验，不只信任扩展名。 |
| `displayName` | 文本 | 用户可见文件名，不作为磁盘路径。 |
| `mimeType` | 文本 | 校验后的 MIME。 |
| `byteSize` | 非负整数 | 单附件不超过 QR-012。 |
| `contentHash` | `ContentHash` | 对解密后规范内容计算，用于完整性和去重提示。 |
| `storageLocator` | 不透明值 | 只由存储适配层解释，不能包含可穿越目录的用户输入。 |
| `encryptionVersion` | 正整数 | 对应附件加密封装版本。 |
| `thumbnailAttachmentId` | `EntityId?` | 图片可有独立加密缩略图。 |
| `status` | `processing \| available \| missing \| corrupt` | 不把失败附件伪装为正常。 |
| `sortKey` | `SortKey` | 多附件顺序。 |
| 公共元数据 | `EntityMeta` | — |

每条记录最终最多 20 个附件；P0 UI 按路线图进一步限制。附件二进制不内嵌到记录正文或普通数据库 BLOB。

### 7.4 `RecordLink`

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `spaceId` | `EntityId` | 两端必须同空间。 |
| `fromRecordId` | `EntityId` | 来源记录。 |
| `toRecordId` | `EntityId` | 目标记录，不能等于来源。 |
| `kind` | `related \| documents \| reminds_about \| tracks` | 受控关系语义，可扩展。 |
| `note` | 文本? | 可选短说明。 |
| 公共元数据 | `EntityMeta` | — |

同方向的 `(from, to, kind)` 唯一。删除任一记录到回收站时关联保留但不展示；永久删除时关联删除，另一端记录不受影响。

## 8. 重复事项聚合

### 8.1 `RecurringItemDetail`

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `recordId` | `EntityId` | 对应 `Record.type = recurring_item`。 |
| `firstSegmentId` | `EntityId` | 系列最初规则段。 |
| `activeSegmentId` | `EntityId?` | 已结束的系列可以为空。 |

重复事项的计划字段不直接覆盖在根实体上，而由一个或多个规则段保存，以支持“本次及以后”而不改写历史。

### 8.2 `RecurrenceSegment`

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `recordId` | `EntityId` | 所属重复事项。 |
| `effectiveFrom` | `LocalDate` | 本规则段首个候选日期，包含边界。 |
| `effectiveUntil` | `LocalDate?` | 被后续规则段切分后的最后候选日期，包含边界。 |
| `schedule` | `ScheduleSpec` | 全天或日期时间语义，见时间规范。 |
| `recurrenceRule` | `RecurrenceRule` | 频率、间隔、按周/月条件和结束条件。 |
| `recurrenceEngineVersion` | 正整数 | 解释该规则并生成候选身份的算法版本。 |
| `ruleRevision` | 正整数 | 同一记录内递增，用于实例追溯。 |
| 公共元数据 | `EntityMeta` | — |

各规则段日期范围不得重叠，并按 `effectiveFrom` 连续排序；允许显式间隔，不要求无缝产生实例。

### 8.3 `Occurrence`

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `recordId` | `EntityId` | 所属重复事项。 |
| `segmentId` | `EntityId` | 产生它的规则段。 |
| `occurrenceKey` | 文本 | 基于记录、规则段和原计划本地值的稳定键。 |
| `originalSchedule` | `ScheduleSpec` | 规则计算出的原始计划，永不因仅本次修改而改变。 |
| `effectiveSchedule` | `ScheduleSpec` | 当前实际计划；默认等于原始计划。 |
| `resolvedInstant` | `Instant?` | timed schedule 已解析时的绝对时刻；全天或尚未解析时为空。 |
| `resolvedTimeZoneId` | `TimeZoneId?` | timed local schedule 实际解析使用的时区；不得用当下设备时区回填历史。 |
| `resolvedUtcOffsetSeconds` | 整数? | 解析时采用的 UTC offset 秒数；与时区和 Instant 一起保留历史证据。 |
| `resolvedTzdbVersion` | 文本? | 产生解析结果的固定 IANA tzdb 版本；有 resolvedTimeZoneId 时必填。 |
| `resolution` | `exact \| gap_shifted_forward \| overlap_earlier \| overlap_later`? | timed local schedule 已解析时必填；记录 DST 消歧结果。 |
| `state` | `pending \| completed \| skipped` | 逾期是根据当前时间派生，不持久化为终态。 |
| `completedAt` | `Instant?` | 仅 completed。 |
| `skippedAt` | `Instant?` | 仅 skipped。 |
| `overrideKind` | `none \| rescheduled \| edited \| cancelled` | 仅本次变化。cancelled 实例不展示为跳过。 |
| `noteOverride` | 文本? | 仅本次说明。 |
| 公共元数据 | `EntityMeta` | — |

#### DOM-010：周期实例身份

同一规则段的同一原计划只能对应一个周期实例。物化窗口重算、时区变化、App 重启和同步重放不得创建第二个实例。

#### DOM-011：历史不可改写

已完成、已跳过、已取消或计划日在当前日期之前的实例不得因后续规则修改改变 `originalSchedule`、所属规则段或历史状态。

发生项进入历史边界后，`resolvedInstant`、实际时区、offset、tzdb 版本和 resolution 也不可由新版时区数据改写。尚未发生且未处理的 future occurrence 可以按 TD-007 重算这些解析字段，但 occurrenceKey、originalSchedule 和规则段身份不变；修改前后必须触发提醒对账。

## 9. 清单聚合

### 9.1 `ChecklistTemplate`

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `spaceId` | `EntityId` | 用户模板属于空间；内置模板使用受控系统空间/资源语义。 |
| `title`、`description` | 文本 | 标题必填。 |
| `origin` | `system \| user` | 系统模板只读，用户通过复制定制。 |
| `sourceVersion` | 文本? | 系统模板内容版本或外部模板来源版本。 |
| `suggestedDueOffsetDays` | 非负整数? | 从创建实例日计算的相对建议，不是绝对日期。 |
| `suggestedReminderOffsets` | 偏移列表 | 相对截止建议，不产生模板提醒实例。 |
| `trashedAt`、`purgeAfter` | `Instant?` | 用户模板支持回收站；系统模板由版本管理。 |
| 公共元数据 | `EntityMeta` | — |

### 9.2 模板分组与项目

`TemplateGroup` 包含 `templateId`、名称和 `sortKey`。`TemplateItem` 包含 `templateId`、可选 `groupId`、标题、说明、可选正数量、单位和 `sortKey`。模板项目没有完成状态。

### 9.3 `ChecklistDetail`

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `recordId` | `EntityId` | 对应 `Record.type = checklist`。 |
| `purpose` | `general \| shopping` | 默认 `general`；采购清单使用 `shopping`，普通清单可由用户明确选作采购目标但不自动改值。 |
| `sourceTemplateId` | `EntityId?` | 仅用于来源说明，模板删除后可保留不透明来源 ID。 |
| `sourceTemplateRevision` | `Revision?` | 创建时模板版本。 |
| `dueSchedule` | `ScheduleSpec?` | 实例截止；模板没有绝对截止。 |
| `manuallyCompletedAt` | `Instant?` | 批量完成动作时间；最终状态仍由有效项目派生。 |

### 9.4 `ChecklistGroup` 与 `ChecklistItem`

| 实体 | 关键字段 | 规则 |
| --- | --- | --- |
| `ChecklistGroup` | `recordId`、名称、`sortKey` | 删除非空分组时项目移至未分组或由用户确认一起删除。 |
| `ChecklistItem` | `recordId`、可选 `groupId`、标题、说明、正数量、单位、`isCompleted`、`completedAt`、`sortKey`、可选来源项目 ID | 取消完成清除 `completedAt`；项目软删除直到记录永久删除。 |

每个清单实例最多 5,000 个有效项目、500 个分组；一项只能属于同清单内一个分组。

#### DOM-020：清单完成状态

- 有至少一个有效项目且全部完成时，清单状态派生为 completed；
- 存在任一未完成有效项目时为 open；
- 空清单为 open；
- 新增未完成项目或取消任一项目完成，会把已完成清单重新打开；
- 归档和回收站属于记录生命周期，高于 open/completed 展示状态。

#### DOM-021：模板快照隔离

从模板创建时复制分组、项目和相对建议。实例不得持有会随模板变化自动更新的共享项目；模板删除、升级或恢复不改变既有实例。

## 10. 备忘聚合

### `MemoDetail`

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `recordId` | `EntityId` | 对应 `Record.type = memo`。 |
| `body` | 文本 | 可为空；但标题和正文不能同时为空。 |

#### DOM-030：备忘无完成状态

备忘不保存完成、跳过或逾期字段。与备忘相关的“知道了”和“稍后提醒”只改变提醒实例，不改变 `MemoDetail`。

## 11. 重要日期聚合

### 11.1 `ImportantDateDetail`

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `recordId` | `EntityId` | 对应 `Record.type = important_date`。 |
| `eventKind` | `birthday \| anniversary \| expiry \| other` | 决定默认文案。 |
| `calendarSystem` | `gregorian \| chinese_lunar` | P0 只开放 gregorian。 |
| `recurrenceMode` | `once \| yearly` | 与历法独立。 |
| `dateValue` | `CalendarDateValue` | 结构取决于历法和重复方式。 |
| `startYear` | 整数? | 用于年龄/周年；不得晚于首次有效发生年份。 |
| `counterDisplay` | `auto \| hidden` | 用户可关闭年龄/周年。 |

`CalendarDateValue`：

| 场景 | 必需组成 |
| --- | --- |
| 公历仅一次 | 年、月、日 |
| 公历每年 | 月、日；可有起始年份 |
| 农历仅一次 | 农历年、月、日、是否闰月 |
| 农历每年 | 农历月、日、是否闰月的处理策略；可有起始年份 |

### 11.2 `DateOccurrence`

重要日期发生项是按年份计算的投影。只有需要提醒、用户确认“知道了”或同步引用时才物化，包含：`recordId`、目标年份、历法日期、公历显示日期、稳定 `occurrenceKey` 和计算规则版本。

#### DOM-040：重要日期无完成和逾期

重要日期描述事实，不保存完成、跳过或逾期。过去的日期发生项可以标记其提醒已处理，但不得把根记录显示为“未完成”。

#### DOM-041：日期维度独立

事件种类、历法、重复方式和起始年份分别持久化。修改展示文案不得改变日期值；切换历法必须视为重新输入日期并预览转换结果。

## 12. 家庭物品聚合

### 12.1 `HouseholdItemDetail`

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `recordId` | `EntityId` | 对应 `Record.type = household_item`。 |
| `unit` | 文本 | 创建后修改需经过单位变更规则。 |
| `currentQuantityCache` | `ExactDecimal` | 已过账流水结果的事务内缓存，必须可重建；它是可触发业务规则的确认数量。 |
| `projectedQuantityCache` | `ExactDecimal?` | 按本地待处理库存意图顺序计算的界面预估；无待处理意图时为空，不得触发共享低库存周期或通知。 |
| `lowStockThreshold` | `ExactDecimal?` | 非负；为空表示不判断低库存。 |
| `storageLocation` | 文本? | 用户可见位置。 |
| `primaryAttachmentId` | `EntityId?` | 必须是该记录的可用图片附件。 |

### 12.2 `StockChangeIntent` 与 `StockTransaction`

`StockChangeIntent` 保存用户提交的不可变库存输入；它不是库存流水，只有服务端或未绑定本地账本接受后才产生 `StockTransaction`：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `recordId` | `EntityId` | 所属家庭物品。 |
| `kind` | `opening \| purchase \| consume \| adjust \| discard \| lost` | 受控类型。 |
| `inputMode` | `delta \| target` | purchase/consume/discard/lost 使用 delta；opening/adjust 使用 target。 |
| `requestedDelta` | `ExactDecimal?` | delta 模式必填；符号由 kind 校验。 |
| `targetQuantity` | `ExactDecimal?` | target 模式必填且非负；实际 delta 在权威过账时计算。 |
| `baseLedgerSequence` | 非负整数 | 用户提交时看到的最新确认流水序号；opening 为 0，adjust 必须与接受时序号一致，其余类型用于冲突解释但可在非负约束内追加。 |
| `occurredAt` | `Instant` | 用户声明的实际发生时间。 |
| `recordedAt` | `Instant` | 用户提交时间；不决定账本顺序。 |
| `note` | 文本? | 可选原因。 |
| `correctionOfTransactionId` | `EntityId?` | adjust 可指出要修正的已过账流水。 |
| `clientMutationId` | `EntityId` | 全局唯一幂等键；同一意图重试不能产生第二条流水。 |
| `state` | `pending \| accepted \| rejected \| cancelled` | accepted/rejected/cancelled 为终态；未绑定本地提交可在同一事务直接成为 accepted。 |
| `resultTransactionId` | `EntityId?` | accepted 时必填并唯一；其余状态为空。 |
| `rejectionCode` | 受控码? | rejected 时必填，不含用户内容。 |
| 公共元数据 | `EntityMeta` | 输入字段创建后不可修改；重新提交必须创建新意图。 |

`StockTransaction` 是已接受、可展示的权威账本流水：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `recordId` | `EntityId` | 所属家庭物品。 |
| `sourceIntentId` | `EntityId?` | 由用户操作产生时唯一关联意图；非空时全局唯一，旧版导入可为空。 |
| `kind` | `opening \| purchase \| consume \| adjust \| discard \| lost` | 受控类型。 |
| `delta` | `ExactDecimal` | 权威应用值；purchase 为正，consume/discard/lost 为负，opening/adjust 由接受时目标与确认余额计算。 |
| `quantityBefore` | `ExactDecimal` | 事务前数量。 |
| `quantityAfter` | `ExactDecimal` | 事务后数量，必须等于 before + delta。 |
| `occurredAt` | `Instant` | 用户声明的实际发生时间。 |
| `recordedAt` | `Instant` | 原意图提交时间；晚补流水时与 occurredAt 不同。 |
| `postedAt` | `Instant` | 权威账本接受时间。 |
| `ledgerSequence` | 正整数 | 单物品内严格递增，决定余额累计顺序；晚补流水仍追加，不回写后续历史。 |
| `note` | 文本? | 可选原因。 |
| `correctionOfId` | `EntityId?` | 调整用于修正哪条流水，可为空。 |
| `postingAuthority` | `local \| server` | 未绑定数据集由本地账本过账；绑定空间只允许服务端过账。 |
| `serverSequence` | `ServerSequence?` | 服务端接受或云端空数据认领确认后填充；不是单物品 ledgerSequence。 |
| 公共元数据 | `EntityMeta` | 流水创建后业务字段不可变。 |

#### DOM-050：库存权威值

已过账 `StockTransaction` 按 `ledgerSequence` 累计是确认数量的权威来源；pending/rejected/cancelled `StockChangeIntent` 不进入账本。`currentQuantityCache` 只为查询性能存在，并必须与新增流水在同一权威事务更新。`projectedQuantityCache` 可以按本设备 pending 意图预估，但必须显示“待同步”，不能替代确认数量。发现确认缓存不一致时停止普通写入并通过重算/诊断修复，不能信任缓存覆盖历史。`occurredAt` 用于展示实际发生时间，不改变余额累计顺序。

#### DOM-051：库存非负

确认数量不得小于 0。未绑定数据集在本地过账前校验；绑定空间由服务端针对最新 ledgerSequence 校验。离线意图可以暂存，但若接受后会为负，服务端必须拒绝并生成可处理冲突，客户端不能静默改小数量。导入历史数据如包含负值，必须在预览中要求解决。

#### DOM-052：流水不可变

库存意图的输入字段和已过账流水均不得编辑；状态确认不是修改输入。输入错误使用新的 adjust 意图，接受后生成新流水，并可通过 `correctionOfId` 关联原流水。拒绝后的重试也必须创建新意图。家庭物品永久删除时才随聚合一起清除相关意图与流水。

accepted 意图必须恰好对应一条 StockTransaction，且 `intent.resultTransactionId` 与 `transaction.sourceIntentId` 双向一致；rejected/cancelled 意图不得对应流水。绑定空间的 pending→accepted/rejected 只能由经过 generation 与权限校验的服务端结果驱动，不得由客户端自行确认。

### 12.3 `LowStockEpisode`

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `recordId` | `EntityId` | 所属家庭物品。 |
| `enteredAt` | `Instant` | 从阈值以上首次变为 `<= threshold` 的时间；创建时已不足则为创建时间。 |
| `thresholdSnapshot` | `ExactDecimal` | 进入时阈值，便于解释历史。 |
| `quantitySnapshot` | `ExactDecimal` | 进入时数量。 |
| `notifiedAt` | `Instant?` | 首次主动提醒成功交给系统的时间。 |
| `handledAt` | `Instant?` | 通过加入适用共享采购清单等共享动作结束本周期的主动催促；“知道了”不写此字段。 |
| `handledReason` | `shopping_item_added`? | handledAt 非空时必填。 |
| `resolvedAt` | `Instant?` | 数量恢复、阈值变化或记录退出活跃跟踪时设置。 |
| `resolutionReason` | `stock_recovered \| threshold_changed \| threshold_removed \| archived \| trashed`? | 解决时必填，解释为何结束本周期。 |
| 公共元数据 | `EntityMeta` | 历史周期不可合并。 |

#### DOM-053：低库存判定

当且仅当 `lowStockThreshold != null` 且确认的 `currentQuantityCache <= lowStockThreshold` 时处于低库存。连续不足只对应一个未解决周期；恢复后再次不足必须创建新周期。pending 库存意图只能产生带“待同步”的界面预估，不创建或解决周期、不触发通知；意图过账后再按确认前后值判断。个人“知道了”由对应 ReminderInstance/Subscription 表达，不改变共享 LowStockEpisode；`handledAt` 只表示所有成员可观察的共享处理动作。

## 13. 采购清单关联

家庭物品通过 `ChecklistItem.linkedHouseholdItemId` 关联采购项目，另可保存 `requestedQuantity` 和与物品单位一致的 `requestedUnit`。

#### DOM-060：活跃采购项唯一

同一家庭物品在同一清单实例中最多有一个未删除、未完成的关联采购项目。重复加入时更新或确认现有项目数量，不静默创建重复项。已完成历史项目保留；再次需要补货时可以创建新项目。

## 14. 提醒模型

本节只定义实体边界；状态迁移和调度算法见提醒专项规范。

### 14.1 `ReminderPlan`

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `spaceId` | `EntityId` | 与来源同空间。 |
| `sourceType` | `recurring_item \| checklist \| memo \| important_date \| low_stock \| item_batch` | 受控来源。 |
| `sourceId` | `EntityId` | 指向记录、规则段或状态来源。 |
| `trigger` | `ReminderTrigger` | 绝对、相对业务时间、周期或状态进入。 |
| `isEnabled` | 布尔 | 关闭后取消未来实例。 |
| `followUpPolicy` | `FollowUpPolicy?` | 默认空；用户主动开启。 |
| `contentModeOverride` | 可选枚举 | 只能比全局隐私设置更严格。 |
| 公共元数据 | `EntityMeta` | — |

### 14.2 `ReminderInstance`

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `planId` | `EntityId` | 所属提醒计划。 |
| `subscriptionId` | `EntityId?` | P0 为空；账号空间中指向一个收件人订阅，使不同账号能独立知道了/稍后。 |
| `sourceOccurrenceKey` | 文本? | 与周期或日期发生项绑定。 |
| `deduplicationKey` | 文本 | 同一逻辑提醒稳定唯一。 |
| `scheduledFor` | `Instant` | 解析时区和偏移后的目标绝对时刻。 |
| `scheduleResolution` | 解析元数据? | 目标源自 timed local schedule 时保存实际 TimeZoneId、UTC offset 秒数、tzdb 版本和 `exact/gap_shifted_forward/overlap_earlier/overlap_later`；绝对 Instant 不需要。 |
| `state` | `planned \| scheduled \| paused \| acknowledged \| snoozed \| cancelled \| expired \| failed` | 收件人范围内的逻辑状态；P0 可按当前 installation 证据聚合，P1 只能按 server-owned ReminderDeliveryAggregate 聚合；`delivered` 不作为可可靠确认的业务状态。 |
| `pauseReason` | `space_deletion_scheduled \| subscription_paused`? | paused 时必填；恢复 future 实例时清空，已到期实例改为 expired。 |
| `acknowledgementKind` | `opened \| done \| skipped \| noted \| shopping_added`? | 必须适合来源。 |
| `snoozedFromId` | `EntityId?` | 稍后提醒链的上一实例。 |
| `failureCode` | 受控错误? | 仅 failed 时可有；P0 来自当前 installation 的终态 Decision，P1 只能来自服务端聚合，不保存原始平台消息；恢复规范化离开 failed 时清空。 |
| 公共元数据 | `EntityMeta` | — |

### 14.3 `NotificationDelivery`

表示一次真实 adapter/platform 提交、取消或可观察回调尝试。权限预检、channel 阻断和预算淘汰没有平台调用，只产生 NotificationSchedulingDecision，不能伪造 Delivery。一个账号订阅可在多个 Device 各有投递；本实体不声称通知已经展示或被用户看到，也不保存 title/body/raw payload/原生任意错误消息。

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `reminderInstanceId` | `EntityId` | 所属逻辑提醒实例。 |
| `installationId` | `EntityId` | 本地设备槽位；P0 必填，不随业务备份迁移。 |
| `deviceId` | `EntityId?` | P1 登录设备；同一账号多个 Device 分别投递。 |
| `transport` | `local_notification \| remote_push` | 本地和远程尝试不能共用平台成功证据。 |
| `platform` | `ios \| android` | 产生请求的平台；服务端远程路由仍指向目标设备平台。 |
| `recipientSlot` | 文本 | 同一 ReminderInstance 下稳定、无内容的收件人/设备投递槽；不得包含邮箱、家庭名等可识别内容。 |
| `platformRequestId` | 文本 | 项目生成的版本化 `lbr2:` 稳定不透明 ID；不包含用户内容。 |
| `adapterNativeId` | 文本? | 平台/adapter 返回的内部 ID；只能用于本机定向清理，不能成为恢复或幂等身份。 |
| `notificationDatasetEpoch` | `NotificationDatasetEpoch` | 必填；只有等于当前 active control 的行才可能成为当前证据。 |
| `attemptSequence` | `LongCounter` | 同一 ReminderInstance、installation/device、transport、platform、recipientSlot、epoch 和 platformRequestId 内从 1 递增；判断最新 attempt，不用设备时间排序。 |
| `scheduleFingerprint` | ContentHash | 覆盖目标、内容策略、payload/category、隐私和精度；不保存可见文案。 |
| `privacyIndependentFingerprint` | ContentHash | 覆盖除实际隐私模式及其派生文案/payload/category/action 之外的全部 replace 输入；只用于判断是否为纯隐私放宽，规范投影由 TD-009 唯一定义。 |
| `effectivePrivacyMode` | `full \| title_only \| hidden` | 实际提交快照的隐私模式；可能因纯放宽而暂时比当前设置更严格。 |
| `categoryContractId`、`categoryContractVersion` | 文本、正整数 | 实际提交的类别合同；hidden 使用 open_only v1。 |
| `actionContractVersion`、`payloadContractVersion`、`requestIdentityContractVersion` | 正整数 | 实际提交的版本化合同。 |
| `status` | `requested \| accepted \| observed_trigger \| observed_action \| cancelled \| rejected \| missing` | 语义以 REM-013 为准；accepted 只表示平台 API 接受。 |
| `evidence` | `ios_pending \| android_registry_only \| adapter_receipt \| none` | Android registry 不能单独证明 AlarmManager 仍有请求。 |
| `requestedPrecision` | `exact \| approximate \| not_applicable` | Android 降级必须可观察；iOS 为 not_applicable。 |
| `environmentGeneration` | 非负整数 | 调度使用的平台能力/环境代次；变化时旧证据失效。 |
| `capabilityFingerprint` | `ContentHash` | 本次提交所用权限、渠道、精度、预算和 adapter 能力摘要；不含用户内容。 |
| `requestedAt`、`acceptedAt`、`observedAt`、`cancelledAt` | `Instant?` | 适用状态写入；不用它们决定跨设备先后。 |
| `failureCode` | 受控错误? | 不含标题、正文、payload 或原生任意错误消息。 |
| `adapterContractVersion` | 正整数 | 解释 receipt、evidence 和 adapter metadata 的固定合同版本。 |
| 公共元数据 | `EntityMeta` | — |

当前证据的唯一身份至少绑定 `(reminderInstanceId, installation/device slot, transport, platform, recipientSlot, notificationDatasetEpoch, platformRequestId, attemptSequence)`。同一身份的最新 attempt 必须 `status=accepted`，且 request ID、epoch、schedule fingerprint、precision、environment generation、capability fingerprint 和 adapter contract 全部匹配当前输入；最新 requested/rejected/missing/cancelled 使较早 accepted 永久失效。本实体是 device-only 技术事实，不进入 portable backup。

隐私比较不能先要求 schedule fingerprint 匹配。`privacyComparisonCandidate` 固定为同一完整 delivery identity（不含 attemptSequence）的 latest attempt，且 current epoch/request ID/precision/environment generation/capability fingerprint/adapter contract 全匹配并为 accepted；初筛刻意不比较 schedule fingerprint。纯隐私放宽时，若 current desired 与该 candidate 的 `privacyIndependentFingerprint` 相同且 NotificationDatasetState 没有 force marker，desired mapper 采用 candidate 的 `effectivePrivacyMode/category/action` 作为 `effectiveScheduledPresentationContract`，再重算 schedule fingerprint；只有重算结果与该 Delivery 的 schedule fingerprint 相等，它才成为普通 current matching evidence。candidate 缺失、base 指纹不同或有 marker 时采用 current desired 合同并 replace，不能循环引用“matching accepted”。

用户的明确更新选择必须成为 NotificationDatasetState 上绑定目标 input revision 的 device-only 耐久意图，并由 coordinator task 镜像唤醒；只有全部 registered transport/platform pair 的 guarded succeeded 结果都确认适用 replace/cancel 后才可清除，不能依赖一次内存事件或单个 pair 成功。`open_only` 是任意仍获授权目标的严格只导航子集，来源后来变为非敏感时仍允许该旧 open response 在 fresh Lease B 下导航，但绝不能恢复来源类别 mutating action。隐私收紧时先清旧内容快照；只有收紧后的当前有效呈现合同已经撤销旧 category/action（例如转为 hidden/open_only）时，清理前到达的旧动作才只能 `business_noop`。仅 `full→title_only` 且 category/action 未变时仍按 fresh Lease B 的当前授权和状态执行，不能把文案收紧误当作动作撤权。

### 14.4 `NotificationActionInbox`

表示已经通过 active dataset epoch 与 request-ID fence 的通知 response。旧、缺失、非法或 future epoch response 在写入前就永久 no-op，因此不创建本实体。

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `actionInboxId` | `ContentHash` | TD-009 canonical hash 幂等键；相同通知动作重放只返回既有结果。 |
| `responseId` | 文本 | transport 回调身份；与 platformRequestId 分离。 |
| `platformRequestId` | 文本 | 已重算并恒时匹配的项目 `lbr2:` ID。 |
| `notificationDatasetEpoch` | `NotificationDatasetEpoch` | 必须等于写入时 active control，并在命令提交前再次匹配。 |
| `installationId` | `EntityId` | 当前设备；不随备份、同步或手动回滚迁移。 |
| `transport` | `local_notification \| remote_push` | 决定受控 parser/adapter，不改变 epoch gate。 |
| `categoryContractId`、`categoryContractVersion` | 文本、正整数 | 已登记的 category 合同及其语义版本。 |
| `actionId` | 文本 | 用户实际动作；只能来自该 category/version allowlist。 |
| `actionContractVersion`、`payloadContractVersion`、`requestIdentityContractVersion` | 正整数 | 缺失、未来或不兼容版本不得猜测。 |
| `reminderInstanceId` | `EntityId` | 不透明目标；只有当前授权/状态检查通过后使用。 |
| `sourceType`、`sourceId` | `hidden` 或业务来源枚举、`EntityId?` | `hidden` 只是 payload 隐私哨兵，不是业务来源类型；解锁后由 reminderInstanceId 反查。 |
| `spaceId` | `EntityId?` | P2 普通 payload 的可选不透明上下文；hidden 时必须为空，不能作为授权事实。 |
| `receivedAt`、`processedAt` | `Instant`、`Instant?` | 不用设备时间决定幂等或跨设备顺序。 |
| `processingState` | `pending \| processing \| applied \| business_noop \| stale_noop \| failed_retryable \| failed_terminal` | `business_noop` 用于 identity current 但来源已经终态/失权/过期；`stale_noop` 用于 inbox 仍在 current dataset/epoch、但同 epoch request identity 已改变的无目标终态。dataset epoch 已替换时旧 row 不进入 target，response 在 current inbox lookup 前永久 no-op。 |
| `processingAttempt` | `LongCounter` | 初始为 `0`；每次 CAS claim 时 checked +1，不用时间决定最新处理者。 |
| `claimOwnerSessionId`、`claimToken` | `EntityId?` | 非空当且仅当 processing；绑定当前 App 进程会话与本次 claim，从 processing 进入任一其他状态时原子清空。 |
| `claimedAt` | `Instant?` | 非空当且仅当 processing，且仅作诊断；退出 processing 时原子清空。claim 有效性使用进程会话与单调时钟，不以可回拨墙钟作正确性依据。 |
| `resultCode` | 受控无内容码? | 不保存标题、正文、原始 payload 或平台错误。 |
| 公共元数据 | `EntityMeta` | revision 只跟踪本机 inbox 状态，不参与同步。 |

只有 payload 先通过 bounded 语法、大小、ID grammar、版本、category/action allowlist 与 hidden/open-only 交叉字段校验，随后短 parser Lease A 再通过 active epoch/request/category registry fence，才能创建本实体；actionInboxId 按 TD-009 把 transport 与 categoryContractVersion 纳入版本敏感 hash。`sourceType=hidden` 当且仅当 `categoryContractId=open_only`；此时 category/action version 均为 1、`sourceId=null`、payload 无 spaceId，且 response `actionId` 只能是 open。任一非法组合在 Lease A 前拒绝。敏感通知必须使用该组合，非敏感通知也只有在有效呈现合同选择更严格 open-only 时可用。

写入 inbox 后立即释放 Lease A，应用锁/用户等待期间不持有 DatasetReadLease。解锁后取得 fresh action/navigation Lease B，先在 then-active Repository 查找同 epoch inbox：dataset 已替换、row 缺失或 epoch 不匹配时只产生无目标 stale 结果，不读取 previous dataset，也不在 target 伪造 row；同 epoch row 存在时才 claim 并重新验证 request identity、当前授权和来源。request identity 已变时以短事务落为终态 `stale_noop`，不得冒充 `business_noop`。mutating action 在 Lease B 下以单一领域事务处理，默认 open 在紧邻导航前也必须通过 Lease B。open 不持久化解析出的目标：router 接受以 actionInboxId 幂等标识、在 Lease B 下重新生成的 NavigationIntent 后把 inbox 置 applied；响应重放即使已有终态结果，也不能绕过 fresh fence 或复用旧目标缓存。

processor 只有取得 Lease B 后，才能用谓词 `(actionInboxId, state=pending|failed_retryable, processingAttempt=expected, claimOwnerSessionId=null, claimToken=null, claimedAt=null)` CAS：把 attempt checked `+1` 并设置新 owner/token/claimedAt 后进入 processing。完成必须在仍持有同 claim 与 Lease B 时迁移为 `applied/business_noop/stale_noop/failed_retryable/failed_terminal`，并在同一事务把三个 claim 字段全部清空；业务 mutation、inbox 终态、输入修订和后续对账任务仍是一个事务。attempt 已达 LongCounter 上限时不得 claim，而是在 Lease B 下以 `failed_terminal + resultCode=action_processing_attempt_exhausted` 终结，claim 字段保持全空且不执行业务动作。

每个 App 进程拥有随机 session ID；启动时立即把其他 session 遗留的 processing claim 回收到 pending，并清空三个 claim 字段，同一 session 的单调时钟 watchdog 也以 token-fenced CAS 做同样回收。`failed_retryable` 只能由带退避的耐久任务重新入队；Repository 再次 active、App 启动/前台和成功解锁都必须幂等扫描 pending/到期 retryable。Lease B 暂不可得时不 claim，保持 pending 并保留耐久唤醒任务，因此崩溃、锁屏或数据集切换都不会永久卡住 inbox。

`validating`、integrity-blocked 或 Repository 未开放时的 `deferred_unclassified` 只是瞬时分类，不创建 inbox、不写 App 明文暂存、不清平台 last response/目标通知。notification subsystem 第一次重新进入 active 必须主动 re-fetch 平台 last response 并从 bounded parse 重跑；若 adapter 不保证保留，只能 targetless fallback 并记录无内容诊断。

### 14.5 `NotificationDatasetState`

每个 `(installationId, notificationDatasetEpoch)` 恰有一项 device-only owner，统一拥有跨 transport/platform 的输入修订、pair fan-out 和明确隐私刷新意图；不得让多个 ReconciliationState 各自成为 revision 真值。

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `installationId` | `EntityId` | 当前安装；不进入 portable backup。 |
| `notificationDatasetEpoch` | `NotificationDatasetEpoch` | 必须等于 active control；dataset replacement 新建 revision 0 owner。 |
| `notificationInputRevision` | `NotificationInputRevision` | 当前 epoch 唯一权威值；全部 pair state/run/Decision 只镜像它。 |
| `revisionState` | `active \| exhausted` | exhausted 时禁止全部 notification platform write 和 current publish，直到受审迁移或新 epoch。 |
| `registeredPairs` | 排序集合 | 每项为 `(transport, platform, mode=active|retiring)`；来自签名 registry，并保留尚未确认清理的 retiring pair。权限/channel 不改变成员资格。 |
| `registeredPairSetVersion` | 正整数 | pair registry 语义版本。 |
| `registeredPairSetDigest` | `ContentHash` | 对完整排序 pair 集计算；coordinator task、pair state 和 input fingerprint 必须匹配。 |
| `forcePresentationRefreshRevision` | `NotificationInputRevision?` | 用户明确扩大已安排呈现时设置为当次新 revision；后续 revision 继承原值，直到全部 pair 完成才清。 |
| `updatedAt` | `Instant` | 诊断时间，不决定顺序。 |

registered pair 只包含当前 installation 的实际 OS platform；P0 是该平台的 `local_notification`，P1 仅在远程合同启用时增加同平台 `remote_push`，绝不构造 iOS×Android 笛卡尔积。移除 transport 时，只要仍有 managed evidence 就以 retiring pair 参与空 desired 清理；确认清空后才能在下一次全局 revision 删除。

任一候选、内容、设置、能力、pair registry 或任一 pair 专属合同输入变化，都在一个短事务锁定本 owner：checked `+1`，更新适用 receiving-device baseline/pair set，把**全部** registered pair 的 ReconciliationState 创建或置 pending，并镜像新 revision/digest、清 current pointer/水位/inputFingerprint/failureCode，再 upsert 一个绑定 `(installationId, epoch, revision, pairSetDigest)` 的 coordinator task。选择保守全 fan-out，禁止只推进某个 transport 后让其他 pair 留在旧 revision。各 pair 可独立发布 succeeded/degraded，但 coordinator 只有在精确 pair 集的每一行都为同 revision/digest 的 succeeded、且适用 replace/cancel 已确认后才完成；degraded/pending/缺行都保留任务。`forcePresentationRefreshRevision` 只能在验证上述全集的 global finalize 事务清除，单个 pair 的 publish 无权清除。

### 14.6 `NotificationSchedulingDecision`

表示一次对账在能力/预算选择和适用平台结果完成后，对单个设备提醒候选作出的最终选择或阻断投影；权限、channel 或容量预检没有平台调用时，它是解释单条状态的唯一设备投影，不得伪造 Delivery。

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `installationId` | `EntityId` | 当前设备；不随业务数据迁移。 |
| `notificationDatasetEpoch` | `NotificationDatasetEpoch` | 非 current epoch 永不可见。 |
| `notificationInputRevision` | `NotificationInputRevision` | 必须等于 NotificationDatasetState 的唯一权威 revision 和本 pair ReconciliationState 镜像值。 |
| `transport` | `local_notification \| remote_push` | 不同 transport 的决策身份不可碰撞。 |
| `platform` | `ios \| android` | 与对应 ReconciliationState 一致。 |
| `reminderInstanceId` | `EntityId` | 当前设备候选。 |
| `recipientSlot` | 文本 | 与 Delivery 相同的稳定无内容投递槽。 |
| `reconciliationRunId` | `EntityId` | 本轮随机、不透明身份；只有等于 ReconciliationState.publishedRunId 才可见。 |
| `platformRequestId` | 文本? | 有当前期望请求时为项目 `lbr2:` ID；不使用 adapterNativeId。 |
| `scheduleFingerprint` | `ContentHash` | 当前候选身份/内容/精度合同摘要，不含可见内容。 |
| `decision` | `eligible_selected \| permission_blocked \| channel_blocked \| capacity_deferred \| unsupported \| retryable_error \| terminal_error` | exact 被拒但选用 approximate 时仍是 eligible_selected。 |
| `reasonCode` | 受控无内容码? | 解释阻断/失败，不保存平台原始消息。 |
| `requestedPrecision` | `exact \| approximate \| not_applicable` | 与当前候选或失败尝试一致。 |
| `environmentGeneration` | 非负整数 | 与本轮固定平台环境一致。 |
| `inputFingerprint` | `ContentHash` | 覆盖 active generation/epoch、`NotificationInputRevision`、capability/environment、tzdb/engine/adapter 合同等最终 CAS guards；不得另造含义重叠的 domain/settings 全局 revision。 |
| `computedAt` | `Instant` | 诊断时间，不用于决定发布先后。 |

唯一键为 `(installationId, notificationDatasetEpoch, notificationInputRevision, transport, platform, recipientSlot, reminderInstanceId, reconciliationRunId)`。`eligible_selected` 表示最终选择未被能力/预算/错误阻断；平台已经 accepted 时仍以 Delivery 作为更强单条证据，平台 retryable/terminal 失败则 Decision 必须改为相应 error。实现可预写 building run rows，但只有所属 run 完整 sealed 且 ReconciliationState 的最终 guard-CAS 发布相同 run，行才成为 current projection。

没有 matching accepted Delivery 时，固定显示映射为：permission_blocked→“等待通知权限”，channel_blocked→“提醒渠道已关闭”，capacity_deferred→“等待补齐”，eligible_selected/retryable_error→“正在重新检查”，unsupported/terminal_error→“失败”。不得把 eligible_selected 单独写成“已安排”。

### 14.7 `NotificationSchedulingRun`

为防止崩溃把部分 Decision 集合发布成完整结果，每轮拥有 device-only run header：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `reconciliationRunId` | `EntityId` | 随机、不透明，本 installation 内不复用。 |
| `installationId`、`notificationDatasetEpoch`、`notificationInputRevision`、`transport`、`platform` | 见上 | 与本轮所有 Decision 和 ReconciliationState 一致。 |
| `registeredPairSetDigest` | `ContentHash` | 必须等于 current NotificationDatasetState；pair set 改变使本轮不可发布。 |
| `phase` | `building \| sealed \| published \| discarded` | 只有 sealed 可参与最终发布；published/discarded 终态且不可改写。 |
| `inputFingerprint` | `ContentHash` | 本轮所有最终 guards 的规范摘要。 |
| `expectedDecisionCount` | 非负整数 | 完整候选集合应有的 Decision 行数。 |
| `decisionSetHash` | `ContentHash?` | sealed 起必填；对按 `(recipientSlot, reminderInstanceId)` ASCII 稳定排序的规范 Decision 投影计算。 |
| `builtAt`、`sealedAt`、`publishedAt` | `Instant?` | 仅用于诊断，不决定顺序。 |

seal 短事务必须同时验证同 run 行数恰等于 `expectedDecisionCount`、每个候选恰一行且规范集合 hash 匹配；sealed 后除 `phase` 的合法终态迁移外，header 其他字段和全部 Decision 行不可修改或删除。最终 guard-CAS 在同一事务把 run 从 sealed 改 published，并设置 ReconciliationState.publishedRunId；guard 变化则把 sealed run 改 discarded 并重排。building 崩溃行、未被指向的 sealed run 和 discarded run 永不可见，可在安全保留期后回收。

### 14.8 `NotificationReconciliationState`

NotificationDatasetState 的每个 registered pair 恰有一项 `(installationId, notificationDatasetEpoch, transport, platform)`；非 registered pair 不得存在 active state。它用于解释当前设备的 pair 调度覆盖，不是 ReminderPlan/Instance 的业务事实。

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `installationId` | `EntityId` | 当前设备。 |
| `notificationDatasetEpoch` | `NotificationDatasetEpoch` | 与 active control 不同即整体失效。 |
| `notificationInputRevision` | `NotificationInputRevision` | NotificationDatasetState current revision 的 pair 镜像；最终 CAS 必须同时精确匹配 owner。 |
| `registeredPairSetDigest` | `ContentHash` | 必须等于 NotificationDatasetState 当前 digest；用于 coordinator 完整性检查。 |
| `transport` | `local_notification \| remote_push` | 分别发布本地/远程设备投影。 |
| `platform` | `ios \| android` | 分别维护平台预算与证据。 |
| `state` | `pending \| running \| succeeded \| degraded` | succeeded 只证明该 epoch 的一次完整对账。 |
| `publishedRunId` | `EntityId?` | pending/running 必须为空；succeeded/degraded 必须指向同 inputRevision/epoch/transport/platform 且 phase=published 的完整 run。 |
| `scheduledThrough` | `Instant?` | 仅 same-epoch succeeded 可非空并作为覆盖水位；pending/running/degraded 必须为空。 |
| `lastAttemptedAt` | `Instant?` | succeeded/degraded 完成一次 guarded run 时设置；不代表成功。 |
| `lastSucceededAt` | `Instant?` | 仅 succeeded 可作为当前“最近成功”；其他状态即使保留历史诊断值也不得展示为当前。 |
| `environmentGeneration` | 非负整数 | 平台能力环境代次；不得代替 dataset epoch。 |
| `capabilityFingerprint` | `ContentHash` | 覆盖权限、精度、预算和 adapter 能力，不含内容。 |
| `inputFingerprint` | `ContentHash?` | succeeded/degraded 发布 run 的全部 guard 摘要；pending/running 为空。 |
| `budget` | 非负整数 | 本轮固定平台预算。 |
| `tzdbVersion`、`recurrenceEngineVersion`、`adapterContractVersion` | 版本 | 任一不匹配使水位失效并触发重算。 |
| `failureCode` | 受控无内容码? | degraded 时解释重试原因。 |

普通输入失效只按 NotificationDatasetState 的全 pair fan-out 事务推进；本行不得独立递增 revision。业务/设置命令在 owner revision 已达上限时整体失败且不改变输入。原生 capability/environment 是已经发生、不能拒绝的外部事实：若失效事务发现上限，必须原子把 owner 置 `revisionState=exhausted`、保留最大 revision、把全部 pair state 置 pending，并清 `publishedRunId/scheduledThrough/inputFingerprint/failureCode`，同时保存新 `environmentGeneration`；若已取得规范化新 capability snapshot，也保存其新 `capabilityFingerprint`，绝不清空这个非空字段。若当前只能确认 environment dirty 而 capability probe 失败，可保留 last-observed capability fingerprint 作为非当前诊断值，但 pending+exhausted 永不能把它当证据；写 `notification_revision_exhausted` 耐久维护任务并停止全部新 platform write/current publish，直到受审迁移或新 dataset epoch 重置。原生变化在被 App 接收的首个短事务执行上述失效；此前最新 Delivery 也因 environment/capability/owner 状态不匹配不能声称当前。

每个 pair 的最终短事务先重读 NotificationDatasetState `revisionState=active`、revision、pair-set digest 与所有 guards，并验证 sealed run 的 expected count/hash：全匹配且完整成功时 CAS 为 succeeded；平台结果失败时可 CAS 为 degraded 并发布完整 Decision run，但不发布成功水位；guard 变化或崩溃不发布本轮 run。pair succeeded 不代表 coordinator 完成，也无权清 force marker；global finalize 仍按 14.5 验证全集。真实平台 receipt 可以保留为非当前技术事实。

### 14.9 `ReminderDeliveryAggregate`（P1）

服务端为一个收件人范围 ReminderInstance 维护无内容的跨设备聚合，客户端不能从本机 device-only 行猜测：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `reminderInstanceId` | `EntityId` | 聚合对象。 |
| `applicableDeviceSetVersion` | `ServerVersion` | 对应服务端适用设备集合和失活期限的一次权威计算。 |
| `applicableDeviceCount`、`acceptedDeviceCount`、`pendingDeviceCount`、`retryableDeviceCount`、`terminalFailedDeviceCount` | 非负整数 | 只含无内容计数；后四个状态计数互斥，且之和必须等于 applicableDeviceCount。 |
| `aggregateState` | `planned \| scheduled \| failed` | 至少一个当前 accepted 才 scheduled；全部适用设备终态失败且无 accepted/待重试才 failed；其余 planned。 |
| `computedAt` | `Instant` | 服务端计算时间。 |
| `serverSequence` | `ServerSequence` | 客户端只按同空间序列应用。 |

`acceptedDeviceCount > 0` 时 aggregateState=scheduled；`applicableDeviceCount > 0` 且 `terminalFailedDeviceCount = applicableDeviceCount` 时为 failed；其余为 planned。设备状态只按服务端确认的最新 device session tenure 和带版本报告进入一个桶，缺失/过期报告进入 pending，不得乐观算 accepted。该投影不进入 portable backup，也不含设备名称、推送 token、通知内容或原始错误。TD-020/022 必须在 P1 上线前固定设备失活期限、报告幂等键和并发合并；在此之前客户端只展示当前 installation 状态。

`NotificationDelivery`、`NotificationActionInbox`、`NotificationDatasetState`、`NotificationSchedulingDecision`、`NotificationSchedulingRun` 和 `NotificationReconciliationState` 都是 device-only，不进入 portable backup、业务同步或用户导出；ReminderDeliveryAggregate 是 server-owned redacted projection，只通过受控同步读取。

#### DOM-070：提醒与记录独立

提醒实例的 acknowledged/snoozed 状态不得自动给不支持完成的记录添加完成状态；通知动作必须先转换为对应领域命令，再由业务规则决定能否改变周期实例或清单。

#### DOM-071：收件人状态与设备投递分离

ReminderInstance 在一个 subscription/收件人范围内共享。P0 当前 installation 的同一身份最新 attempt 全部合同匹配且 accepted 时可从 planned 聚合为 scheduled；证据失效而实例仍有效时回 planned。P1 只有 server-owned ReminderDeliveryAggregate 可以把至少一个适用 Device accepted 聚合为 scheduled；客户端不得从本机行推断设备全集。

P0 只有本 installation 终态失败且没有 accepted/待重试 attempt 时可进入 failed；P1 只有服务端聚合确认全部当前适用设备终态失败时可进入 failed。权限未询问/拒绝、渠道关闭、容量不足或暂时没有活跃设备时保持 planned。单条“已安排/近似”从 latest matching Delivery 派生；等待权限/补齐/失败只从 state∈{succeeded,degraded} 且 epoch/inputRevision/transport/platform/publishedRunId 全匹配的 Decision 派生；无 current Decision 且 state 缺失/pending/running/degraded 时显示“正在重新检查”。全局水位只来自 same-epoch succeeded ReconciliationState。

#### DOM-072：平台证据不等于送达

NotificationDelivery accepted、iOS pending、Android adapter registry、远程推送供应商 receipt 和 observed trigger/action 都不能证明用户看到通知。Android 跳过重挂还必须同时具有当前 epoch registry 匹配和相同 platformRequestId、fingerprint、precision、environment generation、capability fingerprint、adapter contract 的最新 accepted attempt；较早或其他 epoch 的 accepted 不能覆盖较新的 requested/rejected/missing/cancelled。

#### DOM-073：通知数据集隔离

- `notificationDatasetEpoch` 的唯一权威是当前 `phase=active` 的受认证 `DatasetControlRecord`；control 不可读、phase 非 active 或 Repository 尚未开放时，不签发通知 read lease，不调度、不写 ActionInbox、不导航目标、不执行命令；
- NotificationDatasetState、Delivery、ActionInbox、Decision、SchedulingRun、ReconciliationState、reconcile task/checkpoint、scheduled-through、request ID 和 payload 携带的 epoch 都只是 control 权威值的镜像；缺失、非法、旧或 future epoch 永久 no-op，不能更新当前 ReminderInstance/Delivery、打开目标或产生 mutation；
- `environmentGeneration` 只表示权限、时间/时区、重启和 adapter 等平台环境变化，与 dataset epoch 不可互换；
- committed restore/manual rollback checked `+1`；`validating` 无 marker 回 previous 保持原 epoch，marker 后完成 target 不再次递增，schema/cipher migration 保持 epoch；
- restore/manual rollback 的 mapper 优先级固定为：① `acknowledged/snoozed/cancelled/expired` 业务终态保持；②其余实例的来源按 REM-021 已失效时转 `cancelled`；③ `paused` 原因仍成立时保持，否则 future 转 `planned`、past 转 `expired` 并清 pauseReason；④其余 `scheduled/failed` 在来源仍有效时 future/past 都转 `planned` 并清 failureCode，past 只派生 application-only 待查看且永不补发；⑤原 `planned` 且来源仍有效时保持 planned，past 永不重挂。mapper 排除全部通知设备投影和旧 task，并另建/激活 target-epoch force task；schema/cipher migration 不执行该规范化。

这里“来源失效”只按 REM-021 的穷举谓词判断；不得另造含义重叠的“不可操作”分支把同一输入写成 expired。若未来需要对仍有效但过久的 application-only 提醒自动过期，必须在 REM-032 新增按来源可测试的确定规则和迁移，而不能由 restore mapper 猜测。

#### DOM-074：通知动作租约分段

parser Lease A 只覆盖预先完成 bounded syntax/allowlist/cross-field 校验后的 active epoch/request/category fence 与 inbox 写入，随后立即释放；人机解锁等待不持有租约。解锁后无法取得 Lease B 时保持 inbox pending 并 defer，不能误标 stale。取得 fresh action/navigation Lease B 后，dataset/epoch 已改变或 current inbox 不存在时直接 targetless no-op，不访问 previous、也不在 target 建 row；同 epoch inbox 存在但 request identity 已变化时才以 `stale_noop` 终结且不得解析目标；identity 仍 current 但授权、来源、动作或 category 语义已不允许时，在短事务消费 inbox 为 `business_noop`。mutating command 在 Lease B 下原子提交，默认 open 在紧邻导航前也必须 fresh fence。`validating` 等无法分类阶段不创建 inbox，并按 REM-062 defer。

#### DOM-075：通知对账发布原子性

任何调度输入变化必须由 NotificationDatasetState 原子推进一次 revision，并把完整 registered pair 集的 current publishedRunId/成功水位清空后进入 pending。每个 pair 的 Decision 集合只有完整 sealed count/hash、owner revision/pair-set digest 与全部 guards 匹配，并与其 ReconciliationState 在同一 CAS transaction 发布时可见；部分 building rows、旧 epoch/revision/digest、discarded 或未被指向的 run 永远不可驱动 UI。degraded 可发布完整 Decision 供逐条解释，但不能发布全局成功水位；仍匹配的 accepted Delivery 不因此失效。单 pair publish 不完成 global coordinator，也不能清 force marker；全集 finalize 条件以 14.5 为准。

## 15. 设置与本地产品状态

### 15.1 `AppPreferences`

按安装保存非内容设置：

- 地区、语言、周起始日和当前时区；
- 通知内容模式、应用静默时段和默认重复催促设置；
- 应用锁是否开启和自动锁定时机；
- 智能首次说明确认版本；
- 可选遥测同意版本；
- 备份提示是否展示、上次关闭时间；
- 最近一次成功备份和恢复时间；提醒对账时间/水位只能保存在带 `notificationDatasetEpoch` 的 `NotificationReconciliationState`，不能以裸时间存在；
- 当前数据库、备份和契约版本。

安全密钥、API Key 和令牌只保存安全存储引用，不直接成为 `AppPreferences` 值。

### 15.2 `ProductCounter`

为了不扫描内容计算渐进提示，可以本地保存只增计数：

- 用户主动创建真实记录总数；
- 安装日期；
- 首次真实记录日期；
- 备份提示展示次数和日期。

恢复或导入不增加真实创建计数，删除不减少计数。该计数不用于用户绩效展示。

## 16. 操作记录与同步扩展

### 16.1 `AuditEvent`

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `spaceId` | `EntityId` | 操作发生空间。 |
| `actorId` | `EntityId` | 本地身份或账号。 |
| `action` | 受控枚举 | create/update/archive/trash/purge/restore/share/member 等。 |
| `entityType`、`entityId` | 文本、`EntityId` | 目标。 |
| `occurredAt` | `Instant` | 操作发生时间。 |
| `summary` | 结构化元数据 | 只含字段类别或数量变化，不保存完整正文。 |
| `clientMutationId` | `EntityId?` | P1 幂等与追踪。 |
| `authority` | `local \| server_verified` | 家庭权限、成员和高风险操作必须由服务端核验后记为 server_verified。 |
| `serverSequence` | `ServerSequence?` | 同步空间中的可信顺序。 |
| `actorDisplaySnapshot` | 文本? | 家庭历史可选的当时显示名；不是身份或鉴权依据。 |

P0 只必须记录高风险数据操作和必要诊断；P2 家庭操作记录在此基础上开放用户可见审计。AuditEvent 创建后不可编辑；客户端可以请求业务操作，但不能自行宣称一个未被服务器接受的家庭审计事实。

### 16.2 `Account` 与 `AuthenticationIdentity`

`Account` 是跨设备用户主体，不等于某次登录会话：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `id` | `EntityId` | 服务端生成且永不复用。 |
| `displayName` | 文本? | 1–80 个码点；家庭页面显示，不能作为鉴权。 |
| `preferredLocale` | 地区语言? | 仅用于服务通知和默认显示。 |
| `status` | `active \| deletion_pending \| deleted` | deletion_pending 只允许取消删除、导出和完成必要家庭交接。 |
| `deletionScheduledFor` | `Instant?` | 与 status 同步存在。 |
| 公共元数据 | `EntityMeta` | 服务端时间另行记录，不改写用户业务时间。 |

认证凭据由 `AuthenticationIdentity` 独立保存：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `accountId` | `EntityId` | 所属账号。 |
| `method` | `email_otp \| passkey \| apple \| google` | P1 首期至少开放 email_otp；其他值按地区与商店配置。 |
| `providerSubject` | 文本 | 供应商内稳定标识；与 method 组成唯一键。 |
| `displayIdentifier` | 文本? | 经过验证的邮箱等；属于账号敏感资料，不进入业务日志。 |
| `verifiedAt` | `Instant` | 只有验证完成后才能创建 active 会话。 |
| `disabledAt` | `Instant?` | 禁用后不得签发新会话。 |

一个 active 账号至少保留一种可用认证身份。添加或删除身份必须近期重新认证；认证提供商令牌不成为领域字段。

### 16.3 `Device` 与 `AccountSession`

`Installation` 代表一次本地安装；登录后服务端为该账号与安装建立 `Device`：

| `Device` 字段 | 类型 | 规则 |
| --- | --- | --- |
| `id` | `EntityId` | 服务端设备登记 ID。 |
| `accountId` | `EntityId` | 所属账号。 |
| `installationId` | `EntityId` | 随机安装标识；同账号内唯一，不是硬件指纹。 |
| `displayName` | 文本 | 默认由平台和用户可改名称组成，不含广告标识。 |
| `platform` | `ios \| android \| web` | 受控值。 |
| `status` | `active \| revoked` | revoked 不可恢复，重新登录产生新 Device。 |
| `firstSeenAt`、`lastSeenAt` | `Instant` | 服务端观测时间，只用于安全与设备管理。 |
| `revokedAt` | `Instant?` | 撤销完成时间。 |

`AccountSession` 字段：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `id`、`accountId`、`deviceId` | `EntityId` | 必须互相匹配。 |
| `status` | `pending \| active \| expired \| revoked` | 终态不可重新激活。 |
| `createdAt`、`expiresAt` | `Instant` | 短期访问令牌与可轮换会话分开实现。 |
| `lastUsedAt`、`revokedAt` | `Instant?` | 服务端安全事件时间。 |
| `authStrength` | 受控枚举 | 记录密码外验证/近期重新认证级别，不保存凭据。 |

令牌、私钥和验证码不进入普通领域数据库、备份、同步或审计摘要。

### 16.4 `DatasetBinding`

`DatasetBinding` 是当前本地数据集与账号个人空间的设备内绑定，防止把退出后保留的数据误传给另一个账号：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `localSpaceId` | `EntityId` | 当前数据集唯一默认个人空间。 |
| `accountId` | `EntityId?` | bound/paused 时为其来源账号。 |
| `remoteSpaceId` | `EntityId?` | 完成认领后与 localSpaceId 使用同一稳定 ID。 |
| `state` | `unbound \| analyzing \| choice_required \| binding \| bound \| paused \| auth_required \| detaching` | 只有 bound 允许内容同步。 |
| `provenanceAccountId` | `EntityId?` | 数据曾来自哪个账号；退出保留副本后仍保留，阻止跨账号静默认领。 |
| `lastCompletedStep` | 受控枚举? | 崩溃后恢复认领，不代表业务数据已上传。 |
| `bindingGeneration` | 正整数 | 每次认领/解绑尝试递增，丢弃迟到响应。 |

这里的“认领”仅指云端为空的 direct claim：它只建立身份映射，不批量改写 Record 的 ID、createdByActorId 或历史 AuditEvent；LocalActor 通过 claimedByAccountId 解析为当前账号。双方都有数据时属于 import + adopt，完成后本地原子采用远端 Space.id，候选对象按 DATA-071 保留或重映射 ID，不得套用 direct claim 的 ID 承诺。选择“仅本机”时保持 unbound，已登录账号的云端个人空间不挂载为第二个本地默认个人空间。

### 16.5 `SpaceMembership` 与 `Invitation`

`SpaceMembership` 只用于账号空间；个人空间有且仅有所属账号一条 active membership，家庭空间规则由家庭规范定义：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `spaceId`、`accountId` | `EntityId` | 服务端鉴权边界；同一账号可有多段历史 tenure，但最多一条未终结 membership。 |
| `membershipEpoch` | 正整数 | 同一 `(spaceId, accountId)` 每次重新加入严格递增；与二者共同唯一。 |
| `role` | `owner \| member` | personal 固定 owner；家庭首期仅这两种。 |
| `status` | `active \| leaving \| removing \| removed` | Invitation 独立表达未接受状态；只有 active 可以读取或写入空间；removed 终态不复活。 |
| `joinedAt`、`endedAt` | `Instant?` | 由服务端事务设置。 |
| `invitedByAccountId` | `EntityId?` | 家庭邀请来源。 |
| 公共元数据 | `EntityMeta` | 角色和状态变化产生服务端审计。 |

`Invitation` 包含家庭空间、邀请者、目标角色、tokenHash、状态 `draft | active | accepted | revoked | expired`、过期时刻、接受账号、接受/撤销时间和服务端版本。明文 token 只在创建时返回，不保存、不写日志；同一邀请最多接受一次。重新邀请已离开的账号会创建新 Invitation，接受时创建新 membership ID 和更大的 membershipEpoch，不修改旧 membership。

### 16.6 同步元数据

所有可同步实体从 P0 起保留：

- 全局稳定 ID；
- `spaceId`；
- 创建/修改人；
- 创建/修改时间；
- 当前副本内的 `revision`；
- 回收站时间；
- 可版本化枚举和扩展字段。

同步后每个实体另有 `serverVersion` 和最近确认的 `serverSequence`；它们不覆盖本地 revision 或用户时间。

`SyncMutation` 是与领域写入同一事务产生的持久 outbox 项：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `clientMutationId` | `EntityId` | 设备生成的服务端幂等键，永不复用。 |
| `spaceId`、`entityType`、`entityId` | 标识 | 明确鉴权和目标。 |
| `authorizationMembershipId` | `EntityId?` | 家庭空间写入时必填并绑定提交时的 membership tenure；重新加入不能复用旧授权。 |
| `operation` | 受控命令 | 使用领域命令语义，不传任意 SQL/表 patch。 |
| `baseServerVersion` | `ServerVersion` | 0 表示客户端认为实体尚不存在。 |
| `snapshotGeneration` | 正整数? | bound 空间必填；新 mutation 必须匹配服务端当前可写 generation，既有幂等收据可直接返回原结果。 |
| `payloadVersion` | 正整数 | 机器格式兼容版本。 |
| `state` | `pending \| sending \| retry_wait \| acknowledged \| conflict \| rejected_forbidden \| rejected_moved \| rejected_version` | sending 崩溃后可安全回到 pending；rejected_moved 表示目标已离开原空间。 |
| `attemptCount`、`nextAttemptAt` | 非负整数、`Instant?` | 受限指数退避。 |
| `resultServerVersion`、`resultServerSequence` | 版本? | acknowledged 时必填。 |
| `errorCode` | 受控码? | 不含用户内容。 |

`SyncCursor` 每个设备、空间一条，保存最近完整应用的 `ServerSequence`、快照 generation 和更新时间。只有一页变化在本地事务中全部应用后才能推进；游标不是删除或备份时间。

`SubmitStockChange` mutation 的 entityType/entityId 指向家庭物品聚合，payload 固定包含 intentId、recordId、kind、inputMode、requestedDelta 或 targetQuantity、baseLedgerSequence、occurredAt、recordedAt，并可含 note、correctionOfTransactionId；CreateHouseholdItem 在同一版本化 payload 中包含 openingIntentId 与 initialQuantity。实现不得发送由客户端预先计算的 quantityBefore/quantityAfter 作为权威输入。

### 16.7 `SyncConflict`

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `id`、`spaceId`、`entityType`、`entityId` | 标识 | 指向仍可处理的目标。 |
| `clientMutationId` | `EntityId` | 触发冲突的本地操作。 |
| `baseServerVersion`、`remoteServerVersion` | `ServerVersion` | 冲突比较依据。 |
| `fieldPaths` | 路径集合 | 只列冲突字段，不进入普通遥测。 |
| `localSnapshotRef`、`remoteSnapshotRef` | 加密引用 | 只保留解决所需最小字段；受源记录敏感级别保护。 |
| `state` | `unresolved \| resolved_local \| resolved_remote \| resolved_merged \| invalidated` | 解决会创建引用双方版本的新 mutation。 |
| `createdAt`、`resolvedAt` | `Instant`、`Instant?` | 本地展示与清理依据。 |

冲突对象不是第三份业务记录；解决或目标永久删除后按同步规范清理快照。服务端权限拒绝和墓碑优先不是可供用户覆盖的冲突。

### 16.8 `Tombstone`

永久删除同步实体后，服务端保存最小墓碑：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `spaceId`、`entityType`、`entityId` | 标识 | 原 ID 永不复用。 |
| `serverVersion`、`serverSequence` | 版本 | 使所有设备观察删除。 |
| `purgedAt` | `Instant` | 服务端接受永久删除时间。 |
| `retainUntil` | `Instant` | 同步安全期限；与 30 天业务回收站不同。 |
| `reason` | `user_purge \| cascade \| account_deleted \| family_deleted` | 不含内容；跨空间移动不产生 Tombstone。 |

墓碑只含上述删除控制字段，不保留标题、正文、详情、标签、附件、冲突快照或其他可恢复业务内容，也不进入用户业务导出；因此业务内容清理完成与墓碑保留不矛盾。服务端只有先发布更高 snapshot generation 并把旧 generation 设为不可写，才可裁剪到期墓碑；之后仍离线的设备必须通过新 generation 快照重建，不能把旧实体当新增上传或基于旧 generation 写入。

### 16.9 `AttachmentTransfer` 与云备份元数据

`AttachmentTransfer` 包含 attachmentId、方向、内容哈希、总大小、已确认偏移/分块、状态 `queued | transferring | verifying | available | failed | cancelled`、重试信息和不含路径的错误码。附件元数据只有在内容完整验证并获得访问权限后才能对其他设备显示 available。

`CloudBackup` 只保存恢复副本的管理元数据：accountId、可选 spaceId、备份 ID、创建设备、createdAt、formatVersion、schemaVersion、byteSize、contentHash、状态 `creating | available | deleting | deleted | failed` 和可选恢复 generation。备份内容、加密和恢复语义仍以数据生命周期与备份契约为准；CloudBackup 不携带 SyncCursor，也不冒充实时同步点。

### 16.10 `OwnershipTransfer`

家庭所有权转移是独立双人确认流程：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `spaceId` | `EntityId` | 必须是 active family 空间。 |
| `fromAccountId`、`toAccountId` | `EntityId` | 发起时分别是唯一 active owner 和 active member。 |
| `state` | `proposed \| awaiting_target \| accepted \| declined \| expired \| cancelled` | 只有 awaiting_target 可以接受/拒绝。 |
| `expiresAt` | `Instant` | 到期后不可接受。 |
| `createdAt`、`respondedAt` | `Instant`、`Instant?` | 使用服务端时间。 |
| `initiatorReauthenticatedAt`、`recipientReauthenticatedAt` | `Instant`、`Instant?` | 接受时双方都必须满足近期认证。 |
| `baseMembershipVersions` | 版本对 | 防止成员状态变化后完成旧转移。 |

accepted 不是先改一人再改另一人的中间态；服务端一次事务交换两条 membership role、增加空间版本并写入审计，任何可见状态都必须恰好一个 owner。

### 16.11 `ReminderSubscription`

ReminderPlan 属于家庭业务记录；`ReminderSubscription` 决定哪个 Account 的哪些设备接收投递：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `spaceId`、`reminderPlanId`、`membershipId`、`recipientAccountId` | `EntityId` | `(reminderPlanId, membershipId)` 唯一；membership 必须 active 且属于 recipient。 |
| `mode` | `all_active_devices \| selected_devices \| off` | 默认由家庭规范决定。 |
| `selectedDeviceIds` | ID 集合 | selected_devices 时至少一个，且都属于 recipient。 |
| `origin` | `creator_default \| user_opt_in \| assignment` | 解释订阅来源，不作为权限。 |
| `status` | `active \| paused \| cancelled` | paused 可恢复且必须有原因；成员离开、计划永久失效或空间到期删除时进入终态 cancelled。 |
| `pauseReason` | `space_deletion_scheduled`? | paused 时必填；恢复 active 时清空。 |
| 公共元数据 | `EntityMeta` | 修改只影响该收件人，不改业务时间。 |

不同成员的订阅不复制 ReminderPlan；每个 `status=active` 且 `mode!=off` 的 subscription 按相同来源发生项展开收件人范围内的 ReminderInstance，同一账号的多个 Device 共享该逻辑实例并各有 NotificationDelivery。`mode=off` 是成员主动退订但关系仍有效；`cancelled` 是系统终结且不能恢复。一个成员处理完成/跳过或加入共享采购清单等共享业务状态后，各订阅实例通过同步取消适用未来投递；仅知道了/稍后等个人提醒动作只改变该 subscription 的实例。

### 16.12 `SpaceTransferOperation`

跨空间移动不是直接改 spaceId，而是可恢复的协调对象：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `recordId`、`sourceSpaceId`、`targetSpaceId` | `EntityId` | 两空间不同；发起时记录属于 source，提交后同一 ID 属于 target。 |
| `initiatedByAccountId` | `EntityId` | 必须同时有来源操作权和目标创建权。 |
| `state` | `preflight \| awaiting_confirmation \| transferring \| committed \| failed_retryable \| rolled_back` | transferring 起记录被服务端写锁定；committed/rolled_back 为终态。 |
| `baseRecordVersion`、`baseSpaceVersions` | 版本 | 防止预览后对象或成员资格改变。 |
| `mappingPlan` | 结构化选择 | 分类、标签、关联、提醒和审计处理选择；不复制正文。 |
| `sourceServerSequence`、`targetServerSequence` | `ServerSequence?` | committed 时同时填充，分别定位成对的 departed/arrived 事件。 |
| `committedRecordVersion` | `ServerVersion?` | committed 时同记录的新权威版本。 |
| `startedAt`、`completedAt` | `Instant`、`Instant?` | 服务端时间。 |

服务端在一个事务中锁定记录和两空间，验证映射/附件后修改记录及聚合子对象的 `spaceId`、提升同一 recordId 的版本，并向源/目标变化流写入共享 transferId 的 `record_departed` / `record_arrived` 事件。它们不是 Tombstone：departed 不表示永久删除，arrived 携带目标权限内可见的完整聚合快照。客户端按 transferId 幂等应用；先收到 departed 时把本地对象置为 `transfer_pending` 只读，先收到 arrived 时原子切换归属，第二个事件只完成收据。只有源权限的客户端在 departed 后清除内容并保留无内容收据，只有目标权限的客户端从 arrived 建立副本。旧源 mutation 返回 rejected_moved，不能自动改投目标空间。

## 17. 聚合事务边界

以下操作必须在一个领域事务中完成：

| 操作 | 必须原子包含 |
| --- | --- |
| 创建普通记录 | `Record`、对应详情和初始标签关系。 |
| 未绑定创建家庭物品/服务端接受创建 | `Record`、详情、accepted opening 意图、opening 流水、确认/预估缓存、适用低库存周期和提醒任务。 |
| 绑定空间本地创建家庭物品 | provisional Record、详情、pending opening 意图、SyncMutation 和 projectedQuantityCache；不创建确认流水、周期或通知。 |
| 编辑记录 | 根版本、详情和受影响提醒对账任务。 |
| 完成/跳过周期实例 | 实例物化、状态、操作记录和提醒取消任务。 |
| 清单批量完成 | 所有目标项目、派生完成状态和提醒取消任务。 |
| 未绑定库存变化 | accepted 意图、新流水、确认/预估数量缓存、低库存周期变化和适用提醒任务。 |
| 绑定库存提交 | pending 意图、预估数量缓存和同步 mutation；不创建流水或低库存周期。 |
| 服务端库存接受 | accepted 意图、新流水、确认数量缓存、低库存周期变化和适用提醒任务。 |
| 服务端库存拒绝 | rejected 意图、预估数量重算和可处理冲突；不修改确认账本。 |
| 删除到回收站 | 根生命周期、未来提醒取消任务和必要操作记录。 |
| 恢复记录 | 根生命周期、派生索引重建标记和未来提醒重建任务。 |
| 永久删除记录 | 聚合子对象、附件清理任务和适用墓碑。 |
| 通知响应入箱 | 短 Lease A 下的 epoch/request/category fence 与幂等写 `NotificationActionInbox`；不包含解锁、用户等待、导航或业务 mutation。 |
| 处理会改变状态的通知动作 | fresh Lease B 下消费 current-epoch `NotificationActionInbox`、领域 mutation、业务幂等结果、inbox 终态和后续提醒输入 revision/对账任务；任一步失败整体回滚。 |
| 发布通知对账轮次 | sealed run 的完整 Decision 集、run phase、ReconciliationState.publishedRunId/state，以及仅成功时的 scheduledThrough/lastSucceededAt；以全部 guards 做单一 CAS，平台调用不在事务内。 |

通知 action command 提交前必须再次验证 fresh Lease B 绑定的 active generation/epoch；若 activation 已使 lease 失效，事务整体中止。TD-010 activation exclusive gate 只等待当前短 parser/action/reconciler lease 和已进入事务的提交/回滚，不等待应用锁或用户操作；尚未进入事务的 processor defer/no-op，不能在两个 dataset generation 间完成半个动作。

操作系统通知、文件删除和网络发送不可能与数据库处于同一原子事务；领域事务写入可重放任务，再由适配层执行并对账。

## 18. 全局领域不变量

### DOM-080：引用完整性

同一聚合内所有子对象必须引用现存且类型正确的父对象。父对象进入回收站后子对象不可单独编辑；父对象永久删除时按数据生命周期规范清理。

### DOM-081：空间一致性

任何领域命令都必须显式携带或从目标解析空间，并验证参与实体属于同一空间。不能依赖当前页面选择的空间隐式授权。

### DOM-082：幂等命令

来自系统通知、网络重试、导入或同步的可重复命令必须携带幂等标识。同一标识重复执行只能返回原结果，不得重复完成、重复流水、重复清单项或重复删除。

### DOM-083：时间不可倒写历史

设备时间改变不得自动修改已有 `createdAt`、`updatedAt`、流水发生时间、完成时间或历史计划。检测到明显倒退时可以使用单调序列解决本地排序，但必须保留用户声明时间。

### DOM-084：敏感优先

任何组合规则都取更严格的数据保护结果：单条敏感设置高于全局完整通知，`aiAccess = denied` 高于任何智能上下文选择，未解锁状态高于页面恢复请求。

### DOM-085：缓存可重建

搜索索引、今天关注项、清单进度、当前库存缓存、缩略图和系统通知队列损坏或清空后，都能从权威领域数据重建，不得成为恢复完整性的必要唯一副本。

### DOM-086：未知枚举安全失败

旧客户端遇到未知记录类型、状态、操作或契约版本时不得按默认分支修改数据。应保留原始值、以只读或不可用状态展示，并要求升级或迁移。

### DOM-087：跨设备顺序不使用设备时钟

本地 revision 只保护当前副本，updatedAt 只表达用户设备记录的业务时间。跨设备并发必须使用 baseServerVersion、服务端版本和空间序列判断；不得以“时间更晚”静默覆盖另一设备。

### DOM-088：认领不改写历史主体

LocalActor 被 Account 认领后保留原 ID，既有 createdByActorId、updatedByActorId 和 AuditEvent 不批量改写。展示层通过 claimedByAccountId 解析身份；恢复、退出或再次登录不得把旧作者伪装成新账号。

### DOM-089：服务端逐命令鉴权

客户端缓存的 membership、当前空间或离线时获得的权限不是最终授权。服务端必须对每个 mutation 的账号、设备、active membership、空间、目标和操作重新校验；被移除后的离线写入拒绝，不能自动复制进个人空间。

### DOM-090：墓碑优先

永久删除墓碑优先于基于旧版本的创建、编辑、恢复或同步重试。任何自动合并都不得复活已永久删除 ID；合法重新创建必须获得新 ID。

### DOM-091：家庭唯一所有者

每个 active 或 deletion_scheduled 的家庭空间必须恰好有一个 active SpaceMembership(role=owner)。创建、所有权转移、owner 退出和家庭删除必须在服务端串行化，不能出现零 owner 或两个 owner 的可见中间态。

### DOM-092：家庭订阅不等于业务归属

ReminderSubscription 只控制某成员设备是否投递，不改变 ReminderPlan、记录、发生项或完成状态。成员退出时取消其订阅；其他成员订阅和共享业务对象继续存在。

### DOM-093：库存只有过账改变确认数量

StockChangeIntent 表达输入和同步等待，StockTransaction 表达已经接受的事实。绑定空间只有服务端可以确定 ledgerSequence、quantityBefore、delta 和 quantityAfter；客户端不得先创建一条流水再由服务端重排或重算其不可变字段。adjust 的 baseLedgerSequence 已变化时必须拒绝并让用户基于最新确认数量重新提交，不能把旧“调整为”静默应用到新账本。

### DOM-094：跨空间移动保留记录 ID

跨空间移动保留记录及聚合子对象的稳定 ID，由服务端 SpaceTransferOperation 原子改变归属并产生 paired transfer events；客户端不得直接把实体改 spaceId 后上传。移动不是复制、回收站或永久删除，不触发 DOM-090，也不允许旧源版本覆盖目标版本。

## 19. 领域命令和结果

领域层以显式命令改变数据，至少包括：

- `CreateRecord`、`UpdateRecord`、`ArchiveRecord`、`TrashRecord`、`RestoreRecord`、`PurgeRecord`；
- `CompleteOccurrence`、`SkipOccurrence`、`RescheduleOccurrence`、`SplitRecurrenceSeries`；
- `CreateChecklistFromTemplate`、`SetChecklistItemCompletion`、`ReorderChecklist`、`SaveChecklistAsTemplate`；
- `SubmitStockChange`、`ResolveRejectedStockChange`、`AddItemToShoppingChecklist`；
- `CreateReminderPlan`、`SnoozeReminder`、`AcknowledgeReminder`；
- `AttachFile`、`RemoveAttachment`、`SetSensitivity`、`SetAiAccess`。

每个命令返回：成功后的实体版本、需要重建/调度的副作用任务，以及可本地化的受控错误码。界面不得直接修改表字段绕过命令和不变量。

## 20. 错误分类

| 类别 | 示例 | 处理 |
| --- | --- | --- |
| `validation` | 标题为空、数量格式错误、日期不存在 | 保留输入，定位字段。 |
| `conflict` | revision 已变化、同步版本冲突 | 不覆盖，刷新或进入冲突处理。 |
| `not_found` | 深链接对象已永久删除 | 不泄露旧内容，显示当前不可用。 |
| `forbidden` | 家庭成员无权操作 | 不执行任何部分写入。 |
| `storage_unavailable` | 空间不足、数据库只读 | 停止写入并保留内存表单。 |
| `integrity_failure` | 库存缓存不一致、附件哈希失败 | 停止相关写入，进入修复与诊断。 |
| `unsupported_version` | 未知 Schema 或记录类型 | 只读保护并要求升级。 |

错误码由物理契约定义，错误语义不得包含用户正文。

## 21. 变更与迁移规则

- 新实体或字段先在本文件定义语义，再进入物理 Schema。
- 枚举只允许新增值；重命名或删除必须保留兼容映射。
- 把可空字段改为必填前必须定义旧数据默认值和用户可见后果。
- 改变不变量时必须评估现有数据修复、备份兼容、同步冲突和智能草稿迁移。
- 派生缓存算法改变后增加缓存版本并允许重建，不改写历史事实。
- 任何 ID、时间和数量语义变化都属于高风险迁移，需要技术决策和往返测试。

## 22. 变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| v1.19 | 2026-07-26 | 增加 NotificationDatasetState 统一 revision/pair fan-out，修复隐私比较候选循环，固定 ActionInbox claim 字段与 attempt 耗尽，并明确外部变化耗尽时的能力基线。 |
| v1.18 | 2026-07-26 | 区分 dataset 替换后旧 inbox 不可见的 targetless no-op 与 current epoch 内可持久化的 stale_noop。 |
| v1.17 | 2026-07-26 | 为 NotificationDelivery 增加隐私无关 replace 指纹，使纯隐私放宽可跨崩溃确定比较。 |
| v1.16 | 2026-07-26 | 固定 NotificationInputRevision 上限时业务写与已发生外部能力变化的不同 fail-closed 处理。 |
| v1.15 | 2026-07-26 | 增加 ActionInbox stale_noop 与可恢复 claim 状态机，耐久化明确的隐私放宽刷新意图，并区分文案收紧与动作撤权。 |
| v1.14 | 2026-07-26 | 统一提醒对账的唯一输入修订护栏，并明确 sealed SchedulingRun 仅允许 phase 进入发布或丢弃终态。 |
| v1.13 | 2026-07-26 | 增加 NotificationInputRevision、完整 sealed SchedulingRun/Decision 发布、fresh action lease、有效呈现合同、确定性恢复优先级和 P1 ReminderDeliveryAggregate，并校正 ExactDecimal 值域。 |
| v1.12 | 2026-07-26 | 增加 NotificationDatasetEpoch、ActionInbox、ReconciliationState、同 epoch Delivery 证据和激活门事务不变量，并固定恢复后的提醒状态规范化。 |
| v1.11 | 2026-07-26 | 纳入 TD-007 历史时间解析证据，并统一 ReminderInstance 收件人范围状态、逐设备 NotificationDelivery 字段与平台证据语义；同步修正页首版本。 |
| v1.10 | 2026-07-26 | 补齐库存意图/流水一对一约束、同步 generation 防复活机制、direct claim 边界和家庭物品创建事务。 |
| v1.9 | 2026-07-26 | 以成对 transfer event 保持跨空间记录 ID，并补充 membership 授权代次与提醒实例暂停状态。 |
| v1.8 | 2026-07-26 | 为库存变化意图增加账本基线，确保并发 adjust 不会静默重解释。 |
| v1.7 | 2026-07-26 | 分离库存变化意图与权威流水，定义服务端回收站时钟、成员重新加入 epoch、可恢复提醒暂停和个人低库存确认；当时的跨空间 ID 方案已由 v1.9 替代。 |
| v1.6 | 2026-07-26 | 将账号/家庭收件人订阅映射到提醒实例，并明确同账号多设备共享逻辑实例、各自投递。 |
| v1.5 | 2026-07-26 | 将未接受状态完全归属 Invitation，SpaceMembership 从接受邀请的原子事务起进入 active。 |
| v1.4 | 2026-07-26 | 明确家庭空间所有者来源与删除计划，并增加所有权转移、成员提醒订阅、跨空间移动和服务端可信审计实体。 |
| v1.3 | 2026-07-26 | 完整定义账号、认证身份、设备会话、数据集绑定、成员关系、同步元数据、冲突、墓碑、附件传输和云备份逻辑实体。 |
| v1.2 | 2026-07-26 | 在规则段保存重复引擎版本，保证备份、迁移和同步可以重现历史候选。 |
| v1.1 | 2026-07-26 | 增加清单用途与低库存周期解决原因，以支持采购清单选择和归档/删除状态。 |
| v1.0 | 2026-07-26 | 建立身份、空间、记录根、五种记录聚合、提醒、附件、库存、设置和同步扩展的统一逻辑模型与不变量。 |

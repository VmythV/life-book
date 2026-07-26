# 生活有谱领域模型

> 项目代号：`life-book` · 版本：v1.5 · 更新日期：2026-07-26 · 状态：领域基线
>
> 权威范围：逻辑实体、值对象、字段语义、关系、聚合边界和领域不变量
>
> 不负责：数据库表名与索引、JSON 字段拼写、页面布局、时间算法和阶段归属
>
> 依赖文档：[产品需求基线](product-features.md)、[产品路线图](roadmap.md)、[术语表](glossary.md)、[产品决策记录](product-decisions.md)

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
| `ExactDecimal` | 不使用二进制浮点的十进制定点数。 | 最多 18 位有效数字、3 位小数；数量计算必须精确。 |
| `SortKey` | 可在相邻对象间插入的稳定排序键。 | 只定义顺序，不向用户展示。 |
| `Revision` | 当前存储副本内的单实体乐观并发版本。 | 正整数，从 1 开始；每次本地持久化业务改变递增，不用于比较不同设备的先后。 |
| `ServerVersion` | 服务端为一个同步实体确认的版本。 | 非负整数；0 表示尚未上传，服务端每次接受改变后单调递增。 |
| `ServerSequence` | 服务端在一个空间内分配的变更顺序。 | 单调递增且不依赖设备时钟；只比较同一空间。 |
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

Any supported source → ReminderPlan → ReminderInstance → NotificationDelivery
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
| `purgeAfter` | `Instant` | 否 | 进入回收站时计算，默认 30 天。 |
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
| `currentQuantityCache` | `ExactDecimal` | 流水结果的事务内缓存，必须可重建。 |
| `lowStockThreshold` | `ExactDecimal?` | 非负；为空表示不判断低库存。 |
| `storageLocation` | 文本? | 用户可见位置。 |
| `primaryAttachmentId` | `EntityId?` | 必须是该记录的可用图片附件。 |

### 12.2 `StockTransaction`

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `recordId` | `EntityId` | 所属家庭物品。 |
| `kind` | `opening \| purchase \| consume \| adjust \| discard \| lost` | 受控类型。 |
| `delta` | `ExactDecimal` | purchase 为正；consume/discard/lost 为负；opening/adjust 可按目标计算。 |
| `quantityBefore` | `ExactDecimal` | 事务前数量。 |
| `quantityAfter` | `ExactDecimal` | 事务后数量，必须等于 before + delta。 |
| `occurredAt` | `Instant` | 用户声明的实际发生时间。 |
| `recordedAt` | `Instant` | 写入时间；晚补流水时与 occurredAt 不同。 |
| `ledgerSequence` | 正整数 | 单物品内严格递增，决定余额累计顺序；晚补流水仍追加，不回写后续历史。 |
| `note` | 文本? | 可选原因。 |
| `correctionOfId` | `EntityId?` | 调整用于修正哪条流水，可为空。 |
| `idempotencyKey` | 不透明值? | 通知动作、导入或同步重试去重。 |
| 公共元数据 | `EntityMeta` | 流水创建后业务字段不可变。 |

#### DOM-050：库存权威值

有效库存流水按 `ledgerSequence` 累计是当前数量的权威来源；`currentQuantityCache` 只为查询性能存在，并必须与新增流水在同一事务更新。发现不一致时停止普通写入并通过重算/诊断修复，不能信任缓存覆盖历史。`occurredAt` 用于展示实际发生时间，不改变余额累计顺序。

#### DOM-051：库存非负

当前数量不得小于 0。会导致负数的使用、报废或丢失操作必须阻止提交，并建议用户使用“调整为实际数量”。导入历史数据如包含负值，必须在预览中要求解决。

#### DOM-052：流水不可变

库存流水创建后不得编辑或单独删除。输入错误使用新的 `adjust` 流水修正，并可通过 `correctionOfId` 关联原流水。家庭物品永久删除时才随聚合一起清除流水。

### 12.3 `LowStockEpisode`

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `recordId` | `EntityId` | 所属家庭物品。 |
| `enteredAt` | `Instant` | 从阈值以上首次变为 `<= threshold` 的时间；创建时已不足则为创建时间。 |
| `thresholdSnapshot` | `ExactDecimal` | 进入时阈值，便于解释历史。 |
| `quantitySnapshot` | `ExactDecimal` | 进入时数量。 |
| `notifiedAt` | `Instant?` | 首次主动提醒成功交给系统的时间。 |
| `acknowledgedAt` | `Instant?` | 用户知道了或采取采购动作。 |
| `resolvedAt` | `Instant?` | 数量恢复、阈值变化或记录退出活跃跟踪时设置。 |
| `resolutionReason` | `stock_recovered \| threshold_changed \| threshold_removed \| archived \| trashed`? | 解决时必填，解释为何结束本周期。 |
| 公共元数据 | `EntityMeta` | 历史周期不可合并。 |

#### DOM-053：低库存判定

当且仅当 `lowStockThreshold != null` 且 `currentQuantity <= lowStockThreshold` 时处于低库存。连续不足只对应一个未解决周期；恢复后再次不足必须创建新周期。

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
| `sourceOccurrenceKey` | 文本? | 与周期或日期发生项绑定。 |
| `deduplicationKey` | 文本 | 同一逻辑提醒稳定唯一。 |
| `scheduledFor` | `Instant` | 解析时区和偏移后的目标绝对时刻。 |
| `state` | `planned \| scheduled \| acknowledged \| snoozed \| cancelled \| expired \| failed` | `delivered` 不作为可可靠确认的业务状态。 |
| `acknowledgementKind` | `opened \| done \| skipped \| noted \| shopping_added`? | 必须适合来源。 |
| `snoozedFromId` | `EntityId?` | 稍后提醒链的上一实例。 |
| `failureCode` | 受控错误? | 不含用户内容。 |
| 公共元数据 | `EntityMeta` | — |

### 14.3 `NotificationDelivery`

表示一次把提醒实例提交到系统通知服务的尝试，包含平台标识、调度标识、提交时间、结果、取消时间和非敏感错误码。它不声称通知已经被用户看到。

#### DOM-070：提醒与记录独立

提醒实例的 acknowledged/snoozed 状态不得自动给不支持完成的记录添加完成状态；通知动作必须先转换为对应领域命令，再由业务规则决定能否改变周期实例或清单。

## 15. 设置与本地产品状态

### 15.1 `AppPreferences`

按安装保存非内容设置：

- 地区、语言、周起始日和当前时区；
- 通知内容模式、应用静默时段和默认重复催促设置；
- 应用锁是否开启和自动锁定时机；
- 智能首次说明确认版本；
- 可选遥测同意版本；
- 备份提示是否展示、上次关闭时间；
- 最近一次成功提醒对账、备份和恢复时间；
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

认领只建立身份映射，不批量改写 Record 的 ID、createdByActorId 或历史 AuditEvent；LocalActor 通过 claimedByAccountId 解析为当前账号。选择“仅本机”时保持 unbound，已登录账号的云端个人空间不挂载为第二个本地默认个人空间。

### 16.5 `SpaceMembership` 与 `Invitation`

`SpaceMembership` 只用于账号空间；个人空间有且仅有所属账号一条 active membership，家庭空间规则由家庭规范定义：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `spaceId`、`accountId` | `EntityId` | 组合唯一；服务端鉴权边界。 |
| `role` | `owner \| member` | personal 固定 owner；家庭首期仅这两种。 |
| `status` | `active \| leaving \| removing \| removed` | Invitation 独立表达未接受状态；只有 active 可以读取或写入空间。 |
| `joinedAt`、`endedAt` | `Instant?` | 由服务端事务设置。 |
| `invitedByAccountId` | `EntityId?` | 家庭邀请来源。 |
| 公共元数据 | `EntityMeta` | 角色和状态变化产生服务端审计。 |

`Invitation` 包含家庭空间、邀请者、目标角色、tokenHash、状态 `draft | active | accepted | revoked | expired`、过期时刻、接受账号、接受/撤销时间和服务端版本。明文 token 只在创建时返回，不保存、不写日志；同一邀请最多接受一次。

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
| `operation` | 受控命令 | 使用领域命令语义，不传任意 SQL/表 patch。 |
| `baseServerVersion` | `ServerVersion` | 0 表示客户端认为实体尚不存在。 |
| `payloadVersion` | 正整数 | 机器格式兼容版本。 |
| `state` | `pending \| sending \| retry_wait \| acknowledged \| conflict \| rejected_forbidden \| rejected_version` | sending 崩溃后可安全回到 pending。 |
| `attemptCount`、`nextAttemptAt` | 非负整数、`Instant?` | 受限指数退避。 |
| `resultServerVersion`、`resultServerSequence` | 版本? | acknowledged 时必填。 |
| `errorCode` | 受控码? | 不含用户内容。 |

`SyncCursor` 每个设备、空间一条，保存最近完整应用的 `ServerSequence`、快照 generation 和更新时间。只有一页变化在本地事务中全部应用后才能推进；游标不是删除或备份时间。

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
| `reason` | `user_purge \| cascade \| account_deleted \| family_deleted` | 不含内容。 |

墓碑到期后仍离线的设备必须通过新快照 generation 重建，不能把旧实体当新增上传。

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
| `spaceId`、`reminderPlanId`、`recipientAccountId` | `EntityId` | 组合唯一，recipient 必须是 active member。 |
| `mode` | `all_active_devices \| selected_devices \| off` | 默认由家庭规范决定。 |
| `selectedDeviceIds` | ID 集合 | selected_devices 时至少一个，且都属于 recipient。 |
| `origin` | `creator_default \| user_opt_in \| assignment` | 解释订阅来源，不作为权限。 |
| `status` | `active \| cancelled` | 成员离开、计划失效或空间删除时取消。 |
| 公共元数据 | `EntityMeta` | 修改只影响该收件人，不改业务时间。 |

不同成员的订阅不复制 ReminderPlan 或 ReminderInstance。一个成员处理共享业务状态后，各订阅设备通过同步取消适用未来投递。

### 16.12 `SpaceTransferOperation`

跨空间移动不是直接改 spaceId，而是可恢复的协调对象：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `recordId`、`sourceSpaceId`、`targetSpaceId` | `EntityId` | 两空间不同；发起时记录属于 source。 |
| `initiatedByAccountId` | `EntityId` | 必须同时有来源操作权和目标创建权。 |
| `state` | `preflight \| awaiting_confirmation \| transferring \| committed \| failed_retryable \| rolled_back` | committed 前记录不能在两空间同时可写。 |
| `baseRecordVersion`、`baseSpaceVersions` | 版本 | 防止预览后对象或成员资格改变。 |
| `mappingPlan` | 结构化选择 | 分类、标签、关联、提醒和审计处理选择；不复制正文。 |
| `startedAt`、`completedAt` | `Instant`、`Instant?` | 服务端时间。 |

附件密钥和内容重归属、聚合子对象、目标 membership 与源 move tombstone 必须作为一个可回滚逻辑提交；物理传输可以分步，但在 committed 前目标不可见、来源保持唯一可写。

## 17. 聚合事务边界

以下操作必须在一个领域事务中完成：

| 操作 | 必须原子包含 |
| --- | --- |
| 创建记录 | `Record`、对应详情、初始标签关系；家庭物品另含期初流水和适用低库存周期。 |
| 编辑记录 | 根版本、详情和受影响提醒对账任务。 |
| 完成/跳过周期实例 | 实例物化、状态、操作记录和提醒取消任务。 |
| 清单批量完成 | 所有目标项目、派生完成状态和提醒取消任务。 |
| 库存变化 | 新流水、当前数量缓存、低库存周期变化和适用提醒任务。 |
| 删除到回收站 | 根生命周期、未来提醒取消任务和必要操作记录。 |
| 恢复记录 | 根生命周期、派生索引重建标记和未来提醒重建任务。 |
| 永久删除记录 | 聚合子对象、附件清理任务和适用墓碑。 |

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

## 19. 领域命令和结果

领域层以显式命令改变数据，至少包括：

- `CreateRecord`、`UpdateRecord`、`ArchiveRecord`、`TrashRecord`、`RestoreRecord`、`PurgeRecord`；
- `CompleteOccurrence`、`SkipOccurrence`、`RescheduleOccurrence`、`SplitRecurrenceSeries`；
- `CreateChecklistFromTemplate`、`SetChecklistItemCompletion`、`ReorderChecklist`、`SaveChecklistAsTemplate`；
- `AddStockTransaction`、`CorrectStock`、`AddItemToShoppingChecklist`；
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
| v1.5 | 2026-07-26 | 将未接受状态完全归属 Invitation，SpaceMembership 从接受邀请的原子事务起进入 active。 |
| v1.4 | 2026-07-26 | 明确家庭空间所有者来源与删除计划，并增加所有权转移、成员提醒订阅、跨空间移动和服务端可信审计实体。 |
| v1.3 | 2026-07-26 | 完整定义账号、认证身份、设备会话、数据集绑定、成员关系、同步元数据、冲突、墓碑、附件传输和云备份逻辑实体。 |
| v1.2 | 2026-07-26 | 在规则段保存重复引擎版本，保证备份、迁移和同步可以重现历史候选。 |
| v1.1 | 2026-07-26 | 增加清单用途与低库存周期解决原因，以支持采购清单选择和归档/删除状态。 |
| v1.0 | 2026-07-26 | 建立身份、空间、记录根、五种记录聚合、提醒、附件、库存、设置和同步扩展的统一逻辑模型与不变量。 |

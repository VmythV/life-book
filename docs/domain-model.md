# 生活有谱领域模型

> 项目代号：`life-book` · 版本：v1.0 · 更新日期：2026-07-26 · 状态：领域基线
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
| `Revision` | 单实体乐观并发版本。 | 正整数，从 1 开始；每次持久化业务改变递增。 |
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
| `ownerId` | `EntityId` | P0 指本地身份；账号后指账号或成员主体。 |
| `status` | `active \| deleting \| deleted` | 个人空间不得进入 deleted；家庭删除按 P2 流程。 |
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
| `resolvedAt` | `Instant?` | 数量恢复到当前阈值以上或阈值被移除。 |
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

P0 只必须记录高风险数据操作和必要诊断；P2 家庭操作记录在此基础上开放用户可见审计。

### 16.2 未来同步字段

所有可同步实体从 P0 起保留：

- 全局稳定 ID；
- `spaceId`；
- 创建/修改人；
- 创建/修改时间；
- 单实体 `revision`；
- 回收站时间；
- 可版本化枚举和扩展字段。

P1 增加而不回填改变领域身份的基础实体：

- `Account`：跨设备用户身份；
- `Device`：可撤销客户端会话；
- `SpaceMembership`：账号、空间和角色；
- `Invitation`：有时效、一次性家庭邀请；
- `SyncMutation`：本地待推送命令及幂等键；
- `SyncCursor`：服务端增量读取位置；
- `Tombstone`：永久删除后的最小同步标记。

同步和家庭字段详细语义由专项规范定义。

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
| v1.0 | 2026-07-26 | 建立身份、空间、记录根、五种记录聚合、提醒、附件、库存、设置和同步扩展的统一逻辑模型与不变量。 |

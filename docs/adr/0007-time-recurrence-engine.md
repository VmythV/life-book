# TD-007：时间、时区与重复规则引擎

> Status：`Accepted`  
> Date：2026-07-26  
> Decision owners：客户端架构负责人、领域负责人、质量负责人  
> Scope：P0～P2 公历日期运算、IANA 时区解析、重复候选、发生项身份、时间重算和时区数据升级  
> Related requirements：REC-001～003、REC-020～023、REC-030～042、REC-050～083、REC-090～102、REC-110～121、DOM-010～011、QR-021～023、QR-090～091  
> Related ADRs：[TD-002](0002-offline-first-client-architecture.md)、[TD-006](0006-cross-platform-scalar-representations.md)、[TD-009](0009-local-notification-scheduling.md)、[TD-010](0010-snapshot-schema-and-migrations.md)、[TD-018](0018-sync-protocol-and-conflict-resolution.md)  
> Decision gate：双平台真机、独立参考实现、IANA tzdb 差分和全部 `REC-T*` fixture 通过后，才允许提醒与重复事项进入功能验收

## Context

生活有谱同时处理全天日期、跟随用户所在地的浮动时间、绑定地区的钟表时间和绝对时刻。重复事项还需要在离线设备上分页生成候选，跨夏令时保持用户原意，并在规则切分、时区变化、App 升级、备份恢复和未来多设备同步后维持同一个 occurrence identity。

JavaScript `Date` 会隐式使用进程默认时区，月份运算会自动溢出；不同 iOS/Android 版本内置的时区数据库也可能不同。直接依赖系统 `Intl`、把 RRULE 库输出当业务事实或“每次加固定毫秒”都会造成跨设备结果不一致。与此同时，自行维护完整历法/时区规则的风险也很高，因此实现要把标准日期算术、官方 tzdb 数据和产品特有重复语义明确分层。

本 ADR 不重新定义产品时间规则；[时间与重复规则](../time-and-recurrence.md) 是业务语义权威。本 ADR 决定如何以确定性、可升级和可验证的方式执行这些规则。

## Decision

建立纯 TypeScript 核心包 `@life-book/time`，对外只暴露受控的日期、解析和 recurrence port：

- ISO 公历/无时区日期算术固定使用 `@js-joda/core@6.1.0`；它不依赖 Hermes 原生 BigInt，也不读取系统时区完成这些运算；
- 时区转换使用 js-joda `ZoneRules` API 与随构建打包、版本固定的 IANA tzdb 派生数据，不读取 OS/`Intl` offset 作为业务结果；首个公开构建基线为 `2026c`；
- 时区 provider 基于 `@js-joda/timezone@2.25.2` 的受审实现，但不使用其落后的内置 `2026a` 数据；项目从 IANA 2026c/`moment-timezone@0.6.3` 的纯数据生成命名空间内的固定资产；运行时不引入 Moment API；
- 重复规则使用生活有谱自己的小型确定性 kernel，严格实现 `REC-050～064`，不直接采用完整 RFC 5545 库；
- 先在本地日历上生成 candidate，再按 `ScheduleSpec` 解析为 instant。DST、设备时区和 tzdb 升级永不改变 candidate identity；
- 查询必须是有界闭开窗口、分页和可取消的；投影缓存、扫描游标和预计算结果均可重建，不成为领域事实；
- 已物化历史保存原始本地计划与当时解析结果；tzdb/引擎升级只重新计算未来未终态结果，并通过通知对账保持去重。

## Decision details

### 1. 模块边界

```text
Application / Reminder / Search
              │
              ▼
        TimeEnginePort
        ├─ CalendarMath
        ├─ TimeZoneResolver
        ├─ RecurrenceKernel
        ├─ ScheduleResolver
        └─ Clock
              │
              ▼
  @js-joda/core + fixed ZoneRules/tzdb asset
```

`@life-book/time` 必须是无 React、无 SQLite、无网络、无系统通知依赖的纯模块。核心接口只收 TD-006 标量和显式 `TimeContext`，不得读取全局 locale、默认时区或当前时间：

```ts
interface TimeContext {
  now: InstantMs;
  currentTimeZoneId: TimeZoneId;
  locale: string;
  weekStart: 'monday' | 'sunday';
  tzdbVersion: string;
  recurrenceEngineVersion: number;
}

interface TimeEnginePort {
  resolveSchedule(spec: ScheduleSpec, context: TimeContext): ResolvedSchedule;
  pageOccurrences(query: OccurrencePageQuery): OccurrencePage;
  preview(rule: RecurrenceRule, schedule: ScheduleSpec, count: number, context: TimeContext): Preview;
  localDayWindow(date: LocalDate, zone: TimeZoneId): InstantRange;
}
```

实现可以调整 DTO 名，但必须保持：输入完整、结果显式带版本、无隐藏系统读取、无数据库 side effect。

### 2. js-joda 使用方式

#### 2.1 选择与封装

- 精确锁定 `@js-joda/core@6.1.0` 和 timezone provider source/integrity；不使用 `^`/`~` 漂移；
- 只通过内部 `CalendarMath`/`ZoneResolver` adapter 使用 `LocalDate`、`LocalTime`、`LocalDateTime`、`YearMonth`、`Instant`、`Duration`、`ZoneId` 和 `ZoneRules`；业务 feature 不直接 import js-joda；
- 领域仍使用 TD-006 标量，不把 js-joda object 写入 Redux/query cache、SQLite、JSON、原生 bridge 或日志；
- 构造月日先用 `YearMonth.lengthOfMonth/isValidDay` 验证，再创建 `LocalDate`；不能调用会把无效日夹到月末的便捷运算实现 REC-062/063；
- 日历固定 ISO/proleptic Gregorian。P1 农历由 TD-024 独立 adapter 提供，不能更改 P0 kernel 的公历含义；
- 禁止 `LocalDate.now()`、`ZonedDateTime.now()`、`ZoneId.systemDefault()` 和任何无显式 clock/zone 的重载；
- js-joda/core、provider 或数据升级必须对旧版本跑 REC fixture、合法/非法输入和随机 differential；不能按设备动态选择两个实现。

选择 js-joda 是为了复用独立于 JavaScript `Date` 的不可变日期类型、Java `java.time` 风格的 ZoneRules 和成熟测试，同时避开 Hermes 当前缺少原生 BigInt 的限制。`Intl` 只负责本地化展示，不进入业务 offset。

#### 2.2 当前时间

- `Clock.wallNow()` 返回 TD-006 `Instant`，只用于“现在”和用户动作时间；测试使用 fake clock；
- `Clock.monotonicNow()` 只计算耗时、退避和单进程 deadline，不持久化；
- 一次 command/query 在入口取得一次 `now`，下游共用；长分页任务每页可取得新的 context，但页内不漂移；
- 智能创建会话把首次 `referenceInstant/referenceTimeZone/locale` 保存到会话，追问不得重新取现在；
- REC-023 的回拨检测由应用服务保存 `lastObservedWallInstant` 与单调/服务端证据，本引擎只返回诊断，不自行修改业务时间。

### 3. 固定 IANA tzdb

#### 3.1 数据来源和生成

首个公开构建基线固定 IANA `tzdata2026c`。截至决策日，`@js-joda/timezone@2.25.2` 内置数据实际仍为 `2026a`，而 `moment-timezone@0.6.3` 的 data-only `latest.json` 已是 `2026c`；因此不能用 npm 包发布日期或“latest”标签推断 tzdb 版本。仓库的生成流程必须：

1. 从 IANA **带版本 URL** 获取 source tarball 和 detached signature；不能使用 `latest` URL；
2. 校验发行签名、预登记 SHA-256 和 tar 路径安全，再在隔离构建环境展开；
3. 使用固定版本的 IANA `zic` 生成参考 TZif；若以 `moment-timezone@0.6.3` packed data 作为 js-joda 生成输入，先校验其内嵌 version 恰为 `2026c` 并与 IANA transition 差分；
4. 复用/固定 js-joda timezone 的公开 transform/provider 逻辑，生成项目命名空间 `@life-book/tzdb` 资产；生产 runtime 不 import Moment，也不允许运行时更新 provider；
5. 生成 manifest：`formatVersion`、`ianaVersion`、IANA source hash、packed-input integrity、provider source revision、compiler version、asset hash、zone/link count和验证范围；
6. 用 `zdump`/TZif 参考输出对每个 zone 做 transition/offset 差分；同一 source 和工具链重复构建必须 byte-identical；
7. 把许可证、source/version/hash、生成器和 fixture 纳入源码/SBOM；生成资产可以从这些输入重建。

不手工维护国家时区表、DST 日期或 offset。显示名称来自受控本地化资源；programmatic ID 和用户文案分离。

#### 3.2 数据覆盖和 resolver

- 使用 js-joda timezone 的 **全量数据构建**，包含 canonical zones、常用 legacy links 和 `UTC`；禁止 10-year、1970–2030、2017–2027 等裁剪 build；
- manifest 明确实际 transition 数据范围。发生项只解析当前查询/提醒滚动窗口；不能因为规则 `never` 就预先解析到数据范围之外。显式用户时间超出可靠范围时保存本地规则但标记 `zone_projection_pending`，不编造固定 offset；进入受支持窗口后由新版 tzdb 解析；
- IANA 对 1970 年前历史本来存在精度限制。导入的历史 timed value 若位于 1970 年前，结果标记 `historical_zone_approximation`；原始 offset/instant 已知时必须保留，不重新猜测；
- resolver 使用 `ZoneId.rules().validOffsets/transition/offset`，不通过格式化字符串或系统 `Intl` 反推 offset；
- zone link 在输入时映射为该资产中的 canonical target，但旧值仍可读取；迁移/写出 canonical ID，不能根据当前国家名称自行猜 zone；
- 未知 ID、损坏资产、unsupported asset version 或超出可解析范围是明确错误；不得静默回退 GMT/设备时区；
- App 启动校验 manifest/hash。失败时仍可查看已存记录和 absolute/all-day 内容，但暂停新的 zoned/floating 解析、未来提醒调度与规则修改，并提供恢复/升级提示。

#### 3.3 当前系统时区发现

`expo-localization`/OS 只负责发现用户设备当前 IANA ID：

- 启动、回前台和系统时区变化事件读取 `getCalendars()[0].timeZone`；同一入口可以使用等价原生 API，但不得自行猜测；
- ID 必须能在打包 tzdb 中解析；link 规范化后持久化到 `AppPreferences.currentTimeZoneId`；
- 系统只给 offset、未知 ID 或临时空值时保留上次有效 zone，并显示非阻断检查提示；不能从 `+08:00` 猜 `Asia/Shanghai`；
- 变化事件去抖后提交一个 `CurrentTimeZoneChanged` command，再触发 projection/notification reconcile；
- 用 OS `Intl` 格式化用户文案可以接受，但任何由它算出的日期/offset 不回写领域事实。

### 4. 本地日期时间解析

#### 4.1 候选 instant

对一个 `LocalDate + LocalTime + TimeZoneId`，resolver 根据邻近 transition 求所有能反向映射到该本地值的 instant：

| 候选数 | 含义 | 处理 |
| --- | --- | --- |
| 1 | 正常本地时刻 | 返回该 instant，`resolution=exact`。 |
| 0 | offset 前跳造成 gap | `compatible` 按 gap 长度向后平移，返回 `gap_shifted_forward`。 |
| 2 | offset 后退造成 overlap | P0 默认较早 instant；显式 `later` 取较晚，分别记录 resolution。 |
| >2 | 数据/实现异常 | fail closed，并触发资产完整性诊断。 |

实现不能假设 gap/overlap 一定为 60 分钟，也不能只检查常见美国 DST。adapter 必须先读取 `validOffsets(localDateTime)` 和 transition，而不是只调用一个“最佳 offset”：gap 按 transition 实际 duration 前移；overlap 依据保存的 `earlier/later` 选择对应 offset。js-joda 的 `atZone/ofLocal/withLaterOffsetAtOverlap` 可执行这些语义，但项目仍显式记录选择结果。每次结果包含：

```text
instant
originalLocalDateTime
effectiveLocalDateTime
timeZoneId
utcOffsetSeconds
resolution: exact | gap_shifted_forward | overlap_earlier | overlap_later
tzdbVersion
```

原始本地值永不因 gap 改写；界面据 `resolution` 显示“因夏令时调整”。

#### 4.2 四种 `ScheduleSpec`

- `all_day`：不产生唯一业务 instant；仅在查询自然日边界或通知 09:00 时用当前/来源 zone 解析；
- `floating_local`：每次未来投影使用 context 的当前用户 zone，原始 date/time 和 occurrence key 不变；
- `zoned`：始终用记录保存的 zone；查看者当前 zone 只影响显示；
- `instant`：直接使用保存 instant，时区只用于显示；P0 重复规则不接受这种 schedule；
- 任何 schedule 缺字段、多字段矛盾或 P0 timed 秒非 0 时，在 command validation 阶段拒绝。

自然日窗口通过解析本地 `date 00:00` 与下一公历日 `00:00` 得到 `[start, end)`，不能把 start 加固定 86,400,000 ms。午夜也可能处于 transition，使用 `compatible/earlier` 规则。

### 5. 重复候选 kernel

#### 5.1 规范输入

保存前把规则规范化：

- `interval`、count、until 和频率组合按 REC-050 校验；
- weekday/monthDay 集合去重并按公历顺序排序；
- weekly 未显式 weekday 时，由 application 按开始日期补齐并在确认页展示；kernel 不读 locale 猜星期；
- `weekStart` 固化在规则中；缺少字段只允许由版本化旧数据 migration 填充；
- 不支持的 RRULE 字段、`monthly last day`、hourly/minutely、农历或多个日内时刻明确拒绝/转导入例外，不能近似；
- normalized rule 与 schedule 生成 canonical hash，供缓存和诊断；hash 不是 occurrence identity。

#### 5.2 生成顺序

v1 kernel 严格按本地公历产生日期：

1. 依据 frequency 和 `effectiveFrom` 建锚点（日、保存 weekStart 的周、月或年）；
2. 只访问 interval 命中的周期，不逐日扫描大间隔；
3. 在周期内展开已排序 weekday/monthDay 或 yearMonthDay；
4. 先校验目标 `YearMonth` 的合法日再构造日期；不存在的 31 日或 2 月 29 日跳过，不夹到月末；
5. 丢弃早于 effectiveFrom、晚于 segment effectiveUntil/untilDate 的候选；
6. 去重后按 `(LocalDate, LocalTime, occurrenceKey)` 排序；
7. count 对实际合法候选计数，取消、完成、跳过或 DST resolution 不改变 count；
8. 到达窗口上界、count、until 或 caller limit 后停止并返回完成原因。

引擎先生成本地候选，再解析 schedule。绝不以上一次 instant 加 24 小时/7×24 小时生成重复；DST 不改变之后日期的原始钟表时间。

#### 5.3 稳定 occurrence identity

P0 recurrence occurrence key 使用不含标题、offset 或 tzdb 版本的 canonical ASCII：

```text
occ:v1:<recordId>:<segmentId>:<YYYY-MM-DD>:a
occ:v1:<recordId>:<segmentId>:<YYYY-MM-DD>:t:<HH:mm:ss>
```

- record/segment ID 使用 TD-006 UUID 规范文本；
- `a`/`t` 区分全天和 timed；timed 使用 original local time，不使用 gap 调整后的钟表值；
- key 长度和 parser 固定，作为 SQLite unique key、同步引用和提醒去重输入；
- floating zone 变化、tzdb 升级、offset 变化、仅本次改期和 UI 文案都不改变 key；
- “本次及以后”创建新 segment ID，因此候选不会与旧段碰撞；
- 仅本次改期保留 original key，并只改变 `effectiveSchedule`；
- v1 语义若必须改变到会产生不同候选 identity，新增 `occ:v2`/engine interpreter 或先把受影响旧候选物化，不能原地复用 key。

重要日期使用独立 `date-occ:v1:<recordId>:<targetYear>:<calendar>` key；P0 calendar 固定 `gregorian`。P1 农历 ADR 必须扩展足以区分闰月/规则版本的 identity，不能套用公历 key。

### 6. 查询、分页与资源上限

#### 6.1 窗口

所有候选查询必须传明确窗口和目的：

```text
[fromLocalInclusive, toLocalExclusive)
purpose = preview | today | reminder | history | validation | sync_repair
pageLimit <= 500
scanBudget <= 10_000 periods
```

instant 查询先根据适用 zone 扩大为不会漏项的本地日期窗口，生成/解析后再以 instant 精确过滤。不能用 SQL 的 `updatedAt` 或 UTC 日直接替代业务日期。

- preview 请求 5 项，合法项不足时返回全部和结束原因；
- 前台一次最多消费 500 个候选，达到页限返回 cursor/进度，不声称已完整；
- 单次最多扫描 10,000 个候选周期；无法找到结果时返回 `scan_limit_exceeded`；
- `occurrenceCount` 最大 100,000，验证/导出分页累计；
- 永不在创建时物化 `endMode=never` 的全部未来。

#### 6.2 Cursor

cursor 是非权威、版本化结构，至少绑定：

```text
engineVersion
ruleCanonicalHash
segmentId + ruleRevision
window/purpose
lastCompletedPeriodAnchor
lastEmittedCandidate
emittedCountFromRuleStart（count 模式）
```

- cursor 必须 MAC/内部校验或只存私有数据库，防外部输入篡改导致漏项；
- 规则、schedule、segment revision、engine/tzdb 或 window 变化时 cursor 失效并从安全边界重建；
- 一页只有在消费方把候选/实例/新 cursor 同一 SQLite 事务提交后才推进；
- cursor 丢失只影响性能，不改变候选集合；
- count 规则的随机页不能只从窗口起点计数，必须使用已验证 checkpoint 或从规则开始累计。

### 7. 投影、物化与历史

- 未互动候选是可重建 projection，不具有随机 EntityId；key 即其稳定引用；
- 完成、跳过、取消、改期、添加本次说明、产生提醒或被同步/冲突引用时，在同一事务物化 Occurrence；
- materialized occurrence 保存 `originalSchedule`、`effectiveSchedule`、`occurrenceKey`、segment/rule revision、engine version；
- timed 历史还保存解析得到的 `resolvedInstant`、`resolvedTimeZoneId`、`resolvedUtcOffsetSeconds`、`resolvedTzdbVersion` 和 `resolution`；物理 schema 在 TD-012 固化；
- `originalSchedule` 与上述历史解析结果一旦发生/终态后不可因引擎或 tzdb 升级改写；
- pending 未来 occurrence 可在保留同 key/override 的前提下更新解析 projection；如果用户已仅本次改期，按 effective schedule 自身语义解析；
- 规则修改先建立新 segment/override，再让 projection diff 产生取消/新增提醒任务；不能先删除未来实例后尝试重建；
- projection cache 以 `(recordId, ruleRevision, engineVersion, tzdbVersion, currentZone, window)` 为 key，可随时丢弃重建。

### 8. 提醒偏移

提醒引擎必须调用同一个 `ScheduleResolver`：

- `提前 N 天/周/月`：先在来源本地日历减 calendar duration，再在来源 time behavior/zone 下解析；
- `提前 N 小时/分钟`：先解析业务 instant，再减绝对 duration；
- 全天“当天 09:00”用 occurrence 本地日期和适用 zone；
- 提醒落在 gap/overlap 时复用同一 resolution 规则，并保存版本/调整原因；
- 产生过去 target 时标记 missed/expired，不补发；
- reminder dedup key 使用逻辑 plan + source occurrence key + offset/recipient revision，不包含 scheduled instant；因此时区/tzdb 重算只更新/替换系统投递，不产生第二个逻辑提醒。

系统通知窗口、数量限制和 reconcile 状态机由 TD-009 定义。

### 9. 时区和引擎升级

#### 9.1 发布监控

- CI 每日/至少每周检查 IANA release feed，但只报告，不自动把 `latest` 合入生产；
- 新 tzdb 进入单独依赖 PR，附 source/signature/hash、NEWS 摘要、受影响 zone/未来 transition diff、bundle size 和全量 fixture；
- 若变更在未来 90 天内影响 offset，列为高优先级客户端发布；产品/支持准备受影响说明；
- 同一 App release 只能有一个 active tzdb asset；版本写入 build info、诊断导出、解析结果和兼容报告；
- 远程配置不能下发未签名规则或更换 tzdb。若未来需要热更新，必须新增签名、回滚、原子激活和供应链 ADR。

#### 9.2 升级事务

首次启动新版本时：

1. 校验新 asset 并记录 `TimeDataUpgrade(old, new)` operation；
2. 以 zone + future window 找出可能受影响的 active schedule；
3. 保持 occurrence key，使用新 tzdb 重算未发生、非终态 projection/ReminderInstance；
4. 生成 old/new diff，取消旧 OS schedule、提交新 schedule，再完成 reconcile；
5. 已发生/终态 historical resolution 不变；
6. 更新 cache/cursor version，标记重建完成；
7. 任一步中断可从 operation journal 重入，不出现一半规则用旧、一半用新而状态自称完成。

若未来 instant 改变，详情显示非阻断“时区规则已更新”；不得发送“变更通知”冒充原提醒。回滚到旧 App 前必须证明它能读取新版本标记；否则数据库 schema 保留新值、旧 App 明确阻止调度而非误算。

#### 9.3 P1 跨设备

- 同步传 canonical schedule/rule、occurrence key、engine version 和已物化历史解析结果；不能只传下次 scheduled instant；
- 服务端和 release 客户端维护经 contract 声明的 engine/tzdb compatibility set；不兼容客户端可以继续离线编辑无时间内容，但不得让其旧计算覆盖新权威未来投影；
- 同一逻辑未来提醒在不同设备因发布滞后暂有差异时，以每设备本地 reconcile 为准并记录版本；服务端不使用 LWW 合并 computed instant；
- engine 语义升级需要双读/对比期或新 interpreter，规则实体的 `recurrenceEngineVersion` 决定解释器；
- 离开/重入家庭、snapshot rebuild 和 generation rollover 都从规则与物化事实重建，不同步 projection cache。

### 10. 错误模型

核心包返回受控错误，不抛含原始用户输入的通用异常：

| 错误码 | 含义 | 用户/调用方处理 |
| --- | --- | --- |
| `invalid_schedule` | 字段缺失或互斥冲突 | 表单定位字段，不保存。 |
| `invalid_recurrence_rule` | 规则组合非法 | 展示可修改说明。 |
| `unsupported_recurrence` | 合法但当前阶段不支持 | 转手动/保留导入原文，不近似。 |
| `unknown_time_zone` | tzdb 无该 ID | 保留旧值并提示选区/升级。 |
| `zone_projection_pending` | 时间超出当前资产可靠解析范围 | 保存本地原意但不启用该时点提醒，升级数据后重算。 |
| `time_data_corrupt` | asset/hash/parser 失败 | 暂停 timed 写入与调度，提供恢复。 |
| `scan_limit_exceeded` | 有界扫描未找到/完成 | 要求缩小范围或改规则，可续算。 |
| `stale_cursor` | 规则或版本已变 | 丢弃 cursor 并安全重建。 |
| `clock_regression` | 设备时钟异常回拨 | 暂缓破坏性定时动作，创建仍可用。 |
| `unsupported_engine_version` | 无对应解释器 | 阻止误算，要求升级/恢复兼容。 |

## Alternatives considered

### 直接使用 JavaScript `Date`

它把 instant、本地时间和系统默认时区混在一个 API 中，月日构造会溢出，无法显式表达 gap/overlap 策略；拒绝作为规则内核。只允许在受控平台边界接收系统毫秒值。

### 原生 Temporal 或 Temporal polyfill

ECMAScript Temporal 已标准化，但 Hermes 尚不能作为已验证原生实现，且 polyfill/宿主时区能力可能依赖 BigInt 或 `Intl` tzdb。TD-001 已选择 Hermes，TD-006 也不能假定原生 BigInt，因此 P0 选择不依赖它们的 js-joda。未来只有通过双平台 release differential 和新 ADR 才能替换。

### Luxon/date-fns-tz/Temporal ZonedDateTime + 系统 `Intl`

API 方便且 bundle 小，但 offset 依赖设备 ICU/tzdb。不同 OS 补丁可能对即将变化的政府规则给出不同结果，不符合 REC-020 的固定 tzdb 要求；可用于纯显示，不作为领域解析权威。

### Moment Timezone 作为运行时

它可携带最新 tzdb，但 Moment 已是 legacy/maintenance 模式，API 可变且含宽松解析。只允许在可复现构建中使用 `moment-timezone@0.6.3` 的 2026c data-only 文件作为经 IANA 差分的生成输入；生产运行时使用 js-joda ZoneRules，不 import Moment。

### 完全自研 TZif resolver

能完全控制格式与数据范围，但 gap/overlap、link、future rule 和历史边界维护风险过高。选择 js-joda ZoneRules/provider 并用官方 zic 做独立差分；项目只拥有数据生成/封装，不重写时区引擎。

### 完整 RFC 5545 RRULE 库

标准覆盖面广，但生活有谱 P0 的 start/count、monthly invalid-date skip、segment、每次 override 和 occurrence identity 已有更窄且明确的语义。直接引入会允许未建模字段或在 DTSTART 不匹配时产生不同结果。保留与 RFC/JSCalendar 相近概念，但实现受控 kernel；未来导入先映射到领域规则或明确拒绝。

### 预先物化所有未来 occurrence

`never` 规则没有终点，tzdb/时区/规则改变还会造成大规模失效。采用有界投影与按需物化事实。

### 固定 24 小时/30 天算法

会在 DST、月份长度和闰年处错误；拒绝。自然日/月/年使用公历运算，小时/分钟才是绝对 duration。

### 在线查询时区服务

破坏离线能力、隐私和可重复性，也让关键提醒依赖网络。tzdb 随 App 打包；服务端只用于版本治理，不是本地解析必需条件。

## Consequences

### Positive

- 同一 release 在 iOS、Android、测试和服务端参考实现上产生相同候选与 offset；
- 用户本地日期/钟表原意与 DST 解析结果分离，时区升级不会制造新 occurrence；
- 规则引擎范围小、无隐藏系统依赖，易于属性测试、分页和版本化；
- 历史结果可解释，未来 tzdb 改动可重算并与系统通知对账；
- 农历、更多 RRULE 和未来替代日期库可通过独立 adapter/新 engine version 扩展，不破坏 v1。

### Negative

- App 需要携带全量 tzdb asset、生成器和 ZoneRules provider，增加 bundle 与供应链维护；
- js-joda 类型必须被 adapter 隔离，未来切换标准 Temporal 仍需差分与迁移验证；
- 需要长期监控 IANA 紧急变更并发布客户端更新；
- P0 kernel 不接受所有 iCalendar 规则，导入必须清楚说明不支持项；
- 版本升级和历史解析元数据增加 schema、测试和通知 reconcile 复杂度。

## Risks and mitigations

| 风险 | 缓解 |
| --- | --- |
| tzdb 新法规在提醒前才发布 | 监控 release、90 天影响 diff、高优先级发布、详情说明；不在线猜规则。 |
| 生成器/provider 错误污染所有 zone | 与官方 zic/TZif/zdump 全量差分；资产 hash；独立实现 fixture。 |
| js-joda 在 Hermes 有语义/性能问题 | 双平台 release spike、移植测试集、精确版本；adapter 可替换。 |
| npm timezone 包发布日期新但 tzdb 旧 | build 读取并断言内嵌 IANA version；公开构建必须达到冻结日基线。 |
| gap/overlap 只测试 1 小时 DST | 使用 IANA 全 transition 参数化测试，覆盖 30 分钟、2 小时、日期跳跃和午夜变化。 |
| 无限/稀疏规则卡死 UI | period 跳跃、10,000 scan budget、500 page limit、可取消后台执行。 |
| tzdb 升级重复通知 | occurrence/dedup key 不含 instant，升级走原子 reconcile。 |
| 旧 engine 恢复后无法解释 | 备份携带版本；保留 interpreter 或先物化；unsupported 时 fail closed。 |
| 设备当前时区只能得到 offset | 保留上次有效 IANA zone并提示，不猜地区。 |
| OS 格式化与领域 offset 不同 | OS 仅展示；详情/调度使用 bundled resolver，diagnostic 显示版本。 |

## Implementation constraints

- calendar/timezone/recurrence 函数必须纯函数或显式 clock；不得读取 `new Date()`、`Date.now()`、默认 `Intl` 或全局 locale；
- 仅 `PlatformTimeZoneSource` 可读取系统 zone，输出先由 bundled registry 验证；
- generated tzdb/provider 对 version/count/offset/range/排序做上限校验，不接受任意网络或用户提供资产；
- resolver 与 recurrence 在后台 JS task/受控 worker 执行大页计算，前台预览小页可同步但有性能预算；
- 不在 render 中逐项生成 recurrence；query service memoize 后一次返回 projection；
- 规则/segment 修改、未来 occurrence diff 和 side-effect task 必须在同一 Unit of Work 建立；OS 通知由事务后 task 执行；
- cache 只能存无敏感内容的 key/计算结果并遵守 SQLCipher；不能把日程写入系统未加密 cache；
- release build 暴露只读 build info（engine/tzdb/asset hash 前缀），支持包可导出，不包含用户日程；
- 远程 flag 只能关闭有缺陷的调度/显示能力，不能改变 recurrence/DST 语义。

## Verification

### 标准与差分测试

- 全部 `REC-T001～REC-T012` 在 domain、SQLite integration、iOS/Android release 和服务端 reference test 中一致；
- js-joda adapter 跑上游相关日期/时区测试与项目 fixture；每次升级对旧版做合法/非法输入 differential；
- tzdb generator 对 manifest 验证范围内每个 zone 的 transitions 与同版 `zic/zdump` 一致，links/offset/abbreviation 数量受审；
- 对 2026c 变更涉及的 Alberta、British Columbia、Morocco 做专项未来 fixture；
- 与 RFC 5545/8984 可映射子集交叉验证，但冲突时以已编号 REC 规则为产品权威并保留 fixture 解释。

### DST 与时区属性测试

- 对资产内每个 transition 自动生成 transition 前/等于/后、gap/overlap 中点、非整小时 offset 用例；
- 验证 local→instant→local：正常唯一值完全往返；gap 返回标记后的 effective local；overlap earlier/later 均能回到相同原始 local；
- 覆盖 `Australia/Lord_Howe` 等非一小时变化、历史日期线变化、午夜变化、负 DST 和无 DST zone；
- current zone A→B→A 后 occurrence key/历史不变，未来 instant 可逆重算；
- tzdb N→N+1 只更新受影响未来投影，终态/过去解析 byte-equal，通知 dedup 不增加。

### Recurrence 属性测试

- daily/weekly/monthly/yearly、interval 1/999、周起始、月底 skip、闰年、until inclusive、count 对实际候选；
- 多 monthDay 去重稳定，start 不命中、segment effectiveUntil、仅本次改期和本次及以后切分；
- 小页拼接结果等于大页，任意 kill/retry 后无漏项/重项，cursor 失效能从头重建；
- 10 万 count 使用分页完成且内存有界；恶意稀疏/非法规则在预算内明确失败；
- 同一 normalized 输入在 32/64-bit Android、iOS、不同系统 zone/locale 下输出 byte-identical key 和日期；
- fuzz parser、date bounds、整数溢出、corrupt tz asset，任何异常不形成部分业务写入。

### 性能门

- 中档最低支持真机预览 5 项 p95 ≤ 50 ms；生成 500 项 p95 ≤ 150 ms（不含 SQLite/通知 IO）；
- 首次加载 time module + asset 不阻塞首屏目标，asset 支持 lazy/memory-map/紧凑读取；
- 记录 bundle/asset 大小基线，tzdb 升级超过预算必须解释，不以裁掉常用 zone 或缩短未来正确性偷换。

## Rollout and rollback

1. 先实现 scalar fixture、js-joda adapter 和 fake clock；
2. 建项目命名空间 tzdb reproducible generator/2026c asset，与 zic/zdump 全量差分；验证上游 `@js-joda/timezone@2.25.2` 的 2026a 数据不会进入生产 bundle；
3. 实现 schedule resolver 与 DST fixture，再实现 recurrence v1 kernel；
4. 让预览、今天、历史和提醒全部通过同一 port，禁止各功能保留旧算法；
5. 以 debug shadow mode 对 reference implementation 比较候选，不写业务结果；
6. 达到性能/差分门后冻结 `recurrenceEngineVersion=1` 和 occurrence key v1；
7. 若上线后需回滚算法，保留已写 v1 interpreter/数据；不能降级成 `Date`/系统 tzdb。严重问题可暂停 timed 调度，全天/手动记录继续可用。

## References

- [js-joda project documentation](https://js-joda.github.io/js-joda/)
- [js-joda ZonedDateTime](https://js-joda.github.io/js-joda/class/packages/core/src/ZonedDateTime.js~ZonedDateTime.html)
- [js-joda ZoneRules](https://js-joda.github.io/js-joda/class/packages/core/src/zone/ZoneRules.js~ZoneRules.html)
- [js-joda timezone data generator](https://github.com/js-joda/js-joda/blob/main/packages/timezone/transform-data.js)
- [Hermes BigInt support status](https://github.com/facebook/hermes/issues/510)
- [Expo Localization](https://docs.expo.dev/versions/latest/sdk/localization/)
- [IANA Time Zone Database](https://www.iana.org/time-zones)
- [IANA Time Zone Database releases](https://www.iana.org/time-zones/releases)
- [IANA tzdb theory and pragmatics](https://www.iana.org/time-zones/theory)
- [RFC 9636：The Time Zone Information Format (TZif)](https://www.rfc-editor.org/rfc/rfc9636.html)
- [RFC 5545：Internet Calendaring and Scheduling Core Object Specification](https://www.rfc-editor.org/rfc/rfc5545.html)
- [RFC 8984：JSCalendar](https://www.rfc-editor.org/rfc/rfc8984.html)

## Revision history

| Date | Version | Change |
| --- | --- | --- |
| 2026-07-26 | v1.0 | 固化 js-joda 公历/ZoneRules、bundled IANA tzdb、P0 recurrence kernel、identity、升级和验证策略。 |

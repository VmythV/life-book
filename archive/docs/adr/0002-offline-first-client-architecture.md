# TD-002：离线优先客户端架构

> Status：`Accepted`  
> Date：2026-07-26  
> Decision owners：客户端架构负责人、领域负责人  
> Scope：P0～P2 移动客户端的模块、依赖、状态、事务与副作用边界  
> Related requirements：PD-002、PD-009、PD-015、QR-030～042、QR-110～112、DATA-002、BR-001～003  
> Related ADRs：[TD-001](0001-mobile-client-stack.md)、[TD-003](0003-encrypted-local-database.md)、[TD-009](0009-native-reminder-scheduler.md)、TD-020
> Decision gate：无开放产品决定；首个纵向切片必须用真实事务与失败注入验证本决定

## Context

生活有谱不是云端页面的离线缓存。P0 在没有账号、网络或在线服务时仍须完成五类记录的创建、编辑、查找、提醒、库存、备份与恢复；P1 同一客户端又要加入同步、云附件和冲突；P2 加入家庭权限。若页面、全局状态库、系统通知队列或网络响应各自保存一套可编辑事实，崩溃、离线和并发会产生无法解释的分叉。

架构还需处理一种普遍结果：领域事务已经成功，但搜索重建、系统通知、附件处理、遥测或网络上传失败。外部副作用不能回滚已向用户确认保存的生活数据，也不能只留在内存 Promise 中等待进程存活。

## Decision

客户端采用**离线优先的模块化单体 + Ports and Adapters**：

```text
Presentation / Navigation
          ↓ commands + queries
Application / Use Cases
          ↓
Deterministic Domain
          ↑ ports
Repositories / Platform / Network Adapters
```

加密 SQLite 与加密附件目录共同构成本地事实源；界面状态、缓存、搜索索引、“今天”投影、系统通知和网络响应都不是独立事实源。所有业务写入经应用命令进入领域规则，在本地 Unit of Work 中原子提交事实、必要的技术 outbox/持久任务和 P1 `SyncMutation`；提交后副作用由可重放执行器完成并对账。

## Decision details

### 1. 依赖方向

| 层 | 可以负责 | 不得负责 |
| --- | --- | --- |
| Presentation | 页面状态、表单草稿、导航、可访问语义、调用命令/查询、呈现受控错误。 | SQL、文件路径、HTTP、领域状态迁移、通知调度。 |
| Application | 用例编排、权限前置、事务范围、幂等、领域结果转任务、查询组合。 | 自己重写领域算法、依赖 React 组件、吞掉部分失败。 |
| Domain | 实体/值对象、不变量、状态迁移、确定性计算、领域错误和领域结果。 | React Native、SQLite、时钟单例、网络、日志、通知或供应商 SDK。 |
| Ports | Repository、UnitOfWork、Clock、IdGenerator、Crypto、Notification、File、Network 等窄契约。 | 暴露某 ORM/SDK 的可变对象或异常类型。 |
| Adapters | SQLite/文件/系统/HTTP 的实际读写、错误归类、资源释放。 | 绕过应用命令直接改变领域事实。 |

依赖只向内。Domain 可以定义它需要的 port 类型，但不得导入 adapter；Presentation 只能通过 application facade，不得从容器按字符串查服务。

### 2. 模块边界

客户端逻辑模块为：

| 模块 | 所有职责 |
| --- | --- |
| `shell` | 启动、锁定、导航、当前安全空间和 composition root。 |
| `records` | Record 根、五类通用生命周期与类型聚合入口。 |
| `scheduling` | 时间、重复、Occurrence/DateOccurrence 的确定性生成。 |
| `checklists` | 模板、实例、分组、项目和派生进度。 |
| `inventory` | 库存意图、权威流水、数量投影、低库存周期。 |
| `organization` | 分类、标签、置顶、归档、RecordLink 和筛选规范。 |
| `reminders` | ReminderPlan/Instance、通知动作、调度期望和对账。 |
| `attachments` | 加密暂存、元数据、缩略图、引用和垃圾回收。 |
| `projections` | 生活簿、今天、搜索和可重建读模型。 |
| `portability` | 备份、恢复、导出与后续导入。 |
| `ai-creation` | 临时创建会话、网关、草稿校验和确认转换。 |
| `identity-sync` | P1 账号、设备、outbox、cursor、快照和冲突。 |
| `spaces-family` | P2 成员缓存、邀请和高风险空间操作入口。 |

模块是代码与所有权边界，不是微服务。一个本地数据库和一个应用进程内，可以由 Application 层开启跨模块事务；模块不能互相导入 adapter 或直接修改对方表。共享包只放基础类型、Schema 生成物、受控错误和无平台纯函数，不形成第二套“common business rules”。

### 3. 命令模型

每个用户或远端业务写操作表示为显式命令：

```text
Command {
  commandId
  actorId
  spaceId
  input
  expectedRevision / precondition（适用时）
  occurredAt（由注入时钟提供）
}
```

命令处理顺序固定为：

1. 在进入事务前做格式、会话和明显权限前置检查；
2. 开启 Unit of Work，读取所需聚合与当前版本；
3. 由领域方法验证不变量并产生事实改变/领域结果；
4. 同一事务保存聚合、不可变历史、必要投影失效标记、持久任务；P1 绑定空间同时保存 `SyncMutation`；
5. 提交成功后发布本进程 invalidation，并唤醒任务执行器；
6. 返回已提交实体版本与受控副作用状态，不等待非原子外部系统完成；
7. 提交失败不发事件、不调度外部动作，保留可重试输入。

命令 ID 在其作用域内幂等。重复通知动作、双击、进程恢复或网络重试先查幂等收据；不能靠按钮禁用作为唯一防重。命令不得返回持久层可变实体供页面继续修改。

### 4. 查询模型

- Query 返回只读 DTO/视图模型，不返回 ORM 行或领域聚合引用；
- 普通详情从规范表读取；列表、今天和搜索可以使用可重建投影；
- 查询参数包含明确 `spaceId`、生命周期与隐私上下文，不能依赖“当前页面已经筛过”；
- 读模型保存来源版本/生成号；落后时可以展示 `stale`，不能把旧投影写回领域表；
- 页面通过稳定 query key 订阅失效/刷新；具体 React 状态库可替换，不进入业务 API；
- 分页使用稳定排序键与实体 ID tie-breaker，不使用可漂移的数组下标或只靠 offset；
- 敏感数据在查询边界即裁剪，不能先返回完整 DTO 再由卡片 CSS 隐藏。

### 5. 状态所有权

| 状态 | 权威位置 | 生命周期 |
| --- | --- | --- |
| 记录、Occurrence、清单、库存、提醒实例 | SQLite 规范表/不可变历史。 | 跨进程、备份；按规则同步。 |
| 附件正文 | 加密私有文件；SQLite 保存元数据/引用。 | 跨进程、备份；按阶段同步。 |
| 搜索、今天、数量预估、缩略图 | 本地可重建投影。 | 可删除并从事实重建。 |
| 表单未提交输入 | 页面/创建会话状态。 | P0 当前会话；未经明确规则不进业务库。 |
| 导航、展开、临时选择 | Presentation 状态。 | 进程内或非内容安全偏好。 |
| 系统通知队列 | 操作系统外部投影。 | 随时对账，不作为“提醒存在”的证明。 |
| P1 网络缓存 | Query cache。 | 可丢弃；本地库仍是客户端完整副本。 |
| 同步 cursor/outbox/mutation | SQLite 技术表。 | 持久、按协议恢复，不进普通 UI 编辑。 |

全局状态库不得复制整套 Record 并允许页面写入。表单编辑使用显式 draft；提交时带 base revision 重新执行命令，避免用陈旧对象覆盖新事实。

### 6. 持久副作用任务

领域提交后可能产生 `RebuildSearchDocument`、`ReconcileReminder`、`ProcessAttachment`、`DeleteAttachmentBytes`、`GenerateThumbnail`、`ExportCleanup`、`PushSyncMutation` 等任务。任务至少保存：

- 全局任务 ID、受控 task type、目标实体/空间 ID；
- 去重键、输入版本或来源 revision；
- `pending | running | retry_wait | succeeded | terminal_failed | cancelled`；
- 尝试次数、下一次执行时刻、非敏感错误码；
- lease owner/expiry，防止重入进程并发执行；
- 创建/完成时刻和清理期限。

执行器规则：

- 先领取短 lease，再执行；崩溃后 lease 到期可重放；
- handler 必须幂等，成功写收据/状态与必要技术结果；
- 指数退避带抖动并尊重平台/服务端建议；权限拒绝、用户取消、来源版本被替代等进入明确终态或等待触发，不无限忙重试；
- `succeeded` 任务按诊断窗口裁剪；不可通过删任务来掩盖仍不一致的投影；
- 用户可见的局部失败从任务状态派生，修复动作创建新尝试或重新对账，不直接改成成功。

P1 网络 `SyncMutation` 有独立协议状态，不用通用 task row 代替；任务只负责唤醒/传输，mutation 才是待同步业务写的权威排队项。

### 7. 事务与并发

- 每条命令只拥有一个本地数据库写事务；事务内不调用网络、模型、系统通知、相册、分享或等待用户输入；
- 同一聚合的进程内命令按 ID 串行，数据库 revision/precondition 仍是最终防线；
- 清单批量操作、规则切分、库存本地过账、回收站恢复和备份元数据提交不得部分成功；
- 附件字节使用“加密暂存 → 校验 → 事务绑定元数据 → 原子提升/恢复清理”协议，不假装文件系统与 SQLite 有分布式事务；
- P1 远端事件应用也经过 Unit of Work 和领域/同步验证，禁止通用 JSON patch 直接写表；
- 事务回调不得产生不可撤回外部副作用，重试事务时不能重复生成随机业务结果；ID、时钟与随机源在进入时固定或注入。

### 8. 启动与恢复

```text
安全遮罩
→ 打开安全存储/解封数据库密钥
→ 打开数据库并检查版本、迁移标记、完整性
→ 恢复未完成的原子文件操作/事务外任务
→ 建立最小查询容器
→ 解锁后查询首屏
→ 后台运行投影、提醒、附件和同步对账
```

未知 Schema、错误密钥、损坏或迁移失败进入 `blocked_error`，不得创建空库覆盖。首屏可用不等待全部投影重建，但必须显示局部状态；任何后台重建不得绕过应用锁读取并渲染敏感内容。

### 9. 错误模型

adapter 异常必须在边界映射为受控类别：

| 类别 | 示例 | Application 行为 |
| --- | --- | --- |
| `validation` | 字段/领域不合法 | 不提交；定位字段。 |
| `conflict` | revision、同步冲突 | 不覆盖；返回选择/刷新信息。 |
| `permission` | 平台或空间权限 | 保留领域事实或输入；给替代/修复。 |
| `transient` | 暂时 IO/网络/服务 | 安全重试或排入持久任务。 |
| `capacity` | 磁盘、配额、附件上限 | 停止相关写；不删除既有数据。 |
| `integrity` | 哈希、DB、Schema 异常 | 阻止破坏性写入，进入恢复路径。 |
| `unsupported` | 新实体/协议/系统能力 | 只读保护或明确降级。 |

页面不接收 SQLite code、Java exception、HTTP response 或供应商原文。

## Alternatives considered

### 页面直接调用 Repository/SQLite

初期代码少，但事务、权限、通知副作用和错误处理会散落在页面；背景任务和远端同步无法复用同一业务入口。拒绝。

### Redux/Zustand 等内存 Store 作为事实源

适合界面状态，不适合崩溃耐久、50k 数据、事务、附件和离线重启。允许用可替换状态工具保存 Presentation 状态/订阅查询，但禁止把它变成业务数据库。

### 全事件溯源

历史事实对库存、审计等局部聚合有价值，但把所有记录编辑都改成事件流会扩大投影、迁移、删除和隐私擦除复杂度。当前采用规范实体 + 需要的不可变历史 + 技术 change log，不做全局 Event Sourcing。

### 通用 CRDT 本地核心

通用 CRDT 不自动表达库存串行过账、重复规则切分、墓碑、权限和高风险事务；P0 也无同步。领域命令和明确同步合并规则更可解释，P1 在 TD-020 决定协议。

### 云端优先薄客户端

直接违反 PD-002 与 QR-040，模型/账号/网络故障会阻断核心手动能力。拒绝。

## Consequences

### Positive

- P0 业务可在无 React Native、无数据库和无网络的纯测试中验证；
- 崩溃或系统副作用失败后可以从本地事实与任务恢复；
- P1 同步和 P2 家庭通过新 adapter/application policy 扩展，不重写页面里的领域逻辑；
- UI 缓存、搜索和今天投影损坏时可以安全重建；
- 每个写入有命令、事务、错误和幂等边界，便于验收追溯。

### Negative

- 命令、DTO、mapper、port、任务和测试带来明显样板代码；
- 开发者必须理解“保存成功”和“副作用完成”是两个结果；
- 查询投影的一致性、重建和失效需要专门设施；
- 跨模块操作必须由应用层显式编排，不能随意跨表更新；
- 不谨慎的抽象可能产生过度分层，因此只为真实端口/用例建立接口。

## Risks and mitigations

| 风险 | 缓解 |
| --- | --- |
| 每个简单字段都出现过多层 | 聚合内纯修改可共用 application handler 基础设施；接口按替换/测试边界创建，不为每个类建接口。 |
| 持久任务无限增长 | 明确终态、保留窗口、去重和运维指标；成功任务可裁剪但事实/收据按协议保留。 |
| 页面看到提交前缓存 | 提交返回规范 DTO/version，并使相关 query key 失效；列表以实体 ID 合并。 |
| adapter 偷带业务判断 | 契约测试同一用例运行内存/SQLite adapter；领域规则只在 domain/application。 |
| 远端同步绕过不变量 | 所有 remote apply 经专用同步用例、precondition 和同一 Unit of Work。 |
| 任务重放产生重复通知/文件 | 每个 handler 使用稳定 dedup key、目标版本和外部收据；故障注入测试每个提交点。 |

## Implementation constraints

- composition root 是创建具体 adapter 的唯一位置；业务模块不得使用全局 service locator；
- Clock、ID、随机、locale/time-zone source 可注入，测试不得改系统全局时间来验证规则；
- Repository API 以聚合/查询意图命名，不暴露 `execute(sql)` 给 Presentation/Application；
- Unit of Work 不嵌套；需要组合时由最外层 application use case 持有事务；
- application result 明确分开 `committed`、`sideEffectsPending`、`warnings`，不能用一个 boolean `success` 隐藏局部失败；
- 日志只记录 command type、受控错误、耗时、版本和随机 request/diagnostic ID；不记录命令正文；
- 远程功能关闭开关只影响相应 adapter/use case，不能让 composition root 无法构造本地核心。

## Verification

首个纵向切片使用“创建一条带提醒的重复事项”验证：

1. 纯领域测试覆盖合法/非法状态、固定时钟和 ID；
2. SQLite 集成测试证明 Record、detail、segment、reminder plan 与 task 原子提交；
3. 在事务提交前 kill 时没有部分数据或外部通知；
4. 提交后、通知前 kill 时记录存在，重启后任务补调度；
5. 通知权限拒绝时记录仍成功，任务进入可理解状态；
6. 重复点击同 commandId 不创建第二条记录/提醒；
7. 搜索投影删除后可从事实重建；
8. 页面刷新和进程重启后从 DB 得到相同业务结果；
9. adapter 抛出的原生/SQLite 异常不会穿透到页面或日志正文。

后续库存、附件、恢复和同步分别重复同类 crash-point/property/contract 测试。架构测试在 CI 禁止 presentation 导入 adapter、domain 导入平台包及跨模块私有目录引用。

## Rollout and rollback

P0 从第一条数据开始采用此结构，不建立临时页面直写数据库版本。架构内部重构必须先保留命令/查询契约和迁移测试，再切 adapter；若某个模块边界证明过细，可在不改变领域/持久化公共格式的情况下合并实现。若要改为云优先、事件溯源或另一事实源，必须用新 ADR，并给出现有本地数据库、任务与备份的迁移和回滚。

## References

- [领域模型](../domain-model.md)
- [业务规则](../business-rules.md)
- [数据生命周期](../data-lifecycle.md)
- [质量属性](../quality-attributes.md)

## Revision notes

| 日期 | 说明 |
| --- | --- |
| 2026-07-27 | 将尚未建立的 TD-020 改为纯编号引用，保留同步协议的计划关系但不创建破链。 |
| 2026-07-26 | 接受模块化单体、依赖向内、本地事实源、命令/查询和持久副作用任务架构。 |

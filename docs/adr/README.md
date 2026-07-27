# 生活有谱技术决策记录索引

> 项目代号：`life-book` · 版本：v1.1 · 更新日期：2026-07-27 · 状态：持续维护
>
> 权威范围：ADR 编号、存在性、状态、日期、固定结构、依赖、接受/替代流程与技术决策阶段门
>
> 不负责：重复决策正文、产品阶段范围、领域规则、物理接口字段、实现完成度或发布排期
>
> 依赖文档：[文档治理](../documentation-governance.md)、[产品决策](../product-decisions.md)、[产品路线图](../roadmap.md)、[未决事项](../open-questions.md)、[质量属性](../quality-attributes.md)

技术决策记录（ADR）回答“系统为何这样实现”。每个 `TD-*` 只拥有一个主要技术选择，保留上下文、备选、后果和退出路径；架构与专项规范引用已接受 ADR，不在多份文档中重新选择技术。

本索引同时登记**仓库当前事实**与**后续计划位置**。计划中的标题、依赖和 disposition 不是已经形成的技术结论；只有对应文件存在且页首声明有效状态，才构成 ADR。

## 1. 状态与生命周期

ADR 的 `Status` 只允许：

| 状态 | 含义 | 实施规则 |
| --- | --- | --- |
| `Proposed` | 方案完整但尚未通过接受门。 | 可以做可丢弃 spike，不得让生产格式或公共契约依赖它。 |
| `Accepted` | 已成为当前实施选择。 | 新实现必须遵守；实现、契约、验证和发布仍需分别通过各自门。 |
| `Deferred` | 决策被有意推迟，且有安全默认或阶段隔离。 | 不得实现被推迟的用户承诺；必须写明阻塞阶段与重开条件。 |
| `Superseded` | 已由另一 ADR 替代。 | 保留历史，不再修改决定正文；页首双向链接替代项。 |

`Blocked` 不是 ADR 状态。若外部问题阻止接受，在 `Proposed` 或 `Deferred` ADR 的 `Decision gate` 中记录 `OQ-*`、阻塞阶段和所需证据。

```text
Proposed ──接受──→ Accepted ──新决策──→ Superseded
    │                   ▲
    └──推迟──→ Deferred ──重开并接受──┘
```

`Accepted` 只证明技术选择成立，不证明物理 Schema/API 已规范化、实现已完成、测试或安全评审已通过、生产已经可发布。上述事实分别由机器契约登记、实现 evidence 和发布清单负责。

## 2. 编号、存在性与日期

- 每份文件名为四位序号加短横线标题，例如 `0001-mobile-client-stack.md`；文内稳定编号为对应 `TD-001`。
- 编号一经提交不得重用、移动或为排序而重编号；新 ADR 默认追加到末尾。
- `Exists=PRESENT` 只表示当前 Git tree 存在对应路径；`MISSING` 的 ADR Status、Decision date 和 Review date 必须都是 `—`。
- 缺失路径只使用代码格式展示，不创建无效 Markdown 链接；文件提交后再改为链接。
- 现有 ADR 页首 `Date` 在 `Accepted` 状态下登记为 Decision date；Review date 只记录独立复审日期，没有复审证据时为 `—`。
- 替代旧决定时创建新编号，旧文件改为 `Superseded`，新旧文件互相链接。
- 一份 ADR 一个 Git 提交；不改变决定的勘误可以修订原 ADR，并在 `Revision notes` 记录。

## 3. 固定结构

每份新 ADR 必须按以下顺序完整填写：

```markdown
# TD-NNN：标题

Status / Date / Review date / Decision owners / Scope
Related requirements / Related ADRs / Decision gate

## Context
## Decision
## Decision details
## Alternatives considered
## Consequences
## Risks and mitigations
## Implementation constraints
## Verification
## Rollout and rollback
## References
## Revision notes
```

- `Context` 只陈述约束和问题，不把偏好伪装成事实。
- `Decision` 必须是一段可判断是否遵守的明确结论。
- `Alternatives considered` 至少包含“不引入该能力”和实际可行的主要候选。
- `Consequences` 同时记录收益、成本、不可逆兼容负担和团队能力要求。
- `Implementation constraints` 规定边界，不复制物理 Schema 或接口字段。
- `Verification` 列自动化、基准、真机、安全评审和外部核验。
- `Rollout and rollback` 说明对已有用户、数据和已发布二进制的退出路径。
- `Review date` 没有发生独立复审时写 `—`；不得用提交日、修订日或计划日期代填。
- 外部能力只引用供应商或标准的官方资料；实现、依赖升级和发布时分别重新核验。

## 4. 接受门

### ADR-001：一般接受门

ADR 从 `Proposed` 进入 `Accepted` 前必须满足：

1. 决策符合已确认 `PD-*`、当前路线图和领域不变量；
2. 主要备选按同一组质量目标比较，不只按熟悉度选择；
3. 安全、隐私、离线、迁移、无障碍、运维和成本后果已经写明；
4. 尚未验证的假设有 owner、spike、通过阈值和最晚门；
5. 需要外部或产品输入时链接 `OQ-*`，且不会越过其阻塞阶段；
6. 公共格式、Schema、API、备份或同步兼容性有版本和回滚策略；
7. 关联架构、测试、运行和实施文档有明确更新位置。

### ADR-002：安全敏感决定

涉及密钥、密码学、认证、授权、备份恢复、远程代码、第三方内容处理或删除的 ADR，还必须：

- 先有威胁模型和数据分类输入；
- 只采用成熟、维护中、适合目标平台的原语或库，不自创密码算法；
- 写明密钥丢失、轮换、撤销、降级和旧格式读取；
- 把独立安全评审列为生产启用门；
- 不用“行业标准”“军用级”等不可测试措辞替代参数和控制。

### ADR-003：外部平台决定

依赖 Apple、Android、Expo、SQLite、模型、云、邮件、历法数据或推送供应商时：

- 接受产品边界和适配策略，不把供应商当前配额或实现细节当领域常量；
- 官方能力、许可、支持系统、数据地区和商店政策在决定、实现、升级及发布前按适用阶段核验；
- 不可控能力必须有手动、离线、只读或关闭能力的降级路径和 kill switch；
- 真机或生产等价环境的 spike 证据进入测试/发布记录，不塞入 ADR 正文持续更新。

## 5. 当前决策登记

### 5.1 已存在 ADR

下表只登记文件和页首能够证明的事实。现有 11 份 ADR 均已接受；尚无独立 Review date。

| ID | ADR | Exists | ADR Status | Decision date | Review date | Phase |
| --- | --- | --- | --- | --- | --- | --- |
| TD-001 | [移动客户端技术栈](0001-mobile-client-stack.md) | `PRESENT` | `Accepted` | 2026-07-26 | `—` | P0 移动端，约束 P1/P2 延续 |
| TD-002 | [离线优先客户端架构](0002-offline-first-client-architecture.md) | `PRESENT` | `Accepted` | 2026-07-26 | `—` | P0～P2 移动客户端 |
| TD-003 | [加密本地数据库](0003-encrypted-local-database.md) | `PRESENT` | `Accepted` | 2026-07-26 | `—` | P0～P2 移动本地关系数据 |
| TD-004 | [设备密钥层级与应用锁](0004-device-key-hierarchy-and-app-lock.md) | `PRESENT` | `Accepted` | 2026-07-26 | `—` | P0 设备安全，约束 P1/P2 |
| TD-005 | [加密附件存储](0005-encrypted-attachment-store.md) | `PRESENT` | `Accepted` | 2026-07-26 | `—` | P0～P2 移动附件 |
| TD-006 | [跨端基础标量表示](0006-cross-platform-scalar-representations.md) | `PRESENT` | `Accepted` | 2026-07-26 | `—` | P0～P2 跨边界标量 |
| TD-007 | [时间、时区与重复规则引擎](0007-time-recurrence-engine.md) | `PRESENT` | `Accepted` | 2026-07-26 | `—` | P0～P2 时间与重复 |
| TD-008 | [加密本地搜索与可重建索引](0008-encrypted-local-search.md) | `PRESENT` | `Accepted` | 2026-07-26 | `—` | P0 本地搜索，兼容 P1/P2 |
| TD-009 | [原生提醒调度与平台通知适配](0009-native-reminder-scheduler.md) | `PRESENT` | `Accepted` | 2026-07-26 | `—` | P0 本地通知，兼容 P1 远程推送 |
| TD-010 | [SQLite 快照、迁移与原子恢复](0010-sqlite-snapshot-migration-and-atomic-restore.md) | `PRESENT` | `Accepted` | 2026-07-26 | `—` | P0～P2 初始化、迁移与恢复 |
| TD-011 | [备份容器与密码学](0011-backup-container-and-cryptography.md) | `PRESENT` | `Accepted` | 2026-07-26 | `—` | P0～P2 `.lifebook` 备份 |

### 5.2 已预留、尚缺失的 ADR

下表所有条目当前均为 `MISSING`。`Planned disposition` 只规定建文档时的初始生命周期位置，不能当作正式 ADR Status。

| ID | 计划标题与路径 | Exists | ADR Status | Decision date | Review date | Phase | Planned disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TD-012 | HTTP API 与契约版本；`0012-http-api-and-contract-versioning.md` | `MISSING` | `—` | `—` | `—` | P0 online | `Proposed` |
| TD-013 | 智能网关与供应商路由；`0013-ai-gateway-and-provider-routing.md` | `MISSING` | `—` | `—` | `—` | P0 online | `Proposed` |
| TD-014 | 匿名服务访问与防滥用；`0014-anonymous-service-access-and-abuse-control.md` | `MISSING` | `—` | `—` | `—` | P0 online | `Proposed` |
| TD-015 | 后端运行时与服务拓扑；`0015-backend-runtime-and-service-topology.md` | `MISSING` | `—` | `—` | `—` | P0 online | `Proposed` |
| TD-016 | 隐私保护的可观测性；`0016-privacy-preserving-observability.md` | `MISSING` | `—` | `—` | `—` | P0 online | `Proposed` |
| TD-017 | 构建、发布与更新边界；`0017-build-release-and-update-boundaries.md` | `MISSING` | `—` | `—` | `—` | P0 | `Proposed` |
| TD-018 | 服务端持久化、Outbox 与对象存储；`0018-server-persistence-outbox-and-object-storage.md` | `MISSING` | `—` | `—` | `—` | P1 | `Proposed` |
| TD-019 | 账号认证与设备会话；`0019-account-authentication-and-device-sessions.md` | `MISSING` | `—` | `—` | `—` | P1 | `Proposed` |
| TD-020 | 增量同步协议；`0020-incremental-sync-protocol.md` | `MISSING` | `—` | `—` | `—` | P1 | `Proposed` |
| TD-021 | 云附件与云备份传输；`0021-cloud-attachment-and-backup-transfer.md` | `MISSING` | `—` | `—` | `—` | P1 | `Proposed` |
| TD-022 | 远程推送路由；`0022-remote-push-routing.md` | `MISSING` | `—` | `—` | `—` | P1 | `Proposed` |
| TD-023 | P1/P2 加密边界；`0023-p1-p2-encryption-boundary.md` | `MISSING` | `—` | `—` | `—` | P1/P2 架构门 | `Deferred`，等待 OQ-006 |
| TD-024 | 家庭授权、审计与高风险串行化；`0024-family-authorization-audit-and-high-risk-locks.md` | `MISSING` | `—` | `—` | `—` | P2 | `Proposed` |
| TD-025 | 智能上下文、查询、补丁与视觉输入；`0025-ai-context-retrieval-patch-and-vision.md` | `MISSING` | `—` | `—` | `—` | P2 | `Proposed` |
| TD-026 | Web 客户端架构；`0026-web-client-architecture.md` | `MISSING` | `—` | `—` | `—` | P2 | `Proposed` |
| TD-027 | 公共模板发布与内容治理；`0027-public-template-publication-and-moderation.md` | `MISSING` | `—` | `—` | `—` | P2 | `Proposed` |
| TD-028 | 中国农历历法数据与转换适配；`0028-chinese-lunar-calendar-adapter.md` | `MISSING` | `—` | `—` | `—` | P1 | `Proposed` |

## 6. 依赖、关联与阶段门

`Prerequisite ADRs` 是有向依赖：后者形成决定前必须先遵守前者已经固定的边界。`Related ADRs` 只是需要交叉影响检查的无向关联，不表示接受或实现顺序。缺失 ADR 的两列都是计划关系，创建正文时必须复核。

### 6.1 P0 客户端、本地数据与平台

| ID | Prerequisite ADRs | Related ADRs | 最晚决定或启用门 |
| --- | --- | --- | --- |
| TD-001 | `—` | TD-002、003、009、017 | 客户端工程创建前确定；若 OQ-003 的默认出现能力反证，以新 ADR 替代。 |
| TD-002 | TD-001 | TD-003、009、020 | 首个纵向切片前；以真实事务和失败注入验证。 |
| TD-003 | TD-002 | TD-004、006、008、010 | 建立持久层前；生产构建须通过数据库、启动、迁移、崩溃和容量矩阵。 |
| TD-004 | TD-002 | TD-003、005、006、010、011、019 | 保存第一条真实数据前；威胁模型、双平台真机、kill-point 与安全评审通过后启用。 |
| TD-005 | TD-004 | TD-003、010、011、021 | 实现附件前；原生密码库、安全、恶意文件和 50 MB 流式真机测试通过后启用。 |
| TD-006 | TD-002 | TD-003、007、010、012 | 首个持久化 Schema 冻结前通过跨语言 fixture。 |
| TD-007 | TD-006 | TD-002、009、010、020、028 | 重复事项和提醒验收前通过真机、参考实现、tzdb 与 `REC-T*` fixture。 |
| TD-008 | TD-006 | TD-002、003、010 | 搜索索引建立前；公开构建前通过能力、崩溃、安全删除和容量基准。 |
| TD-009 | TD-002 | TD-001、004、006、007、010、012、022 | 实现通知前；公开构建前通过双平台、权限、升级、预算和恢复矩阵。 |
| TD-010 | TD-003 | TD-002、004、005、008、009、011 | 保存真实数据、生成长期备份或执行已发布迁移/覆盖恢复前通过真机与 kill-point 门。 |
| TD-011 | TD-010 | TD-004、005、006 | 生成长期保留备份前通过密码学评审、byte fixture、fuzz 和 5 GiB 测试。 |

### 6.2 P0 在线能力

| ID | Prerequisite ADRs | Related ADRs | 最晚决定或启用门 |
| --- | --- | --- | --- |
| TD-012 | `—` | TD-006、009、013～017 | 接入任何生产服务前接受；API Schema 和兼容 oracle 另过契约门。 |
| TD-013 | TD-012 | TD-014、016 | 接入任何模型前接受；供应商、区域和额度保持可配置。 |
| TD-014 | TD-013 | TD-012、016 | 开放内置智能测试前接受；OQ-010 默认只允许可撤销的匿名访问。 |
| TD-015 | TD-012 | TD-016～018 | 创建服务端工程前接受；不得先固化未决定的生产区域。 |
| TD-016 | TD-015 | TD-014、017 | 接入日志、崩溃或遥测 SDK 前接受；真实数据还受 OQ-001/002 阻塞。 |
| TD-017 | TD-015 | TD-001、009、016 | 首次内部分发前接受；签名、升级、回滚与环境边界必须可验证。 |

### 6.3 P1 账号、云、同步与农历

| ID | Prerequisite ADRs | Related ADRs / requirements | 最晚决定或启用门 |
| --- | --- | --- | --- |
| TD-018 | TD-015 | TD-019～023 | P1 服务端架构冻结前接受。 |
| TD-019 | TD-018 | TD-004、020～022 | 账号与设备会话实现前接受；真实用户启用受 OQ-001/002/006 阻塞。 |
| TD-020 | TD-018 | TD-002、019、021、022、024 | 同步实现前接受；OQ-006 关闭前不得冻结不可迁移的加密边界。 |
| TD-021 | TD-019、TD-020 | TD-005、011、018、023 | 云附件或云备份实现前接受。 |
| TD-022 | TD-019、TD-020 | TD-009、018、023 | 跨设备提醒实现前接受；不扩大 PD-013 的送达承诺。 |
| TD-023 | `—` | TD-018～022、024 | 保持计划 `Deferred`；OQ-006 关闭且威胁模型、迁移路径完成前不得接受。 |
| TD-028 | TD-006、TD-007 | PD-018、PR-260、REC-092 | P1 农历重要日期切片设计前接受，并固定数据来源、许可、版本、支持年份、转换 adapter、迁移与 occurrence identity；对应合同及跨实现 oracle 通过前，入口保持关闭。 |

### 6.4 P2 家庭、成熟智能与 Web

| ID | Prerequisite ADRs | Related ADRs | 最晚决定或启用门 |
| --- | --- | --- | --- |
| TD-024 | TD-020、TD-023 | TD-019、022、025～027 | 家庭空间实现前接受；授权矩阵、审计和高风险操作必须同门评审。 |
| TD-025 | TD-024 | TD-013、016、023 | P2 成熟智能实现前接受；查询与补丁不得绕过家庭授权。 |
| TD-026 | TD-024 | TD-001～003、020、023 | Web 工程创建前接受；不得复用移动端本地存储假设。 |
| TD-027 | TD-024 | TD-016、019、020、023 | 公共模板实现前接受；发布、审核、下架和删除必须形成闭环。 |

## 7. 未决事项映射

| OQ | 影响的 ADR | 当前处理 |
| --- | --- | --- |
| OQ-001 首发地区 | TD-013～019、021、022、026、027 | 供应商和区域保持可配置；阻塞生产环境与公开测试，不阻塞本地工程。 |
| OQ-002 运营主体 | TD-016、019、027 | 不虚构主体；阻塞真实账号、遥测和公共内容投产。 |
| OQ-003 团队偏好 | TD-001、015、026 | TD-001 已采用默认栈；若出现能力反证，以新 ADR 替代。其余在工程创建前决定。 |
| OQ-004 提醒承诺 | TD-009、022 | 遵守 PD-013 的平台边界，不实现绝对送达。 |
| OQ-005 备份口令找回 | TD-004、011 | P0 已采用“不托管、不找回”默认；改变时需要新安全 ADR。 |
| OQ-006 P1/P2 E2EE | TD-018～025 | TD-023 计划保持 `Deferred`；阻塞 P1/P2 架构冻结，不反向阻塞 P0。 |
| OQ-007 商业与额度 | TD-013、014 | 额度配置与本地能力隔离；不在 ADR 中虚构价格。 |
| OQ-008 发布日期与团队容量 | `—` | 不产生 ADR；只阻塞日历排期，不阻塞技术拆分和依赖排序。 |
| OQ-009 品牌可用性 | TD-017、026 | 技术标识使用 `life-book`，展示名保持可替换；阻塞正式商店提交。 |
| OQ-010 匿名防滥用 | TD-014、016 | 采用可撤销匿名令牌默认；真实滥用超出护栏时重开决定。 |

## 8. 已知一致性修复队列

以下是当前 Git tree 中已经定位、但必须按“一份文档一个提交”另行修正的引用问题。它们不改变既有 `Accepted` 决定本身：

1. TD-006 正文把 TD-014 链接为旧的“API 与契约版本”路径；当前编号登记是 TD-012=HTTP API、TD-014=匿名访问与防滥用。
2. TD-007 正文仍使用 TD-009、TD-010 的旧文件名，把同步协议写为 TD-018，并把物理 Schema 和农历 adapter 分别写为 TD-012、TD-024。当前计划分别把物理 Schema、同步协议和农历适配归入 `persistence-schema.md`、TD-020、TD-028；目标文件建立前，这些计划归属不构成生效的技术决定。
3. TD-001、TD-002、TD-004、TD-005、TD-009 共包含指向 TD-012、TD-017、TD-019～022 的 6 个有效未来关系，但目标文件尚不存在；应先改成纯 `TD-*`，文件建立后再恢复链接。
4. TD-008 对 `persistence-schema.md` 的依赖语义成立，但该文档仍缺失；在其建立前只能记为 dependency gap，不能改指另一份 ADR。

修复规则：只校正编号、路径、权威 owner 和 `Revision notes`，不得借链接修复静默改变 ADR 决定；如果含义确实改变，必须新建替代 ADR。

## 9. 评审与维护

### ADR-010：变更触发器

出现以下任一情况必须评估新 ADR：

- 更换主要 UI、数据库、同步、认证、备份、加密、时间、通知、历法或服务运行时；
- 公共格式或 API 出现破坏性版本；
- 新供应商改变数据处理或信任边界；
- 质量目标无法在当前选择上达到；
- 新阶段让已有默认失效；
- 安全事件或平台政策证明原假设错误。

普通依赖补丁升级不必新建 ADR，但必须通过依赖、迁移、契约和发布门；主版本升级若改变架构能力或数据格式，需要修订或替代决定。

### ADR-011：索引一致性

- 新增、接受、推迟、复审或替代 ADR 时，必须更新本索引的存在性、正式状态、日期和依赖。
- 按一文件一提交执行时，先提交 ADR，再用独立索引提交更新登记；两次提交属于同一 change train，完成前不得声称 registry 已同步。
- 决策正文引用计划 ADR 时使用纯 `TD-*`；仅在目标文件存在后使用文件链接。
- 最终文档门必须确认索引没有缺失登记或孤立 ADR，`TD-*` 唯一且与文件序号一致，并区分决定、契约、实现和发布 evidence。

## 10. 变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| v1.1 | 2026-07-27 | 按仓库事实重建 28 项登记；区分存在性、ADR 状态、决定/复审日期、前置/关联关系与实施门；新增 TD-028，并登记现存引用修复队列。 |
| v1.0 | 2026-07-26 | 建立 ADR 状态、固定结构、接受门、27 项技术决策索引、阶段依赖和未决事项映射。 |

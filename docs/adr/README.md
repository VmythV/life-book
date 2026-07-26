# 生活有谱技术决策记录索引

> 项目代号：`life-book` · 版本：v1.0 · 更新日期：2026-07-26 · 状态：技术决策治理基线
>
> 权威范围：ADR 编号、状态、固定结构、接受/替代流程、阶段门与技术决策索引
>
> 不负责：重复描述每项决策正文、产品阶段范围、领域规则、物理接口字段和实施排期
>
> 依赖文档：[文档治理](../documentation-governance.md)、[产品决策](../product-decisions.md)、[产品路线图](../roadmap.md)、[未决事项](../open-questions.md)、[质量属性](../quality-attributes.md)

技术决策记录（ADR）回答“系统为何这样实现”。每个 `TD-*` 只拥有一个主要技术选择，保留上下文、备选和后果；系统架构引用已接受 ADR，而不在多份文档中重新选择技术。

## 1. 状态与生命周期

ADR 的 `Status` 只允许：

| 状态 | 含义 | 实施规则 |
| --- | --- | --- |
| `Proposed` | 方案完整但尚未通过接受门。 | 可以做可丢弃 spike，不得让生产格式或公共契约依赖它。 |
| `Accepted` | 已成为当前实施选择。 | 新实现必须遵守；验证项可以在实施中完成，但失败必须触发替代决策。 |
| `Deferred` | 决策被有意推迟，且有安全默认或阶段隔离。 | 不得实现被推迟的用户承诺；必须写明阻塞阶段与重开条件。 |
| `Superseded` | 已由另一 ADR 替代。 | 保留历史，不再修改决定正文；页首链接替代项。 |

`Blocked` 不是状态。若外部问题阻止接受，在 `Proposed` 或 `Deferred` ADR 的 `Decision gate` 中记录 `OQ-*`、所阻塞阶段和所需证据。实现尚未完成、测试未跑完也不自动把 `Accepted` 改回 `Proposed`；这类状态由实施计划和测试证据管理。

状态流：

```text
Proposed ──接受──→ Accepted ──新决策──→ Superseded
    │                   ▲
    └──推迟──→ Deferred ──重开并接受──┘
```

## 2. 编号和文件规则

- 每份文件名为四位序号加短横线标题，例如 `0001-mobile-client-stack.md`；
- 文内稳定编号为对应 `TD-001`，序号和编号一一对应；
- 编号一经提交不得重用、移动或为排序而重编号；
- 新 ADR 默认追加到末尾；替代旧决定时创建新编号并让双向链接完整；
- 一份 ADR 一个 Git 提交；同一决定需要改变时优先新增替代 ADR，不静默重写已经实施的历史；
- 只有拼写、链接和不改变决定的澄清可以修订原 ADR，并增加 `Revision notes`。

## 3. 固定结构

每份 ADR 必须按以下顺序完整填写：

```markdown
# TD-NNN：标题

Status / Date / Decision owners / Scope
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

其中：

- `Context` 只陈述约束和问题，不把偏好伪装成事实；
- `Decision` 必须是一段可判断是否遵守的明确结论；
- `Alternatives` 至少包含“维持现状/不引入该能力”及实际可行的主要候选；
- `Consequences` 同时记录收益、成本、不可逆兼容负担和团队能力要求；
- `Implementation constraints` 规定边界，不复制物理 Schema 或接口字段；
- `Verification` 列自动化、基准、真机、安全评审和外部核验；
- `Rollout and rollback` 说明在已有用户、已有数据或已发布二进制上的退出路径；
- 外部能力引用供应商或标准的官方资料，升级依赖时重新核验，ADR 不把当前平台限制写成永久事实。

## 4. 接受门

### ADR-001：一般接受门

ADR 从 `Proposed` 进入 `Accepted` 前必须满足：

1. 决策符合已确认 `PD-*`、当前路线图和领域不变量；
2. 主要备选按相同质量目标比较，不只按熟悉度选择；
3. 安全、隐私、离线、迁移、无障碍、运维和成本后果已经写明；
4. 尚未验证的假设有 owner、spike、通过阈值和最晚门；
5. 不需要用户产品决定的事项已经收敛；需要时链接 `OQ-*`，且不会越过其阻塞阶段；
6. 公共格式、Schema、API、备份或同步兼容性有版本/回滚策略；
7. 关联架构、测试和实施文档有明确更新位置。

### ADR-002：安全敏感决定

涉及密钥、密码学、认证、授权、备份恢复、远程代码、第三方内容处理或删除的 ADR，还必须：

- 先有威胁模型和数据分类输入；
- 只采用成熟、维护中、适合目标平台的原语/库，不自创密码算法；
- 写明密钥丢失、轮换、撤销、降级和旧格式读取；
- 通过独立安全评审或明确把该评审列为生产启用门；
- 不用“行业标准”“军用级”等不可测试措辞替代参数和控制。

### ADR-003：外部平台决定

依赖 Apple、Android、Expo、SQLite、模型、云、邮件或推送供应商时：

- 接受的是产品边界和适配策略，不把某供应商当前配额当领域常量；
- 官方能力、许可、支持系统、数据地区和商店政策在实现、升级及发布前分别核验；
- 不可控能力必须有手动/离线/只读降级和 kill switch；
- 真实设备或生产等价环境的 spike 证据进入测试/发布记录，不塞入 ADR 正文持续更新。

## 5. 决策索引

“文档状态”在对应文件提交后改为 ADR 的正式 `Status`；`待建立` 只表示索引已预留、不是第五种 ADR 状态。

### 5.1 P0 客户端、本地数据与平台

| ID | ADR | 文档状态 | 最晚接受门 |
| --- | --- | --- | --- |
| TD-001 | [移动客户端技术栈](0001-mobile-client-stack.md) | 待建立 | 创建客户端工程前。 |
| TD-002 | [离线优先客户端架构](0002-offline-first-client-architecture.md) | 待建立 | 首个纵向切片前。 |
| TD-003 | [加密本地数据库](0003-encrypted-local-database.md) | 待建立 | 建立持久层前。 |
| TD-004 | [设备密钥层级与应用锁](0004-device-key-hierarchy-and-app-lock.md) | 待建立 | 保存第一条真实数据前。 |
| TD-005 | [加密附件存储](0005-encrypted-attachment-store.md) | 待建立 | 实现图片/文件前。 |
| TD-006 | [跨端基础标量表示](0006-cross-platform-scalar-representations.md) | 待建立 | 领域 Schema 定稿前。 |
| TD-007 | [时间与重复引擎](0007-time-recurrence-engine.md) | 待建立 | 实现重复事项前。 |
| TD-008 | [加密本地搜索](0008-encrypted-local-search.md) | 待建立 | 建立搜索索引前。 |
| TD-009 | [原生提醒调度](0009-native-reminder-scheduler.md) | 待建立 | 实现通知前。 |
| TD-010 | [SQLite 快照、迁移与原子恢复](0010-sqlite-snapshot-migration-and-atomic-restore.md) | 待建立 | 发布首个迁移/恢复格式前。 |
| TD-011 | [备份容器与密码学](0011-backup-container-and-cryptography.md) | 待建立 | 生成首个可保留备份前。 |
| TD-012 | [HTTP API 与契约版本](0012-http-api-and-contract-versioning.md) | 待建立 | 接入任何生产服务前。 |
| TD-013 | [智能网关与供应商路由](0013-ai-gateway-and-provider-routing.md) | 待建立 | 接入模型前。 |
| TD-014 | [匿名服务访问与防滥用](0014-anonymous-service-access-and-abuse-control.md) | 待建立 | 开放内置智能测试前。 |
| TD-015 | [后端运行时与服务拓扑](0015-backend-runtime-and-service-topology.md) | 待建立 | 创建服务端工程前。 |
| TD-016 | [隐私保护的可观测性](0016-privacy-preserving-observability.md) | 待建立 | 接入日志/崩溃 SDK 前。 |
| TD-017 | [构建、发布与更新边界](0017-build-release-and-update-boundaries.md) | 待建立 | 首次内部分发前。 |

### 5.2 P1 账号、云与同步

| ID | ADR | 文档状态 | 最晚接受门 |
| --- | --- | --- | --- |
| TD-018 | [服务端持久化、Outbox 与对象存储](0018-server-persistence-outbox-and-object-storage.md) | 待建立 | P1 服务端架构冻结前。 |
| TD-019 | [账号认证与设备会话](0019-account-authentication-and-device-sessions.md) | 待建立 | 开始账号实现前。 |
| TD-020 | [增量同步协议](0020-incremental-sync-protocol.md) | 待建立 | 开始同步实现前。 |
| TD-021 | [云附件与云备份传输](0021-cloud-attachment-and-backup-transfer.md) | 待建立 | 开始云文件实现前。 |
| TD-022 | [远程推送路由](0022-remote-push-routing.md) | 待建立 | 开始跨设备提醒前。 |
| TD-023 | [P1/P2 加密边界](0023-p1-p2-encryption-boundary.md) | 待建立；应为 `Deferred` | OQ-006 关闭前不得接受。 |

### 5.3 P2 家庭、成熟智能与 Web

| ID | ADR | 文档状态 | 最晚接受门 |
| --- | --- | --- | --- |
| TD-024 | [家庭授权、审计与高风险串行化](0024-family-authorization-audit-and-high-risk-locks.md) | 待建立 | P2 家庭实现前。 |
| TD-025 | [智能上下文、查询、补丁与视觉输入](0025-ai-context-retrieval-patch-and-vision.md) | 待建立 | P2 智能实现前。 |
| TD-026 | [Web 客户端架构](0026-web-client-architecture.md) | 待建立；可保持 `Proposed` | P2 Web 工程创建前。 |
| TD-027 | [公共模板发布与内容治理](0027-public-template-publication-and-moderation.md) | 待建立 | P2 公共模板实现前。 |

## 6. 阶段依赖图

```text
P0 foundation
TD-001 → TD-002 ─┬→ TD-003 → TD-010 → TD-011
                 ├→ TD-004 → TD-005
                 ├→ TD-006 → TD-007 / TD-008
                 └→ TD-009

P0 online
TD-012 → TD-013 → TD-014
   └────→ TD-015 → TD-016 / TD-017

P1
TD-015 → TD-018 → TD-020 → TD-021 / TD-022
              └→ TD-019 ───────┘
TD-023 gates the final P1/P2 encryption architecture, not P0

P2
TD-020 + TD-023 → TD-024 → TD-025 / TD-026 / TD-027
```

箭头表示“后者需要前者的边界已明确”，不表示实现只能串行。安全规范与威胁模型横跨 TD-003～005、TD-011、TD-014、TD-016、TD-019、TD-023～025。

## 7. 未决事项映射

| OQ | 影响的 ADR | 当前处理 |
| --- | --- | --- |
| OQ-001 首发地区 | TD-013～019、TD-021～022、TD-026～027 | 保持供应商/区域可配置；阻塞生产环境和公开测试，不阻塞本地工程。 |
| OQ-002 运营主体 | TD-016、TD-019、TD-027 | 不虚构主体；阻塞真实账号、遥测和公共内容投产。 |
| OQ-003 团队偏好 | TD-001、TD-015、TD-026 | 按默认栈形成 ADR；工程创建前若有明确能力证据可替代。 |
| OQ-004 提醒承诺 | TD-009、TD-022 | 采用 PD-013 的平台边界，不实现绝对送达。 |
| OQ-005 备份口令找回 | TD-004、TD-011 | P0 不托管、不找回；改变时新建安全 ADR。 |
| OQ-006 E2EE | TD-018、TD-020～025 | TD-023 保持 Deferred；阻塞 P1 架构冻结。 |
| OQ-007 商业/额度 | TD-013～014 | 额度配置与本地能力隔离，不实现计费。 |
| OQ-009 品牌可用性 | TD-017、TD-026 | 技术标识用 `life-book`，展示名保持可替换。 |
| OQ-010 匿名防滥用 | TD-014、TD-016 | 采用随机安装令牌默认；以真实滥用数据重开。 |

## 8. 评审与维护

### ADR-010：变更触发器

出现以下任一情况必须评估新 ADR：

- 更换主要 UI、数据库、同步、认证、备份、加密、时间、通知或服务运行时；
- 公共格式或 API 出现破坏性版本；
- 新供应商改变数据处理或信任边界；
- 质量目标无法在当前选择上达到；
- 新阶段让已有默认失效；
- 安全事件或平台政策证明原假设错误。

普通依赖补丁升级不必新建 ADR，但必须通过依赖、迁移、契约与发布门；主版本升级若改变架构能力或数据格式，需要修订或替代决定。

### ADR-011：索引一致性

新增、接受、推迟或替代 ADR 时，同一变更应更新本索引的链接、正式状态和依赖；如果坚持“一份文档一个提交”，先提交 ADR，再用独立索引提交记录状态。最终发布检查必须确认索引没有缺失/孤立文件，`TD-*` 唯一且与文件序号一致。

## 9. 变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| v1.0 | 2026-07-26 | 建立 ADR 状态、固定结构、接受门、27 项技术决策索引、阶段依赖和未决事项映射。 |

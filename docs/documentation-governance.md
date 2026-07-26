# 生活有谱文档治理规范

> 项目代号：`life-book` · 版本：v1.1 · 更新日期：2026-07-26 · 状态：文档基线
>
> 权威范围：文档类型、唯一职责、状态、版本、稳定编号、权威关系、机器契约登记、变更流程与阶段门
>
> 依赖文档：[产品决策](product-decisions.md)、[产品路线图](roadmap.md)、[ADR 治理与索引](adr/README.md)、[未决事项](open-questions.md)

本文定义项目文档的职责边界、权威关系、状态、版本和变更流程。它不描述具体产品功能；它负责保证同一个概念只有一个权威定义，并使产品、设计、工程、测试和运营能够沿同一条基线协作。

## 1. 治理目标

生活有谱的文档必须同时满足以下要求：

1. **单一事实来源**：一个规则只在一份权威文档中完整定义，其他文档通过链接和规则编号引用。
2. **可以追溯**：页面、数据字段、接口、测试和发布门槛能够追溯到产品决策或功能要求。
3. **明确版本边界**：所有能力都标记为 P0、P1、P2 或待讨论，不把未来设计误当作当前交付范围。
4. **先决策后实现**：影响产品边界、隐私、安全、数据兼容或长期架构的改变，先记录决策再修改规范。
5. **文档与实现同行**：代码、数据库或接口改变了外部行为时，对应文档必须在同一组变更中更新。
6. **冲突必须消除**：权威顺序只用于发现冲突时临时判断，不能以“按高优先级文档为准”为理由长期保留矛盾。

## 2. 规范用语

本文档体系中的关键词具有以下含义：

| 用语 | 含义 |
| --- | --- |
| 必须 / 不得 | 强制要求；不满足即不能验收或发布。 |
| 应当 / 不应 | 默认要求；只有记录了明确理由才可以偏离。 |
| 可以 | 可选能力，不构成交付承诺。 |
| P0 | 首个可用版本，范围以产品路线图为准。 |
| P1 | 首发后的增强版本。 |
| P2 | 建立在账号、同步或成熟数据基础上的扩展版本。 |
| 待讨论 | 尚未形成决策，不允许直接进入实现基线。 |

## 3. 文档状态

普通叙事规范的页首必须声明以下一种状态：

| 状态 | 使用规则 |
| --- | --- |
| 草案 | 可以讨论和试验，不得作为开发承诺。 |
| 待确认 | 内容已完整，但包含需要产品负责人确认的决定。 |
| 文档基线 | 已作为当前实施依据；变更需要执行影响检查。 |
| 持续维护 | 记录型文档，可持续追加条目；既有条目不得静默改写。 |
| 已替代 | 不再生效，必须链接到替代文档或决定。 |

“文档基线”表示当前可以据此设计、开发和测试，不表示内容永久不变。

ADR 不使用上述中文状态，其 `Status` 只允许 `Proposed`、`Accepted`、`Deferred`、`Superseded`，定义、转换和唯一状态索引由 [`docs/adr/README.md`](adr/README.md) 负责。`Accepted` 只表示技术选择已经成立，不表示物理契约、实现验证或生产发布门已经通过。

`specs/` 下的规范性契约使用 `Draft`、`Normative`、`Superseded`：

| 状态 | 使用规则 |
| --- | --- |
| `Draft` | 结构可讨论，不得生成需要长期兼容的生产数据或公共流量。 |
| `Normative` | 实现必须遵守且版本含义不得原地改变；仍需独立通过实现与发布门。 |
| `Superseded` | 保留历史身份和 fixture，明确链接替代版本。 |

机器格式本身无法安全携带状态时，由本规范的机器契约登记表记录。ADR 接受门、契约规范门和生产发布门是三个独立门禁：前者确认选择，第二个确认字段/字节合同唯一且可验证，最后一个确认实现、真机、兼容、安全评审和历史 fixture 已通过；任何一个状态都不能替代另两个门。

## 4. 文档分层与唯一职责

### 4.1 方向与范围层

| 文档 | 唯一负责内容 | 不负责内容 |
| --- | --- | --- |
| `brand-name.md` | 品牌名称、定位、语气和品牌使用规则 | 功能与交互规则 |
| `product-decisions.md` | 已确认产品决策及原因 | 逐字段实现规范 |
| `product-features.md` | 产品能力全景和高层行为 | 数据库、接口和算法细节 |
| `roadmap.md` | P0/P1/P2 范围、排除项和发布门槛 | 详细排期和技术选型 |
| `open-questions.md` | 未决项、默认处理、阻塞阶段和关闭条件 | 用未决项代替应当完成的决定 |
| `product-validation.md` | 用户假设、研究方法和验证结论 | 用研究结论直接覆盖已确认决策 |
| `success-metrics.md` | 产品成功、质量护栏和测量口径 | 业务日志的具体实现 |
| `quality-attributes.md` | 性能、可靠性、兼容性、离线、容量和能耗目标 | 功能范围与具体技术选型 |

### 4.2 体验与内容层

| 文档 | 唯一负责内容 |
| --- | --- |
| `glossary.md` | 用户可见术语和内部领域术语的标准定义 |
| `information-architecture.md` | 导航、页面层级、页面清单和内容归属 |
| `user-flows.md` | 端到端任务流程、分支、失败与恢复路径 |
| `screen-specifications.md` | P0 各页面的组成、操作、状态和响应式规则 |
| `content-design.md` | 界面文案、通知文案、错误与权限说明规则 |
| `accessibility.md` | 无障碍、动态字体、触控、读屏和动效要求 |
| `design-system.md` | 视觉基础、设计令牌、组件状态和响应式使用规范 |

### 4.3 领域与数据层

| 文档 | 唯一负责内容 |
| --- | --- |
| `domain-model.md` | 实体、字段、关系、不变量和生命周期 |
| `business-rules.md` | 非时间类业务行为、状态迁移和跨实体约束 |
| `time-and-recurrence.md` | 日期时间语义、重复算法和边界情况 |
| `reminders-and-notifications.md` | 提醒计划、提醒实例、系统通知状态机和调度规则 |
| `search-and-organization.md` | 搜索、筛选、分类、标签、置顶和归档语义 |
| `data-lifecycle.md` | 本地/临时数据及备份、恢复、导出、导入、删除、迁移的产品范围、用户可见成功/取消、保留与兼容承诺 |
| `account-and-sync.md` | P1 账号、本地认领、设备会话、个人/共享空间共用的增量同步状态机、冲突、附件传输和云备份协作语义 |
| `family-sharing.md` | P2 家庭空间、角色、授权、邀请、共同处理、移除、审计和解散语义；通用同步只引用 `SYNC-*` |

### 4.4 智能能力层

| 文档 | 唯一负责内容 |
| --- | --- |
| `ai-creation-contract.md` | 智能创建请求、统一草稿结构、校验和供应商适配契约 |
| `ai-evaluation.md` | 测试集分类、正确性标准、上线阈值和回归办法 |

### 4.5 工程与安全层

| 文档 | 唯一负责内容 |
| --- | --- |
| `adr/` | 每项技术选择、信任边界、原因、取舍、替代历史和生产启用决策门；不拥有物理字段或 byte layout |
| `system-architecture.md` | 系统边界、技术栈、模块、数据流和阶段演进 |
| `persistence-schema.md` | 领域模型到本地/服务端物理存储的映射、portable SQLCipher DDL/profile/meta/mapper、索引和迁移 |
| `service-contracts.md` | 客户端与服务端接口、错误、幂等、版本和兼容规则 |
| `security-and-privacy.md` | 威胁模型、数据分级、权限、密钥、日志和安全控制 |
| `engineering-standards.md` | 代码组织、配置、迁移、依赖、分支和评审约束 |
| `analytics-and-telemetry.md` | 可采集事件、禁止属性、同意、保留和指标映射 |

### 4.6 交付与运营层

| 文档 | 唯一负责内容 |
| --- | --- |
| `acceptance-spec.md` | 可执行验收场景及需求、规则和质量属性的覆盖关系 |
| `implementation-plan.md` | 里程碑、依赖、纵向切片、用户故事和完成定义 |
| `test-strategy.md` | 测试分层、测试矩阵、质量门槛和缺陷等级 |
| `observability-and-operations.md` | 监控、告警、故障处理、供应商降级和运行手册 |
| `release-operations.md` | 构建、签名、灰度、回滚、数据库迁移和发布检查 |
| `legal-and-compliance.md` | 隐私政策输入、用户协议、权限披露和第三方处理清单 |
| `support-playbook.md` | 用户支持、数据恢复边界、常见问题和升级路径 |

### 4.7 机器契约层

机器可校验或 byte-exact 的契约放在 `specs/` 中。登记表中的“待建立”表示文件当前不存在，不能作为已就绪能力引用：

| 契约 | 格式/版本身份 | 状态 | Owner / 决策来源 | 唯一负责内容与最低校验 |
| --- | --- | --- | --- | --- |
| `specs/ai/record-draft.schema.json` | JSON Schema Draft 2020-12 / Schema v1 | `Normative` | 智能能力 / `AI-*` 与智能 ADR | 智能草稿字段、类型和必填约束；metaschema、正反 fixture 与 adapter contract test。 |
| `specs/api/openapi.yaml` | OpenAPI 3.1 / API v1 | `Draft`（待建立） | 服务端平台 / TD-012 | 网络 API 请求、响应、鉴权和错误结构；lint、mock/consumer/provider contract test。 |
| `specs/backup/container-v1.md` | 规范性协议 Markdown / `1.0.0` | `Normative` | 客户端安全与数据基础设施 / TD-011 | `.lifebook` header offset、整数宽度、registry、密码/AAD 投影、payload framing、长度、EOF 和 parser 状态机；offset/registry checker、golden byte fixture、双平台 conformance。 |
| `specs/backup/manifest.schema.json` | JSON Schema Draft 2020-12 / `manifestSchemaVersion=1` | `Normative` | 客户端安全与数据基础设施 / TD-011 | 认证 manifest 字段树、required、类型、pattern 和 Schema 内条件；metaschema、正反 fixture、与容器跨字段测试。 |
| `specs/backup/fixtures/` | 固定 byte/JSON fixtures / v1 | `Draft`（待建立） | 客户端安全与数据基础设施 / TD-011 | 一致性与历史兼容证据，不产生新规则；由独立实现复算并在双平台 reader/writer 通过。 |
| `specs/telemetry/events.schema.json` | JSON Schema Draft 2020-12 / telemetry v1 | `Draft`（待建立） | 隐私与数据 / TD-016 | 允许采集的事件和属性白名单；metaschema、禁止属性负例、采集端/仓库端 contract test。 |

`docs/**/*.md` 默认解释产品、领域或工程语义；`specs/**/*.md` 允许成为规范性 wire-format 文档，用于标准 Schema 无法表达的 byte offset、endianness、AAD/KDF 投影、hash、framing、EOF、parser 状态机和跨字段算法。规范性协议 Markdown 必须在页首声明 `Status`、`Version`、`Owner`、`Decision source` 和 paired contract；它可以引用 JSON 字段路径作为算法输入，但不得重新定义 JSON 对象结构。

Schema/OpenAPI 是其机器字段的唯一权威；协议 Markdown 是 byte 与跨字段算法的唯一权威；fixture 和测试只证明符合性，不产生规则。Schema 的 `$comment` 或叙事文档可以给出非规范摘要和链接，但不得复制后再独立演进同一运行时不变量。

备份合同尤其按以下边界维护：`data-lifecycle.md` 负责产品范围与承诺；TD-010/TD-011 负责技术选择、信任边界、理由和生产启用门；`container-v1.md` 负责 byte-level 及运行时跨字段不变量；`manifest.schema.json` 负责 JSON 结构约束；`persistence-schema.md` 负责 portable/active 物理 Schema 与 mapper；fixture/test 只提供证据。

## 5. 权威关系

### 5.1 按问题寻找权威文档

遇到问题时，按问题类型查找，而不是在所有文档中选择措辞最具体的一处：

| 问题 | 首要依据 |
| --- | --- |
| 为什么做、为什么不做 | 产品决策记录 |
| 哪一期交付 | 产品路线图 |
| 产品总体能做什么 | 产品功能说明 |
| 一个词具体是什么意思 | 术语表 |
| 用户经过哪些步骤 | 用户流程 |
| 页面如何表现 | 页面规格与内容设计 |
| 数据怎样保存、状态怎样变化 | 领域模型及对应专项规则 |
| 服务如何通信 | 服务契约与 OpenAPI |
| 系统怎样实现 | 技术架构和技术决策记录 |
| 机器字段、byte layout 或 parser 怎样实现 | 对应 `specs/` 契约登记项 |
| 怎样证明实现正确 | 测试策略和对应需求编号 |
| 能否发布 | 产品路线图发布门槛与发布规范 |

### 5.2 冲突处理顺序

发现冲突后必须创建修正文档的任务。在修正完成前按以下顺序临时处理：

1. 最新且状态为“已确认”的产品决策；
2. 当前产品路线图中的阶段边界；
3. 对该主题声明唯一职责的专项规范；
4. 产品功能说明中的高层描述；
5. 用户故事、示例、线框和测试用例等派生材料。

如果高层决策与安全、法律或平台硬性限制冲突，不直接实现任何一方；必须新增决策条目并说明替代方案。

## 6. 稳定编号与追溯

规范中的重要对象使用稳定编号。编号一旦发布不得重新分配；废弃时保留并标记“已替代”。

| 前缀 | 对象 | 唯一分配者 |
| --- | --- | --- |
| `PD-` | 产品决策 | `product-decisions.md` |
| `TD-` | 技术决策 | `adr/`，状态与编号由 `adr/README.md` 登记 |
| `OQ-` | 未决事项 | `open-questions.md` |
| `PR-` | 产品能力要求 | `product-features.md` |
| `JTBD-` | 用户任务与验证假设 | `product-validation.md` |
| `FLOW-` | 用户流程 | `user-flows.md` |
| `SCR-` | 页面或系统界面 | `screen-specifications.md` |
| `CONTENT-` | 内容与文案规则 | `content-design.md` |
| `A11Y-` | 无障碍要求 | `accessibility.md` |
| `DS-` | 设计系统规则 | `design-system.md` |
| `DOM-` | 领域实体、不变量或事务边界 | `domain-model.md` |
| `BR-` | 非时间类业务规则 | `business-rules.md` |
| `REC-` | 时间与重复规则 | `time-and-recurrence.md` |
| `REM-` | 提醒与通知规则 | `reminders-and-notifications.md` |
| `SRCH-` | 搜索与组织规则 | `search-and-organization.md` |
| `DATA-` | 数据生命周期、备份、恢复、导出、导入、删除与迁移规则 | `data-lifecycle.md` |
| `SYNC-` | 账号认领与同步协议规则 | `account-and-sync.md` |
| `FAMILY-` | 家庭角色、授权与协作规则 | `family-sharing.md` |
| `AI-` | 智能创建契约规则 | `ai-creation-contract.md` |
| `AIEVAL-` | 智能评测规则 | `ai-evaluation.md` |
| `QR-` | 质量属性 | `quality-attributes.md` |
| `MET-` | 指标定义 | `success-metrics.md` |
| `ARCH-` | 系统架构约束 | `system-architecture.md` |
| `DB-` | 物理持久化与迁移规则 | `persistence-schema.md` |
| `API-` | 服务接口规则 | `service-contracts.md` |
| `SEC-` | 安全与隐私控制 | `security-and-privacy.md` |
| `ENG-` | 工程标准 | `engineering-standards.md` |
| `TEL-` | 遥测事件与数据治理 | `analytics-and-telemetry.md` |
| `ACPT-` | 可执行验收场景 | `acceptance-spec.md` |
| `IMP-` | 实施里程碑与完成定义 | `implementation-plan.md` |
| `TEST-` | 测试策略与质量门 | `test-strategy.md` |
| `OPS-` | 可观测性与运行操作 | `observability-and-operations.md` |
| `REL-` | 构建、发布、升级与回滚 | `release-operations.md` |
| `LEGAL-` | 法律与合规要求 | `legal-and-compliance.md` |
| `SUP-` | 支持流程与升级规则 | `support-playbook.md` |

其他文档只能引用这些编号，不得创建、重新定义或赋予第二含义。页面规格、接口、数据迁移和测试用例应引用对应规则编号；代码中的测试名称可以包含规则编号，但业务代码不应依赖文档编号运行。新增前缀必须先修改本表，不能在两份文档中临时撞名。

## 7. 文档元数据与版本

每份叙事规范或规范性协议 Markdown 页首至少包含：

```text
项目代号 · 文档版本 · 更新日期 · 状态
权威范围 · 依赖文档
```

ADR 按其固定结构声明元数据；JSON Schema、OpenAPI 等机器文件无法放置上述页首时，版本、状态、owner、决策来源和校验方式必须在第 4.7 节登记，并通过 `$id`、`info.version` 或等价机器字段给出稳定版本身份。

版本使用以下规则：

- `v0.x`：结构或核心决定仍可能明显调整；
- `v1.x`：已达到对应阶段的实施基线，兼容性改变需要迁移说明；
- 文档版本独立于 App 版本，不使用 P0、P1、P2 代替版本号；
- 只改错别字或链接可以增加修订号，改变行为必须增加次版本并写入变更记录。

规范文档底部应保留简短的变更记录。持续追加型的决策记录可以用条目日期代替统一变更表。

## 8. 变更流程

### 8.1 普通澄清

不改变用户行为、数据格式、接口或阶段范围的澄清：

1. 修改拥有该内容的权威文档；
2. 检查所有引用链接和示例；
3. 运行文档一致性检查；
4. 将文档和必要测试更新纳入同一组变更。

### 8.2 产品行为改变

影响用户体验、隐私默认值、阶段边界或商业承诺时：

1. 在产品决策记录中新增或替代一个 `PD-` 条目；
2. 更新产品功能说明和路线图中受影响的摘要；
3. 更新对应体验、领域、测试和发布文档；
4. 明确已有用户和已有数据的迁移方式；
5. 全部文档一致后才能进入开发。

### 8.3 技术或数据兼容性改变

影响技术栈、持久化格式、加密、同步或公共接口时：

1. 在技术决策记录中新增或替代一个 `TD-` 条目；
2. 更新技术架构或专项契约；
3. 给出数据、API 或备份格式迁移方案；
4. 增加向后兼容和回滚测试；
5. 明确最低可升级版本与失败恢复路径。

### 8.4 机器契约改变

影响 JSON Schema、OpenAPI、数据库 portable 格式、二进制容器、遥测白名单或其他机器边界时：

1. 先判断是否改变用户行为、安全边界、公开接口或已发布字节含义；需要时先新增并接受 ADR；
2. 只在登记的唯一 owner 契约中定义新字段/字节规则，并更新显式版本、registry 或 capability；
3. 同步 paired Schema/协议、兼容矩阵、golden/negative fixture 和 conformance test，不以注释复制另一契约的规则；
4. 已发布版本不得原地改变含义，采用新版本或新 registry 值，并明确 old-read/new-write 与停止支持门；
5. JSON Schema 必须通过目标 draft metaschema；OpenAPI 必须 lint；规范性协议 Markdown 必须通过链接、offset、registry、长度公式和 fixture 检查；
6. 同一主题可以遵守“一份文档一个提交”分别落地，但只有全部 paired contract 一致且证据齐备后，才可把该主题标为开发或发布基线。

## 9. 一致性检查清单

每次改变规范行为时至少检查：

- 规则是否只在登记的唯一 owner 中定义，其他位置是否只作摘要/引用；
- 名称是否与术语表一致；
- P0/P1/P2 是否与路线图一致；
- 页面入口是否存在于信息架构；
- 页面操作是否在用户流程中有成功、取消和失败路径；
- 页面字段是否能映射到领域模型；
- 日期、重复和提醒是否引用统一规则；
- 数据是否有创建、编辑、归档、删除、恢复和迁移定义；
- 智能创建是否只生成领域模型允许的草稿；
- 接口是否有鉴权、幂等、错误和版本策略；
- 机器契约的字段、byte 算法、版本/registry、fixture 和 reader/writer 是否成套更新；
- 敏感数据是否满足安全与隐私控制；
- 测试是否覆盖新增规则和回归风险；
- 发布、支持和合规材料是否需要同步更新。

## 10. 阶段完成条件

### 10.1 可以开始交互设计

- 产品决策、产品功能说明和路线图没有未解释冲突；
- 术语、信息架构和核心用户流程已形成文档基线；
- 核心流程中的异常与权限拒绝路径已经定义。

### 10.2 可以开始功能开发

- P0 页面规格、领域模型、业务规则和专项规范已形成文档基线；
- 所需 ADR 已 `Accepted`，技术架构、安全模型、接口契约和工程规范已形成基线；
- 当前纵向切片依赖的机器契约已 `Normative`，paired contract、fixture 与本地校验命令已登记且无冲突；
- 每个开发项有验收条件并能追溯到规则编号；
- 尚未确定事项均不阻塞当前里程碑，或已经记录默认处理方式。

### 10.3 可以开始公开测试

- 端到端、平台兼容、离线、备份恢复和安全测试达到门槛；
- 所有生产格式/API 的历史 fixture、consumer/provider 或双平台 conformance 已通过，且没有把 ADR/契约状态误当作测试证据；
- 监控、故障降级、发布回滚和支持流程可用；
- 隐私政策、权限说明和第三方数据处理清单与实现一致；
- 数据格式和迁移路径经过真实升级验证。

## 11. 文档提交规则

- 当前文档基线建设期，每个 Git 提交只新增或修改一份文档/机器契约文件，使目的、责任 owner 和评审范围清楚；
- 同一提交不混入代码、第二份文档或第二个契约文件；生成型 fixture/资产按其专项规范登记后单独提交；
- 跨文档一致性修正按文档分别提交，并在提交说明中使用相同主题；
- 不通过复制整段权威规则解决可读性问题，优先提供摘要、编号和链接；
- 合并或删除文档时保留重定向说明，避免历史链接失效。

## 12. 变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| v1.1 | 2026-07-26 | 增加 ADR/规范/发布三层门禁、规范性协议 Markdown、机器契约登记与变更流程、备份合同权威边界，收口账号/同步/家庭 ownership，并补全稳定编号 owner。 |
| v1.0 | 2026-07-26 | 建立文档分层、权威关系、稳定编号、变更流程和阶段完成条件。 |

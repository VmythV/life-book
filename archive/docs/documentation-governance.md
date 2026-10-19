# 生活有谱文档治理规范

> 项目代号：`life-book` · 版本：v1.3 · 更新日期：2026-07-27 · 状态：文档基线
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

核心治理不变量使用稳定编号：

| 编号 | 不变量 |
| --- | --- |
| GOV-001 | 同一基线中的同一运行语义只有一个 `ACTIVE` owner；非权威候选、摘要、示例和测试不得产生第二个活动定义。 |
| GOV-002 | 存在性、文档/合同状态、evidence 和阶段 Gate 是四个独立事实，适用时必须分列登记，不得互相推导；不适用必须显式记为 `—` 或 `NOT_REQUIRED`。 |
| GOV-003 | ADR `Accepted`、机器合同 `Normative`、实现验证通过和生产发布通过是四道独立门。 |
| GOV-004 | 治理 registry 只记已由仓库证据证明的当前事实；缺失文件的状态是 `—`，不得预写成“草案”或 `Draft`。 |
| GOV-005 | 跨文档改动可以按一文件一提交展开，但只有整个 change train 完成且复核后才能宣称新基线或 Gate 通过。 |
| GOV-006 | “文档已写完”不等于“功能可发布”；未决项可以用安全默认隔离未来阶段，但不得越过明示阻塞门。 |
| GOV-007 | 每个 registry snapshot ID 只锚定一次 Git 审计提交且永不复用；注册路径在锚点后变化或工作树未清洁时快照自动 `STALE`，不得沿用其 `PASS`。 |

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

机器格式本身无法安全携带状态时，由本规范的机器契约登记表记录。ADR 接受门、契约规范门、实现/evidence 门和生产发布门是四个独立门禁：它们分别确认技术选择、字段/字节合同的唯一与稳定、实现符合性，以及真机/兼容/安全/运营发布证据；任何一个状态都不能替代其他门。

### 3.1 Registry 维度

登记表使用下列受控值，它们不是新的文档状态：

| 维度 | 受控值 | 解释 |
| --- | --- | --- |
| `Exists` | `PRESENT \| MISSING` | 只由该 registry 声明的 snapshot anchor Git tree 是否有该路径决定。 |
| `Status check` | `VALID \| INVALID \| —` | `VALID` 表示页首精确使用本节状态；`INVALID` 表示自造状态；缺文件为 `—`。 |
| `Evidence` | `VERIFIED \| PARTIAL \| MISSING \| NOT_REQUIRED` | 只表示该行明确声明的 evidence class 是否存在且通过；contract oracle 与 implementation conformance 必须分表，不得互相代替。 |
| `Gate` | `PASS \| BLOCKED \| NOT_APPLICABLE` | 只对该行声明的阶段门有效；不代表其他文档或生产门。 |
| `Authority` | `ACTIVE \| CANDIDATE \| RETIRED \| —` | `ACTIVE` 才拥有当前运行语义；`CANDIDATE` 可与旧 owner 暂时重复但不生效；缺文件为 `—`。 |

页首声明非法时，registry 必须保留 raw status 并标记 `INVALID`；治理表不能替代原文修改。缺失文件可以登记 planned initial status，但当前状态仍为 `—`、`Exists=MISSING`、`Gate=BLOCKED`。Contract oracle 是供实现者复现预期结果的固定输入、golden bytes 与负例；implementation conformance 是某个实现版本实际运行 oracle 的可追溯结果，二者必须有不同路径和状态。

## 4. 文档分层与唯一职责

### 4.1 方向与范围层

| 文档 | 唯一负责内容 | 不负责内容 |
| --- | --- | --- |
| `documentation-governance.md` | 本登记表、状态/版本/权威规则、一致性门和变更流程 | 任何具体产品或技术规则 |
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
| `adr/README.md` | ADR 编号、状态、固定结构、接受/替代流程与唯一 TD 索引 |
| `system-architecture.md` | 系统上下文、逻辑部署拓扑、模块职责/依赖方向、数据流、任务边界和阶段演进；技术选择只引用 ADR |
| `persistence-schema.md` | 领域模型到本地/服务端物理存储的映射、portable SQLCipher DDL/profile/meta/mapper、索引和迁移 |
| `service-contracts.md` | 客户端与服务端接口、错误、幂等、版本和兼容规则 |
| `security-and-privacy.md` | 威胁模型、数据分级、权限、密钥、日志和安全控制 |
| `engineering-standards.md` | 代码组织、配置、迁移、依赖、分支和评审约束 |
| `analytics-and-telemetry.md` | 可采集事件、禁止属性、同意、保留和指标映射 |
| `third-party-services.md` | 实际第三方服务、route、数据类别、地区、训练/留存/删除、合同、子处理者和启用资格登记 |

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

### 4.7 文档存在性与准入 Registry

本节是 `GOV-REGISTRY-2026-07-27-02` 的事实快照，覆盖 30 份 `docs/` 根目录文档、1 份 ADR 索引和本规范已登记但尚缺失的 10 份文档，共 41 项。快照锚点是**首次提交该 snapshot ID 时修改本文件的 Git 提交**；提交后用 `git log --format=%H --fixed-strings --grep='Registry-Snapshot: GOV-REGISTRY-2026-07-27-02' -1` 解析其不可变 SHA，避免在文件内写入会改变自身提交 SHA 的循环引用。提交信息必须带唯一 trailer `Registry-Snapshot: GOV-REGISTRY-2026-07-27-02`；以后任何修改本文件都必须完整重审 registry、分配未使用的新 snapshot ID 和新 trailer，绝不让旧 ID 自动漂移到另一 SHA。只要登记范围内工作树不清洁，或锚点后任一登记路径发生变化，快照即为 `STALE`，所有由它推导的 `PASS` 暂停生效，直到重审本节并以新快照提交。“文档 Gate”只表示该文件能否计入声明的 Gate scope；不替代其引用的 OQ、ADR、机器合同或实现证据门。

#### 4.7.1 治理、方向与范围

| 文件 | Exists | 页首 raw status | Status check | Evidence | 目标合法状态 | Gate scope | 文档 Gate | 依赖、安全默认与后继门 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [documentation-governance.md](documentation-governance.md) | `PRESENT` | 文档基线 | `VALID` | `NOT_REQUIRED` | 文档基线 | 全阶段文档治理 | `PASS` | 本文定义门；各阶段仍继承对应专项门。 |
| [adr/README.md](adr/README.md) | `PRESENT` | 持续维护 | `VALID` | `NOT_REQUIRED` | 持续维护 | 全阶段技术决策治理 | `PASS` | TD-001～011 为 `Accepted`，TD-012/013 为 `Proposed`，TD-014～028 保持 `MISSING`；索引与正文一致。 |
| [brand-name.md](brand-name.md) | `PRESENT` | 产品命名基线；商标与渠道可用性待外部核验 | `INVALID` | `NOT_REQUIRED` | 待确认 | P0 公开品牌 | `BLOCKED` | 内部产品设计沿用 OQ-009 默认且不阻塞；商店提交/公开投放被 OQ-009 阻塞。 |
| [product-decisions.md](product-decisions.md) | `PRESENT` | 持续维护 | `VALID` | `NOT_REQUIRED` | 持续维护 | 全阶段产品决策治理 | `PASS` | 产品型 OQ 的关闭证据 owner；各能力仍继承其专项门。 |
| [product-features.md](product-features.md) | `PRESENT` | 文档基线 | `VALID` | `NOT_REQUIRED` | 文档基线 | 全阶段需求 | `PASS` | 实现切片仍继承路线图和相应 ADR/合同门。 |
| [roadmap.md](roadmap.md) | `PRESENT` | 文档基线 | `VALID` | `NOT_REQUIRED` | 文档基线 | 全阶段范围 | `PASS` | 已按本地、在线、同步、农历和 P2 分切片声明门；OQ-008 只阻塞日期。 |
| [open-questions.md](open-questions.md) | `PRESENT` | 持续维护 | `VALID` | `NOT_REQUIRED` | 持续维护 | 全阶段未决治理 | `PASS` | 已关闭项有 owner/证据，开放项有安全默认和阻塞阶段；不替代专项关闭证据。 |
| [product-validation.md](product-validation.md) | `PRESENT` | 文档基线 | `VALID` | `NOT_REQUIRED` | 文档基线 | P0 发现 | `PASS` | OQ-008 只阻塞日历承诺，不阻塞依赖里程碑。 |
| [success-metrics.md](success-metrics.md) | `PRESENT` | 指标基线 | `INVALID` | `NOT_REQUIRED` | 文档基线 | P0 测量设计 | `BLOCKED` | 真实采集继承 TD-016、用户同意与法律门；OQ-001/002 只阻塞公开真实数据。 |
| [quality-attributes.md](quality-attributes.md) | `PRESENT` | 文档基线 | `VALID` | `NOT_REQUIRED` | 文档基线 | 全阶段质量目标 | `PASS` | 作为 ADR、测试和发布门输入；叙事 PASS 不替代实现 evidence。 |

#### 4.7.2 体验与内容

| 文件 | Exists | 页首 raw status | Status check | Evidence | 目标合法状态 | Gate scope | 文档 Gate | 依赖、安全默认与后继门 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [glossary.md](glossary.md) | `PRESENT` | 文档基线 | `VALID` | `NOT_REQUIRED` | 文档基线 | P0 术语 | `PASS` | OQ-009 只影响最终对外品牌词。 |
| [information-architecture.md](information-architecture.md) | `PRESENT` | 体验结构基线 | `INVALID` | `NOT_REQUIRED` | 文档基线 | P0 信息架构 | `BLOCKED` | P1/P2 页面继承对应能力门，不反向阻塞 P0。 |
| [user-flows.md](user-flows.md) | `PRESENT` | 体验流程基线 | `INVALID` | `NOT_REQUIRED` | 文档基线 | P0 核心流程 | `BLOCKED` | 在线 AI、同步和家庭分支分别继承专项门。 |
| [screen-specifications.md](screen-specifications.md) | `PRESENT` | 体验实现基线 | `INVALID` | `NOT_REQUIRED` | 文档基线 | P0 UI | `BLOCKED` | 本地切片继承 TD-001～011；在线/P1/P2 页面另继承对应门。 |
| [content-design.md](content-design.md) | `PRESENT` | 产品文案基线 | `INVALID` | `NOT_REQUIRED` | 文档基线 | P0 内容 | `BLOCKED` | 内部交互不被开放 OQ 阻塞；公开披露继承 OQ-001/002/009。 |
| [accessibility.md](accessibility.md) | `PRESENT` | 实施基线 | `INVALID` | `NOT_REQUIRED` | 文档基线 | P0 UI | `BLOCKED` | 实现证据继承 TD-001，内部分发检查继承 TD-017。 |
| [design-system.md](design-system.md) | `PRESENT` | 实施基线 | `INVALID` | `NOT_REQUIRED` | 文档基线 | P0 UI | `BLOCKED` | 平台实现继承 TD-001；公开品牌继承 OQ-009。 |

#### 4.7.3 领域、数据与智能

| 文件 | Exists | 页首 raw status | Status check | Evidence | 目标合法状态 | Gate scope | 文档 Gate | 依赖、安全默认与后继门 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [domain-model.md](domain-model.md) | `PRESENT` | 文档基线 | `VALID` | `NOT_REQUIRED` | 文档基线 | P0 本地域 | `PASS` | P1 同步映射继承 OQ-006、TD-020/022/023，不反向阻塞 P0。 |
| [business-rules.md](business-rules.md) | `PRESENT` | 业务规则基线 | `INVALID` | `NOT_REQUIRED` | 文档基线 | P0 本地规则 | `BLOCKED` | 同步/家庭规则继承 OQ-006、TD-020/024。 |
| [time-and-recurrence.md](time-and-recurrence.md) | `PRESENT` | 文档基线 | `VALID` | `NOT_REQUIRED` | 文档基线 | P0 公历与重复、P1 农历产品规则 | `PASS` | P0 继承 TD-006/007 与合同/oracle；农历继承 PD-018、TD-028 与独立转换合同/oracle。 |
| [reminders-and-notifications.md](reminders-and-notifications.md) | `PRESENT` | 文档基线 | `VALID` | `NOT_REQUIRED` | 文档基线 | P0 本地提醒 | `PASS` | P0 继承 TD-004/006/007/009/010；P1 远程能力继承 OQ-006、TD-020/022/023。 |
| [search-and-organization.md](search-and-organization.md) | `PRESENT` | 搜索基线 | `INVALID` | `NOT_REQUIRED` | 文档基线 | P0 本地搜索 | `BLOCKED` | P0 继承 TD-006/008；P1 服务端搜索继承 OQ-006、TD-020/023。 |
| [data-lifecycle.md](data-lifecycle.md) | `PRESENT` | 文档基线 | `VALID` | `NOT_REQUIRED` | 文档基线 | P0 本地数据 | `PASS` | P0 继承 TD-004/005/006/009/010/011；P1 云生命周期继承 OQ-006、TD-018/020/021/023。 |
| [account-and-sync.md](account-and-sync.md) | `PRESENT` | 待确认 | `VALID` | `NOT_REQUIRED` | 待确认 | P1 账号与同步 | `BLOCKED` | 合法但非基线；P1 继承 OQ-006、TD-015/018～023，P0 只使用关闭的扩展缝。 |
| [family-sharing.md](family-sharing.md) | `PRESENT` | P2 家庭首期实施基线 | `INVALID` | `NOT_REQUIRED` | 待确认 | P2 家庭首期 | `BLOCKED` | P2 继承 OQ-006 与 TD-019/020/022/023/024。 |
| [ai-creation-contract.md](ai-creation-contract.md) | `PRESENT` | 智能能力基线 | `INVALID` | `NOT_REQUIRED` | 待确认 | P0 在线 AI | `BLOCKED` | TD-012～017；OQ-001/002 阻塞生产/公开真实数据，OQ-007 只阻塞商业化，OQ-010 使用非阻塞默认；OQ-108/109 待安全关闭证据。 |
| [ai-evaluation.md](ai-evaluation.md) | `PRESENT` | 智能发布门槛 | `INVALID` | `NOT_REQUIRED` | 文档基线 | P0 AI 发布 | `BLOCKED` | TD-013/014/016/017；OQ-001/002 只阻塞生产与公开真实数据。 |

#### 4.7.4 工程与安全

| 文件 | Exists | 当前状态 | Status check | Evidence | 目标合法状态 | Gate scope | 文档 Gate | 依赖、安全默认与后继门 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [system-architecture.md](system-architecture.md) | `PRESENT` | 文档基线 | `VALID` | `NOT_REQUIRED` | 文档基线 | 永久工程骨架架构 | `PASS` | 只激活无长期数据的客户端骨架；本地正式 adapter 继承 TD-001～011/合同门，在线/P1/P2 保持关闭。 |
| `persistence-schema.md` | `MISSING` | `—` | `—` | `NOT_REQUIRED` | 草案 → 文档基线 | P0 首个持久化切片 | `BLOCKED` | P0 继承 TD-002～006/008/010/011；P1 服务端映射再继承 OQ-006、TD-018/020/023。 |
| `service-contracts.md` | `MISSING` | `—` | `—` | `NOT_REQUIRED` | 草案 → 待确认 → 文档基线 | P0 在线 AI | `BLOCKED` | P0 继承 TD-012～016，OQ-010 使用非阻塞默认；OQ-001/002 阻塞生产/公开真实数据；P1 再继承 OQ-006、TD-019～023。 |
| `security-and-privacy.md` | `MISSING` | `—` | `—` | `NOT_REQUIRED` | 草案 → 文档基线 | P0 首个真实数据/在线安全 | `BLOCKED` | P0 本地继承 TD-003～005/011；在线再继承 TD-014/016 和第三方核验；P1/P2 继承 OQ-006 及对应 ADR。 |
| [engineering-standards.md](engineering-standards.md) | `PRESENT` | 文档基线 | `VALID` | `NOT_REQUIRED` | 文档基线 | P0 客户端永久骨架 | `PASS` | 客户端继承 TD-001/002/006/007；服务端 runtime 等 TD-015，内部分发/OTA 等 TD-017。 |
| `analytics-and-telemetry.md` | `MISSING` | `—` | `—` | `NOT_REQUIRED` | 草案 → 待确认 → 文档基线 | 接入任何遥测 SDK | `BLOCKED` | 继承 TD-016；在此之前 scaffold 不注册 exporter，OQ-001/002 阻塞公开真实数据。 |
| `third-party-services.md` | `MISSING` | `—` | `—` | `NOT_REQUIRED` | 草案 → 待确认 → 文档基线 | 启用任何真实第三方 route | `BLOCKED` | 逐 route 核验地区、用途、训练/留存/删除、合同和子处理者；TD-013 明确依赖，合成 fake 不需要真实 route。 |

#### 4.7.5 交付与运营

| 文件 | Exists | 当前状态 | Status check | Evidence | 目标合法状态 | Gate scope | 文档 Gate | 依赖、安全默认与后继门 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `acceptance-spec.md` | `MISSING` | `—` | `—` | `NOT_REQUIRED` | 草案 → 文档基线 | P0 首个正式纵向切片 | `BLOCKED` | 永久骨架用 ARCH/ENG/IMP/TEST 结果验收；产品场景仍须由本文件补齐并继承专项门。 |
| [implementation-plan.md](implementation-plan.md) | `PRESENT` | 文档基线 | `VALID` | `NOT_REQUIRED` | 文档基线 | 无日期实施顺序/M0 骨架 | `PASS` | OQ-008 只阻塞日历日期；M1～M7 分别继承其叙事、合同和发布门。 |
| [test-strategy.md](test-strategy.md) | `PRESENT` | 文档基线 | `VALID` | `NOT_REQUIRED` | 文档基线 | M0 骨架与测试治理 | `PASS` | M0 不要求尚不存在的 implementation evidence；正式切片仍继承合同/oracle/验收门。 |
| `observability-and-operations.md` | `MISSING` | `—` | `—` | `NOT_REQUIRED` | 草案 → 待确认 → 文档基线 | P0 在线共享环境 | `BLOCKED` | TD-012～016；合成客户端骨架不接 collector，OQ-001/002 阻塞生产/公开真实数据。 |
| `release-operations.md` | `MISSING` | `—` | `—` | `NOT_REQUIRED` | 草案 → 待确认 → 文档基线 | P0 首次内部分发 | `BLOCKED` | 内部分发继承 TD-017；OQ-008 只影响日期，OQ-001/002/009 只阻塞对应公开/生产范围。 |
| `legal-and-compliance.md` | `MISSING` | `—` | `—` | `NOT_REQUIRED` | 草案 → 待确认 → 文档基线 | P0 公开测试 | `BLOCKED` | OQ-001/002/009 与届时真实供应商、处理者和运营主体；本地合成骨架不对外。 |
| `support-playbook.md` | `MISSING` | `—` | `—` | `NOT_REQUIRED` | 草案 → 待确认 → 文档基线 | P0 公开测试 | `BLOCKED` | 部署版本继承 TD-017；主体/联系方式继承 OQ-002。 |

快照汇总：`PRESENT=31`、`MISSING=10`；已存在文件中 `VALID=18`、`INVALID=13`。17 个合法基线/持续维护文档的相应文档 Gate 为 `PASS`，合法但为“待确认”的账号/同步文档仍为 `BLOCKED`。本快照只确认“永久工程骨架”可以开始；P0 正式本地切片、在线、内部分发和公开发布仍分别被上表及第 4.8 节缺件阻塞，不能宣称“全部开发文档就绪”。

### 4.8 机器契约层

机器可校验或 byte-exact 的合同放在 `specs/` 中。合同、contract oracle、某个实现的 conformance 结果和生产发布证据分别登记；fixture 不是 paired contract，也不拥有运行语义。本节与第 4.7 节使用同一快照锚点。

#### 4.8.1 Contract Readiness Registry

“Contract Gate”只回答实现者能否据此开始对应切片；它要求主合同、paired contract、稳定身份和 oracle 齐备，不要求尚未产生的实现 conformance。当前 20 个产品主合同中只有 3 个存在且为 `Normative`，但它们也因 metadata、pair 或 oracle 缺口而保持 `BLOCKED`。

| 合同路径 | 稳定身份 | Contract status | Exists | Authority | Paired contract（精确路径或 `NONE`） | Oracle manifest | Gate scope | Contract Gate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `specs/scalars/v1.md` | `scalarEncodingVersion=1` | `—` | `MISSING` | `—` | `NONE` | `specs/scalars/fixtures/v1/manifest.json` | P0 首个物理 Schema | `BLOCKED` |
| `specs/security/installation-anchor-v1.md` | `envelopeFormatVersion=1`；presence/bootstrap v1 | `—` | `MISSING` | `—` | `specs/security/installation-anchor-v1.schema.json` | `specs/security/fixtures/v1/manifest.json` | 保存第一条真实数据 | `BLOCKED` |
| `specs/security/installation-anchor-v1.schema.json` | Draft 2020-12；anchor records v1 | `—` | `MISSING` | `—` | `specs/security/installation-anchor-v1.md` | `specs/security/fixtures/v1/manifest.json` | 保存第一条真实数据 | `BLOCKED` |
| `specs/security/device-key-envelope-v1.md` | `deviceKeyEnvelopeFormatVersion=1` | `—` | `MISSING` | `—` | `specs/security/device-key-envelope-v1.schema.json` | `specs/security/fixtures/v1/manifest.json` | P0 密钥基础 | `BLOCKED` |
| `specs/security/device-key-envelope-v1.schema.json` | Draft 2020-12；device-key envelope v1 | `—` | `MISSING` | `—` | `specs/security/device-key-envelope-v1.md` | `specs/security/fixtures/v1/manifest.json` | P0 密钥基础 | `BLOCKED` |
| `specs/persistence/active-v1.sql` | `databaseSchemaVersion=1` | `—` | `MISSING` | `—` | `specs/persistence/portable-v1.sql`, `specs/persistence/sqlcipher-profiles-v1.md`, `specs/persistence/migration-manifest.schema.json` | `specs/persistence/fixtures/v1/manifest.json` | P0 持久层 | `BLOCKED` |
| `specs/persistence/portable-v1.sql` | `portableDataSchemaVersion=1` | `—` | `MISSING` | `—` | `specs/persistence/active-v1.sql`, `specs/persistence/sqlcipher-profiles-v1.md`, `specs/backup/manifest.schema.json` | `specs/persistence/fixtures/v1/manifest.json` | P0 备份/恢复 | `BLOCKED` |
| `specs/persistence/sqlcipher-profiles-v1.md` | profile registry v1；active 与 `sqlcipher_portable_v1` 分项 | `—` | `MISSING` | `—` | `specs/persistence/active-v1.sql`, `specs/persistence/portable-v1.sql`, `specs/backup/container-v1.md` | `specs/persistence/fixtures/v1/manifest.json` | P0 本地 DB/备份 | `BLOCKED` |
| `specs/persistence/dataset-control-v1.md` | `datasetControlFormatVersion=1` | `—` | `MISSING` | `—` | `specs/persistence/dataset-control-v1.schema.json`, `specs/persistence/migration-manifest.schema.json` | `specs/persistence/fixtures/v1/manifest.json` | P0 启动/迁移/恢复/clear | `BLOCKED` |
| `specs/persistence/dataset-control-v1.schema.json` | Draft 2020-12；DatasetControl v1 | `—` | `MISSING` | `—` | `specs/persistence/dataset-control-v1.md` | `specs/persistence/fixtures/v1/manifest.json` | P0 数据集激活 | `BLOCKED` |
| `specs/persistence/migration-manifest.schema.json` | Draft 2020-12；`migrationManifestVersion=1` | `—` | `MISSING` | `—` | `specs/persistence/active-v1.sql`, `specs/persistence/portable-v1.sql`, `specs/persistence/dataset-control-v1.md` | `specs/persistence/fixtures/v1/manifest.json` | 首个真实 Schema/升级 | `BLOCKED` |
| `specs/attachments/private-container-v1.md` | `privateFormatVersion=1` | `—` | `MISSING` | `—` | `NONE` | `specs/attachments/fixtures/v1/manifest.json` | P0 附件 | `BLOCKED` |
| `specs/time/tzdb-manifest.schema.json` | Draft 2020-12；tzdb manifest v1；首发数据 2026c | `—` | `MISSING` | `—` | `NONE` | `specs/time/fixtures/v1/manifest.json` | P0 重复/提醒 | `BLOCKED` |
| `specs/notifications/local-contract-v3.md` | request/payload/ActionInbox v3；schedule/privacy/input/Decision/initialization v2；capability/registered-pair/category/action/dedup-domain v1 | `—` | `MISSING` | `—` | `specs/notifications/payload-v3.schema.json` | `specs/notifications/fixtures/v3/manifest.json` | P0 本地提醒 | `BLOCKED` |
| `specs/notifications/payload-v3.schema.json` | Draft 2020-12；payload/request identity v3 | `—` | `MISSING` | `—` | `specs/notifications/local-contract-v3.md` | `specs/notifications/fixtures/v3/manifest.json` | P0 调度/动作 | `BLOCKED` |
| [specs/ai/record-draft.schema.json](../specs/ai/record-draft.schema.json) | Draft 2020-12；`contractVersion="1.0"` | `Normative` | `PRESENT` | `ACTIVE` | `specs/api/openapi.yaml` | `specs/ai/fixtures/v1/manifest.json` | P0 AI adapter | `BLOCKED` |
| [specs/backup/container-v1.md](../specs/backup/container-v1.md) | `containerFormatVersion=1`；`headerVersion=1`；`suiteId=1`；`passphraseProfileId=1`；`kdfProfileId=1` | `Normative` | `PRESENT` | `ACTIVE` | `specs/backup/manifest.schema.json`, `specs/persistence/portable-v1.sql`, `specs/persistence/sqlcipher-profiles-v1.md` | `specs/backup/fixtures/v1/manifest.json` | 首个可长期保留备份 | `BLOCKED` |
| [specs/backup/manifest.schema.json](../specs/backup/manifest.schema.json) | Draft 2020-12；`manifestSchemaVersion=1` | `Normative` | `PRESENT` | `ACTIVE` | `specs/backup/container-v1.md`, `specs/persistence/portable-v1.sql` | `specs/backup/fixtures/v1/manifest.json` | 首个可长期保留备份 | `BLOCKED` |
| `specs/api/openapi.yaml` | OpenAPI 3.1.2；API v1 | `—` | `MISSING` | `—` | `specs/ai/record-draft.schema.json` | `specs/api/fixtures/v1/manifest.json` | P0 在线 AI/任何生产服务 | `BLOCKED` |
| `specs/telemetry/events.schema.json` | Draft 2020-12；telemetry schema v1 | `—` | `MISSING` | `—` | `NONE` | `specs/telemetry/fixtures/v1/manifest.json` | 接入任何遥测 SDK | `BLOCKED` |

#### 4.8.2 治理基础设施 Registry

下列文件定义 oracle 与 evidence 索引自身，不计入 20 个产品主合同或 11 个产品 oracle。它们仍遵守独立状态、存在性、Authority、Evidence 和 Gate 维度。

| 路径 | Kind / 稳定身份 | Contract status | Exists | Authority | Evidence | Accountable owner / source | Gate scope | Gate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `specs/testing/oracle-manifest-v1.schema.json` | Contract / `oracleManifestVersion=1` | `—` | `MISSING` | `—` | `MISSING` | 测试与发布工程 / GOV-003/062 | 首个 contract oracle | `BLOCKED` |
| `specs/testing/conformance-index-v1.schema.json` | Contract / `conformanceIndexVersion=1` | `—` | `MISSING` | `—` | `MISSING` | 测试与发布工程 / GOV-003/062 | 首个实现 evidence | `BLOCKED` |
| `specs/testing/release-evidence-index-v1.schema.json` | Contract / `releaseEvidenceIndexVersion=1` | `—` | `MISSING` | `—` | `MISSING` | 发布与运营 / GOV-003/062 | 首个发布候选 | `BLOCKED` |
| `specs/testing/fixtures/v1/manifest.json` | Oracle / testing schemas v1 | `—` | `MISSING` | `—` | `MISSING` | 测试与发布工程 / `test-strategy.md` | 治理基础设施 oracle | `BLOCKED` |

#### 4.8.3 所有权与 Authority 迁移

`Accountable owner` 是评审责任角色，`Decision source` 解释为什么选择，`Semantic owner` 解释产品/领域含义。下表逐个映射第 4.8.1 节合同；`Source Authority` 与 `Target Authority` 是可在最终激活提交中机械更新的当前事实。ADR 的某个机器细节分区变为 `RETIRED` 不改变 ADR 自身的 `Accepted` 状态。

| Target contract path | Accountable owner | Decision source | Semantic owner | Source authority path | Source Authority | Target Authority | 激活/退休条件 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `specs/scalars/v1.md` | 跨平台数据契约 | TD-006 | `docs/domain-model.md` 与各专项规则 | `docs/adr/0006-cross-platform-scalar-representations.md` | `ACTIVE` | `—` | target `Normative` + oracle `VERIFIED` 后，源的编码细节分区转 `RETIRED`。 |
| `specs/security/installation-anchor-v1.md` | 客户端安全与数据基础设施 | TD-004 | `docs/security-and-privacy.md` | `docs/adr/0004-device-key-hierarchy-and-app-lock.md` | `ACTIVE` | `—` | paired Schema/oracle 通过后，源的 envelope/AAD/slot 细节分区转 `RETIRED`。 |
| `specs/security/installation-anchor-v1.schema.json` | 客户端安全与数据基础设施 | TD-004 | `docs/security-and-privacy.md` | `docs/adr/0004-device-key-hierarchy-and-app-lock.md` | `ACTIVE` | `—` | 已决定的 JCS 字段结构转入 Schema；源只保留选择与理由。 |
| `specs/security/device-key-envelope-v1.md` | 客户端安全与数据基础设施 | TD-004 | `docs/security-and-privacy.md` | `docs/adr/0004-device-key-hierarchy-and-app-lock.md` | `ACTIVE` | `—` | target/oracle 通过后，源的 envelope/AAD/原子写细节分区转 `RETIRED`。 |
| `specs/security/device-key-envelope-v1.schema.json` | 客户端安全与数据基础设施 | TD-004 | `docs/security-and-privacy.md` | `docs/adr/0004-device-key-hierarchy-and-app-lock.md` | `ACTIVE` | `—` | 仅为 JCS 候选；TD-004 明确编码后才能激活，若选择非 JSON 则在新 snapshot 移除此 target。 |
| `specs/persistence/active-v1.sql` | 客户端数据基础设施 | TD-003/010 | `docs/persistence-schema.md` | `NONE` | `—` | `—` | 这是新的精确 DDL authority；Schema/profile/oracle 全套通过后激活。 |
| `specs/persistence/portable-v1.sql` | 客户端数据基础设施 | TD-010/011 | `docs/persistence-schema.md` | `NONE` | `—` | `—` | 这是新的 portable DDL authority；backup pair/oracle 全套通过后激活。 |
| `specs/persistence/sqlcipher-profiles-v1.md` | 客户端数据基础设施 | TD-003/010/011 | `docs/persistence-schema.md` | `docs/adr/0003-encrypted-local-database.md`, `docs/adr/0010-sqlite-snapshot-migration-and-atomic-restore.md`, `specs/backup/container-v1.md` | `ACTIVE` | `—` | 各源只退休其 profile registry 分区；技术选择与 container byte 规则保留。 |
| `specs/persistence/dataset-control-v1.md` | 客户端数据基础设施 | TD-004/010 | `docs/persistence-schema.md` | `docs/adr/0010-sqlite-snapshot-migration-and-atomic-restore.md` | `ACTIVE` | `—` | target/oracle 通过后，源的 control/slot/CAS 细节分区转 `RETIRED`。 |
| `specs/persistence/dataset-control-v1.schema.json` | 客户端数据基础设施 | TD-010 | `docs/persistence-schema.md` | `docs/adr/0010-sqlite-snapshot-migration-and-atomic-restore.md` | `ACTIVE` | `—` | 仅为 JCS 候选；TD-010 明确编码后才能激活，若选择非 JSON 则在新 snapshot 移除此 target。 |
| `specs/persistence/migration-manifest.schema.json` | 客户端数据基础设施 | TD-010 | `docs/persistence-schema.md` | `docs/adr/0010-sqlite-snapshot-migration-and-atomic-restore.md` | `ACTIVE` | `—` | Schema/oracle/历史升级图通过后，源的 manifest 字段分区转 `RETIRED`。 |
| `specs/attachments/private-container-v1.md` | 客户端安全与附件 | TD-005 | `docs/security-and-privacy.md`, `docs/persistence-schema.md` | `docs/adr/0005-encrypted-attachment-store.md` | `ACTIVE` | `—` | target/oracle 通过后，源的 byte/framing/AAD 分区转 `RETIRED`。 |
| `specs/time/tzdb-manifest.schema.json` | 时间引擎 | TD-007 | `docs/time-and-recurrence.md` | `docs/adr/0007-time-recurrence-engine.md` | `ACTIVE` | `—` | manifest 字段转入 Schema；时间与重复语义仍由专项文档拥有。 |
| `specs/notifications/local-contract-v3.md` | 提醒平台 | TD-009 | `docs/reminders-and-notifications.md` | `docs/adr/0009-native-reminder-scheduler.md` | `ACTIVE` | `—` | target/payload/oracle 通过后，源的 hash/projection/adapter 分区转 `RETIRED`。 |
| `specs/notifications/payload-v3.schema.json` | 提醒平台 | TD-009 | `docs/reminders-and-notifications.md` | `docs/adr/0009-native-reminder-scheduler.md`, `docs/reminders-and-notifications.md`（语义分区） | `ACTIVE` | `—` | 机器字段转入 Schema；提醒语义保留在专项文档。 |
| `specs/ai/record-draft.schema.json` | 智能能力 | `AI-*`；网络路由继承 TD-013 | `docs/ai-creation-contract.md` | `NONE` | `—` | `ACTIVE` | 保持当前 authority；补 OpenAPI pair、oracle 与版本身份迁移，不产生第二 owner。 |
| `specs/backup/container-v1.md` | 客户端安全与数据基础设施 | TD-010/011 | `docs/data-lifecycle.md` | `NONE` | `—` | `ACTIVE` | 保持 byte authority；补 metadata、portable/profile pair 与 oracle。 |
| `specs/backup/manifest.schema.json` | 客户端安全与数据基础设施 | TD-010/011 | `docs/data-lifecycle.md` | `NONE` | `—` | `ACTIVE` | 保持 JSON authority；补 portable pair 与 oracle。 |
| `specs/api/openapi.yaml` | 服务端平台 | TD-012 | `docs/service-contracts.md` | `NONE` | `—` | `—` | 当前未发布机器 API；P0 surface/AI pair/oracle 齐备后首次激活。 |
| `specs/telemetry/events.schema.json` | 隐私与数据 | TD-016 | `docs/analytics-and-telemetry.md` | `NONE` | `—` | `—` | 当前未发布事件 Schema；白名单/禁用属性/oracle 齐备后首次激活。 |

Authority 迁移采用三步协议：新合同先以 `Draft + CANDIDATE` 建立并允许与旧来源重复；paired contract 与 oracle 自校验通过后可转 `Normative + CANDIDATE`；最后一次 registry 审计提交逐行把 `Target Authority` 改为 `ACTIVE`，并把存在旧 owner 的 `Source Authority` 改为 `RETIRED`。中间状态禁止新实现依赖 candidate；全新边界在激活前保持没有已发布机器合同，因此既不产生双 owner，也不伪造一个并不存在的活动合同。

#### 4.8.4 Contract Oracle Registry

每个 oracle manifest 是固定测试包的唯一索引，必须符合 `specs/testing/oracle-manifest-v1.schema.json`，并记录 oracle 版本、覆盖的合同身份、每个 fixture 的相对路径与 SHA-256、生成器版本、正/负例预期和自校验命令。manifest 不列自身 checksum，其身份由 Git blob 与 snapshot anchor 固定；目录存在或测试名称不等于 `VERIFIED`。

| Oracle manifest | Exists | Evidence | 验证对象 | 最低固定内容 | 自校验 | Gate scope | Oracle Gate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `specs/scalars/fixtures/v1/manifest.json` | `MISSING` | `MISSING` | scalar v1 | EntityId/Instant/LocalDate/LongCounter、边界/MAX、domain label、正反例 | Schema + checksum + canonical round-trip | P0 标量合同 | `BLOCKED` |
| `specs/security/fixtures/v1/manifest.json` | `MISSING` | `MISSING` | anchor/device-envelope v1 | JCS/AAD/digest、双槽、sequence/headroom、key-loss、clear/reinstall、互换负例 | Schema + checksum + golden-byte recompute | P0 安全合同 | `BLOCKED` |
| `specs/persistence/fixtures/v1/manifest.json` | `MISSING` | `MISSING` | 全部 persistence contracts | clean/historical DDL、cipher/control/candidate、migration DAG、crash/rollback、backup round-trip | SQLite/SQLCipher probe + schema fingerprint + checksum | P0 数据合同 | `BLOCKED` |
| `specs/attachments/fixtures/v1/manifest.json` | `MISSING` | `MISSING` | private container v1 | 0/1 byte、chunk 边界、50 MiB、tamper/truncate/trailing、跨平台 bytes | offset/length/parser + checksum | P0 附件合同 | `BLOCKED` |
| `specs/time/fixtures/v1/manifest.json` | `MISSING` | `MISSING` | tzdb manifest + recurrence engine v1 | tzdb 2026c provenance/hash、REC-T、DST gap/overlap、月末、分页、升级差分 | metaschema + zic/zdump + deterministic vectors | P0 时间合同 | `BLOCKED` |
| `specs/notifications/fixtures/v3/manifest.json` | `MISSING` | `MISSING` | 完整通知版本矩阵 | JCS/hash/domain label、pair registry、capability/dedup v1、incarnation/epoch/transport、stale no-op | Schema + checksum + cross-language vectors | P0 提醒合同 | `BLOCKED` |
| `specs/ai/fixtures/v1/manifest.json` | `MISSING` | `MISSING` | AI draft 1.0 + API pair | 五类型、互斥结果、format assertion、恶意输出、capability profile、adapter errors | metaschema + OpenAPI refs + checksum | P0 AI 合同 | `BLOCKED` |
| `specs/backup/fixtures/v1/manifest.json` | `MISSING` | `MISSING` | container/manifest/portable/profile | KAT、golden bytes、selector 分离、old-read/new-write、bit flip、5 GiB 流式边界 | offset/registry + metaschema + independent recompute | P0 备份合同 | `BLOCKED` |
| `specs/api/fixtures/v1/manifest.json` | `MISSING` | `MISSING` | OpenAPI v1 的 P0 surface | auth/error/idempotency/version、AI endpoint 正负 examples；不包含 P1 sync | lint/bundle/ref/checksum | P0 在线合同 | `BLOCKED` |
| `specs/telemetry/fixtures/v1/manifest.json` | `MISSING` | `MISSING` | telemetry schema v1 | allowlist、禁止内容属性、consent/retention routing 正负例 | metaschema + forbidden-property lint + checksum | 接入遥测前 | `BLOCKED` |
| `specs/sync/fixtures/v1/manifest.json` | `MISSING` | `MISSING` | OpenAPI sync surface + `SYNC-*` | client-client-server、乱序/重复/冲突/墓碑/cursor/附件 | deterministic simulation + checksum | P1 同步；不阻塞 P0 | `BLOCKED` |

#### 4.8.5 Implementation 与 Release Evidence

Oracle 自校验通过只表示预期可执行；实际 Swift/Kotlin/TypeScript/SQLite/服务端实现通过后，由 CI 生成不可手写的 evidence index。索引至少绑定 Git SHA、合同与 oracle digest、实现/平台版本、命令、结果、时间和不可变 artifact URI；失败、过期 SHA 或未覆盖必需实现均不能记为 `VERIFIED`。

| Evidence index | Schema | Exists | Evidence | Owner | Gate scope | Gate |
| --- | --- | --- | --- | --- | --- | --- |
| `evidence/conformance/index.json` | `specs/testing/conformance-index-v1.schema.json` | `MISSING` | `MISSING` | 测试与发布工程 | 实现 conformance / 公开测试 | `BLOCKED` |
| `evidence/release/index.json` | `specs/testing/release-evidence-index-v1.schema.json` | `MISSING` | `MISSING` | 发布与运营 | 生产发布证据 | `BLOCKED` |

当前已知合同治理 blocker：

- AI Schema 的 `$id` 仍是未版本化的 `life-book.example` URL；在产生对外兼容负担前必须通过新版本身份和兼容映射收口，不得事后原地重解释已发布身份。
- container v1 已链接 manifest，但页首还没有精确 `Paired contract` 与 `Authority` 元数据；在修正前不得通过严格 metadata 检查。
- TD-004/005/006/007/009/010 当前仍承载将迁移到 `specs/` 的字段、JCS、byte 或 profile 细节；只能按第 4.8.3 节协议转移，不能先删旧规则。
- installation anchor 已由 TD-004 确定使用 JCS JSON，必须拥有登记的 paired JSON Schema。device-key envelope 与 DatasetControl 的 JSON Schema 目前只是 `CANDIDATE` 路径；分别由 TD-004/010 明确 JCS 后才能激活，若决定其他编码则在新 snapshot 中移除候选 Schema，并由协议合同拥有相应 bytes。
- 通知合同不得简写为单一“v3”；任何登记、实现和 evidence 都必须保留第 4.8.1 节完整版本矩阵。
- 备份 selector 必须分别保留 `containerFormatVersion=1`、`headerVersion=1`、`suiteId=1`、`passphraseProfileId=1`、`kdfProfileId=1` 和独立 `sqlcipher_portable_v1`，不得合并称为含糊的“profile v1”。
- 现有 3 个 `Normative` 文件都没有 `VERIFIED` oracle 或 implementation evidence；`Normative` 不得被解读为开发、真机或生产 Gate 已通过。

`docs/**/*.md` 默认解释产品、领域或工程语义；`specs/**/*.md` 允许成为规范性 wire-format 文档，用于标准 Schema 无法表达的 byte offset、endianness、AAD/KDF 投影、hash、framing、EOF、parser 状态机和跨字段算法。规范性协议 Markdown 必须在页首声明 `Status`、`Version`、`Owner`、`Decision source`、`Semantic owner`、`Paired contract` 和 `Authority`；它可以引用 JSON 字段路径作为算法输入，但不得重新定义 JSON 对象结构。

Schema/OpenAPI 是其机器字段的唯一权威；协议 Markdown 是 byte 与跨字段算法的唯一权威；fixture/oracle 和测试只提供预期或证据，不产生规则。Schema 的 `$comment` 或叙事文档可以给出非规范摘要和链接，但不得复制后再独立演进同一运行时不变量。

备份合同尤其按以下边界维护：`data-lifecycle.md` 负责产品范围与承诺；TD-010/TD-011 负责技术选择、信任边界、理由和生产启用门；`container-v1.md` 负责 byte-level 及运行时跨字段不变量；`manifest.schema.json` 负责 JSON 结构约束；`persistence-schema.md` 负责 portable/active 物理 Schema 与 mapper；oracle/test 只提供预期与实现证据。

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
| 真实第三方 route 是否具备处理与启用资格 | 第三方服务登记 |
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
| `GOV-` | 文档治理不变量、流程和门 | `documentation-governance.md` |
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
| `TPS-` | 第三方服务 route、处理条件与启用资格 | `third-party-services.md` |
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

ADR 按其固定结构声明元数据；JSON Schema、OpenAPI 等机器文件无法放置上述页首时，版本、状态、owner、决策来源和校验方式必须在第 4.8 节登记，并通过 `$id`、`info.version` 或等价机器字段给出稳定版本身份。

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
2. 只在登记为 `ACTIVE` 的唯一 owner 契约中定义生效字段/字节规则；候选只可登记为 `CANDIDATE`，并更新显式版本、registry 或 capability；
3. 同步 paired Schema/协议、兼容矩阵、golden/negative oracle 和 conformance test，不以注释复制另一契约的规则，也不把 oracle 伪装成实现通过证据；
4. 已发布版本不得原地改变含义，采用新版本或新 registry 值，并明确 old-read/new-write 与停止支持门；
5. JSON Schema 必须通过目标 draft metaschema；OpenAPI 必须 lint；规范性协议 Markdown 必须通过链接、offset、registry、长度公式和 fixture 检查；
6. 同一主题可以遵守“一份文档一个提交”分别落地；paired contract 与 oracle 齐备后才可通过 Contract Gate，实现 conformance 与发布证据齐备后才可通过对应后继 Gate。

### 8.5 GOV-050：跨文档 Change Train

一个行为/合同改动同时影响多份文件时，先列出 change train 的 owner、受影响路径、决策/迁移/验证门和结束审计，再按第 11 节逐文件提交。过渡期允许 Git 历史中的中间提交尚未构成新基线，但必须满足：

1. 已提交的 owner 文档本身完整、不伪造其他路径已存在/已通过；
2. 旧运行语义在新 owner 完成 `Normative + CANDIDATE`、paired/oracle 自检且 registry 激活前不得删除；激活提交同时完成 `ACTIVE/RETIRED` 切换，不得产生双 owner 或无 owner 窗口；
3. 每个后续提交使用同一可识别主题，并在最后一份文档后运行全仓库一致性审计；
4. 只有审计通过后才更新 registry 中的 `Exists`、`Status check`、`Authority`、`Evidence` 或 `Gate=PASS`；中间提交不得对外分发为完整基线。

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
- 发布、支持和合规材料是否需要同步更新；
- 所有页首状态是否精确命中受控枚举，registry raw status、`Exists`、目标状态与 snapshot anchor tree 是否一致；
- 当前 snapshot ID 的 `Registry-Snapshot` trailer 是否在可达历史中恰好出现一次，登记范围工作树是否清洁，锚点后是否没有未重审的登记路径变化；
- ADR 索引的文件存在性/正文 `Status`/标题是否一致，缺失 ADR 是否只使用 code path 而不制造 broken link；
- `specs/` 主合同、paired contract、oracle、implementation evidence、版本身份和本地校验命令是否逐表对应，缺文件是否仍为状态 `—`；
- 本地 Markdown 链接、标题锚点、编号唯一性、代码围栏和 JSON/YAML/SQL 语法是否通过；
- 所有 OQ 默认、ADR 决策门和阶段阻塞是否在路线图、专项规范和交付文档中指向同一 owner。

## 10. 阶段完成条件

### 10.1 可以开始交互设计

- 产品决策、产品功能说明和路线图没有未解释冲突；
- 术语、信息架构和核心用户流程已形成文档基线；
- 核心流程中的异常与权限拒绝路径已经定义。

### 10.2 可以开始永久工程骨架

- TD-001/002 已 `Accepted`，ADR 索引与正文一致；
- `system-architecture.md`、`engineering-standards.md`、`implementation-plan.md` 和 `test-strategy.md` 已形成合法“文档基线”；
- 骨架 scope 只包含客户端 workspace、移动壳、层/模块边界、composition root、内存/noop/disabled port、纯确定性测试、CI 和合成 capability spike；
- production composition root 不注册数据库、通知产品入口、网络、遥测、OTA、账号、同步、家庭或 Web adapter，不产生长期数据、公共 wire format 或真实外部流量；
- OQ-003 已有接受决定，OQ-008 只阻塞日期；OQ-001/002/009 不阻塞本地合成工程；
- 当前 registry snapshot 不是 `STALE`，且工作树对登记范围清洁。

该 Gate 是开发前的决定/文档 readiness，不要求尚不存在的实现 evidence。代码产生后必须按工程规范和测试策略通过每个合入门；M0 完成仍不能自动打开下一节。

### 10.3 可以开始 P0 本地功能开发

- P0 页面规格、领域模型、业务规则、专项规范、系统架构、持久化 Schema、安全模型和工程规范已形成合法“文档基线”；
- 当前本地切片所需 TD-001～011 已 `Accepted`，且 ADR 索引与正文一致；
- 当前切片实际依赖的第 4.8.1 节 Contract Gate 与第 4.8.4 节 Oracle Gate 均为 `PASS`；P0 本地完整闭环至少覆盖 scalar、security、persistence、attachment、time、notification 与 backup，但独立切片不被无依赖合同人为阻塞；
- 每个开发项有验收条件并能追溯到规则编号；
- 尚未确定事项均不阻塞当前里程碑，或已经记录默认处理方式。

### 10.4 可以开始 P0 在线智能开发

- TD-012～017 已 `Accepted`，`service-contracts.md`、OpenAPI、安全、遥测、可观测性和发布规范达到各自文档/Contract/Oracle Gate；
- OQ-001/002 可在内部、无真实用户数据的隔离环境中暂不关闭，但生产 route、真实数据与公开测试仍被阻塞；
- 模型/服务失败只关闭可选在线能力，P0 手动、离线、备份与本地提醒闭环继续可用。

### 10.5 可以开始 P1/P2 实现

- P1 在 OQ-006 关闭、TD-018～023 `Accepted`、同步/OpenAPI/attachment/cloud-backup/remote-push 合同和三方 oracle 就绪前不得冻结架构；
- P2 在 P1 门通过、TD-024～027 `Accepted`，家庭授权/审计、Web、成熟 AI 和公共模板专项验收就绪前不得启用；
- 未来农历能力在独立产品与技术决定、数据来源/版本/迁移和 oracle 就绪前保持关闭。

### 10.6 可以开始公开测试

- 端到端、平台兼容、离线、备份恢复和安全测试达到门槛；
- 所有生产格式/API 的历史 oracle、consumer/provider 或双平台 conformance 已通过，`evidence/conformance/index.json` 对当前 Git/合同/oracle digest 为 `VERIFIED`，且没有把 ADR/契约状态误当作测试证据；
- 监控、故障降级、发布回滚和支持流程可用；
- 隐私政策、权限说明和第三方数据处理清单与实现一致；
- 数据格式和迁移路径经过真实升级验证。

### 10.7 GOV-062：Gate 计算规则

Gate 按 scope 分别计算，不能套用一条会令开发前置条件依赖尚不存在实现的循环公式：

1. 文档 Gate：路径 `PRESENT`、页首状态 `VALID`、内容审计完成，且 scope 内 OQ/ADR 不阻塞；当前状态只有“文档基线”，以及职责确属追加型 registry 的“持续维护”可以为 `PASS`，纯叙事文档 Evidence 可为 `NOT_REQUIRED`。“草案”与“待确认”为 `BLOCKED`，“已替代”为 `NOT_APPLICABLE`。
2. Contract Gate：全部依赖合同 `PRESENT + Normative + ACTIVE`，paired contract 无缺口，稳定身份/metadata/兼容规则合法，对应 Oracle Gate 为 `PASS`；不要求尚未开始的实现 conformance。
3. Oracle Gate：manifest 与全部列举 fixture `PRESENT`，checksum、Schema/metaschema、golden 重算和自校验均通过，Evidence 才能为 `VERIFIED`。
4. Implementation Gate：`evidence/conformance/index.json` 对当前 Git SHA、合同 digest、oracle digest 和所有必需实现/平台均为 `VERIFIED`。
5. Release Gate：上述适用 Gate 全部通过，`evidence/release/index.json` 绑定同一候选版本并满足安全、法律、运营、灰度和回滚证据。

任一 Gate 还要求 registry 快照不是 `STALE` 且全仓库审计通过。单个子系统可以先通过自己的切片门，不要求 P1/P2 文件阻塞 P0 本地切片；但不得用子集 `PASS` 声称整体或生产就绪。根据第 4.7/4.8 节锚点快照，永久工程骨架 Gate 为 `PASS`；P0 正式本地功能、P0 在线、P1/P2、内部分发和公开测试 Gate 均仍为 `BLOCKED`。

## 11. 文档提交规则

- GOV-061：当前文档基线建设期，每个 Git 提交只新增或修改**一个文件**，包括纠错、Schema、SQL、fixture 和索引；使目的、责任 owner 和评审范围清楚；
- 同一提交不混入代码、第二份文档/契约/生成资产；一个 fixture 目录中的每个文件也分别提交；
- 跨文档一致性修正按文档分别提交，并在提交说明中使用相同主题；
- 中间提交必须保持其单文件内部完整，不得把“后续会补”当作当前文件的缺失定义；跨文档主题按 GOV-050 直到最终审计前不宣称新 Gate；
- 不通过复制整段权威规则解决可读性问题，优先提供摘要、编号和链接；
- 合并或删除文档时保留重定向说明，避免历史链接失效。

## 12. 变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| v1.3 | 2026-07-27 | 重审 41 项文档 registry，登记架构/工程/实施/测试基线及第三方服务 owner，分配 `GOV-REGISTRY-2026-07-27-02`，新增不产生长期数据的永久工程骨架 Gate。 |
| v1.2.1 | 2026-07-27 | 跨日后重新执行完整 registry 审计，分配 `GOV-REGISTRY-2026-07-27-01`，不复用前一快照 ID。 |
| v1.2 | 2026-07-27 | 新增 GOV 不变量、40 项文档事实 registry、不可复用 snapshot trailer、产品合同/oracle/治理基础设施/evidence 分层 registry、Authority change train、分阶段 Gate 计算和一文件一提交强制规则。 |
| v1.1 | 2026-07-26 | 增加 ADR、契约与发布分层门禁、规范性协议 Markdown、机器契约登记与变更流程、备份合同权威边界，收口账号/同步/家庭 ownership，并补全稳定编号 owner。 |
| v1.0 | 2026-07-26 | 建立文档分层、权威关系、稳定编号、变更流程和阶段完成条件。 |

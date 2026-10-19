# TD-013：智能网关与供应商路由

> Status：`Proposed`
> Date：2026-07-27
> Review date：—
> Decision owners：智能能力负责人、服务端负责人、安全负责人、隐私负责人、质量负责人
> Scope：P0 管理式智能创建的供应商无关网关、路由配置、适配器、调用尝试、校验、故障与关闭边界
> Related requirements：PD-002、PD-005、PD-006、PD-014、PD-017、PR-002、PR-400～405、PR-583～584、AI-001～151、QR-013、QR-021～022、QR-040～042、QR-060～062、QR-070～072、QR-110～112
> Related ADRs：[TD-012](0012-http-api-and-contract-versioning.md)、TD-014、TD-015、TD-016、TD-017
> Decision gate：TD-012 进入 `Accepted`，`security-and-privacy.md` 给出适用的第三方内容处理威胁模型，且合成 provider adapter/路由/attempt spike 与独立安全隐私评审证明方案可行后，本 ADR 才可接受；route 激活还要求 `service-contracts.md`、`third-party-services.md`、AI 契约/Schema/评测完成对应门。任何真实数据或生产 route 另受 OQ-001/OQ-002、供应商地区/留存核验及 AIEVAL-070～072 阻塞

## Context

P0 智能创建必须把用户当前输入发送给产品托管的模型服务，但五种本地手动创建始终是完整主路径。移动端不能持有产品供应商密钥，业务契约不能绑定某个供应商响应格式，供应商故障、地区变化或成本异常也不能影响本地数据。

现有 [智能创建契约](../ai-creation-contract.md) 已定义供应商无关的业务状态、草稿语义、确定性校验、一次回退与数据边界，[智能评测规范](../ai-evaluation.md) 已定义候选配置的回归和灰度门。仍需固定以下技术边界：

- 如何在地区、披露、能力、质量、健康、延迟和成本约束下选择 route；
- 如何隔离供应商 SDK、参数、错误、标识和数据处理差异；
- 同一逻辑请求如何允许有限 repair 或 fallback，又不被隐藏 retry 扩大成无界调用；
- 何时返回业务 `DraftEnvelope`，何时返回 TD-012 的受控 HTTP 错误；
- 如何在不保存原始输入、完整响应或推理的前提下诊断和回滚。

TD-012 仍为 `Proposed`，安全、服务合同和第三方服务清单尚未落库，因此本 ADR 先完整提出可实现方案，不虚报为已经接受或可投产。

## Decision

采用产品托管、无状态的 **AI Gateway + `ProviderRouter` + provider-specific adapter**。网关只执行 P0 的一次智能解析 command：选择一个已批准的不可变 route 配置，在唯一 execute lease 内串行调用供应商，转换并校验为同一 `DraftEnvelope`，随后清除请求内容。

每个逻辑 `requestId` 最多发生 **两次 provider invocation**。第一次为 primary attempt；第二次只能二选一：同 route 的一次模型 Schema repair，或暂时故障后的一个已批准 fallback provider。两者不得同时发生。AI-062 的纯程序确定性修复不调用模型，不占 provider attempt。SDK、HTTP client、代理和供应商客户端的隐式 retry 一律关闭。

P0 不建立 chat/thread/assistant/agent、异步 job、工具调用、函数执行、Web 搜索、文件访问、数据库访问、领域保存、通知调度或服务端会话历史。供应商只能返回候选业务结果，不能取得任何副作用能力。

## Decision details

### 1. 职责边界

| 内容 | 目标责任边界（本 ADR 接受并由对应合同激活后） |
| --- | --- |
| 公共 HTTP、requestId 幂等、status 与 Problem Details | TD-012；激活后由 OpenAPI/`service-contracts.md` 承接精确合同 |
| 匿名授权、cheap rate、quota reserve、execute lease 与结算 | TD-014 |
| route eligibility、provider attempt、adapter 和上游错误映射 | 本 ADR |
| 业务状态、字段来源、确认与模型数据边界 | [智能创建契约](../ai-creation-contract.md) |
| `DraftEnvelope` 机器结构 | `specs/ai/record-draft.schema.json` |
| 质量、隐私探针、供应商准入与灰度证据 | [智能评测规范](../ai-evaluation.md) |
| 实际供应商、地区、用途、训练/留存/删除与合同核验 | `third-party-services.md` |
| 可记录字段、trace 和 exporter | TD-016 及遥测/可观测性规范 |

adapter 产生的 SDK type、原始 status、request ID 和错误对象不得越过网关边界。生成类型、provider simulator 或 bundle 都是派生物，不成为第二产品契约。

### 2. 唯一执行链

调用顺序固定为：

```text
TD-014 edge / anonymous-auth / cheap-rate gate
→ TD-012 strict JSON / OpenAPI / contract / capability validation
→ TD-014 atomic quota reserve + unique execute lease
→ TD-013 content-free route selection
→ TD-014 atomically claim providerAttempt=0 / mode=primary and mark provider_started
→ TD-013 primary provider attempt
→ parse + Schema + capability + deterministic domain validation
→ optional deterministic repair
→ if needed, atomically claim providerAttempt=1 / mode=model_repair XOR fallback
→ TD-014 one terminal settlement
```

- 没有 execute lease 或 attempt claim 原子转换失败时，adapter 不得发出请求。
- 非法 body 在 reserve 前拒绝，不消耗周期额度。
- 每次 egress 前，TD-014 必须 crash-safe 地 claim 唯一 `(requestId, providerAttempt=0|1, mode=primary|model_repair|fallback)`；`started` 或结果未知都视为该 index 已消费，永不复用。第二个 index 的 mode 只能一次性 CAS 为 repair 或 fallback，天然保证 XOR；共享状态不确定时 fail closed。
- route 在 provider 前变得不可用时，报告 pre-provider failure，由 TD-014 释放 reservation；一旦 `provider_started` 成功或结果不确定，最多结算一次，即使客户端断连、超时或发生第二 attempt。
- 客户端网络 retry 沿用同一 `requestId`，不能建立第二条执行链；`ParseDraftRequest.attempt` 只表示唯一追问轮次，不能与内部 `providerAttempt` 混用。
- 本 ADR 的两个 provider attempts 共享同一 execute lease、deadline 和用户额度；不得并行竞速、hedge 或产生第二次用户扣额。

### 3. 不可变 route 配置

每个 route 配置有不可复用的版本身份，并绑定：

- 环境、region cell、法律/数据处理 policy 与第三方披露版本；
- provider、精确 model identifier、稳定 `modelAlias` 与 KMS secret reference；
- `promptVersion`、`adapterVersion`、`contractVersion`、`validationVersion`、`capabilityProfileVersion`；
- 输出模式、输入/输出上限、内部 deadline、成本和并发上限；
- primary/fallback 关系、健康阈值、断路器、region/provider/global kill switch；
- 通过的 AIEVAL run ID、批准者、激活范围和回滚目标。

激活后不得原地重解释同一配置版本。任何 provider/model、提示、adapter、输出模式、回退顺序、数据处理或校验版本变化都产生新版本，并重新通过适用评测和审批。secret 值不进入配置、仓库、日志或错误；轮换 secret 不改变 route 的业务身份，但必须留下无内容发布证据。

OQ-001 未关闭前只建立 region/policy 抽象和关闭的合成测试 route，不选择或承诺生产地区、provider 或 model。

### 4. 路由资格与选择

Router 先执行硬过滤，候选必须同时满足：

- 当前环境和 region cell 允许，数据不会跨越未批准处理边界；
- 用户看到的第三方说明覆盖该供应商、用途和处理地区；
- 训练、滥用监控、应用状态、留存和删除控制已按当前官方资料及合同核验；
- 请求 contract/capability、输出模式和模型上下文上限兼容；
- 精确配置已通过 AI release/holdout/安全评测且仍在批准窗口；
- route、provider、预算、并发、deadline、健康和 kill switch 均允许新调用。

过滤后只可按无内容信号选择，例如 region、版本、健康、容量、延迟/成本分桶和显式 rollout cohort。不得读取 `rawInput`、草稿字段、推断敏感性、标题、日期或数量来选择供应商；不得因内容把用户暗中送往未披露的 route。

没有合格 route 时不调用供应商，按 TD-012 返回运行态 503，并让客户端保留输入、转手动。调用者的地区、build 或 capability 确定性不具资格则由 TD-012/014 在更早阶段返回 403。

### 5. ProviderAdapter

统一 adapter port 只提供构造请求、调用、取消、解析和错误归一化。供应商请求使用字段 allowlist，只包含 AI-010～022 当前会话允许的原始输入、固定参考上下文、版本化系统指令和由权威 Schema 派生的输出约束；不发送 Installation/grant/token、其他记录、历史会话、联系人、位置、附件、账户或内部风控状态。

OpenAI route 在精确 model/endpoint 支持且工具矩阵通过时使用 Responses API 的 Structured Outputs，显式 `store: false`，不使用 conversation/previous response、background mode、streaming、tools 或文件。Structured Outputs 仍不能替代本项目的 Schema、日历、数量、capability 和跨字段校验，也不能把拒绝当作合法草稿。

阿里云百炼/Qwen route 只在精确模型、地区 endpoint 和参数通过核验时使用 JSON structured output。JSON mode 只保证或倾向产生可解析 JSON，不能宣称等价于本项目的严格 Schema；所有结果必须经过相同的下游校验。若供应商标记 partial/truncated、返回额外文本或 SDK 丢失关键错误信息，adapter 必须归一化为无内容内部结果，不能把残缺 JSON 当草稿。

任何未来供应商都实现同一 port、同一业务契约和同一评测门，不因“OpenAI-compatible”名称跳过能力、错误、留存、地区或参数验证。

### 6. 输出、repair 与可信元数据

每个 attempt 依次执行：严格解析 → `record-draft` Schema → contract/capability → 字段、时间、数量与交叉规则 → 隐私/安全规则。只有全部通过才可形成成功 `DraftEnvelope`。

- AI-062 列出的纯程序、保持语义修复最多执行一次并记录受控 warning；它不增加 provider attempt。
- 需要模型修复时，只能在剩余 deadline 充足且 route 明确允许时使用第二次 invocation；修复后重跑完整流水线。
- primary 遇到连接失败、deadline 前的供应商 429/5xx 或等价暂时故障时，才可把第二次 invocation 用于 fallback。fallback 必须同地区允许、已披露、数据处理同等或更严格、同 contract 评测通过。
- 模型 repair 与 provider fallback 互斥；第一次已经使用模型 repair 后不得再 fallback，fallback 返回无效结构后也不得再 repair。
- `content_refused`、输入/产品安全判断、contract/capability 错误、调用者鉴权/额度错误均不得触发 fallback。

模型只产生业务 result 候选；网关用可信配置组装或覆盖 `requestId`、`contractVersion`、`promptVersion`、`adapterVersion`、`modelAlias`、usage、warning 和服务端随机 `trackingId`。供应商原始 request ID 不返回客户端、不进入普通日志；确需向供应商支持定位时，只在隔离、短期的安全事件流程保存经批准的无内容关联值。

不得请求、保存或返回 chain-of-thought、隐藏推理或供应商自由解释。系统提示必须作为受审、版本化的配置 artifact 保存并由 `promptVersion` 引用，但不得返回客户端，也不得进入普通日志、遥测、错误、诊断包或供应商响应缓存。

### 7. 错误归一化

| 上游结果 | 是否第二 attempt | 对外结果 |
| --- | :---: | --- |
| 明确供应商/产品内容拒绝 | 否 | 成功 `DraftEnvelope.result=content_refused` |
| primary 连接失败、受控 429/5xx、暂时不可用 | 可用一次合格 fallback | 尝试耗尽后 503；供应商 429 不伪装成用户 quota 429 |
| 结构/协议无效或截断 | 只可用一次 model repair | 仍无效则 502 |
| 网关内部 deadline 到期 | 否 | 504 |
| provider/model/secret/config 错误 | 否；立即隔离 route | 503，不向客户端泄露配置 |
| 无合格 route、断路器或 kill switch | 否 | 503 |

稳定 HTTP status、Problem Details `code`、`retryable` 和客户端恢复动作只由 TD-012 的机器/服务合同定义；本文不复制供应商原始错误码到公共接口。

### 8. Deadline、取消与健康

- 继承 TD-012 的客户端 15 秒 soft、30 秒 hard deadline；网关内部 hard cap 不得超过 25 秒，并为网络回程留出预算。最终精确预算由 `service-contracts.md` 单点登记，route 只能更紧。
- 第二 attempt 开始前必须同时满足剩余网关预算、该 route 的最坏调用上限和清理预算；不满足即停止。
- 收到明确 cancel、确认连接已关闭或剩余客户端/网关预算不足后，不得 claim 或启动 `providerAttempt=1`；只能取消当前调用并完成无内容清理与结算。
- 客户端取消/断连后尽力取消尚未完成的 provider request；若已经 `provider_started`，仍完成无内容状态清理和一次结算，不保存或回送迟到内容。
- 健康由无内容的连接、status、延迟、Schema 合法率和断路器状态决定；不能采样原文判断健康。
- global、region、provider、model/route 四层开关都能阻止新调用。关闭只影响在线智能，不隐藏五种手动入口，不删除本地记录，也不触发客户端重试风暴。

### 9. 内容、留存与凭据

- 网关只在有界请求内存中持有原始输入和完整供应商响应；不得写入业务数据库、KV、缓存、队列、对象存储、普通日志、APM、trace、错误追踪、诊断包或评测报告。
- route 配置、错误、metrics 和 traces 只使用服务端 diagnostic ID、稳定 model alias、版本、无内容状态及低基数用量/延迟/成本分桶；`requestId`、provider raw ID 和内容 hash 不进入普通可观测性。
- `store: false` 或供应商对应参数不等于零留存承诺。实际训练、滥用监控、应用状态、默认/可选留存、区域处理和删除能力必须在 `third-party-services.md` 按 route 核验；没有合同或配置证据时 route 保持关闭。
- 供应商凭据只存服务端密钥管理系统，按环境、region 和最小 workspace/scope 隔离；不得进入移动端、远程配置明文、仓库、构建产物或日志。
- provider SDK telemetry、body logging、batch、files、conversation state 和自动存储默认关闭；不主动设置稳定 `prompt_cache_key`，也不启用 extended/explicit caching。供应商无法关闭的短期隐式缓存必须进入 `third-party-services.md` 的留存核验、披露和 route 资格，不能声称 `store: false` 已将其关闭。确需其他能力必须另开 ADR/数据流/披露/删除与评测门。

## Alternatives considered

### 不引入在线智能网关

保持纯本地和手动创建可最大化隐私与可用性，但无法交付已经确认的管理式智能入口。它保留为所有在线故障的降级，不替代目标能力。

### 移动端直接调用产品供应商

会暴露产品凭据，无法可靠执行地区、额度、回退、撤销和统一合同，也让供应商变化绑定客户端发版。拒绝。P1 用户自带 Key 是独立产品边界，不改变 P0。

### 单一供应商、在业务代码中直接使用 SDK

初始代码更少，但供应商类型、错误和存储默认值会渗入产品契约，无法安全满足地区和故障切换。拒绝，仍允许某一地区配置只有一个合格 route。

### 只实现通用 OpenAI-compatible adapter

协议表面相似不代表 structured output、错误、取消、留存、地区和工具默认值相同。拒绝作为唯一适配；可以在 provider-specific adapter 内复用经测试的低层传输组件。

### 并行竞速、无界 retry 或同时 repair 后 fallback

可能改善尾延迟，却扩大内容披露、成本、结算和不可预测性，并破坏两次调用上限。拒绝。

### 按输入内容选择模型

可能优化质量或成本，但会产生未披露的内容分类与供应商转移，扩大隐私和一致性风险。P0 拒绝，只按无内容 eligibility/health 信号路由。

### 保存完整请求/响应用于调试和永久 replay

可简化故障复现，却违反 AI-110 和本地优先边界。拒绝；使用合成 fixture、用户主动最小复现和无内容状态。

## Consequences

收益：

- 客户端、草稿契约和领域层不依赖具体模型或 SDK；
- 每个请求只有一条执行链和最多两次可解释调用，成本、隐私与结算边界可测试；
- 供应商、模型、提示、adapter、地区和回退可以按不可变配置独立灰度/回滚；
- route 故障或合规变化可以只关闭在线智能，离线数据与手动功能保持可用。

成本：

- 每个供应商都需要 adapter、错误映射、取消、保留核验和独立评测；
- route registry、断路器、配置审批与 provider simulator 增加平台工作；
- 不保存完整响应意味着部分超时/响应丢失不能在服务端永久重放，只能让客户端保留输入并明确新提交。

兼容负担：已激活的 route 配置、版本组合和公开第三方说明必须在客户端支持窗口内可追溯；不能用同一版本名更换模型语义或数据处理。团队需要持续维护 AI 评测、供应商官方资料复核和故障演练能力。

## Risks and mitigations

| 风险 | 缓解 |
| --- | --- |
| repair 与 fallback 组合成第三次调用 | 单一 attempt counter；第二次前原子消费唯一剩余预算；属性测试覆盖所有分支。 |
| SDK 自带 retry 绕过计数 | 显式禁用；传输层注入计数器；provider simulator 断言实际出站次数。 |
| 进程在 egress 后、记账前崩溃导致重发 | 每次 egress 前原子 claim；started/unknown index 永不复用；状态不确定时关闭本次在线请求。 |
| content-aware routing 泄露敏感性 | eligibility 输入类型 allowlist；静态分析禁止传入 `rawInput`/草稿；隐私探针。 |
| Structured Outputs 被误当作领域正确 | 所有供应商均重跑同一 Schema、capability、日历、数量和跨字段校验。 |
| 供应商条款或区域改变 | 定期和变更触发核验；route 自动到期/人工续批；不满足即关闭。 |
| 断路器误伤全部智能 | region/provider/model 分层隔离，保守阈值和手动 kill；本地入口始终可用。 |
| provider raw ID 扩散为跨系统标识 | adapter 内截断；普通观测只用 server diagnostic ID；支持关联走隔离事件流程。 |
| 取消后供应商仍计费或返回 | deadline/cancel 尽力传播；provider_started 后至多一次结算；迟到结果丢弃且不持久化。 |
| route 配置被篡改或错误发布 | 不可变版本、Schema 校验、最小权限、双人审批、签名发布和快速 kill。 |

## Implementation constraints

- Router 和 adapter 位于 application/infrastructure 边界；领域层与移动客户端不得 import provider SDK/type。
- route 选择函数的输入必须是封闭、无内容结构；代码审查和测试拒绝任何自由文本、领域实体或内容 hash。
- provider 出站 host 使用按环境/region 的 allowlist；禁止供应商响应触发二次 URL、工具、文件或函数请求。
- request/response buffer 有公开上限和最短生命周期，终态立即释放引用；对可控 mutable/native buffer 尽力覆盖，但不得宣称能物理清零 GC string 或 SDK 内部副本。不得以 debug flag 在生产打开 body capture。
- adapter 必须接受调用级 deadline/cancellation，并返回封闭的内部错误联合；抛出的任意 SDK message 在记录前丢弃。
- 所有出站 invocation 都绑定 execute lease 和已原子 claim 的 `providerAttempt=0|1`/mode；无法证明绑定、claim 状态未知或 index 已消费时 fail closed。
- 精确 route 配置 Schema、错误 code、deadline、参数和第三方保留值进入各自合同/清单，不从 ADR 正文生成运行配置。
- P0 gateway 不访问生活内容数据库；未来 TD-025 的上下文检索必须是新 capability、授权和数据流，不能扩展本 adapter 的隐式权限。

## Verification

- 用 route 决策表覆盖 region、披露、contract/capability、评测、健康、预算、并发、deadline 和所有 kill switch；无候选时出站调用数为 0。
- 对 OpenAI、Qwen 和 fake provider 分别做请求快照、错误映射、取消、partial/truncated、refusal、额外文本、未知字段及 SDK 升级 contract tests。
- 穷举 primary success/failure、deterministic repair、model repair、fallback、取消和 deadline；任何序列 provider invocation `<=2`，且 repair XOR fallback。
- 100 个并发相同 `requestId`、进程在两个 attempt 的 claim 前后及 egress 前后中止、lease 恢复等序列中，每个 attempt index 最多一次出站，只形成一条执行链、一次 `provider_started` 与一次额度结算。
- 每个 routeConfigVersion 运行 AIEVAL release/holdout/红队/隐私探针并归档 run ID；五种记录、当前 contract 和每个生产供应商分别过门。
- 注入 prompt/tool/URL/SQL/文件指令，证明供应商没有工具和副作用，输出只按纯文本与封闭 Schema 处理。
- 在输入、响应、provider ID 和异常中放置唯一哨兵，确认日志、trace、metrics、KV、cache、queue、APM、crash 和诊断包均不可搜索到。
- 用生产等价代理验证出站 host allowlist、TLS、secret redaction、`store: false`/对应配置、无 conversation/background/tools，以及供应商地区和数据控制证据。
- 验证 15/30 秒客户端与不超过 25 秒网关预算、第二 attempt 剩余时间门、断连取消、迟到结果丢弃及 provider/region/global kill。
- 所有在线 route 关闭时，智能入口受控转手动，五种手动创建、已有数据、搜索、提醒和备份不受影响。

## Rollout and rollback

1. 在 TD-012/014 的 stub admission 与 fake provider 上完成唯一执行链、两次调用上限和错误 oracle；
2. 为每个候选 provider 建 adapter contract tests，只使用合成数据和隔离非生产凭据；
3. 补齐安全、服务合同、第三方清单和 AIEVAL 证据，待本 ADR 与前置 ADR 接受；
4. OQ-001/OQ-002 和治理门关闭后，按单个 region + 单个 route 从 internal → 1% → 5% → 25% → 100% 灰度；fallback 单独后开，不能与 primary 首次投产同时扩大故障面；
5. 每阶段按 Schema 合法率、严重错误、服务错误、延迟、成本和隐私探针暂停；只关闭对应 route，不重放历史 requestId；
6. 回滚到最近通过同 contract、地区、数据处理和评测门的不可变配置版本。没有合格目标时关闭 AI，而不是放宽 Schema、地区、留存或 attempt 上限；
7. provider 配置或凭据泄漏时先 kill route、撤销/轮换 secret、隔离无内容证据并完成事件评审；本地数据不迁移、不删除，手动功能继续。

## References

- [OpenAI：Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI：Data controls in the OpenAI platform](https://developers.openai.com/api/docs/guides/your-data)
- [OpenAI：Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- [OpenAI：Responses API](https://developers.openai.com/api/reference/resources/responses)
- [阿里云百炼：Qwen Structured Output](https://help.aliyun.com/en/model-studio/qwen-structured-output)
- [阿里云百炼：Text Generation API Reference](https://help.aliyun.com/en/model-studio/qwen-api-reference/)
- [阿里云百炼：Security Certifications and Privacy Notice](https://help.aliyun.com/en/model-studio/privacy-notice)
- [阿里云百炼：API Key](https://help.aliyun.com/en/model-studio/get-api-key)

## Revision notes

| 日期 | 说明 |
| --- | --- |
| 2026-07-27 | 提出无状态 AI Gateway、无内容路由、provider-specific adapter、单执行链最多两次调用及 repair XOR fallback 边界。 |

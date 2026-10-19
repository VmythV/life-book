# TD-012：HTTP API 与契约版本

> Status：`Proposed`
> Date：2026-07-27
> Review date：—
> Decision owners：服务端负责人、客户端负责人、安全负责人、质量负责人
> Scope：P0 在线服务的 HTTP 语义、版本、错误、幂等、缓存与契约治理，并约束后续公共 API
> Related requirements：PD-005、PD-006、PD-011、PD-014、PD-017、PR-400～405、PR-583～584、AI-001～151、QR-013、QR-021～022、QR-040～042、QR-060～062、QR-070～072、QR-110～112
> Related ADRs：[TD-006](0006-cross-platform-scalar-representations.md)、[TD-009](0009-native-reminder-scheduler.md)、TD-013、TD-014、TD-015、TD-016、TD-017
> Decision gate：本 ADR 在 `security-and-privacy.md` 给出适用威胁模型、OpenAPI 3.1.2/3.2.0 工具矩阵证明目标版本可实现并完成独立安全评审后，才可进入 `Accepted`；API v1 激活还要求 `service-contracts.md`、OpenAPI、AI paired Schema、API/AI oracle 及当前/上一兼容客户端测试齐备。生产与真实数据另受文档治理总门、TD-013～017、适用安全/运维/发布规范及 OQ-001/OQ-002 阻塞，本文不替代这些门

## Context

P0 的本地手动闭环不依赖服务，但匿名智能创建需要稳定、可演进且供应商无关的客户端—服务端边界。现有 [智能创建契约](../ai-creation-contract.md) 拥有 `ParseDraftRequest` / `DraftEnvelope` 的产品语义，`specs/ai/record-draft.schema.json` 唯一拥有 `DraftEnvelope` 的机器结构。`specs/api/openapi.yaml` 当前尚不存在，因此还没有已激活的 API 机器合同；创建并过门后，`ParseDraftRequest` 的 wire 结构将由它唯一拥有。HTTP 决策不得复制第二套草稿字段。

该边界还必须同时解决：

- 30 秒用户体验边界、取消和至多一次客户端自动重试；
- 同一业务 `requestId` 的重复传输不启动第二条逻辑执行链，也不重复结算额度；
- 草稿、追问等业务结果不与鉴权、限流或服务故障混为一类；
- 原始输入、完整模型响应、凭据和内部拓扑不进入日志、缓存或错误体；
- P0 API 与 AI contract、提示词、供应商 adapter 独立演进；
- 未来 P1/P2 surface 可以扩展，但不能提前改变 P0 权限或破坏已发布 v1。

## Decision

采用 **contract-first 的 HTTPS JSON HTTP API**。计划创建的 `specs/api/openapi.yaml` 激活后成为 path、method、header、media type、HTTP status 及 wire field 的唯一机器权威，目标使用 OpenAPI `3.1.2` 和 JSON Schema Draft 2020-12 dialect；AI Schema 继续唯一拥有 `DraftEnvelope` 及五种草稿结构，OpenAPI 通过外部 `$ref` 复用，不复制定义。OpenAPI 3.1.2 的选择在工具矩阵通过前仍是待验证提案。

公共 API 主版本放在 URI，首版为 `/v1`。P0 智能创建使用有界、同步、非流式的 `POST`；不引入 SSE、WebSocket、异步 job/poll 或服务端聊天会话资源。传输错误使用 RFC 9457 Problem Details；通过鉴权、资源门和校验后的草稿、追问、无法识别等结果仍以 `DraftEnvelope` 成功响应表达。

`ParseDraftRequest.requestId` 同时是智能创建 operation 的逻辑幂等键。相同作用域和相同请求最多建立一条逻辑执行链、取得一个 execute lease 并产生一次额度结算；TD-013 可以在该 lease 内执行有界、串行的供应商 attempts。传输重试不得建立第二条链，也不另造含义重复的 `Idempotency-Key` header。

## Decision details

### 1. 权威边界

| 内容 | 目标唯一 owner（激活后） |
| --- | --- |
| HTTP path/method/header/media type/status/wire field，包括 `ParseDraftRequest` | `specs/api/openapi.yaml` |
| `DraftEnvelope` 与记录草稿机器结构 | `specs/ai/record-draft.schema.json` |
| 调用顺序、错误恢复、兼容和客户端行为 | `service-contracts.md` |
| 业务结果、字段来源、确认与模型数据边界 | `ai-creation-contract.md` |
| 技术选择、替代、后果和生产门 | 本 ADR |
| 匿名授权、admission、quota 与 abuse 状态 | TD-014 |
| 供应商选择、attempt 和 execute lease 消费 | TD-013 |

OpenAPI bundle、生成代码和 SDK 都是派生物，不得成为第二权威。当前 AI Schema 的未版本化占位 `$id` 不得直接形成生产兼容负担；首次激活 OpenAPI 前必须通过新 Schema 身份和明确兼容映射完成迁移，不能原地重解释已发布身份。

### 2. 版本模型

- URI `/v1` 是公共 API major；确切 operation path 将由激活后的 OpenAPI 定义。
- OpenAPI `info.version` 是契约文档修订的 SemVer，初始为 `1.0.0`，不参与请求协商，也不能代替 URI major。
- `contractVersion`、`promptVersion`、`adapterVersion`、`validationVersion`、`capabilityProfileVersion` 和 API major 独立；切换模型或提示词不得提升 API major。
- 同一 major 只允许 additive-compatible 改动：在开放的 HTTP 包装层新增旧客户端可忽略的可选 wire field，或新增不改变既有权限的 operation。`DraftEnvelope` 及草稿对象保持封闭；不得在同一 `contractVersion` 增加字段，结构变化必须发布新的 `contractVersion`，并按请求版本返回精确旧 shape。只有未来契约显式定义的 extension 容器才允许旧客户端忽略其中的未知可选字段。
- 删除/改名、optional 变 required、收窄既有合法输入、改变字段/状态/幂等/鉴权语义，以及给旧客户端无法安全忽略的封闭枚举增加值，均为 breaking change；必须提升相应 contract 或新增 `/v2`。
- 服务端至少支持当前公开客户端和上一个兼容客户端。客户端遇到未知必要 contract/capability 时不得展示或保存草稿，必须保留输入并转手动或提示升级。
- 废弃可发送 RFC 9745 `Deprecation`；只有确定停用时间时才发送 RFC 8594 `Sunset`。完成最低客户端、通知和兼容门前不得停止 v1。

### 3. HTTP 与 JSON profile

- 仅允许 HTTPS；HTTP/1.1、HTTP/2、HTTP/3 由连接协商，业务语义不得依赖具体传输版本。
- 成功请求/响应使用 UTF-8 `application/json`；问题响应使用 `application/problem+json`。
- 严格拒绝错误 Content-Type、非法 UTF-8、重复 JSON key、非有限或越界数字、未知关键版本，以及超过 body、深度、token 或属性上限的输入。
- 校验顺序为：连接/资源上限 → JSON syntax/profile → OpenAPI/Schema → 版本与 capability → 领域语义；失败不得部分执行后续层。
- 原始输入、令牌和供应商内容不得进入 URI 或 query，也不使用 cookie 认证。移动 App 的 P0 API 默认不开放浏览器 CORS。
- Base URL 按环境固化在签名 build 或受信配置中；远程配置可以关闭 route，不能把生产 App 重定向到任意 host。

`rawInput` 的产品上限只由 AI-011 定义，精确 wire 约束只进入 OpenAPI；`service-contracts.md` 只解释超限后的可观察行为和恢复路径，不复制数值。代理或供应商不得另设一套用户可见规则。

### 4. 业务结果与 Problem Details

请求通过鉴权、限流、Schema 和版本门，且网关得到受控业务判断时，返回成功 `DraftEnvelope`，其中结果只允许：`draft | clarification_required | unrecognized | multiple_intents | unsupported | content_refused`。这些都不是 HTTP error。

其余失败使用 RFC 9457 Problem Details，并由 OpenAPI 约束稳定 `code`、服务端 diagnostic request ID、可选 `retryable` 和受控字段路径。错误体不得含原始输入、stack、供应商响应/凭据、内部 host 或拓扑。

| HTTP status | 语义类别 |
| --- | --- |
| 400 | JSON/请求语法错误。 |
| 401 | 匿名或账号令牌缺失、失效。 |
| 403 | 调用者的 grant、地区、build、contract 或 capability 确定性不具资格；不伪装成模型拒绝。 |
| 409 | 幂等内容冲突、原请求仍处理中或无内容墓碑无法重放。 |
| 413 | body 超过公开上限。 |
| 422 | Schema 通过后的确定性语义校验错误。 |
| 429 | 匿名速率或额度限制。 |
| 502 | 供应商响应不符合已声明的协议或结构。 |
| 503 | 运行时无合格 route、供应商尝试耗尽、依赖暂不可用或 kill switch 已关闭能力。 |
| 504 | 网关 deadline 到期。 |

409/429/503 可以携带 RFC 9110 `Retry-After`，只指导合同明确的等待或用户主动恢复；P0 客户端不得仅因收到这些状态自动重放智能创建，任何等待或重试也不得越过剩余 30 秒 hard deadline。不把尚未成为稳定标准的 `RateLimit-*` 草案字段写入 v1 契约，也不向客户端暴露可用于推断内部账户的精确供应商余额。

### 5. 幂等、admission 与隐私

幂等作用域固定为：

```text
anonymous grant subject
+ environment/audience
+ API operation
+ API major
+ contractVersion
+ requestId
```

首次通过基础校验后，TD-014 必须在同一原子操作中建立 admission 并预占额度；TD-013 只有获得唯一 execute lease 才能开始供应商执行链。TD-014 拥有 `reserved`、`provider_started`、provider 前失败、provider 后终态和取消的状态语义，`service-contracts.md` 拥有其可观察行为，`persistence-schema.md` 才拥有物理存储映射。

服务端必须对已经 Schema-valid 的语义请求计算带密钥、用途隔离且无歧义的幂等 digest。本文只决定 digest 必须绑定完整幂等作用域与请求语义；`security-and-privacy.md` 唯一拥有 primitive 选择和 key 生命周期，待登记的匿名服务规范性协议唯一拥有域标签、字段 framing 与 canonical bytes，API oracle 只固定字节样例而不产生规则。例如概念输入为：

```text
KeyedDigest(idempotency-purpose, framed-scope, canonical-request)
```

其中 scope 必须包含 `requestId`。短期安全状态只保存 digest、key version、无内容状态和时间，不保存/导出原始 body，也不进入普通日志、分析、APM 或诊断包。同一作用域和 `requestId` 但 digest 不同，返回 409 `idempotency_conflict`。

相同 digest 的并发重复不得取得第二个 execute lease 或重复预占/扣额：

- 原调用仍在同一受控执行上下文且能安全共享结果时，可以等待同一结果；
- 否则返回 409 `request_in_progress` 和受控 `Retry-After`；
- 终态结果仍在当前请求内存时可以回送同一 envelope；
- 结果已按 AI-110 清除时，只保留无内容 tombstone，返回 409 `request_replay_unavailable`，不得重新调用供应商或再次扣额。

客户端保留原输入；用户明确再次提交时创建新 `requestId`。tombstone/digest 的对外幂等保证至少覆盖客户端 hard timeout、一次退避重试、代理迟到窗口和服务端最大 deadline，精确保证期只由 `service-contracts.md` 定义；内部存储 TTL、删除和 key rotation 只由 `security-and-privacy.md` 定义，且不得短于公开保证或无限保留。

`requestId` 必须在响应中原样关联，并只进入 TD-014 的短期 admission/idempotency 安全状态；普通日志、metrics 和 traces 只使用服务端生成的随机、无内容 diagnostic request ID。两者都不是身份或授权凭据。

### 6. Deadline、取消与重试

- 客户端以 15 秒为 soft deadline、30 秒为 hard deadline；服务端内部 deadline 必须为网络回程预留时间，精确预算进入服务配置和合同。
- 客户端只可对没有收到 HTTP response 的暂时网络错误自动重试一次，沿用同一 `requestId` 并使用指数退避和抖动；409/429/503 只按上一节进入等待或用户主动恢复。开始重试前必须确认退避与剩余执行仍能落在 30 秒 hard deadline 内；用户取消后不得自动重放。
- HTTP client、代理和供应商 SDK 的隐藏 retry 必须关闭。TD-013 只能在唯一执行链内显式、串行地使用其受控 attempt 预算；POST 不因方法本身自动视为可重试。
- 断连/取消是 best effort。provider 已开始时，服务端仍完成受控清理和 at-most-once quota 结算；迟到结果不进入客户端已失效 generation，也不写领域数据库或调度提醒。

### 7. 缓存和内容暴露

- 匿名令牌、配额和 AI 请求/响应全部使用 `Cache-Control: no-store`；网关、代理和 CDN 不缓存 body。
- 服务端、API gateway、WAF、APM、错误追踪和 reverse proxy 的 body/header capture 默认关闭；授权材料按 allowlist 全部 redact。
- Problem Details、metrics 与 traces 只允许 AI-111/TD-016 的无内容字段；供应商 SDK/type 不得穿透到公共响应。
- 客户端生成的 ID、`clientBuild`、Installation ID 和请求字段均不可信；认证和授权只由 TD-014 的有效证明决定。

### 8. 契约工作流

`specs/api/openapi.yaml` 必须声明：

```yaml
openapi: 3.1.2
jsonSchemaDialect: https://json-schema.org/draft/2020-12/schema
info:
  version: 1.0.0
```

外部 `$ref` 在 CI 中 resolve/bundle；bundle 是构建产物。每次契约变更必须按适用范围一起更新 narrative、OpenAPI、AI Schema、API/AI fixture manifest、consumer/provider tests、兼容 diff 和链接检查。

CI 必须阻断 unresolved refs、OpenAPI lint 或 metaschema 失败、重复 example key、正负例与错误映射不一致，以及未经 major/contract 升级的 breaking diff。P0 OpenAPI 只含已决定的 P0 online surface；P1 同步/账号以后可以增加独立 tag 和合同，但不得提前扩大 P0 匿名 token 权限。

## Alternatives considered

### P0 保持纯本地，不建立 HTTP 在线边界

隐私与运维面最小，也保留全部手动功能，但无法交付已经确认的匿名智能创建、产品托管供应商凭据与统一额度控制。保留为在线能力关闭时的安全降级，不作为目标产品方案。

### OpenAPI 3.2.0

3.2.0 是截至本提案日期的最新规范，但 P0 不依赖其新增能力，现有 lint、bundle、codegen、外部 `$ref`、validator 和客户端生成链的兼容证据尚未归档。目标暂定 3.1.2；只有 3.1.2 工具矩阵全部通过才能接受。若 3.2.0 在激活前具备同等或更好证据，可在本 ADR 仍为 `Proposed` 时修订目标，接受后则以新 ADR 替代。

### GraphQL

P0 只有少量有界 command，没有选择字段图的收益，却增加错误、缓存、授权和版本治理复杂度。拒绝。

### gRPC-only 公共接口

类型和流式能力有价值，但移动代理、调试、商店网络环境和现有 JSON Schema 消费成本不合适。未来内部服务可另行决定，公共 v1 不采用。

### Header 或 media type 承载主版本

技术上可行，但路由、可观察性、废弃和并存版本不如 URI major 清晰。拒绝。

### API、AI contract、提示词和模型共用一个版本

会让供应商或提示调整无谓破坏客户端。拒绝，采用独立版本轴。

### Code-first 或把 AI Schema 复制进 OpenAPI

会形成两个机器权威并产生漂移。拒绝。

### 持久缓存完整请求/响应以永久重放

能提供更强 replay，却违反原始输入和完整模型响应不长期保存的边界。拒绝，采用短期无内容 tombstone，并在无法回放时保留客户端输入让用户明确重提。

### 把 Idempotency-Key / RateLimit 草案作为 v1 规范依赖

截至本决定日期仍不是可依赖的稳定标准，且项目已有业务 `requestId`。拒绝；未来标准稳定且确有互操作需要时以新兼容决策评估。

## Consequences

收益：

- 客户端与模型供应商解耦，API、AI Schema、提示和 adapter 可独立回滚；
- 错误可诊断又不泄露内容；业务降级不会被误报为 HTTP 故障；
- 匿名重试具备 at-most-once 逻辑执行链、execute lease 和额度结算语义；链内供应商调用由 TD-013 有界；
- v1/v2 可以并存迁移，机器契约和测试有单一入口。

成本：

- 需要严格的 OpenAPI/Schema CI、兼容矩阵和 consumer/provider 测试；
- admission store、execute lease、短期 tombstone 和 key rotation 增加服务端状态；
- 在不持久缓存完整响应的隐私边界下，成功响应丢失后可能只能提示用户新建请求，而不能永久 replay。

## Risks and mitigations

| 风险 | 缓解 |
| --- | --- |
| 409 恢复路径难理解 | 固定三个幂等错误码；客户端保留输入并只提供等待、重试原请求或明确新提交。 |
| 幂等 digest 被当作内容追踪标识 | digest 绑定 requestId、使用独立用途 key 和短 TTL；禁止导出到普通可观测性。 |
| 代理或 SDK 隐式重试启动第二条链 | admission 原子预占 + 唯一 execute lease；关闭隐藏 retry；链内 attempt 由 TD-013 统一计数并做故障注入验证。 |
| 新枚举让旧客户端误保存 | 封闭枚举的非安全扩展提升 contract；未知必要值 fail closed。 |
| Problem Details 泄露内部信息 | 字段 allowlist、快照测试、body capture 关闭和代理层扫描。 |
| CDN/中间层缓存敏感响应 | 全部 no-store，生产等价代理测试，不在 URI 携带内容或凭据。 |
| v1 停服使旧客户端失去智能入口 | 当前+上一兼容窗口、Deprecation/Sunset、最低客户端门；本地手动功能始终可用。 |

## Implementation constraints

- 客户端和服务端都必须对响应执行 Schema、版本与领域校验；未知关键值 fail closed。
- TD-012 定义外部 request scope/幂等/错误，TD-014 原子拥有 admission/quota，TD-013 只消费 execute lease 和报告 attempt；三者不得各建一套扣额或重试状态机。
- P0 endpoint 不访问生活数据库、其他记录、附件、联系人、位置、账号资料或历史智能会话。
- 任何配置关闭、鉴权失败或模型故障只关闭在线智能；五种手动入口和已有本地数据不受影响。
- 精确 path、wire field、status 和 wire constraint 只由 OpenAPI 定义；可观察 deadline、幂等保证期与恢复行为只由 `service-contracts.md` 定义；物理状态只由 `persistence-schema.md` 定义；内部保留与 key policy 只由 `security-and-privacy.md` 定义；正负 example 与 bytes 只由 API oracle/fixture 定义。本文不复制这些值生成代码。

## Verification

- 对 OpenAPI 3.1.2 和 3.2.0 运行同一 lint、bundle、codegen、外部 ref resolution、validator 与 Draft 2020-12 工具矩阵；只有目标 3.1.2 的客户端/服务端链全部通过且归档选择证据，才可接受本 ADR。正负 example 与 manifest checksum 必须匹配。
- 当前与上一兼容客户端分别通过 consumer/provider contract；breaking diff 覆盖字段删除、required、枚举、status、鉴权和幂等语义。
- JSON 对抗测试覆盖重复 key、非法 UTF-8、depth/token/body/数字上限、错误 content type 和未知版本。
- 错误矩阵证明所有业务状态只进入成功 envelope；401/403/409/413/422/429/502/503/504 都是合法、无内容的 Problem Details。
- 同一 `requestId` 100 并发、同 ID 不同 body、响应丢失、进程重启、lease 超时、key rotation、provider started 后取消等序列均最多一个 execute lease 和一次额度结算。
- 代理测试证明 URI/query/log/APM/cache 不含授权或生活内容，敏感响应均 no-store。
- 15/30 秒 deadline、无响应网络错误的一次 retry、jitter、409/429/503 非自动重放、`Retry-After` 手动恢复、迟到 generation 丢弃和 kill switch 逐项通过；关闭服务时本地手动闭环不受影响。

## Rollout and rollback

1. 先提交本 ADR，再建立 `service-contracts.md`、OpenAPI、AI Schema 身份迁移和 API/AI oracle；
2. 用 stub server/client 完成当前与上一兼容 consumer/provider 测试；
3. TD-013/014 只在相同 scope 和 admission/execute-lease 合同下实现；
4. 只使用合成输入做内部流量、故障和隐私扫描；OQ-001/OQ-002、治理生产门、TD-013～017 及适用安全/运维/发布规范全部关闭后，才可使用真实数据或公开测试并按地区/供应商灰度；
5. v1 上线后只做 additive-compatible 改动；breaking change 以新 major/contract 并存迁移；
6. 回滚只能回到仍实现同一 v1 语义并通过同一 oracle 的代码/配置，不得重新解释字段、删除已发布 status 或重做旧 requestId；
7. 新 major 失败时关闭新 route 并保留 v1；在线服务整体异常时关闭智能 route，客户端继续本地手动。

## References

- [OpenAPI Specification 3.1.2](https://spec.openapis.org/oas/v3.1.2.html)
- [OpenAPI Specification 3.2.0](https://spec.openapis.org/oas/v3.2.0.html)
- [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12)
- [RFC 9110：HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html)
- [RFC 9111：HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111.html)
- [RFC 9457：Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html)
- [RFC 6585：Additional HTTP Status Codes](https://www.rfc-editor.org/rfc/rfc6585.html)
- [RFC 9745：The Deprecation HTTP Response Header Field](https://www.rfc-editor.org/rfc/rfc9745.html)
- [RFC 8594：The Sunset HTTP Header Field](https://www.rfc-editor.org/rfc/rfc8594.html)
- [IETF Idempotency-Key draft history](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/history/)
- [IETF RateLimit header draft](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/)

## Revision notes

| 日期 | 说明 |
| --- | --- |
| 2026-07-27 | 治理勘误：状态改为 Proposed，补充威胁模型与工具矩阵接受门，并把幂等收敛为一条逻辑执行链和一次额度结算。 |
| 2026-07-27 | 首次提出 OpenAPI 3.1.2 contract-first HTTPS/JSON、URI major、Problem Details、独立版本轴和 requestId 幂等语义。 |

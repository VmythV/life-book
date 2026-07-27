# 生活有谱测试策略

> 项目代号：`life-book` · 版本：v1.0 · 更新日期：2026-07-27 · 状态：文档基线
>
> 权威范围：测试分层、适用矩阵、质量门、测试数据、故障注入、缺陷等级、波动治理及测试/evidence 的判定边界
>
> 不负责：业务需求正文、逐场景 Given/When/Then、根命令实现、机器合同内容、发布操作或生产监控配置
>
> 依赖文档：[质量属性](quality-attributes.md)、[系统架构](system-architecture.md)、[工程规范](engineering-standards.md)、[产品路线图](roadmap.md)、[ADR 索引](adr/README.md)、[文档治理](documentation-governance.md)

本文定义如何证明实现满足已有规则。具体用户验收场景由尚待建立的 `acceptance-spec.md` 唯一维护；本文件只规定这些场景应在哪一层运行、需要哪些环境和何时构成 Gate。

当前可以据此测试永久工程骨架和 TD-001 的合成 capability spike。首个正式持久化纵向切片、在线能力与发布候选仍需各自合同、oracle、验收和发布门，不能因为测试框架已经搭好而提前写入真实数据或接通生产服务。

## 1. 测试不变量

| 编号 | 不变量 |
| --- | --- |
| TEST-001 | 每项测试必须证明可观察行为或工程约束；测试实现、fixture 和 snapshot 不得创造第二套产品规则。 |
| TEST-002 | ADR `Accepted`、合同 `Normative`、oracle 自校验、implementation conformance 和 release evidence 是不同事实，必须分别留证。 |
| TEST-003 | Domain 单元测试无 React Native、SQLite、网络、系统通知和隐式系统时间；所有不确定输入显式注入。 |
| TEST-004 | 外部 adapter 开发采用 contract-first；主合同/paired contract/oracle 未过门时只能做合成、可丢弃的 capability spike。 |
| TEST-005 | 同一业务向量必须能复用于内存与真实 adapter、两移动平台及适用服务端实现，不能为某实现改写预期。 |
| TEST-006 | 事务、文件、通知、迁移、恢复和同步必须在命名提交点做失败/kill 注入；只测 happy path 不构成可靠性 evidence。 |
| TEST-007 | OS、设备、数据库、密码学和供应商行为以真实 release configuration/合同模拟器证据为准；mock 不能证明平台能力。 |
| TEST-008 | 测试、截图、日志和 artifact 只使用合成内容与合成凭据；真实生活内容和生产 secret 不得进入测试系统。 |
| TEST-009 | 适用 required test 首次失败即阻塞；rerun、quarantine、skip 或降低断言不能把未知状态变成 PASS。 |
| TEST-010 | Gate 按切片计算；无依赖的未来合同不阻塞当前切片，但关闭能力必须有不可达性测试。 |
| TEST-011 | 行覆盖率只能发现空白，不能替代规则分支、边界值、负例、property、mutation 或跨端 oracle。 |
| TEST-012 | 测试日志遵守产品日志 allowlist，不输出输入正文、标题、附件、密钥、路径、原始 provider response 或 SQL 参数。 |
| TEST-013 | 生产环境不是首次验证场所；不可逆格式、migration、权限和数据出站必须先在隔离环境通过。 |
| TEST-014 | 测试 evidence 必须绑定 Git SHA、合同/oracle digest、工具链、平台和命令；脱离这些身份的截图或“手测通过”不能复用。 |

## 2. 测试分层

| 层 | 主要对象 | 运行环境 | 典型失败 | Gate 作用 |
| --- | --- | --- | --- | --- |
| 静态与文档 | 格式、类型、import、链接、状态、ID、秘密模式 | 干净 checkout | 依赖越界、非法状态、broken link、secret | 每个 PR |
| Domain unit | value object、实体、不变量、确定性函数 | 无平台 Node 进程 | 规则结果错误、隐藏全局输入 | 每个 PR |
| Property/mutation | 标量、排序、重复、状态机、parser | 固定 seed 的纯进程 | 边界遗漏、等价类错误、断言无效 | 受影响核心 PR/完整门 |
| Component | 页面状态、表单、a11y semantics | React Native 测试环境 | 状态遗漏、焦点/标签错误 | UI PR |
| Architecture | import 图、composition root、关闭能力 | 静态图 + 合成装配 | adapter 泄漏、环、生产 SDK 可达 | 每个 PR |
| Port contract | 同一 port 的 fake/真实 adapter | 参数化 suite | fake 与真实行为漂移 | adapter 合入前 |
| Contract/oracle | Schema、byte、SQL、OpenAPI、golden/negative | 独立校验器 | 字段/bytes/兼容错误 | 合同与实现 Gate |
| Integration | SQLCipher、文件、Keychain/Keystore、通知、HTTP | 真实库/平台或受控服务 | I/O、资源、生命周期错误 | 相应切片 |
| Kill-point | transaction、migration、附件、恢复、task | 可终止进程/故障 adapter | 部分提交、错误恢复 | 持久切片 |
| Native/platform | CNG、权限、后台、分享、通知、安全存储 | 模拟器 + 真机 release | 平台差异、debug-only 成功 | 原生切片/发布 |
| End-to-end | 用户关键任务与恢复路径 | 完整候选 App | 层间编排/文案/导航错误 | 里程碑/发布 |
| Performance/resource | QR 延迟、容量、内存、电量、存储 | 参考设备 release | 回归、泄漏、超限 | 里程碑/发布 |
| Security/privacy | 威胁控制、日志、secret、出站、权限 | 静态 + 动态 + 人工评审 | 泄露、越权、不安全降级 | 安全切片/发布 |

单元快不等于真实，真机真实也不等于覆盖全面。每个风险放在最便宜且能证明它的最低层，同时为跨层契约保留少量集成/端到端证据。

## 3. Gate 与 evidence 模型

### 3.1 五道独立门

| 门 | 回答的问题 | 不能由什么替代 |
| --- | --- | --- |
| 文档/ADR 门 | 需求、边界和技术选择是否可以实施？ | 测试代码、prototype |
| Contract Gate | 字段/bytes/版本是否唯一、稳定且成套？ | TypeScript interface、ORM model |
| Oracle Gate | 独立实现者能否重算相同预期？ | 实现自己的单元 snapshot |
| Implementation Gate | 当前实现是否在指定平台通过 oracle/合同？ | ADR/合同状态、mock |
| Release Gate | 当前候选是否具备安全、平台、运营和回滚证据？ | 某次开发机通过、历史版本 evidence |

oracle manifest 和 fixture 是预期的可执行表达，不是产品实现 evidence。实现通过后，CI 生成的 conformance index 必须绑定当前 Git、合同和 oracle digest；发布 evidence 再绑定候选版本、签名构建、环境与运行检查。任何过期身份都回到 `MISSING/BLOCKED`，不能手工改成 `VERIFIED`。

### 3.2 结果状态

测试任务只能产生：

- `PASS`：适用集合完整运行并满足阈值；
- `FAIL`：至少一个适用检查失败；
- `BLOCKED`：缺前置合同、环境、设备或工具，尚不能作出结论；
- `NOT_APPLICABLE`：由阶段 registry 明确证明本切片不适用。

`SKIPPED`、`QUARANTINED`、进程异常、超时或没有收集到结果都不能汇总为 `PASS`。重新运行必须保留前次失败和原因；只有修复或证明基础设施故障后，新结果才可形成新的 evidence。

## 4. 永久工程骨架测试门

### 4.1 开始条件

开始写骨架只要求 TD-001/002、系统架构、工程规范、实施计划和本测试策略已形成合法基线，并由最新治理快照确认该 scope。没有代码时不要求虚构 implementation evidence。

### 4.2 每个骨架 PR

骨架建立后，每个 PR 至少通过：

1. frozen install，lockfile 与工具链身份一致；
2. `format:check`、lint、strict typecheck；
3. Domain/component 的适用 unit tests；
4. architecture tests：层级、跨模块 public entry、production→test-support 禁止和 composition root allowlist；
5. docs link/status/ID、generated zero-diff、dependency 与 secret checks；
6. 测试进程无外网、无开发机 secret、无真实内容；
7. 配置缺失/非法时 fail closed，关闭 adapter 返回明确 unavailable 而非 success；
8. 涉及 app config、plugin、native dependency 时做 clean CNG 与双平台 compile；
9. 生成后工作树 clean，artifact 中不包含 `.env`、凭据或绝对开发机路径。

architecture suite 必须包含故意违规的最小 fixture 或 checker 自测，证明 Presentation→Adapter、Domain→React Native、跨模块 deep import、production→test-support 和关闭 SDK 注册确实会导致失败，而不是一条永远为绿的空规则。

### 4.3 骨架完成检查

- 安全静态 App 壳在 iOS/Android Development Build 与 local release configuration 启动；
- 无数据库、通知、网络或遥测时 composition root 仍可构造，且 UI 不展示“已保存/已同步”等虚假结果；
- fixed Clock/ID/Random 的纯 Domain 样例在重复运行中 byte-for-byte 输出一致的**非持久测试结果**；
- 删除 capability spike 后普通构建和测试不变；
- M0 required root commands 在干净 checkout 可复现；
- 结果只证明工程骨架，不命名为 P0 功能 conformance 或 release evidence。

## 5. TD-001 capability spike

capability spike 用于发现技术栈反证，不激活生产合同。它必须使用独立入口、合成数据、release configuration 和锁定工具链；失败会暂停相应切片并触发替代方案评估。

| 能力 | iOS/Android 最低证据 | 不构成的证明 |
| --- | --- | --- |
| Development Build/CNG | 干净生成、Development Build、本地 release build；无 Expo 在线服务仍能构建/运行本地壳。 | TD-017 分发/OTA 可发布。 |
| SQLCipher | 合成库创建、事务、candidate migration、关闭重开、错误 key；不保留格式。 | 正式 Schema、bootstrap 或用户数据可写。 |
| 加密文件 | 合成 50 MB 文件分块读/写、认证、取消、异常清理；无明文残留。 | 正式附件/备份格式。 |
| 通知 | 合成 category/request 的调度、取消、点击、动作；Android 区分 exact/approximate capability。 | 产品通知合同、准时展示或用户已读。 |
| Keychain/Keystore | 合成 key 的封装/解封、认证取消、设备锁定与凭据变化。 | 正式 installation anchor/key envelope。 |
| 文件/分享/deep link | 合成文件选择、分享、拒绝/取消、受控 deep link。 | 正式导出/恢复或外部 URI 可长期保存。 |
| 生命周期/后台 | 前后台、被杀恢复、窄 background entry 和安全遮罩。 | 正式 task/notification recovery 状态机。 |
| 无障碍 | VoiceOver/TalkBack、最大字体、Reduce Motion、最小命中区的组件样例。 | 全部页面验收。 |
| 诊断 | 崩溃符号、受控日志与 source map 使用无内容样例。 | 允许接入生产遥测或第三方 collector。 |

第 1～6 项任何关键能力不能在 iOS 16 和 Android 10 的适用设备/模拟环境以可维护方式完成，都不能用 mock 接受 TD-001。spike 报告至少记录 Git SHA、设备/OS、release/debug、精确依赖、步骤、结果、已知限制和删除/保留决定；它属于技术可行性证据，不写入 `evidence/conformance/index.json` 冒充正式合同符合性。

## 6. 领域与应用测试

### 6.1 决定表与边界

每个稳定 `BR-*`、`TIME-*`、`REM-*`、`SEARCH-*` 规则至少覆盖：

- 一个最小合法例和适用的最大/边界例；
- 每种显式拒绝原因；
- 状态迁移前置、成功和重复调用；
- 固定 Clock/ID/Random/locale/time zone 下的结果；
- 不同模块组合时的事务与错误传播；
- 对未来/未知枚举和版本的 fail closed。

测试标题引用 rule ID 便于追溯，但预期值必须从权威规范/oracle 人工编码或独立生成，禁止调用待测函数生成自己的 expected。

### 6.2 Property 与 mutation

下列算法必须有 property/generative tests：

- ExactDecimal、LongCounter、SortKey 的 parse/format/order/overflow；
- repeat/recurrence 的单调性、区间边界、规则切分和历史不变；
- inventory 不可变流水与派生数量；
- checklist 派生进度、批量完成/重开；
- 幂等 command/task/notification action；
- parser、manifest、backup framing 与未知字段/版本拒绝。

随机测试保存 seed、生成器版本与最小化反例。核心规则的 mutation run 必须证明关键断言能杀死改变比较符、边界、去重和错误类别的 mutation；mutation score 是诊断，不用一个仓库总百分比掩盖高风险存活项。

## 7. 合同、adapter 与跨实现测试

### 7.1 Contract suite

一个 port 的 in-memory fake 与每个 production adapter 运行同一 contract suite，验证：

- 成功结果、幂等和稳定排序；
- validation/conflict/permission/transient/capacity/integrity/unsupported 映射；
- cancellation、deadline 与迟到结果；
- 资源释放、重复 close/cancel；
- 不含内容的日志与 diagnostic ID；
- 未知版本、额外/缺失字段和安全降级。

fake 可以增加故障注入能力，但不能接受 production adapter 会拒绝的输入。fake 与真实 adapter 分歧时，先核对权威合同；不能为了让现有实现通过而修改共享 expected。

### 7.2 Oracle

每个机器合同的 oracle 至少包括 manifest、checksums、golden、边界、negative 和独立自校验命令。适用时由另一语言/实现重算，而不是只由合同生产者运行一次。Schema valid 不能替代跨字段算法、byte offset、AAD/hash 或 SQL 行为验证。

合同变更必须运行旧 reader/new writer、new reader/old writer 及声明兼容窗口中的历史 fixture。破坏变化新增身份和 migration，不改写旧 fixture 让历史变绿。

## 8. 持久化、安全与恢复

本节只有在相关合同过门后才成为 implementation Gate。

### 8.1 数据集与 SQLCipher

至少覆盖：strict all-absent 初始化、partial/invalid presence、错误 key、unknown Schema/cipher/control、candidate build、migration、activation CAS、receipt/anchor 不匹配、旧 generation 回收和磁盘不足。每个 commit/rename/fsync/anchor/receipt 点都要故障注入，结果只能是旧数据集完整或新数据集完整，不得混合。

Repository contract suite 同时运行内存与 SQLCipher adapter；SQL 结果和 mapper 必须与领域 DTO 相同。禁止测试失败时自动删库重建，因为这会掩盖 QR-031 风险。

### 8.2 密钥与应用锁

覆盖首次 bootstrap、all-absent/partial 状态、Keychain/Keystore 锁定、认证取消、凭据变化、重包、错误 key、前后台遮罩、截图/任务预览和恢复入口。测试日志、crash report 和 JS exception 搜索 key、明文、路径和输入 canary，出现即失败。

### 8.3 附件与备份

- 附件覆盖明文 temp、分块认证、hash、取消、进程终止、引用绑定、提升、缩略图和垃圾回收所有提交点。
- 备份覆盖 KAT/golden bytes、错误口令、header/manifest/ciphertext 篡改、截断、重复/路径穿越、未知 suite/profile、空间不足与取消。
- 恢复在原数据存在时注入每个失败点并证明原数据/附件/设置不变；成功后验证 portable mapper、完整性、搜索重建和提醒对账。
- 已声明兼容的每个旧备份版本都做新版本恢复；新备份不得由不支持的旧 binary 误读为成功。

## 9. 时间、提醒与平台真值

时间 oracle 覆盖 Gregorian 边界、闰年/月末、DST gap/overlap、时区切换、tzdb 升级、规则结束与历史实例不变。支持范围外返回 `unsupported`，不能以系统 `Date` 或在线服务近似。

通知测试分三层：

1. 纯规则：ReminderPlan/Instance、动作适用性、dedup、滚动窗口与对账决定；
2. adapter contract：request/category/action、accepted/permission/capability、取消与 stable ID；
3. 平台真值：iOS pending requests，Android adapter registry/receipt/generation 与强制重挂触发。

设备关机、勿扰、通知摘要和 OEM 限制不伪造为 App 可控 PASS。证据分别记录“请求被平台接受”“计划仍在可管理证据中”“系统展示”“用户动作”，不得从前一项推导后一项。

## 10. 搜索、查询和性能

- 搜索使用合成中文、ASCII、空白、标点、敏感/归档/删除、分类标签与稳定排序数据集；验证删除索引后可从事实重建。
- 查询验证分页 tie-breaker、projection stale/rebuild、隐私裁剪和并发 invalidation；不允许旧 DTO 写回事实。
- 性能至少准备空库、小数据和 [QR-020](quality-attributes.md) 设计容量数据集；生成器固定 seed 和版本。
- QR-010～013/020/100/101 在 release configuration、关闭 debugger、记录设备/温度/可用存储的条件下测量；百分位至少按质量属性要求的样本数。
- 性能失败先保留 trace/受控计数和复现输入，不用扩大 timeout 或降低数据量作为唯一修复。

## 11. 在线 API、AI、同步与家庭

### 11.1 P0 在线（当前关闭）

在 TD-012～017 与相应合同过门后，使用合成内容验证：OpenAPI request/response、状态码、idempotency、deadline/cancel、DPoP/admission、lease/settlement、限流、provider attempt 上限和跨供应商 Schema 结果。provider simulator 必须覆盖 malformed JSON、Schema invalid、超时、429、5xx、断连和迟到响应。

路由测试证明一次 logical request 只走 TD-013 允许的修复/回退路径；取消/客户端断开后不开始第二次 provider 调用。网络记录和 test artifact 只保留内容-free metadata。真实 provider 只在第三方处理、地区、留存和安全门通过后做受控合成 smoke，不能使用生活内容。

### 11.2 P1/P2（当前关闭）

同步至少需要双设备离线并发、分页 cursor、idempotent push/pull、墓碑、规则冲突、附件断点/校验、snapshot generation、退出登录与删除收敛。服务端授权测试逐操作覆盖账号、设备、空间和 membership，不能以客户端隐藏按钮代替。

家庭增加邀请竞态、角色变化、成员移除、所有权转移、空间迁移与旧缓存拒绝；Web/移动使用同一授权/合同向量。OQ-006 和 TD-018～027 未过门前，本节只有测试设计意义，不授权实现 production server 或入口。

## 12. 端到端、无障碍与本地化

`acceptance-spec.md` 建立后，每个 P0 `PR-*` 和 `QR-*` 至少映射一个可执行或明确人工场景。关键路径包括首次启动、创建/编辑/查找、提醒动作、应用锁、权限拒绝、备份/恢复、空间不足、升级和数据完整性阻断；在线关闭时本地闭环必须独立通过。

每个用户结果至少验证成功、取消、可重试失败、不可恢复/需修复失败和进程重启恢复中的适用分支。端到端测试不通过直接写数据库跳过用户路径，只有准备大数据或故障 artifact 时可使用受控 test-only importer，且不能进入 production bundle。

无障碍检查组合自动化与 VoiceOver/TalkBack 人工真机：读屏顺序、名称/角色/状态、焦点恢复、动态字体、对比度、最小命中区、Reduce Motion、键盘/外接输入及错误定位。截图回归只辅助发现视觉变化；被遮罩的敏感内容还必须从可访问性树和 snapshot 数据源移除。

至少在简体中文与伪本地化验证截断、复数/占位、日期格式和 RTL 结构准备；业务存储语义不得随显示 locale 改变。

## 13. 测试数据与环境

### 13.1 数据集

| 数据集 | 用途 |
| --- | --- |
| `minimal` | 单一合法对象和快速 PR tests。 |
| `boundary` | 最大/最小、空值、未知版本、时间与数值边界。 |
| `design-capacity` | 50,000 记录、250,000 子对象及 QR-020 关系/附件元数据规模。 |
| `historical` | 每个受支持 Schema/backup/API/contract 身份的不可变 fixture。 |
| `corrupt-negative` | 截断、篡改、冲突、错误 key、路径攻击和非法状态。 |
| `privacy-canary` | 明显可搜索的合成标记，用于证明日志/artifact 不泄露。 |

生成数据不得使用真实姓名、地址、生日、物品清单、附件或用户智能输入。合成中文内容也要明确标记为虚构。fixture 一经用于兼容承诺即不可原地改写；新增规则创建新身份或新 fixture。

### 13.2 环境层级

- 纯 Node：Domain、property、architecture、Schema/oracle；默认断网。
- 模拟器/emulator：快速 UI、CNG、权限和生命周期回归；不替代真机。
- 最低/主流/最新真机：按 QR-001/002 和发行相关 Android 厂商矩阵。
- 隔离 integration service：只用合成租户/内容/secret，网络和成本有硬上限。
- 发布候选环境：与生产配置类别相同但使用隔离账号、route 和数据；生产不承担 destructive test。

环境不能满足适用条件时结果为 `BLOCKED`，不得换用更强设备或 mock 后沿用同一 evidence 标签。

## 14. 缺陷等级与处置

| 等级 | 示例 | 合入/发布规则 |
| --- | --- | --- |
| S0 阻断 | 数据丢失/损坏、未授权读取、secret/生活内容泄露、不安全恢复、远程执行边界突破 | 立即停止相关 Gate；修复并完成影响审计，不能豁免。 |
| S1 严重 | 核心闭环不可用、业务状态错误、重复通知动作、升级失败、应用锁绕过、关键无障碍任务不可完成 | 不得进入受影响里程碑或候选。 |
| S2 主要 | 有安全替代路径的局部功能错误、明显性能回归、非关键平台差异 | 必须有 owner、隔离和退出条件；是否阻塞由当前里程碑 DoD 决定。 |
| S3 次要 | 不改变含义的视觉/文案小问题 | 可排入后继，但不得掩盖为测试通过。 |

严重度按最坏可信影响而非复现概率降低。任何能造成静默数据丢失或隐私泄露的问题不以“只出现一次”降级。

## 15. Flaky、quarantine 与维护

- required test 首次失败保留为该次执行的 `FAIL`；自动 rerun 只帮助诊断，不能抹去原结果。
- 只有证据表明测试基础设施不稳定、且产品风险有另一项可靠检查覆盖时，才可临时 quarantine；记录 owner、原因、影响 Gate 和移除条件。
- quarantine/skip 的适用检查使对应完整 Gate 保持 `BLOCKED`，不能计入通过率。
- 随机测试固定并输出 seed；时间测试固定 Clock/tzdb；网络 simulator 使用确定脚本；真机不稳定记录 OS/设备/电量/权限状态。
- 测试与生产 owner 共同维护合同 suite；发现 fake 比真实实现宽松时在同一 change train 修正 fake 和受影响测试。
- 不再对应当前需求的测试先确认兼容/历史用途，再删除；不能通过删历史 fixture 修复失败。

## 16. 执行频率矩阵

| 时机 | 必须运行 |
| --- | --- |
| 每个 PR | M0 适用静态、type、unit、architecture、生成、依赖、secret；按改动触发合同/集成/native。 |
| 主分支完整门 | 全 workspace unit/property、激活合同与 integration、双平台 release compile。 |
| 定期受控任务 | 设计容量性能、依赖/漏洞、长时间通知/后台、fuzz 与历史兼容矩阵。 |
| 里程碑候选 | 当前切片全部验收、真机、升级/恢复、无障碍、安全和性能。 |
| 发布候选 | P0/P1/P2 适用 E2E、历史 conformance、迁移/回滚、运营与法律证据。 |

定期任务的日历频率由团队容量和发布规范确定；OQ-008 未关闭前本文不虚构具体日期。一次定期任务失败必须阻断其影响的下一候选，不能因为不是 PR check 而忽略。

## 17. 当前结论

| Scope | 测试准备状态 | 可执行动作 |
| --- | --- | --- |
| 永久工程骨架 | 策略与门完整；待代码创建后产生实现结果。 | 可以开始编码并建立第 4 节 checks。 |
| TD-001 capability spike | 场景完整；只需骨架工具链和合成数据。 | 可与骨架并行，结果不升级为正式合同 evidence。 |
| 首个 P0 持久化切片 | 验收规范、叙事安全/持久化和合同/oracle 缺失。 | 只写不会序列化的纯逻辑；不得保存第一条真实数据。 |
| P0 在线 | TD-012/013 `Proposed`，其余 ADR/合同/运营门缺失。 | 仅 fake/simulator/合成 spike。 |
| P1/P2 | 产品/安全/ADR/合同门未满足。 | 保持关闭，不建立 production tests 来反向冻结架构。 |

## 18. 变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| v1.0 | 2026-07-27 | 建立测试分层、evidence 边界、永久骨架与 TD-001 spike 门，以及后续领域、合同、持久化、平台、在线和发布测试矩阵。 |

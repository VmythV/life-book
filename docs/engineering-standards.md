# 生活有谱工程规范

> 项目代号：`life-book` · 版本：v1.0 · 更新日期：2026-07-27 · 状态：文档基线
>
> 权威范围：物理代码组织、命名与 import 约束、TypeScript 规则、依赖和工具链锁定、配置与秘密、生成物、开发命令、CI 最低合入门、Git/评审及原生代码约束
>
> 不负责：系统拓扑、业务算法、物理 DDL、API 字段、测试覆盖矩阵、签名/灰度/回滚步骤或具体云运行时
>
> 依赖文档：[系统架构](system-architecture.md)、[文档治理](documentation-governance.md)、[ADR 索引](adr/README.md)、[TD-001](adr/0001-mobile-client-stack.md)、[TD-002](adr/0002-offline-first-client-architecture.md)、[TD-006](adr/0006-cross-platform-scalar-representations.md)、[TD-007](adr/0007-time-recurrence-engine.md)

本文首先约束 P0 客户端永久工程骨架及后续客户端代码。服务端运行时、容器与部署工具必须等待 TD-015，签名、内部分发、OTA 与发布通道必须等待 TD-017；两项尚未建立时，本文件不会通过目录或脚本提前替它们做决定。

本文不固定会过期的 Node、pnpm、Expo、React Native、Xcode 或 JDK 小版本。创建骨架时必须核验当时官方稳定兼容矩阵，把**精确选择**写入版本文件、manifest、lockfile 和 CI image；以后只通过受控升级变更。

## 1. 工程不变量

| 编号 | 不变量 |
| --- | --- |
| ENG-001 | 仓库使用一个 JavaScript workspace、一个包管理器和一个 lockfile；本地与 CI 从同一锁定输入安装。 |
| ENG-002 | 代码依赖遵循 Presentation → Application → Domain ← Ports ← Adapters；规则由静态检查执行，不靠评审记忆。 |
| ENG-003 | 跨模块只允许导入公开入口，禁止 deep import、循环依赖、跨模块私有目录和 adapter 互调。 |
| ENG-004 | 所有 TypeScript 产品代码使用严格配置；边界运行时校验不能用静态类型、cast 或 non-null assertion 替代。 |
| ENG-005 | 时间、ID、随机、locale、time zone、平台状态与配置显式注入；测试不得篡改隐式全局状态。 |
| ENG-006 | 可预期失败使用封闭结果类型；原生、SQLite、HTTP 或 SDK 异常必须在 adapter 边界转换。 |
| ENG-007 | TD-006/007 的标量和时间实现只有一个项目封装入口；业务代码不得使用近似数值或平台默认解析绕过。 |
| ENG-008 | 每个生产依赖必须直接声明、精确锁定并通过许可、维护、安全、数据出站和退出路径审查。 |
| ENG-009 | 配置从 typed Config Port 读取并启动时 fail closed；secret 不得进入移动 bundle、仓库、日志、fixture 或 source map。 |
| ENG-010 | `specs/`、CNG 配置和人工接受的 migration 是权威输入；生成物不得成为第二 owner 或接受不可重放手改。 |
| ENG-011 | 根命令是本地与 CI 的统一接口；CI 不维护一套隐藏的等价脚本，也不得用无条件 no-op 伪造通过。 |
| ENG-012 | 关闭阶段的生产 SDK、adapter、route 和 workspace 不得提前创建；合成 fake 不得伪装为生产实现。 |
| ENG-013 | 文档、合同、oracle、implementation evidence 与 release evidence 分开提交、检查和表达状态。 |
| ENG-014 | 规则例外必须局部、可追溯、有 owner/退出条件；不得用长期全局 disable 绕过工程门。 |

## 2. 仓库与 workspace

### 2.1 根布局

永久骨架采用 pnpm workspace 与 Corepack，根 `package.json` 必须为 `private`，并在 `packageManager` 固定完整 pnpm 版本。Node 精确版本同时写入一个受版本控制的运行时版本文件和 CI；若两者不一致，安装必须失败。

```text
apps/
  mobile/
    app.config.ts
    src/
      shell/
        composition/
        navigation/
        presentation/
      modules/
        <module>/
          domain/
          application/
          ports/
          adapters/
          presentation/
          public.ts
      platform/
packages/
  scalar/
  time/
  tzdb/
  contracts/
  ui/
  test-support/
docs/
specs/
tools/
```

布局规则：

- `apps/mobile` 是 Expo Development Build/CNG App；`shell/composition` 是创建具体 adapter 的唯一生产位置。
- `modules/` 的合法模块名来自 [系统架构](system-architecture.md)；只创建当前切片需要的目录，不建立空的 P1/P2 入口。
- `domain` 和 `application` 必须可在无 React Native 的 Node 测试进程运行；`presentation` 与 `adapters` 是外层。
- `platform` 只放跨模块平台 adapter 和 CNG 接线，不放业务规则。
- `packages/scalar` 发布内部包 `@life-book/scalar`，是唯一允许导入 `jsbi` 的业务包。
- `packages/time` 发布 `@life-book/time`；`packages/tzdb` 发布随二进制锁定的 `@life-book/tzdb` 资产。二者不得依赖 React、SQLite、网络或通知。
- `packages/contracts` 只包含由已激活机器合同生成或包装的类型/validator，不拥有合同语义；合同未过门前不放临时 production DTO。
- `packages/ui` 只拥有共享展示组件和可访问性实现，不读取 Repository、HTTP、密钥或领域事实。
- `packages/test-support` 只导出 builder、fake、fixed source 与 fault adapter；production graph 对它的 import 必须被静态禁止。
- `tools` 放 codegen、fixture、lint、文档和 CI wrapper；工具不得在运行时 bundle 中被 import。
- 服务端目录只有在 TD-015 `Accepted` 后按该 ADR 创建；禁止先建立“临时但保留”的 `server`/`api` workspace。

根目录只允许一个 `pnpm-lock.yaml`，不得提交 `package-lock.json`、`yarn.lock` 或子 workspace lockfile。CI 和受控本地验证使用 frozen lockfile。

### 2.2 包与模块公开面

- workspace 包名统一使用 `@life-book/<name>`；内部包不得发布到公共 registry。
- 每个模块的唯一跨模块入口是 `public.ts`；它只导出明确的 facade、command/query/result、只读 DTO 或领域结果。
- 同模块内部使用显式相对路径；跨 workspace 使用 package `exports`。禁止全局 `@/` alias 隐藏依赖层级。
- `public.ts` 不导出 ORM row、文件路径、SDK 对象、可变聚合或 adapter constructor。
- 跨模块业务事务由上层 application use case 编排；不得通过一个巨大 `common`/`shared-service` 包规避所有权。
- 任何新跨模块边都必须进入依赖图和 architecture test；发现环时重新划分职责，不能用动态 import 掩盖。

## 3. TypeScript 和命名

### 3.1 编译约束

共享基础配置必须开启 `strict`，并至少开启：

- `noUncheckedIndexedAccess`；
- `exactOptionalPropertyTypes`；
- `useUnknownInCatchVariables`；
- `noImplicitOverride`；
- `noFallthroughCasesInSwitch`；
- `noImplicitReturns`；
- `forceConsistentCasingInFileNames`。

`target`、`module`、JSX 和 resolution 模式跟随已验证的 Expo/React Native 工具链，不在本文写死。生产代码禁止隐式 `any`；显式 `any`、双重 cast、non-null assertion 和文件级检查关闭只能按第 14 节做局部例外。`catch` 值保持 `unknown`，先分类再使用。

所有外部 JSON、导航参数、deep link、原生模块结果、数据库 row、env/config、文件 manifest、HTTP 和 provider 响应都必须在所属边界运行时校验。parser 返回受控结果，不把“TypeScript 已声明接口”当作数据可信证明。

### 3.2 命名与文件

| 对象 | 规则 | 示例 |
| --- | --- | --- |
| 文件、目录、package path | `kebab-case` | `create-record-handler.ts` |
| type、class、React component | `PascalCase` | `CreateRecordCommand` |
| value、function、hook | `camelCase` | `createRecord` |
| 编译期常量 | `UPPER_SNAKE_CASE` | `MAX_BATCH_SIZE` |
| 协议枚举/error code | owner 定义的 lowercase `snake_case` | `integrity_failed` |
| port | 能力名 + `Port` | `NotificationSchedulerPort` |
| adapter | 技术/平台名 + `Adapter` | `IosNotificationAdapter` |
| command/query/result/DTO | 用途写入名称 | `RebuildSearchResult` |

禁止无边界的 `common.ts`、`utils.ts`、`helpers.ts` 或 `misc/`。复用函数必须按拥有的概念命名并放入最窄 owner。纯类型 import 使用 `import type`；副作用 import 只允许经审查的入口文件、polyfill 或生成代码 bootstrap。

## 4. 标量、时间和确定性

### 4.1 标量

- Entity、command、operation、diagnostic 与 request ID 使用不同 branded type，不得互相复用；生成规则继承 TD-006。
- P0 Hermes 的 `ExactInteger` adapter 使用 TD-006 固定的 `jsbi@4.3.2`；只有 `@life-book/scalar` 可直接导入 JSBI，其他代码只调用项目 value object API。
- `ExactDecimal`、`SortKey`、`Revision` 和 `LongCounter` 只用 TD-006 的精确语义；禁止用 `number`、`parseFloat`、隐式舍入或原生 BigInt literal 代替。
- P0 没有产品 Money 类型。未来引入金额前必须先定义 currency、scale/minor unit、rounding 和 exchange 语义；不得把 Quantity 偷作金额。
- 在 `specs/scalars/v1.md` 与 oracle 过门前，纯内存实现可以验证接受 ADR 的算法，但不得产生 production JSON、SQLite 或原生 bridge 编码。

### 4.2 时间和环境输入

- Domain/Application 只能通过注入的 `Clock`、`IdGenerator`、`RandomSource`、`LocaleSource` 和 `TimeZoneSource` 获取不确定输入。
- 业务 `Instant`、`LocalDate`、`LocalTime` 和 `TimeZoneId` 只由 `@life-book/time` 解析/运算；禁止裸 `Date` 解析本地日期。
- deadline、timeout 与 duration 使用单调时钟和带单位类型；变量名/类型必须带 `Ms`、`Seconds` 等单位，禁止裸数字混用。
- 测试显式构造 fixed source，不修改进程全局时区、系统时间或 `Math.random`。
- 生产 runtime 不下载或隐式更新 tzdb；资产版本、范围与 digest 由 TD-007 和对应合同拥有。

## 5. 结果、错误、取消和资源

可预期的 validation、conflict、permission、transient、capacity、integrity、unsupported 与 cancellation 使用封闭 discriminated union/Result 表达。异常只用于程序不变量被破坏或 adapter 未预期故障；禁止 `throw string`。

adapter 必须在边界完成：

1. 将原生/SQLite/HTTP/SDK 错误映射为受控类别和稳定内部 code；
2. 丢弃供应商正文、堆栈、设备路径、SQL 和可能含内容的 message；
3. 保留无内容 diagnostic ID、retryability 和安全的修复提示；
4. 在 `finally` 或等价结构释放 transaction、statement、stream、file handle、listener、timer 和 abort handler；
5. 把用户取消与超时建模为明确 outcome，不混成未知异常。

Application result 必须区分 `committed`、`sideEffectsPending` 与 `warnings`，不能用一个 boolean `success` 隐藏部分结果。UI/API 不得看到 Java/Swift exception、SQLite code、原始 HTTP response、provider message 或 stack trace。跨进程/网络稳定 error code 的具体值由对应合同拥有，本文件不另建第二列表。

异步函数必须接收或显式创建有 owner 的 cancellation/deadline；调用者结束后移除 listener。不可取消的原生操作要返回“取消后忽略结果”的明确语义，迟到结果不得写入已替代 session。

## 6. 依赖与工具链治理

### 6.1 选择与锁定

- manifest 禁止 `latest`、`*`、浮动 git branch 和运行时 CDN dependency。
- 生产代码只能导入当前 workspace 直接声明的依赖，不能依赖 hoist 出来的 transitive package。
- Expo/React Native/React/Hermes 使用官方兼容组合；Hermes 随 React Native，不独立混装。
- manifest、lockfile、版本文件和 CI image 必须在同一变更中更新；`pnpm install --frozen-lockfile` 可重复成功。
- 精确版本、完整依赖图、license 与 digest 进入 lockfile/SBOM，不复制到会过期的叙事段落；ADR 已固定的正确性版本例外，以 ADR 为准。
- 不在一次升级中同时改变框架 major、数据库格式、备份格式和通知协议。

### 6.2 新增/升级审查

每个 production dependency 必须记录并由代码评审确认：

- owner、用途和为什么不能由现有依赖/小型本地代码满足；
- 许可、维护活跃度、已知安全公告和供应链风险；
- install/build script、原生代码、权限、数据出站与遥测行为；
- bundle/启动/内存影响和目标平台/New Architecture 支持；
- 升级、替换、移除和数据/协议退出方式。

crypto、安全存储、数据库、通知、provider SDK、原生模块与会发送数据的依赖需要相应领域 owner 复核。依赖主版本升级或改变系统边界、持久格式、平台能力时先评估 ADR；普通补丁也必须通过锁文件、测试、安全和许可门。

## 7. 配置、feature gate 与秘密

### 7.1 配置分类

| 类别 | 示例 | 规则 |
| --- | --- | --- |
| 可公开构建配置 | app 内部 ID、非秘密 feature 默认值 | typed allowlist 后可进入移动 bundle；仍须验证。 |
| 受控部署配置 | 服务 base URL、地区 route、诊断采样 | 只在对应阶段过门后由受信配置提供；改变 host/信任边界需评审。 |
| secret | provider key、签名私钥、证书口令、KMS 值 | 只在适用 secret manager/CI protected store；永不进入客户端或仓库。 |

代码只从 typed Config Port 读取配置。`process.env`、Expo Constants、Info.plist、Android resources 和 native build config 只能由最外层 config adapter 读取；启动时 Schema 校验，缺失、未知或非法值 fail closed。测试传显式 config object，不修改开发机全局环境。

`.env.example` 只允许键名、注释和显然无效的合成值。真实 `.env*`、凭据、证书、provisioning material、provider key 和真实 endpoint token 必须被忽略并由 secret scan 阻止提交。`EXPO_PUBLIC_*` 永远按公开数据处理。

产品供应商 key 只存在于未来服务端 secret manager。remote config 只能关闭/收紧可选在线能力，不能切换到未审核 host、改变 ID/时间/密码/Schema/迁移语义或提高安全硬上限。debug flag 不得在 release 中绕过应用锁、证书、数据门或日志裁剪。

### 7.2 阶段 gate

每个可选 adapter 在装配时读取**本地编译期/受信配置与阶段资格**的交集。关闭时必须使用显式 `Unavailable/Disabled` application result，不能 silently fallback 到真实网络或未加密存储。M0 scaffold 默认关闭数据库、通知产品入口、网络、遥测、OTA、账号、同步、家庭和 Web。

## 8. 生成代码、合同和 migration

### 8.1 机器合同派生物

- `specs/` 中登记为 `Normative + ACTIVE` 的合同是字段/byte 的 owner；生成类型、client、validator 和 docs 只是派生物。
- 生成物放入带 `generated` 标识的隔离目录，通过窄 wrapper 导出；任何文件头必须记录 source identity 和 generator，不允许手改。
- 默认不提交可在构建中稳定生成的临时输出。若离线构建或跨语言发布必须提交，则同时记录 source digest、generator/toolchain 版本，并让 `generate:check` 从干净输入重建后要求零 diff。
- 只更新生成物、不更新 owner 或 generator 的提交必须失败；合同尚未过门时不得生成看似 production-ready 的兼容类型。

### 8.2 CNG 与原生工程

Expo app config、config plugin 和本地原生模块源代码是 CNG 权威输入。生成的 `ios/`、`android/` 默认不作为手工维护源；CI 从目录不存在的状态做 clean generation 并验证构建。若工具链确需提交生成目录，必须先以 ADR/工程例外记录理由、自动重生成与零 diff 检查，仍禁止直接手改。

### 8.3 数据 migration

物理持久化开门后，ORM/codegen 只能产生 candidate SQL。人工审查并通过合同/oracle 后，带稳定 ID 和 checksum 的 migration 才能进入受签名构建；已发布 migration 的 ID、内容和 checksum 永不原地改写。runtime 只执行构建内、版本路径合法且 checksum 匹配的 migration。具体启动、双槽、恢复和回滚状态机由 TD-003/010、`persistence-schema.md` 与机器合同拥有。

## 9. 测试代码组织

测试策略与质量阈值由 `test-strategy.md` 唯一拥有；本节只规定代码位置与命名。

| 类型 | 命名 |
| --- | --- |
| 纯单元 | `*.test.ts` / `*.test.tsx` |
| adapter/存储集成 | `*.integration.test.ts` |
| consumer/provider 或 port 合同 | `*.contract.test.ts` |
| import/装配边界 | `*.architecture.test.ts` |
| 端到端 | `*.e2e.test.ts` |
| migration | `*.migration.test.ts` |
| 崩溃提交点 | `*.kill-point.test.ts` |
| Swift | `*Tests.swift` |
| Kotlin local/instrumented | `*Test.kt`，按 source set 区分 |

使用 `test` 而不使用 `spec` 后缀，避免与仓库 `specs/` 机器合同混淆。单元测试与源码同目录；跨模块 contract/integration/e2e 放所属 app/package 的 `test/`。跨语言 golden/negative fixture 只引用 `specs/**/fixtures`，不得复制一份测试私有真相。

测试标题优先写 `[RULE-ID] given/when/then -> observable result`；没有稳定编号时写清可观察行为。产品代码不得依赖文档编号。测试数据只使用合成值；任何从真实事故提取的数据必须先不可逆去内容化并经过隐私评审。

## 10. 根开发命令

根 scripts 是稳定的人机/CI 接口，底层 runner 可以在保持行为与输出类别的前提下替换。永久骨架必须真实实现以下命令：

| 命令 | 结果 |
| --- | --- |
| `pnpm format` | 对受控源执行机械格式化。 |
| `pnpm format:check` | 检查格式且不修改文件。 |
| `pnpm lint` | 代码质量、禁止 API、module/import 与敏感模式检查。 |
| `pnpm typecheck` | 对全部激活 workspace 做严格类型检查。 |
| `pnpm test:unit` | 运行纯逻辑与组件单元测试，不联网。 |
| `pnpm test:architecture` | 验证层、模块、test-support 和 composition root 依赖边界。 |
| `pnpm docs:check` | 检查本地链接、页首状态、稳定 ID、代码围栏和登记一致性。 |
| `pnpm deps:check` | 检查 lockfile、直接依赖、许可/漏洞策略与重复关键依赖。 |
| `pnpm secrets:scan` | 扫描受控源、历史增量与构建配置中的秘密模式。 |
| `pnpm generate` | 从当前激活的权威输入生成派生物。 |
| `pnpm generate:check` | 干净生成后验证受控派生物零 diff。 |
| `pnpm native:generate:check` | clean CNG、检查最终 native 配置并证明无手改依赖。 |
| `pnpm build:mobile:ios` | 在锁定工具链中构建 iOS release configuration。 |
| `pnpm build:mobile:android` | 在锁定工具链中构建 Android release configuration。 |
| `pnpm verify` | 组合当前 M0 PR 必需检查；任一子检查失败即失败。 |

某个 script 只有在它有真实检查时才能加入。后续随着 scope 激活增加 `specs:check`、`test:contract`、`test:integration`、`test:e2e` 与 `verify:full`；禁止用“打印 skipped 后 exit 0”的占位命令制造绿色 Gate。阶段不适用的检查不进入当前 required set，并由治理 registry 表达 `NOT_APPLICABLE`。

“开发命令”是 shell script 接口，与 TD-002 的 Application Command 是两种概念，命名和文档不得混用。

## 11. CI 与合入门

### 11.1 永久骨架 required checks

每个代码 PR 至少执行：

1. Corepack 按根 manifest 激活固定 pnpm，并以 frozen lockfile 安装；
2. `format:check`、`lint`、`typecheck`、`test:unit`、`test:architecture`；
3. `generate:check`、`docs:check`、`deps:check` 与 `secrets:scan`；
4. 生成后工作树保持 clean；
5. app config/config plugin/native dependency 改动时执行 clean CNG 和双平台 compile；
6. protected main 或等价完整门在 macOS/Android 构建环境执行双平台 release configuration build。

CI 调用第 10 节根 script，不复制内部参数。required check 失败不能通过无变更 rerun、删断言或 blanket retry 掩盖；先修复根因。flaky test 必须立即隔离出 release/merge 结果、记录 owner 与退出条件，在修复前不能算适用 Gate 通过。

### 11.2 后续条件门

| 改动 | 必须追加的检查 |
| --- | --- |
| 合同/Schema/OpenAPI | metaschema、自校验 oracle、兼容 diff、适用 consumer/provider。 |
| 数据库/migration | 历史 fixture 升级、失败回滚、kill point、旧 binary/backup 兼容。 |
| native/config/权限 | clean CNG、最终 merged artifact、两端 release compile 与适用真机。 |
| crypto/security | 已登记向量、negative/fuzz、secret/日志检查与安全 owner 评审。 |
| notification/time | 固定 tzdb/clock 的跨端向量、权限/时区/重启与平台对账。 |
| provider/网络 | 合成 consumer/provider、超时/取消/幂等/限流，且无真实内容。 |

具体设备矩阵、覆盖阈值、E2E 和发布 evidence 归测试/发布规范。尚未产生的 implementation/release evidence 不是开始写骨架的循环前置，也不能由 CI 配置存在推导为已通过。

## 12. Git、文档与评审

- 实施阶段使用短生命周期分支、受保护主分支和 PR 合入；不得把“本地通过”替代 required checks。
- commit message 使用 `type(scope): imperative summary` 或当前已有的无 scope 形式；`docs:`、`feat:`、`fix:`、`test:`、`build:`、`chore:` 需准确表达主要意图。
- 一个代码提交保持一个可评审的逻辑目的，可以包含完成该目的所需的多文件；不得把无关格式化、依赖升级和功能混在一起。
- 当前文档基线建设严格继承 GOV-061：每个提交只新增或修改一个文件；这不等于以后代码提交也只能一个文件。
- 跨文档/合同变化按 GOV-050 change train 展开，全部 owner 更新与审计完成前不得宣称新 Gate。
- security/crypto、`specs/`/API、persistence/migration、native/build 与 lockfile 变更需要相应 owner 评审；高风险作者不能作为唯一批准人。
- breaking change 必须先有替代 ADR、合同版本/兼容方案、migration 与回滚影响，不以 PR 描述临时授权。
- review 必须检查数据 owner、阶段 gate、错误/取消、日志字段、测试证据和删除/回滚路径，不只看 happy path。

## 13. 原生与平台代码

实现顺序继承 TD-001：维护中且兼容的库 → 幂等 config plugin → 窄 Expo Module/TurboModule → 有 ADR/例外和版本断言的受控 patch。

- 新原生源默认使用 Swift 与 Kotlin；Objective-C++/Java 只用于 ABI/interop 或已有证据的必要场景。
- 原生模块只实现窄 Platform Port、配置或必须的性能路径，不拥有领域状态或第二套业务规则。
- 每个 module 明确 typed JS/native contract、线程、生命周期、取消、nullability、错误映射和资源释放；不得返回 key、原始路径或 SDK exception。
- iOS/Android 提供等价能力或明确的安全降级；不能让一个平台 silent fallback 到不安全实现。
- 权限、entitlement、Info.plist、Android manifest、network/security/backup rule 由 config plugin 声明，并检查最终 merged artifact。
- 关键路径必须在 New Architecture、Hermes 和 release configuration 验证；debug/模拟器结果不能替代 TD-001 的真机 spike。
- 符号、source map、R8/ProGuard、隐私清单、license 与 SBOM 影响必须登记；不含生活内容的诊断样例才可离开设备。

capability spike 可以包含独立 native 源，但必须与普通 App route/production composition root 隔离，并能整体删除而不破坏产品构建。

## 14. 例外和禁止项

局部 lint/type/build 例外必须在最窄行或文件旁注明：违反的 `ENG-*`/规则、技术原因、风险控制、owner、跟踪项和移除条件。没有退出条件的例外不得合入。文件级/目录级 disable、关闭 strict、忽略整个 generated/native diff 或把测试标记为永久 skipped，需要 ADR 或修正规范。

以下做法没有例外通道：

- 在客户端或仓库放生产 provider key、签名私钥或用户内容；
- 使用未加密持久化作为正式数据的临时阶段；
- 页面直连 SQLite、文件、HTTP、Keychain/Keystore 或通知 SDK；
- Domain 导入 React Native/Expo/SQLite/network/logging；
- 修改已发布 migration/合同身份并假称兼容；
- 关闭能力仍注册真实 route/adapter，或 fake 返回 production success；
- 用测试、fixture、生成类型或 ORM model 重新定义权威合同。

## 15. 永久工程骨架完成定义

开始创建骨架时不要求已有实现 evidence；骨架完成时必须满足：

1. 根 workspace、Corepack、Node、pnpm、Expo/React Native/React 与原生工具链已有精确、互相兼容的锁定输入；
2. frozen install、Development Build、clean CNG 和双平台 local release configuration build 可重复；
3. 第 2 节目录和模块 public boundary 已建立，architecture test 能用故意违规 fixture 证明会失败；
4. strict TypeScript、格式化、lint、unit 与根 `verify` 在干净 checkout 通过；
5. scaffold composition root 只装配 static shell、fixed source 与内存/noop/disabled port，不打开正式数据库、不发通知、不联网；
6. 至少一个纯 Domain 测试证明 Clock/ID/Random 显式注入，production graph 不能 import `test-support`；
7. config 缺失 fail closed，移动 bundle 没有 secret，secret scan 与生成零 diff 检查通过；
8. capability spike 与正式 App 的依赖隔离可自动验证，使用的内容全部合成且可删除；
9. 服务端 workspace、生产 provider/telemetry SDK、签名/OTA/商店配置和 P1/P2 入口均未越过阶段门；
10. 对应 Git SHA 的治理审计仍确认“永久工程骨架”scope，不把它表述成 P0 正式功能或发布就绪。

首个真实持久化切片仍必须等待系统架构第 12 节列出的叙事规范、机器合同与 oracle；工程骨架完成不能替代该门。

## 16. 变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| v1.0 | 2026-07-27 | 建立 P0 客户端永久骨架的仓库、TypeScript、依赖、配置、生成、命令、CI、评审和原生规范；明确服务端与发布工具链后置。 |

# TD-001：移动客户端技术栈

> Status：`Accepted`  
> Date：2026-07-26  
> Decision owners：移动端技术负责人、架构负责人  
> Scope：P0 iOS/Android 客户端，并约束 P1/P2 移动端延续  
> Related requirements：PD-001、PD-002、PD-006、QR-001～003、QR-010～012、QR-080～082、QR-110～112  
> Related ADRs：[TD-002](0002-offline-first-client-architecture.md)、[TD-003](0003-encrypted-local-database.md)、[TD-009](0009-native-reminder-scheduler.md)、TD-017
> Decision gate：采用 OQ-003 的默认值；若工程骨架建立前出现明确团队能力或关键原生能力反证，必须以新 ADR 替代

## Context

生活有谱 P0 必须同时交付 iOS 16+ 与 Android 10+，并满足：

- 免登录、本地优先、无网络时完成全部手动核心任务；
- 加密 SQLite、流式附件加密、系统安全存储和应用锁；
- 可对账的本地通知、通知动作、Android 精确/近似提醒和系统权限状态；
- 50,000 条记录、250,000 个子对象下的本地性能与大字体/读屏要求；
- 后续账号同步、家庭协作和 Web 可以复用机器契约，但不能削弱移动平台原生行为。

项目尚无已知团队技术偏好。选择必须让大部分界面与确定性领域逻辑共用，同时保留编写、配置和调试原生能力的完整出口。Expo Go 的固定原生能力集合无法承载加密数据库、定制通知和文件流水线，不能作为生产工程边界。

## Decision

移动客户端采用 **React Native + Expo Development Build / Continuous Native Generation（CNG）+ TypeScript**。使用与当前稳定 Expo SDK 兼容的稳定 React Native 版本、React Native New Architecture 和随 React Native 捆绑的 Hermes；不使用 Expo Go 作为开发或验收运行时。

原生能力通过维护中的原生库、Expo config plugin、本地 Expo Module 或必要的 TurboModule/原生组件接入。CNG 的 app config、config plugin 和原生模块源代码是权威输入；生成的 `ios/`、`android/` 目录不接受无法重放的长期手工修改。

## Decision details

### 1. 工程形态

- 使用 `create-expo-app` 的当前稳定 TypeScript 模板创建工程，但在首次提交前移除演示代码并锁定依赖；
- 从第一天创建 iOS 与 Android Development Build，在模拟器和真机运行；Expo Go 只可用于与本产品工程无关的概念试验；
- 默认启用 React Native New Architecture；关键依赖必须在该架构和目标系统上验证；
- 使用 React Native 版本配套的 Hermes，不自行混装独立 Hermes 版本；
- 本地 Xcode/Android Studio 构建必须可用；EAS Build 可以作为 CI/分发适配器，但不是唯一可构建路径；
- CNG 通过干净生成验证：CI 能从无 `ios/`、`android/` 目录的受控源生成等价原生工程并完成发布构建。

### 2. TypeScript 边界

- 产品代码、纯领域核心、应用命令、Schema 生成类型和服务端可共享契约使用 TypeScript；
- TypeScript 开启严格模式；外部 JSON、路由参数、原生模块返回值和持久化数据在边界运行时校验，不能因有静态类型而跳过；
- Swift/Objective-C++ 与 Kotlin/Java 只用于平台适配、原生模块、构建配置和确有性能/系统 API 需要的代码；
- 不为了“共享”把 UIKit/SwiftUI、Android View/Compose 或系统控件行为重新实现成不符合平台约定的自绘组件；
- 共享代码目标是领域规则、应用用例、Schema 和一致的组件契约，不以源码行数复用率作为质量指标。

### 3. 原生扩展规则

接入顺序为：

1. 优先选择维护中、支持目标系统与 New Architecture、许可可接受的库；
2. 若只缺原生工程配置，编写可幂等重放的 config plugin；
3. 若需要受控平台 API，使用本地 Expo Module/TurboModule 并定义窄接口；
4. 只有生成机制无法表达且经 ADR/评审确认时，才保留受控 native patch；patch 必须有自动应用、上游版本断言和失败即停的测试；
5. 不允许页面直接调用散落的原生 SDK；统一经 Platform Port/Adapter 进入。

每个原生模块都必须：

- 定义 JS/原生错误码、取消、线程、生命周期和空值契约；
- 在 iOS 与 Android 提供等价能力或明确的平台降级；
- 不在日志、崩溃信息或 JS 异常中暴露密钥、路径或生活内容；
- 有 release build 的真机集成测试，而不只在 debug/模拟器通过；
- 记录所需权限、隐私清单、ProGuard/R8、符号和商店披露影响。

### 4. 版本选择

ADR 不固定会过期的框架小版本。创建工程和每次升级时：

- 选择当时处于稳定支持、与 Expo SDK 官方兼容的 React Native/React/Expo 组合；
- 锁文件提交到仓库，CI 使用固定 Node、包管理器和原生工具链；
- 不在同一升级中同时改变框架大版本、数据库格式、备份格式和通知协议；
- 最低系统仍以 QR-001 为准；框架“可以编译”不等于项目已声明支持；
- 依赖停止维护、出现高危漏洞或不再支持 New Architecture 时，先替换/封装，必要时以新 ADR 替代本决定。

## Alternatives considered

### Flutter + Dart

优点：统一渲染与组件行为、成熟移动工具链、跨平台性能可控。缺点：引入 Dart 技能与第二套契约工具；大量原生安全/通知/文件能力仍需插件或平台代码；与当前默认的 TypeScript 网关及机器契约复用较弱。若团队未来有显著 Flutter 优势，可以新 ADR 重新评估，但当前没有足够理由承担切换成本。

### Swift/SwiftUI + Kotlin/Compose 双原生

优点：平台能力和原生可访问性最直接，系统升级响应快。缺点：需要维护两套页面、表单、状态编排和较多领域适配，P0 的五类记录、重复、提醒和备份组合会显著放大实现与一致性成本。平台适配仍保留原生代码，但不选择整套双原生客户端。

### React Native 裸工程

保留 React Native/TypeScript 优势，并能任意修改原生目录；代价是长期维护两套生成工程、升级差异和第三方配置。CNG 已允许安装原生库、使用 config plugin 和自有模块，因此先采用可重放生成；若某项长期原生需求无法可靠生成，再以证据决定是否改为受控裸工程。

### PWA 或 Web 包装

无法作为 P0 主客户端满足离线私有数据库、系统通知、应用锁、附件、安全存储、平台分享及后台约束的完整验收。Web 保留到 P2 独立决策。

### Expo Go

它是固定原生运行时，不能随项目加入必要原生依赖。官方也将 Development Build 作为生产级项目的完整开发环境，因此只拒绝 Expo Go 作为工程边界，不拒绝 Expo 工具链。

## Consequences

### Positive

- iOS/Android 共用主要界面、领域和应用代码，减少两端规则漂移；
- TypeScript 与 AI/API/Schema 工具链一致，契约生成和测试夹具可复用；
- Development Build 保留自定义原生模块，避免被 Expo Go 能力限制；
- CNG 让原生配置可审查、可重放，并降低常规 SDK 升级的手工差异；
- 本地和云端构建都可用，避免把开发、签名和发布锁死在单一构建服务。

### Negative

- 团队仍必须具备 Xcode、Swift/Objective-C++、Gradle 和 Kotlin 的调试能力；
- SQLCipher、通知、后台、文件和生物识别等依赖升级可能需要原生修复；
- React Native/Expo/New Architecture 升级形成持续兼容矩阵；
- JS 线程、原生线程和生命周期之间的错误更难定位，必须投资端到端和真机测试；
- CNG plugin 若不可重入或依赖隐式顺序，会造成“本机能构建、干净环境失败”的风险。

### Compatibility commitment

一旦首个版本发布，切换到 Flutter 或双原生仍必须读取相同数据库/备份/API 数据，并保持路由、提醒和业务结果；框架更换不能成为丢弃用户数据或取消兼容窗口的理由。

## Risks and mitigations

| 风险 | 缓解 |
| --- | --- |
| 关键原生库不支持 New Architecture | 在工程骨架阶段做能力 spike；优先替代，必要时维护窄模块；不能静默关闭 New Architecture。 |
| CNG 无法表达原生配置 | 建立幂等 config plugin 和干净生成测试；最后才使用带版本断言的 patch。 |
| JS 线程阻塞影响 QR-010/011 | 领域批处理分页；加密、哈希、图片与大查询下沉原生/worker；发布构建性能基准。 |
| 两端外观相同但行为不原生 | 设计系统规定语义，平台 adapter 保留系统控件、返回、权限和安全区行为；真机无障碍测试。 |
| Expo/EAS 服务不可用 | 保持本地原生构建、签名与替代 CI 路径；产品运行不依赖 Expo 在线服务。 |
| 依赖供应链风险 | 锁版本、生成 SBOM、许可证/维护性审查、漏洞扫描和可复现构建。 |

## Implementation constraints

- UI 不得直接访问 SQLite、文件系统、通知、Keychain/Keystore 或 HTTP；依赖方向由 TD-002 规定；
- 任何 Native Module 不得成为第二个领域状态源；它只执行平台动作并返回受控结果；
- 原生通知队列、任务调度和系统偏好都视为外部投影，应用数据库仍保存业务期望；
- 共享组件必须满足设计系统与可访问性组件契约；不能用跨平台抽象屏蔽必要平台差异；
- 产品展示名与内部 bundle/package 标识分离，品牌核验改变展示名时不迁移用户数据库 ID；
- OTA、runtimeVersion、签名与可更新范围由 TD-017 决定，本 ADR 不授权任意远程代码更新。

## Verification

创建正式功能分支前，最小工程 spike 必须在 iOS 16 最低档设备/模拟器与 Android 10 真机或等价设备上以 New Architecture、Hermes、release 配置证明：

1. Development Build、本地 release build 和干净 CNG 生成成功；
2. 加密 SQLite 能创建、事务、迁移、关闭重开并处理错误密钥；
3. 50 MB 文件可分块读取/加密/取消，临时文件没有泄露；
4. 通知可调度、取消、点击和执行动作；Android 能区分精确/近似权限；
5. Keychain/Keystore 与系统认证能完成密钥封装/解封并处理取消、锁定和凭据变化；
6. 文件选择、系统分享、深链接、前后台/被杀恢复和安全遮罩正常；
7. VoiceOver/TalkBack、最大字体、Reduce Motion 与最小命中区在共享组件样例通过；
8. 崩溃符号、受控日志和 source map 能在不含生活内容的样例中工作；
9. 不连接 Expo 在线服务时，本地手动产品和本地构建仍可运行。

任何 1～6 的关键能力无法在两个平台以可维护方式实现，都必须暂停对应切片并评估替代 ADR；不能用 mock 结果接受技术栈。

## Rollout and rollback

首个工程尚无用户数据，回滚为删除可重建骨架并由替代 ADR 重新生成；spike 不生产长期备份或正式数据库版本。发布后框架升级采用 preview channel/内部构建 → 数据迁移与备份往返 → 真机矩阵 → 分批发布；失败回退到仍能读取新写数据的上一兼容二进制，不能回滚到不认识已提交 Schema 的版本。

## References

- [Expo：Develop an app with Expo](https://docs.expo.dev/workflow/overview/)
- [Expo：Introduction to development builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [Expo：Continuous Native Generation](https://docs.expo.dev/workflow/continuous-native-generation/)
- [React Native：About the New Architecture](https://reactnative.dev/architecture/landing-page)
- [React Native：Bundled Hermes](https://reactnative.dev/architecture/bundled-hermes)

这些链接用于核验当前工具能力，不把网页当前版本号写成永久产品约束。初始化工程、升级 Expo SDK/React Native 或提高 target SDK 时必须重新核验官方兼容矩阵。

## Revision notes

| 日期 | 说明 |
| --- | --- |
| 2026-07-27 | 将尚未建立的 TD-017 改为纯编号引用，避免把计划关系伪装成可访问 ADR。 |
| 2026-07-26 | 接受 React Native + Expo Development Build/CNG + TypeScript，明确 New Architecture、Hermes、原生扩展和能力 spike 门。 |

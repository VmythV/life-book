# TD-006：跨端基础标量表示

> Status：`Accepted`  
> Date：2026-07-26  
> Decision owners：客户端架构负责人、服务端架构负责人、数据负责人  
> Scope：P0～P2 领域对象、SQLite、JSON/HTTP、备份、同步和服务端之间的基础标量  
> Related requirements：领域模型 §2、REC-001～003、REC-020～023、BR-082、SYNC-032、SYNC-034、QR-022、QR-090～091、QR-110  
> Related ADRs：[TD-002](0002-offline-first-client-architecture.md)、[TD-003](0003-encrypted-local-database.md)、[TD-007](0007-time-zone-and-recurrence-engine.md)、[TD-010](0010-snapshot-schema-and-migrations.md)、[TD-014](0014-api-style-and-contract-versioning.md)  
> Decision gate：跨 TypeScript、SQLite、备份和服务端的兼容 fixture 全部通过后，才允许冻结首个持久化 schema

## Context

生活有谱是离线优先、未来跨设备同步的应用。同一个值会依次经过 TypeScript、原生模块、SQLite、JSON、备份容器和服务端数据库。若各层自行选择表示，常见结果包括：JavaScript 把 64-bit 整数舍入、金额/数量出现二进制浮点误差、本地日期被错误转成 UTC、排序键在并发插入后失效，以及不同设备把同一个 ID 序列化成不同文本。

领域模型已经定义 `EntityId`、`Instant`、`LocalDate`、`LocalTime`、`TimeZoneId`、`ExactDecimal`、`SortKey`、`Revision`、`ServerVersion` 和 `ServerSequence` 的语义，但刻意没有指定物理表示。本 ADR 为所有边界给出唯一表示和转换规则。业务规则仍由领域文档拥有；本 ADR 只拥有编码、范围、规范化和跨端兼容约束。

## Decision

采用一组显式、带品牌类型的跨端标量，并遵守“领域值与物理表示分开、只在 adapter 边界转换、序列化只有一种规范形式”的原则：

- `EntityId` 使用 CSPRNG 生成的 RFC 9562 UUIDv4，规范小写连字符文本；
- `Instant` 在领域中表示 UTC 时间轴毫秒，SQLite 为 epoch milliseconds，JSON/备份为固定毫秒精度的 RFC 3339 UTC 文本；
- `LocalDate`、`LocalTime` 和 `TimeZoneId` 独立保存，绝不靠 `Instant` 反推用户原意；
- `ExactDecimal` 使用 3 位定标的整数语义，客户端为精确整数 value object，SQLite/JSON 为规范十进制文本；
- `SortKey` 使用 128-bit 无符号整数的 32 位小写十六进制编码，并以中点插入、必要时事务内重排；
- 本地 `Revision` 限定在安全的 32-bit 正整数；服务端版本/序列使用 64-bit 范围，但在 JavaScript、SQLite 和 JSON 中始终作为规范十进制字符串处理；
- 禁止边界层隐式强制类型转换、二进制浮点业务运算和依赖设备时间排序跨设备事件。

## Decision details

### 1. 通用类型边界

领域层不直接传递裸 `string`/`number` 代表这些值。TypeScript 使用品牌类型或不可变 value object，使不兼容标量不能互相赋值：

```ts
type EntityId = string & { readonly __brand: 'EntityId' };
type InstantMs = number & { readonly __brand: 'InstantMs' };
type LocalDate = string & { readonly __brand: 'LocalDate' };
type LocalTimeSecond = number & { readonly __brand: 'LocalTimeSecond' };
type TimeZoneId = string & { readonly __brand: 'TimeZoneId' };
type SortKey = string & { readonly __brand: 'SortKey' };
type Revision = number & { readonly __brand: 'Revision' };

interface ExactDecimal {
  readonly scaled: ExactInteger;
}
```

`ExactInteger` 是本项目的不透明精确整数端口，不等同于 ECMAScript 原生 `bigint`。P0 Hermes 客户端固定用 `jsbi@4.3.2` 实现；应用代码只调用项目封装的 parse/format/add/subtract/multiply/compare/divide/remainder，不直接 import JSBI，也不使用 `123n` literal。服务端可以在同一端口后使用原生 BigInt。替换实现不得改变任何 canonical encoding 或运算结果。

这些示例是语义约束，不要求照抄类型名。最终实现必须满足：

- 所有外部值先经总长度、语法、范围和规范形式校验，再构造领域类型；
- parser 不做 `Number(value)`、truthy/falsy、宽松日期解析或指数记数法等隐式转换；
- formatter 对同一领域值只能产生一种 canonical encoding；
- SQLite row、API DTO、备份 DTO 和领域对象使用不同类型，转换函数集中在 adapter；
- 未知/非法标量使当前命令或导入失败并给出安全错误，不“尽量猜测”后写入事实库；
- 日志只使用允许记录的技术 ID；不得因为类型统一而把标题、邮箱、邀请 secret 或内容写入日志。

### 2. `EntityId`

#### 2.1 生成与规范形式

- 使用 RFC 9562 UUID version 4，由平台密码学安全随机源生成；不得使用 `Math.random`；
- 规范文本为 36 个 ASCII 字符：`xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`，十六进制只用小写，`y` 符合 RFC variant；
- parser 可以接受平台 UUID 对象，但任何持久化/交换前必须转为规范文本；API 和导入默认只接受规范文本，避免同值多编码；
- nil UUID `00000000-0000-0000-0000-000000000000` 无效；ID 创建后不可改变、回收或跨类型重新使用；
- SQLite 使用 `TEXT`，列以 binary collation 比较；服务端优先使用原生 `uuid` 类型，JSON/备份使用规范文本；
- ID 是不透明身份，不承载创建时间、设备、实体类型、空间或顺序。排序必须使用明确字段和 ID 最终 tie-break；
- 所有客户端可创建实体、`clientMutationId`、命令 ID 和 operation ID 使用相同编码规则，但类型品牌彼此独立，不能把附件 ID 当 mutation ID。

UUIDv4 的随机性不替代授权或 secret。家庭邀请、会话 token、重置 token 和分享 token 必须使用专门的高熵随机 secret、限时和哈希存储规则，不能直接把可见实体 ID 当凭据。

#### 2.2 数据导入

受控旧版导入若支持大写 UUID，可在通过完整 UUID/variant/version 校验后一次性规范成小写，并记录迁移版本；普通 API 不保留这种宽松路径。第三方 ID 不能塞进 `EntityId`，应保存在有来源命名空间的 external reference 字段。

### 3. 时间标量

#### 3.1 `Instant`

`Instant` 表示 UTC 时间轴上的毫秒：

| 层 | 唯一表示 |
| --- | --- |
| Domain/TypeScript | epoch milliseconds `number`，必须是整数且在支持范围内 |
| SQLite | `INTEGER` epoch milliseconds |
| JSON/API/backup | RFC 3339 UTC 字符串，固定 `YYYY-MM-DDTHH:mm:ss.SSSZ` |
| PostgreSQL | `timestamptz`；读取/写出都规范到 UTC 毫秒 |

约束：

- 产品支持公历年 `0001`～`9999`；对应毫秒值远小于 JavaScript 最大安全整数，仍必须校验 `Number.isSafeInteger`；
- JSON/备份固定三位毫秒和大写 `T`/`Z`，不输出 `+00:00`、省略毫秒或超过毫秒的小数；
- 输入边界若允许其他合法 RFC 3339 offset，必须立即验证并规范成 UTC 毫秒；内部和后续输出不保留多种等价文本；
- 闰秒 `:60` 不进入领域：外部来源必须按其协议先映射为普通 UTC instant 或拒绝，不能由通用 parser 猜测；
- `createdAt`/`updatedAt` 等设备时刻可以描述业务发生时间，但不能决定跨设备胜负；同步顺序使用服务端版本/序列；
- duration、重试等待和性能计时使用进程单调时钟，绝不把单调时钟值持久化成 `Instant`。

#### 3.2 `LocalDate`

- 规范 ASCII 文本为扩展年公历 `YYYY-MM-DD`，固定 10 字符，年 `0001`～`9999`；
- SQLite、JSON、备份都保存同一文本，binary collation 下字典序等于日期序；
- parser 必须验证真实日期和闰年，不允许 `2026-2-3`、`2026/02/03`、日期时间、locale 文本或自动溢出；
- 采用 ISO 8601 的 proleptic Gregorian calendar 语义；UI 可按 locale 显示，但写回前恢复为领域日期；
- 不以 UTC 午夜或设备当前时区的 `Date` 代替，否则跨时区会改变生日、纪念日和重复候选日。

#### 3.3 `LocalTime`

- 领域/TypeScript 使用当天从 00:00:00 起的整数秒，范围 `0...86399`；P0 界面只产生分钟值，因此秒必须为 `0`；
- SQLite 使用 `INTEGER`；JSON/备份使用固定 8 字符 `HH:mm:ss`；
- 不接受 `24:00:00`、offset、日期、locale 文本或小数秒；
- UI 可以显示 `HH:mm` 或 12 小时制，但 formatter/parser 必须携带 locale，领域值不保存 AM/PM 文本；
- 当未来开放秒级能力时，不需要 schema 迁移；只有产品能力和调度精度发生变化。

#### 3.4 `TimeZoneId`

- 保存 IANA Time Zone Database 名称，例如 `Asia/Shanghai`、`America/New_York`；不得保存 `GMT+8`、`CST` 或纯 offset 代替；
- 输入必须由选定时间引擎依据随包 tzdb 验证；系统返回 alias 时，在入口映射为引擎的 canonical ID 后保存；
- 固定 UTC 可以保存引擎确认支持的 `UTC` canonical ID；应用不得自行把任意 `Etc/GMT±N` 重写成相反符号；
- 每次 release/规则解析记录可诊断的 tzdb 版本；规则升级及历史实例策略由 TD-007 负责；
- `LocalDate + LocalTime + TimeZoneId + disambiguation` 才能解析有时间的业务计划，字段不可互相替代。

### 4. `ExactDecimal`

#### 4.1 领域和值域

`ExactDecimal` 固定 scale 为 3，以 milli-unit 保存：

```text
display value = scaled integer / 1000
```

- `scaled` 是 signed integer，绝对值最多 18 位；范围为 `-999999999999999999...999999999999999999`；
- 对应可表示业务范围 `-999999999999999.999...999999999999999.999`；具体字段仍可施加非负、上限或符号业务约束；
- TypeScript 使用 `ExactInteger` 做加、减、比较和乘整数；P0 Hermes adapter 为 JSBI，禁止经 `number`/`parseFloat` 运算；
- 除法、比例换算或相乘可能需要舍入时，调用者必须选择已命名的舍入模式，并由相应业务规则批准；P0 库存加减不发生隐式舍入；
- 等值依据 `scaled`，因此 `1`、`1.0` 和 `1.000` 是同一个领域值，负零规范为零。

#### 4.2 交换与持久化

JSON/API/备份使用用户数值的规范十进制字符串：

- 语法为可选 `-`、整数部分、可选小数点和 1～3 位小数；
- 输出不带 `+`、指数、分组符或空白；整数至少一个 `0`；去除多余前导零和小数尾零；
- 示例：`0`、`12`、`-0.125`、`999999999999999.999`；
- 外部输入超过 3 位小数或 18 位 scaled 精度时拒绝，不静默四舍五入。

SQLite 将 **scaled integer 的规范十进制文本** 存为 `TEXT`，例如领域值 `1.25` 存为 `"1250"`。这是有意选择：当前 Expo SQLite 的 JS bridge 没有精确大整数 bind 类型，把 64-bit 整数交给 JavaScript `number` 会在范围内丢精度。

- 从 DB 读写都用严格 signed-integer text parser/formatter；`0` 是唯一零表示，无 `+` 和前导零；
- 不在 SQL 中 `CAST(... AS INTEGER/REAL)`，不依赖 TEXT 字典序做数值排序或范围比较；
- 权威业务计算在 application/domain 的 `ExactInteger` 中完成，并在同一事务写回；
- 若查询确需排序/筛选，物理 schema 可添加由受控 adapter 维护的 fixed-width sortable encoding 或业务派生列，但必须有重建校验，不能成为第二份业务事实；
- 服务端使用 `NUMERIC(18,3)`，API 仍使用规范字符串，不能因数据库支持 decimal 就向 JSON 输出 number。

### 5. `SortKey`

#### 5.1 编码和比较

- 逻辑值是 `0...2^128-1` 的无符号整数；持久化/交换为恰好 32 位小写十六进制 ASCII；
- SQLite 使用 `TEXT COLLATE BINARY`，TypeScript parser 转为 `ExactInteger` 计算；规范字符串字典序与数值序一致；
- `00000000000000000000000000000000` 和 `ffffffffffffffffffffffffffffffff` 是保留边界，不分配给普通项；
- 同一列表稳定排序为 `(sortKey ASC, id ASC)`；即使异常/并发产生相同 key，结果仍确定；
- SortKey 只在其拥有者列表内有意义，不作为时间、全局顺序或用户可见编号。

#### 5.2 插入和重排

- 新建首批项目在两个保留边界之间均匀分布；
- 相邻 `left < right` 有空位时分配 `floor((left + right) / 2)`；列表首尾分别以保留边界计算；
- 若不存在整数空位，在一个数据库事务中按当前稳定 `(sortKey, id)` 顺序为整个列表重排：第 `i` 项（从 1 开始）获得 `floor(i × MAX / (n + 1))`；随后执行原插入；
- 重排是技术维护，不改变 `updatedAt`、用户活动历史或业务 revision；但持久化层必须有独立索引版本/技术变更路径；
- 单机拖拽命令以“被移动 ID、目标前后邻居 ID、列表 ID”表达用户意图，由 application service 生成 rank；Presentation 不直接写 key；
- P1 同步仍提交邻居意图和 base version，服务端在当前权威列表重新求 key。客户端提供的 raw key 不是授权或并发真相；
- 列表规模达到重排/性能硬限时必须显示安全错误或分批策略，不能让 128-bit 算术溢出。

### 6. 版本、序列和计数器

#### 6.1 `Revision`

- 范围 `1...4294967295`，TypeScript/JSON/SQLite 均可使用整数 `number`/`INTEGER`；
- 创建时为 1，每次本地持久化业务改变加 1；索引重建、key 重包和 SortKey 技术重排不递增；
- 写入前验证 safe integer 和 UInt32 范围；达到上限时返回受保护的 `revision_exhausted` 错误并要求数据迁移，绝不回绕为 0；
- Revision 只比较同一存储副本的同一实体，不能跨设备排序。

#### 6.2 服务端版本与序列

`ServerVersion`、`ServerSequence`、账本序列、同步 generation 内的 long counter 使用非负 signed 64-bit 范围 `0...9223372036854775807`：

| 层 | 表示 |
| --- | --- |
| TypeScript domain | `ExactInteger`/不透明 decimal-string value object；Hermes 由 JSBI 实现 |
| SQLite | 规范非负十进制 `TEXT` |
| JSON/API/backup | 规范非负十进制字符串 |
| PostgreSQL | `bigint`，写出前做范围校验 |

- 唯一零表示为 `"0"`；正数无前导零、加号、小数或指数；
- 比较/递增用 `ExactInteger`，不得转 JavaScript `number`；
- SQLite 不依赖十进制 TEXT 字典序比较；同步 adapter 在内存精确比较，或使用经 ADR 明确的 fixed-width 派生编码；
- cursor 是包含 generation/sequence 等内容的不透明、版本化 token，调用方不得解析后自行加一；
- 达到 64-bit 上限前服务端必须通过新 schema/generation 迁移，绝不回绕或复用序列。

普通 UI 计数、数组长度和分页大小只有在文档硬上限远低于 `Number.MAX_SAFE_INTEGER` 时才用 `number`。任何会持久增长、跨设备或来自服务端大整数的计数都按 long counter 处理。

### 7. JSON、SQLite 与文本通则

- JSON boolean 只接受 `true`/`false`，SQLite 以受约束的 `0/1 INTEGER` 保存；不接受 `"true"`、`"0"` 等宽松形式；
- enum 交换值使用已登记的 lowercase `snake_case` token；显示文案和 enum 分开，本地化不能改协议值；
- schema 中“必需且可空”的字段必须出现并显式为 `null`；只有定义为 additive optional 的字段可缺省；`null`、缺省、空串和零不得互换；
- 文本统一 UTF-8。不得全局改变用户输入的 Unicode normalization、大小写、空白或 emoji；分类/标签的比较规范化只由其业务规则和搜索索引负责；
- SQLite 列必须声明与标量相符的 type/`CHECK`，但业务 adapter 仍做完整校验；不能把 SQLite affinity 当 parser；
- map/object 的键排序、完整 canonical JSON 和签名输入由具体容器/协议 ADR 定义；本 ADR 只规定标量的 canonical value；
- 错误信息不得回显完整 secret 或任意大型非法输入；诊断记录 schema/version、字段路径和错误码即可。

### 8. Schema 元数据与兼容

每个持久化/交换 schema 必须声明其使用的标量版本 `scalarEncodingVersion = 1`，或通过父 schema 版本唯一推导。未来改变编码时：

1. 新增版本与双读 fixture，不原地改变 v1 的含义；
2. 先发布能读旧/新、只写旧的兼容版本；
3. 再迁移并切换写新；
4. 最后在保留期、最低客户端版本和恢复测试满足后停止旧写/旧读；
5. 备份、同步和本地 DB 各有自己的容器版本，但引用同一标量 fixture。

不得通过远程配置改变 ID 算法、decimal scale、时间精度、SortKey 位宽或版本范围。

## Alternatives considered

### UUIDv7 或 ULID

可按生成时间大致排序并改善某些数据库索引局部性，但客户端时钟可回拨/被篡改，ID 也会暴露粗略创建时间。生活有谱已经有明确排序字段，P0 数据量不需要用身份承载顺序，因此选择更简单、不带时间语义的 UUIDv4。未来若服务端规模证明索引局部性是瓶颈，必须以新 ID 类型/ADR 引入，不能改变已有 EntityId。

### 数据库自增 ID

无法在离线客户端创建全局身份，合并时需要重写引用，也不适合 mutation 幂等；拒绝。

### `number`/SQLite REAL 表示数量

二进制浮点不能精确表示常见十进制，累加库存流水会产生不可解释偏差；拒绝。

### SQLite INTEGER 保存 scaled decimal

SQLite 自身能保存 signed 64-bit，但当前 JS bridge 会把值暴露为 `number`，18 位 scaled 值可能在到达精确整数 parser 前已损坏。TEXT 多一次解析但能端到端保真；接受该成本。

### 所有时间都保存 ISO 字符串

可读性高，但 Instant 范围/精度规范更容易出现多种等价字符串，索引和算术也更复杂。采用 DB epoch milliseconds、交换固定 RFC 3339；业务本地日期/时间仍保存独立规范文本/整数。

### LocalDate 保存 UTC 午夜

跨时区显示会改变日历日，无法表达“无时区的生日/到期日”；拒绝。

### 浮点 rank、数组下标或可变长度分数 key

浮点中点很快失去间隙，数组下标导致移动后全表改写，可变长度方案需要额外规范化/并发算法。固定 128-bit key 算法简单、跨语言可复现；极端局部插入通过事务重排处理。

### 版本号作为 JSON number

超过 `2^53-1` 后浏览器/React Native 会静默舍入，可能跳过同步事件或误判冲突；服务端 long 值统一用字符串。

## Consequences

### Positive

- 同一值在客户端、SQLite、备份、API 和服务端之间可无损往返；
- 编码只有一种，便于签名、hash、fixture、差异比较和问题定位；
- 日期/时区原意、精确库存和同步长序列不会被 JavaScript 隐式损坏；
- 128-bit SortKey 支持离线拖拽和未来服务端重排，无需把数组位置写进领域身份；
- 标量 parser/formatter 可集中复用，减少每个功能自行发明格式。

### Negative

- adapter 和 branded type 增加代码量，开发者不能直接操作裸 JSON；
- ExactDecimal、服务端 long 和 SortKey 需要 ExactInteger/字符串转换，SQL 聚合与排序不能直接套用；
- UUIDv4/固定 SortKey 的数据库索引局部性不如时间有序 ID；
- schema 需要少量派生列与一致性重建机制支持复杂查询；
- 固定 canonical 格式要求旧版导入有单独宽松 parser，不能复用运行时入口。

## Risks and mitigations

| 风险 | 缓解 |
| --- | --- |
| 代码绕过 value object 直接用裸值 | 禁止不安全 cast；lint/代码评审检查 adapter；domain API 只收品牌类型。 |
| ExactInteger/JSBI 被 JSON.stringify 或原生 bridge 错误处理 | DTO 先显式转规范字符串；跨桥 contract test；禁止通用 stringify 领域对象。 |
| epoch 单位秒/毫秒混淆 | 类型名带 `Ms`；范围检查；固定 fixture；接口字段文档明确格式。 |
| 本地日期经 `Date` 自动转区 | LocalDate parser/日历库独立；禁止裸 `new Date(localDate)` 规则。 |
| decimal TEXT 被 SQL 当数值/字典序排序 | repository query 白名单；禁止 CAST；需要时用可重建派生列。 |
| SortKey 高频同位置插入导致重排 | 128-bit 空间；监控重排次数/规模；事务算法和服务端邻居意图。 |
| UUID 实现随机源退化 | 使用平台 CSPRNG；启动/测试检查格式；固定依赖和真机测试。 |
| tzdb alias/升级改变解析 | TD-007 固定 tzdb 版本、历史解析结果与升级测试。 |
| 64-bit sequence 超 JS 安全整数 | 全链路字符串/ExactInteger；极值 fixture；静态禁止 `Number(serverSequence)`。 |
| Hermes 没有原生 BigInt | P0 固定 JSBI adapter；release 真机测试；禁止 BigInt literal/直接能力探测分叉。 |

## Implementation constraints

- 建立一个 `scalar` 核心包，导出 parser、formatter、比较器、范围常量和 fixture；UI/feature 不自行复制正则；
- parser 必须线性处理且有输入长度上限，先验长度再做 ExactInteger/日期解析，防恶意超长数字；
- ExactInteger/JSBI object 不得经过原生 bridge、SQLite 或 JSON；跨边界先转受版本化字符串/bytes；
- `scalar` 包是唯一可以 import `jsbi` 的业务包；lint 禁止其他包使用原生 BigInt literal、`BigInt(...)` 或直接 import JSBI；
- 若未来目标 Hermes 支持原生 BigInt，必须先在双平台 release build 跑完整标量 fixture 和随机 differential，再替换 adapter；不能在同一 release 按设备动态选择两套实现；
- SQLite schema 对 canonical TEXT 至少设置长度/字符形态 `CHECK`，但完整 UUID 日期合法性由应用 parser 和迁移审计负责；
- API schema/OpenAPI 必须把 long/decimal 标成 string + pattern/example，不生成会转 number 的客户端类型；
- 测试/fixture 时间使用固定 clock 和明确 TimeZoneId，不能依赖开发机 locale/时区；
- telemetry 不上报业务 decimal、用户日期或完整实体关系；允许上报解析错误码、schema 版本和匿名计数；
- 日后采用支持原生 64-bit/decimal 的新桥也不能静默改物理格式，须新 ADR 与兼容迁移。

## Verification

### 标量 fixture

同一份版本化 fixture 必须被 TypeScript、iOS/Android 原生边界、SQLite adapter、备份 parser 和服务端实现读取，至少覆盖：

- UUID 合法 version/variant、小写规范、nil、大写、缺连字符、错误字符、随机批量唯一性；
- Instant 年界、闰日、毫秒 `000/999`、offset 输入规范化、非法日期、超范围和非安全整数；
- LocalDate 闰年/非闰年、每月边界、LocalTime `00:00:00`/`23:59:59`/`24:00:00`；
- IANA 正常区、alias、未知区及 tzdb 版本变化；
- decimal 零/负零、前导/尾随零、±边界、边界±1、3/4 位小数、指数、长恶意输入；
- SortKey 首尾、相邻中点、无空隙重排、10 万次随机插入/移动、重复 key 的 ID tie-break；
- Revision 1/UInt32 max/溢出，long 的 `2^53-1`、`2^53`、signed-64 max 和 max+1；
- JSON null/absent/boolean/enum 的严格差异和 UTF-8 往返。

### 属性与集成测试

- 对每个合法值验证 `parse(format(value)) == value`，对 canonical 文本验证 `format(parse(text)) == text`；
- 随机生成合法/非法标量，在所有平台得到相同接受/拒绝结果；
- SQLite 写入、进程重启、读取、备份、恢复、API round-trip 后逐字段相等；
- 模拟原生 bridge、JSON serializer 和 ORM，证明没有 long/decimal 隐式转 `number`；
- decimal 流水随机加减后缓存等于从头 ExactInteger 重放，服务端 NUMERIC 结果一致；
- SortKey 重排在任意 kill point 原子回滚或完整提交，不改变业务 revision/updatedAt；
- 跨 DST 测试证明 LocalDate/LocalTime/TimeZoneId 分离，具体解析行为由 TD-007 fixture 验证；
- 静态扫描禁止 `parseFloat` 处理 ExactDecimal、`Number(...)` 处理 long、裸 `Date` 解析 LocalDate。

## Rollout and rollback

1. 在任何业务表 migration 前实现 scalar 包、跨端 fixture 和 SQLite adapter；
2. 用小型 prototype 验证 JSBI adapter 在 Hermes release build 的正确性/性能，以及 Expo SQLite TEXT bind/read 和原生桥；
3. 首个 schema 直接写 v1 canonical encoding，不保留实验格式；
4. 若 release 前发现实现不兼容，删除测试数据并更换未发布 schema；若已有用户数据，只能新增 scalar/schema version 并迁移；
5. 回滚应用版本前验证旧客户端能读当前编码；不能让远端写出旧客户端会误读而非明确拒绝的新标量。

## References

- [RFC 9562：Universally Unique IDentifiers (UUIDs)](https://www.rfc-editor.org/rfc/rfc9562.html)
- [RFC 3339：Date and Time on the Internet](https://www.rfc-editor.org/rfc/rfc3339.html)
- [IANA Time Zone Database](https://www.iana.org/time-zones)
- [Expo SQLite API](https://docs.expo.dev/versions/latest/sdk/sqlite/)
- [SQLite Datatypes](https://www.sqlite.org/datatype3.html)
- [ECMAScript BigInt specification](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-bigint-objects)
- [JSBI：pure-JavaScript BigInts](https://github.com/GoogleChromeLabs/jsbi)
- [Hermes BigInt support status](https://github.com/facebook/hermes/issues/510)

## Revision history

| Date | Version | Change |
| --- | --- | --- |
| 2026-07-26 | v1.1 | 消除 Hermes 原生 BigInt 假设，固定客户端 ExactInteger/JSBI adapter，保持跨端编码不变。 |
| 2026-07-26 | v1.0 | 固化跨端 ID、时间、精确十进制、排序键、版本/序列和 canonical encoding。 |

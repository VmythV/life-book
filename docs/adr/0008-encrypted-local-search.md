# TD-008：加密本地搜索与可重建索引

> Status：`Accepted`  
> Date：2026-07-26  
> Decision owners：客户端数据负责人、搜索负责人、安全负责人  
> Scope：P0 移动端离线搜索，兼容 P1/P2 空间权限、同步重建和字段扩展  
> Related requirements：PR-400～403、SRCH-001～101、DOM-001～002、BR-020～021、QR-011、QR-020、QR-022、QR-030、QR-070～071、QR-090～091、QR-100～101  
> Related ADRs：[TD-002](0002-offline-first-client-architecture.md)、[TD-003](0003-encrypted-local-database.md)、[TD-006](0006-cross-platform-scalar-representations.md)、[TD-010](0010-snapshot-schema-and-migrations.md)、[TD-012](0012-local-persistence-schema.md)  
> Decision gate：目标 SQLCipher build 的 FTS 能力探测、Expo 关闭连接缺陷规避、双槽崩溃恢复、安全删除、敏感竞态和设计容量真机基准全部通过后，才允许搜索进入公开构建

## Context

生活有谱要求中文、拉丁字符、数字和型号在离线状态下可理解地部分匹配，单个汉字也能找到标题、标签和位置；同时 50,000 条根记录、250,000 个子对象下首批结果 P95 不超过 400 ms。SQLite FTS5 的默认 `unicode61` 不能把连续中文自然拆成产品需要的短子串，`trigram` 对至少 3 个 Unicode 字符的子串有效，却不能直接回答 1～2 字符查询。`LIKE '%…%'` 则会让常见短查询退化为全表扫描。

搜索还处于加密和权限边界内。索引可能滞后、损坏或处于重建中；敏感记录、已回收记录和刚被撤销的家庭成员不能因旧索引命中而泄露。索引不是事实，不能让 FTS 触发器、单独明文数据库或不可恢复的一次性 migration 成为第二套数据生命周期。

本 ADR 将 [搜索与整理规范](../search-and-organization.md) 的产品语义映射为一个确定、可重建且可版本化的 SQLite 实现。字段归属、匹配等级和筛选语义仍以该规范为权威。

## Decision

在 TD-003 的同一个 SQLCipher 数据库内建立可重建 Search Projection，不创建明文 sidecar：

- 3 个及以上码点的连续子串由 FTS5 `trigram case_sensitive 1` 召回；
- 1～2 码点由普通 SQLite `search_short_gram` 倒排表召回，不使用 `%LIKE%` fallback；
- 完整标题、标题前缀及分类/标签/位置 exact tier 由 B-tree/结构化关系判定，不让 BM25 猜最高等级；
- 规范化由应用层一个版本化 Unicode pipeline 负责，索引与查询共用；SQLite tokenizer 不拥有产品语义；
- 一条根记录对应一个 SearchDocument，清单项目是带 part identity 的嵌套内容，结果始终折叠为根记录；
- FTS 使用 `content=''`、`contentless_delete=1`、`detail=full`、`columnsize=1`；原文仍只在权威表，UI 片段从权威字段生成；
- 索引采用 A/B 双槽。后台在 inactive slot 分页构建、追平变更、校验后用短事务原子切换；失败只丢弃 inactive slot；
- 每次领域提交在同一事务写幂等 `RebuildSearchDocument(entityId,targetRevision)` 任务并推进 mutation counter；任务从权威聚合重建当前文档，旧任务不能覆盖新 revision；
- 每次命中返回前重新读取权威记录并检查空间、membership、生命周期、敏感和应用锁；FTS 命中从来不是授权；
- SQLite 核心与每张 FTS 表分别启用 secure-delete，并对 Expo/SQLite 的编译能力和已知 FTS 关闭缺陷设置 release gate。

## Decision details

### 1. 模块和事实边界

```text
Domain transaction
  ├─ writes authoritative aggregate
  ├─ increments searchMutationCounter
  └─ enqueues RebuildSearchDocument(id, targetRevision)
                         │
                         ▼
                  SearchIndexer
                         │
         ┌───────────────┴────────────────┐
         ▼                                ▼
 active Search Projection          building Search Projection
         │                                │
         └──────── atomic slot flip ──────┘
                         │
                         ▼
             SearchQueryService
                         │
               authority re-check
                         ▼
                 protected result DTO
```

- Record、detail、Category/Tag、Attachment metadata 等领域表是唯一业务事实；
- SearchDocument、FTS、short grams、排名特征、part manifest、索引任务和游标都是技术 projection；
- 搜索重建不能改变 `Record.updatedAt`、领域 revision、历史或同步 mutation；
- Presentation 只调用 `SearchQueryPort`，不能执行 MATCH、拼 SQL 或读取 normalized columns；
- 索引器只通过只读聚合 projector 获取允许字段，不能绕过 repository 直接扫任意表列；
- P1/P2 服务端搜索是独立实现，但复用规范化/契约 fixture 和结构化权限语义，不复制移动端物理 schema。

### 2. 物理投影

TD-012 固化具体 DDL；逻辑表和约束如下。所有表位于 SQLCipher 主库并跟随同一 key、事务、备份/恢复边界。

#### 2.1 元数据和文档

`search_index_meta` 单行保存：

```text
activeSlot: a | b
indexGeneration
indexSchemaVersion
normalizationVersion
unicodeDataVersion
rankingVersion
sourceMutationCounter
indexedMutationCounter
buildingSlot?
buildingStartedAt?
lastVerifiedAt?
health: ready | building | partial | failed
```

每个 slot 有 `search_document_<slot>`：

```text
docRowId INTEGER PRIMARY KEY             -- 技术身份，不跨重建稳定
entityId TEXT UNIQUE NOT NULL
spaceId TEXT NOT NULL
entityType TEXT NOT NULL
entityRevision INTEGER NOT NULL
lifecycle TEXT NOT NULL
isSensitive INTEGER NOT NULL
titleExactKey TEXT NOT NULL
titlePrefixKey TEXT NOT NULL
titleCompactKey TEXT?
normalizedFieldManifest BLOB/TEXT NOT NULL
indexedAt INTEGER NOT NULL
```

- `docRowId` 只连接同一 slot 的索引表；业务结果始终返回 EntityId；
- `titleExactKey` 是 NFKC + full case-fold 后保留产品边界的规范标题，支持 equality；
- `titlePrefixKey` 是稳定搜索形式，使用 binary collation 和 prefix successor 做 `[prefix, upperBound)` range；
- `titleCompactKey` 仅用于型号的字母数字 compact variant；
- lifecycle/sensitivity 字段用于先减少候选，但不能替代最终权威检查；
- manifest 只保存 field/part ID、规范化范围、variant 和重建信息，不保存另一份用户原文。

#### 2.2 FTS 长 token 索引

每槽一张 contentless-delete FTS5 表，逻辑列为：

```sql
CREATE VIRTUAL TABLE search_fts_<slot> USING fts5(
  title,
  category_tag,
  location,
  checklist_title,
  body_description,
  item_description,
  attachment_name,
  content='',
  contentless_delete=1,
  detail=full,
  columnsize=1,
  tokenize='trigram case_sensitive 1'
);
```

DDL 是语义示例；migration 必须安全引用固定 slot 名，不能把用户输入放入 identifier。规则：

- FTS `rowid = search_document.docRowId`；
- `content=''` 避免 FTS 再保留可读取列副本；索引仍含 term/position，仍属于敏感数据；
- `contentless_delete=1` 允许标准 UPDATE/DELETE，要求 SQLite ≥ 3.43.0；
- `detail=full` 保留 column/position，支持字段匹配和 tier 内 proximity；
- `columnsize=1` 为受限 BM25 保留 token count；
- `case_sensitive 1` 是有意选择：大小写、全半角、重音 variant 已由版本化应用 pipeline 处理，不能再叠加 SQLite 自己的大小写语义；
- 不使用 external-content trigger；索引器在受控事务显式 upsert/delete，并带 revision guard。

#### 2.3 1～2 码点倒排

每槽一张 `search_short_gram_<slot>`：

```text
gram TEXT
variant exact | compact | accent_folded
fieldGroup controlled enum
docRowId INTEGER
partKey TEXT NOT NULL
PRIMARY KEY (gram, variant, fieldGroup, docRowId, partKey)
INDEX (docRowId)
```

- 对每个规范 token 生成连续 1-gram 和 2-gram；同一 part 内去重；
- gram 按 Unicode scalar/code point 切分，不按 UTF-16 code unit，不能拆 surrogate pair；
- `partKey` 对根字段使用固定 `root:<field>`，对嵌套字段使用受控 type + EntityId；只在定位清单 item 等嵌套命中时使用，根结果按 docRowId 去重；
- 文档替换先按 docRowId 清旧 grams 再分批插入新集合，和 FTS/doc revision 在同一 slot 更新事务；
- 单个 100,000 码点字段必须流式/分块产生 gram batch，不一次构造巨大 JS 数组；
- 索引体积和写放大纳入 QR-020。若真机设计容量不达标，必须用新 ADR 评估预分词 contentless FTS/原生 tokenizer，不能静默取消短词语义。

### 3. 字段映射

| fieldGroup / FTS column | 来源 | 逻辑权重 | 允许片段 |
| --- | --- | ---: | :---: |
| `title` | Record.title / 物品名称 | 100 | 是 |
| `category_tag` | 当前分类名、标签名 | 60 | 名称本身 |
| `location` | HouseholdItem.storageLocation | 55 | 是 |
| `checklist_title` | 有效 ChecklistItem.title | 50 | 是，带 itemId/groupId |
| `body_description` | Memo.body、Record.description | 40/35 | 是 |
| `item_description` | 有效 ChecklistItem.description | 25 | 是，带 itemId |
| `attachment_name` | 有效 Attachment.displayName | 20 | 是 |

- 逻辑权重与字段 source type 一起进入 manifest；Memo body 和通用 description 即便共享物理列也保留不同 feature；
- 已删除/不可用子对象、库存流水备注、OCR、操作历史和通知诊断不进入索引；
- 分类/标签重命名、合并、删除为所有引用根记录生成 fan-out task；
- 附件内部 locator、MIME sniff 细节和 content hash 不进入搜索；
- 一根记录只有一行 SearchDocument/FTS。重复 field token 可去重用于 short gram，但 FTS 保留有上限的 position/frequency；
- 字段新增需要新的 indexSchemaVersion、隐私评审、容量基准和 A/B 重建。

### 4. Unicode 规范化

#### 4.1 唯一 pipeline

`SearchNormalizer` 同时供 indexer 和 query 使用，步骤固定为：

1. 校验 UTF-16 输入，按 Unicode scalar 迭代；孤立 surrogate 作为非法持久化数据诊断，导入时用明确替换/拒绝策略；
2. Unicode NFKC；
3. Unicode Default Full Case Folding，不使用 locale-specific lowercase；
4. 再执行 NFKC，因为 full case fold 不保证保持 normalization；
5. 将已登记空白与标点映射为 token boundary，连续 boundary 合并；保留原文；
6. 生成 `exact` search token；
7. 对拉丁内容可生成去组合重音的 `accent_folded` alternate；exact 权重更高；
8. 对型号生成只保留 Unicode 字母/十进制数字的 `compact` alternate，例如 `ＡＢＣ－１２３ → abc-123 / abc123`；
9. 为长 token 送 FTS，为短查询/字段生成 1～2 gram；
10. 返回规范 token、variant、原文 offset map 和版本。

`normalizationVersion` 同时包含 pipeline 版本和 Unicode Character Database 版本。任何规则/UCD 变化都触发全量双槽重建；不能让旧/新 normalizer 在一个 active slot 混用。

#### 4.2 语义边界

- 不做拼音、繁简转换、中文停用词和通用编辑距离；
- 不全局修改领域原文、分类/标签业务唯一性值或 UI 展示；搜索 variant 只属于 projection；
- emoji/ZWJ/组合字符按 Unicode 数据和 offset map 保真；高亮不得截断 grapheme cluster；
- 日期、数字、单位保留完整 token 和连续片段，不做单位换算；
- 单字符/双字符能够命中任意已索引 field；结果量仍受 page/candidate budget 和结构化过滤控制；
- 超长正文不截断索引语义；处理必须分页/分块并受总存储容量门约束。

### 5. 更新任务与即时可见

#### 5.1 Task 创建

任何 SRCH-080 变化在领域事务内：

1. 修改权威聚合并得到新 revision；
2. 递增 `sourceMutationCounter`；
3. 幂等 upsert `RebuildSearchDocument(entityId, targetRevision, mutationCounter)`；
4. 若 permanent purge，任务类型仍由 handler 从“实体不存在”推导删除，不能携带旧内容；
5. 提交后由 task runner 执行，失败不回滚已保存记录。

Task payload 只有 ID、revision、counter 和原因 enum，不含标题、正文或 normalized token。

#### 5.2 Handler

- 领取 task 后重新读取当前权威聚合，不相信 task 中的旧字段；
- 当前 revision 大于 target 时，将 task 合并到当前 revision；小于 target 表示读取/事务异常，重试；
- 实体已 purged 时从 active/building slot 删除对应 doc/FTS/grams；
- 正常时完整生成一个新 SearchDocument，以 slot 内 `entityRevision <= incomingRevision` 条件替换；
- active slot 必写；若 meta 有 building slot，也写 building，避免构建期丢变更；
- 同一 task 重放任意次数结果一致；旧 builder/page/task 不得覆盖更新 revision；
- 成功写完所有目标 slot 才把 task acknowledged，并推进可证明连续的 `indexedMutationCounter`。

#### 5.3 刚保存补偿

当前进程保存/编辑成功后，将 EntityId + revision 放入有界 `SessionDirtySearchSet`：

- 查询时对尚未达到该 revision 的 dirty ID，用同一 normalizer/matcher 直接读取权威聚合并与索引候选 union；
- 最多保留 200 个 ID；超过时优先运行 index task，并把搜索状态标为“正在整理/结果可能不完整”，不能扫描全库；
- 对应索引 revision 已追平或 session 结束即移除；不持久化查询文本；
- 补偿结果仍走同一权限、敏感裁剪、排名和分页逻辑。

### 6. A/B 双槽重建

触发条件：首次建库、indexSchema/normalization/ranking 所需 feature 变化、恢复/导入、完整性失败或手动修复。

1. 在短事务选择 inactive slot，清空/重建其固定 DDL，记录 building versions 与起始 mutation counter；active 继续服务；
2. 按 EntityId keyset 分页读取可搜索根记录，每批构建 SearchDocument；不得把 50,000/250,000 对象一次装进内存；
3. 每次 upsert 带 revision guard；同时发生的新 task 双写，旧 builder page 不会覆盖；
4. 完成基线扫描后反复处理 `mutationCounter > buildStart` 的任务，直到 building slot 追平；
5. 执行 FTS `integrity-check` 和领域覆盖校验；等待所有不大于候选 barrier 的 search task 完成；
6. 在 exclusive 短事务再次确认 source counter 未变化、building indexed counter 相等、版本/health 正确，然后只更新 `activeSlot/indexGeneration`；
7. 新查询使用新 generation；已有 cursor 明确过期。旧 slot 等进程内 query lease 归零后后台清理；
8. 任一步 crash 后依据 meta 恢复或丢弃 building slot，active slot 始终保持可读；
9. 低磁盘时先删除失效 inactive projection/可重建 cache，再重试；绝不删除领域数据。若 active 也不可用，显示 partial/repair 状态。

Contentless table 不依赖 FTS `rebuild` 命令；全量重建由上述应用双槽流程完成。

### 7. 查询编译

#### 7.1 输入 gate

- 按 Unicode 码点限制原始 query ≤ 200、normalized token group ≤ 20；
- 空白/全标点/无 token 查询不执行索引；
- 每个输入 token 是一个 AND group；exact/compact/accent variants 在同 group 内 OR；
- P0 没有用户布尔语法。`AND`、`OR`、`NOT`、引号、星号、冒号、括号和 NUL 都只是原始输入，规范化后不能变成 FTS operator；
- SQL parameter bind 只防 SQL 注入，不防 FTS query-language 注入，因此必须经过 `SearchQueryAst` 和唯一 renderer；
- renderer 只输出 allowlist column、固定 AND/OR 括号和严格引用的 normalized token；禁止 Presentation/feature 拼 MATCH string。

#### 7.2 候选集合

每个 group：

- 完整标题 equality/前缀先查 B-tree，记录 deterministic tier；
- 长度 ≥ 3 的 variant 走对应 FTS column 集合；
- 长度 1～2 的 variant 走 `search_short_gram` equality；
- 分类、标签、类型、space、生命周期、日期/业务状态是结构化关系/投影 filter，不伪装成文本 token；
- 一个 group 的多 variant/backend union；不同 group 以 docRowId intersection；
- 每个阶段设内部 candidate budget；达到预算必须继续用索引/结构化条件收窄或返回明确 `query_too_broad`，不能截断后声称完整。

标签 filter 默认 relation AND，分类 filter 为 OR，“未分类”为显式谓词。混合类型日期按 SRCH-052 选择具体字段，不把所有日期合成一个列。

### 8. 排名、分页与片段

#### 8.1 固定排序元组

最终 keyset 排名为：

```text
matchTier ASC,
boundedTextScore DESC,
proximityScore DESC,
recencyBucket DESC,
updatedAt DESC,
entityId ASC
```

`matchTier` 固定：标题 exact、标题 prefix、标题 substring、分类/标签/位置 exact、清单项目标题、正文/说明、附件名。规则：

- exact/prefix tier 由 B-tree/结构化 equality 决定，完整标题永远高于正文重复；
- FTS5 `bm25()` 数值越小越相关；adapter 转成量化、封顶的 `boundedTextScore`，只在同 tier 使用；
- 列权重对应 SRCH-010，但重复命中/超长正文贡献有上限；
- exact variant 高于 compact，compact 高于 accent-folded；
- `queryInstant` 在首批固定，最近修改仅分桶/轻衰减，不随翻页时间漂移；
- rankingVersion 任何语义变化触发回归 fixture；若依赖新存储特征则触发重建。

#### 8.2 Cursor/session

- 首批 ≤ 30，后续页 ≤ 50，使用上述完整 tuple + EntityId keyset，不用裸 offset；
- cursor 是进程内 opaque session nonce + generation/mutationCounter/rankingVersion + last tuple，不含 query/token；normalized query 只在已解锁内存 session；
- 每页前核对 generation、source mutation counter、锁和 filter permission；变化时返回 `search_snapshot_expired` 并让 UI 保留查询后刷新；
- App 重启/锁定/切空间立即销毁 session，cursor 无效；
- 不能为了稳定分页长期持有 SQLite read transaction/WAL snapshot。

#### 8.3 片段与高亮

- 最多 2 个片段、每段约 120 个显示字符；
- 先由 index feature/manifest 选最佳 field + part，再读取当前权威原文并用同版 normalizer 重建 offset map；
- 使用 grapheme boundary 扩展高亮，不能把 normalization 文本、HTML marker 或 FTS `snippet()/highlight()` 直接交给 UI；
- 清单项目携带 item/group ID；若当前项目已删或 revision 改变，降级为根记录结果或丢弃候选；
- 敏感结果在 SearchQueryService 边界就移除正文、项目、位置、附件名和 offset；按当前产品隐私模式只返回通用占位或允许的标题，Presentation 不接触被裁剪值。

### 9. 权限、锁与生命周期

索引查询只是 candidate lookup。输出前必须用当前权威数据检查：

- 当前 space 与所选跨空间范围；
- P1/P2 当前 Account、active membership tenure 和实体可见权；
- active/archived/trashed/purged domain；
- root/subobject 当前 revision 与引用存在；
- isSensitive、应用锁和当前内容显示策略；
- 家庭删除只读/退出/撤权等状态。

因此普通→敏感、active→trashed、成员撤销或永久删除即使索引 task 尚未执行也不能泄露。锁屏/切后台时取消正在运行查询、finalize statement、清 session/result/snippet 内存并让 UI 使用安全占位；解锁后重新查询，不能恢复旧敏感 DTO。

P1 服务端再次鉴权，不能接受客户端传入“允许 entity IDs”作为授权。敏感可被本人本地搜索不代表可进入 AI，上下文仍按 SRCH-092 由用户明确选择和最小化。

### 10. 删除、维护和空间

#### 10.1 安全删除

- 数据库连接启用 TD-003 `PRAGMA secure_delete=ON`；
- 每张 FTS table 建立后执行 `INSERT INTO ft(ft, rank) VALUES('secure-delete', 1)` 等价配置；SQLite 核心 secure_delete 不能替代 FTS 自己的 term 删除；
- FTS secure-delete 要求 SQLite ≥ 3.42.0，并使索引格式不能被更旧 FTS5 读取；最低回滚/恢复版本必须在 migration manifest 声明；
- purge/字段移除后及时删除 SearchDocument、FTS row 和 grams；后续 WAL checkpoint/VACUUM 遵循 TD-003/数据生命周期，不承诺闪存物理覆写；
- 搜索索引不进入单独系统备份；整库备份/恢复按 TD-011 重建策略声明是否携带，不能产生明文词表。

#### 10.2 合并与完整性

- 每槽定期运行 FTS `integrity-check`；
- 另检验每个可搜索根恰一份当前 revision、lifecycle/sensitive、part 和关系一致；
- 不一致 ≤ 1% 时按实体修复，> 1% 时双槽全量重建；安全相关 mismatch 无论比例都立即以权威过滤并排高优先修复；
- 平时用可中断小步 `merge` 控制 segment；`optimize` 只在大重建后、空闲/供电/空间足够时执行；
- 禁止让 crisis merge 在交互写入上无限阻塞；相关 FTS config 经容量测试固定；
- `ANALYZE/PRAGMA optimize` 与 FTS optimize 是不同动作，由数据库维护策略分别调度。

### 11. Runtime capability 与 Expo 风险

不能根据依赖名称假设功能存在。首次建库/升级在目标 release build 中读取：

```text
sqlite_version()
cipher_version()
PRAGMA compile_options
```

并在临时/目标库实际执行 create/insert/query/update/delete/integrity-check/secure-delete probe，验证：SQLCipher、FTS5、trigram、contentless-delete 和所需语义。TD-003 的受控 SQLite/SQLCipher build 与 WAL 修复门优先；若 SQLCipher baseline 低于所需 SQLite，必须升级/回移修复，不能只看普通 SQLite header。

截至本 ADR：

- Expo SQLite config plugin 可启用 FTS 与 SQLCipher，并提供 prepared statement、流式迭代和 exclusive transaction API；
- Expo SDK 57 源码中的普通 SQLite 与 SQLCipher baseline 并非同一版本，因此 release 必须以运行时 probe 为准；
- Expo issue #38168 记录 FTS 使用后关闭连接可能在 iOS/Android 崩溃，当前仍须作为 release risk。

规避规则：

- P0 采用 TD-003 长生命周期单序列化连接；
- 所有 statement 在 `finally` 显式 finalize；关闭前停止并等待 search task/query；
- 受影响版本可使用 Expo 已记录的关闭配置 workaround 或纳入受控 fork，但必须由双平台反复 open→FTS→lock/background→close 压测决定；
- 不在正常后台/前台切换频繁关闭数据库；
- 依赖升级必须重跑关闭、WAL、SQLCipher、FTS、备份和迁移矩阵。

## Alternatives considered

### 仅使用 FTS5 `unicode61`

它按 SQLite 固定 Unicode 规则分词，连续中文和产品 1～3 字子串语义不足；应用也无法独立版本化 full case fold。拒绝。

### 仅使用 FTS5 trigram

至少 3 字的子串性能好，但 SQLite 明确指出少于 3 个 Unicode 字符的全文查询不命中；不能满足单字/双字。采用 trigram + short gram 混合。

### `%LIKE%` 短词 fallback

2 字 pattern 没有一个完整 trigram 可用，常见查询会全扫大型规范化正文，无法保证 400 ms；拒绝。

### External-content FTS + SQL triggers

可减少应用代码，但外部内容、触发器与权威聚合/嵌套字段易失配，更新/删除顺序错误会留下 term；也很难同时双写 A/B 与 revision guard。选择 contentless-delete + application projector。

### 单槽原地重建

重建期间无完整结果，crash 会留下难以区分的新旧混合状态。A/B 多占临时磁盘，但可以验证后原子切换并安全回滚。

### P0 自定义 C tokenizer 或独立搜索引擎

能更高效处理中日韩分词/模糊匹配，但引入双平台 native 生命周期、加密、备份、迁移和供应链面。先使用 SQLite 原生能力；只有混合方案在正式容量 fixture 失败时以新 ADR 评估。

### 保存或上传搜索历史

可做建议和分析，但增加敏感数据与生命周期。P0 query/session 仅驻留已解锁内存，遥测只保留批准的非内容分桶。

## Consequences

### Positive

- 中文 1/2/3+ 字、拉丁子串和型号都走索引，不依赖网络或全表扫描；
- 标题 exact/prefix 的产品排名不受 BM25 统计波动影响；
- 索引与领域事实分离，任何失败、schema/Unicode 升级和恢复都能双槽重建；
- 敏感/权限/生命周期在权威边界复核，索引滞后不会直接泄露；
- 同一 SQLCipher/事务/备份边界减少明文副本与跨库原子问题；
- Unicode、排名和 schema 独立版本，未来拼音/OCR/服务端搜索可以增加而不偷换 P0 语义。

### Negative

- trigram + short grams + 双槽重建增加磁盘、写放大和实现复杂度；
- 100,000 码点正文的 short gram 构建成本高，需要流式批处理和容量门；
- contentless FTS 无法直接返回原文，片段必须重读/重做 offset map；
- 索引异步更新需要 dirty-set 补偿和显式 partial/repair 状态；
- Expo/SQLCipher SQLite 版本和关闭缺陷需要受控 native build/回归维护。

## Risks and mitigations

| 风险 | 缓解 |
| --- | --- |
| Unicode 跨平台结果不同 | 自带 UCD/version；同一纯 normalizer；NormalizationTest/CaseFolding fixtures。 |
| FTS query language 注入 | 安全 AST + 唯一 renderer + allowlist；用户永不直达 MATCH。 |
| 旧 task 覆盖新内容 | handler 重读权威；revision conditional upsert；双槽 task barrier。 |
| 重建切换漏变更 | mutation counter、building 双写、追平 barrier、exclusive 原子 flip。 |
| stale index 泄露敏感/撤权数据 | 每个结果重新鉴权并在 query service 裁剪；锁屏销毁 session。 |
| 短 gram 体积失控 | per-part 去重、批处理、空间预算/指标、设计容量门；失败则新 ADR。 |
| FTS 删除仍残留旧 term | 核心 + FTS secure-delete、WAL 生命周期、forensic test。 |
| 低磁盘破坏领域数据 | projection 可删除重建；先清 inactive；领域事务与索引任务分离。 |
| FTS 关闭连接崩溃 | 长连接、显式 finalize、已知 workaround/受控 fork、真机生命周期压力测试。 |
| 排名随库统计漂移 | tier 优先、BM25 仅 tier 内且量化封顶、ranking fixtures。 |

## Implementation constraints

- `SearchNormalizer`、`SearchQueryAst`、renderer、ranker 和 snippet mapper 是独立纯包，客户端/服务端 fixture 可复用；
- 只有 SearchRepository 可以引用固定 FTS table 名、MATCH/bm25/special INSERT；动态 identifier 禁止；
- 所有 SQL value 使用 prepared bind；FTS expression 即使最终 bind 也必须先由 AST renderer 生成；
- indexer 每批限定记录数、文本码点、gram rows、事务时间和取消点；不能在 JS heap 聚合全库；
- 写 active/building slot 的一个文档必须原子；不允许 doc revision 已新而 FTS/gram 仍旧；
- 搜索后台任务与普通写共享 TD-003 单连接队列，分批让出，不能持有长事务阻塞 200 ms 写入目标；
- query 不返回任意 normalized text/manifest；DTO 先裁剪再离开 application boundary；
- 不记录 query、token、片段、标题、敏感 EntityId 或 MATCH SQL；允许 token 数/结果数/耗时分桶、版本和错误码；
- 远程配置只能暂停索引/调低批大小/隐藏有缺陷能力，不能提高硬上限、改变 normalization/ranking 或开启未建模字段；
- schema/normalizer/ranker 版本与 migration/backup manifest 显式关联，旧 App 遇到新 FTS secure-delete 格式必须安全拒绝而非误读。

## Verification

### 正确性与 Unicode

- Unicode NormalizationTest、CaseFolding golden data 在 iOS/Android/服务端输出一致；覆盖 NFKC、全角、`ß`、组合重音、emoji/ZWJ、孤立 surrogate；
- 中文 1/2/3/长串、英文 exact/prefix/substr、`ABC-123/abc123/ＡＢＣ－１２３`、数字/日期/单位；
- 默认 AND 可跨字段，variant 在组内 OR；不出现隐藏 AND/OR/NOT/引号/星号/冒号语法；
- 分类/标签/位置 exact、标签 AND、分类 OR/未分类、日期/类型/状态结构化过滤；
- 清单 item 命中折叠根记录并定位 part，删除/移动 item 后无旧片段；
- 排名不变量：标题 exact 永远高于正文重复，stable tie/cursor byte-equivalent。

### 安全与生命周期

- 普通→敏感、active→archived/trashed/purged、家庭成员撤销、space 切换与 index task 延迟的竞态均不泄露；
- 未解锁深链、查询中锁屏/后台、截图/可访问树、session/cursor 重用；
- 敏感命中在 application DTO 无正文/项目/位置/附件名，不只是 UI 隐藏；
- SQL/FTS fuzz：引号、operator、NUL、长输入、无效 Unicode、20/21 token；无 SQL/FTS 注入或 parser blowup；
- forensic 检查 DB/WAL/SHM 无明文，删除后的 FTS vocab/普通表、日志、crash 和 analytics 无内容。

### 一致性与崩溃恢复

- task 创建/领取、active upsert、building upsert、ack 每个 kill point；重放 100 次结果不增长；
- stale revision、实体 purge、分类/标签 fan-out、附件 rename、同步批量/restore/import；
- 双槽 build 每页/追平/verify/flip/cleanup kill；始终有旧完整或新完整 active，不出现混合代；
- building 期间高频编辑同一实体，builder 旧 revision 不覆盖；mutation barrier 无漏 task；
- 1% 边界的单体修复/全量重建、FTS corruption、低磁盘、asset/schema/version mismatch；
- current-session dirty set 让刚保存内容立即可搜，达到 201 个时进入可解释 partial 且领域数据可见。

### 性能与平台

- QR-020 数据集：热门单字、常见双字、3+ 子串、无结果、20 token、最多正文和 5,000 item 清单；
- 首批 P95 ≤ 400 ms，并分别记录 normalize/candidate/filter/rank/snippet；索引写不使普通记录事务超过 QR-011；
- `EXPLAIN QUERY PLAN` 回归证明 B-tree、short gram 和 MATCH 生效；禁止 leading `%LIKE%`；
- 索引全量/增量大小、临时双槽峰值、写放大、重建时间和 battery/thermal 基线；
- iOS/Android release 反复 open→FTS query/update→锁定/后台→close，无 crash/悬挂 statement；
- 启动 runtime probe 在普通 SQLite 与 SQLCipher 实际 build 上验证相同 feature，失败进入可恢复搜索 unavailable 状态。

## Rollout and rollback

1. 先实现/冻结 normalization、query、ranking 和 security fixtures；
2. 在目标 SQLCipher build 做 capability probe 与 Expo FTS 生命周期 spike；
3. 建 slot A schema，分页 backfill 后验证/激活；索引完成前记录页面、列表和手动功能照常可用；
4. 开 shadow comparison 对一组本地合成 query 比较期望，不采集用户 query；
5. 达到正确性、隐私、容量和性能门后开放 SCR-021；
6. 新 schema/normalizer 用 slot B 构建并原子切换；回滚 App 必须理解当前 meta/FTS format，否则只禁用搜索，不能触碰领域数据；
7. 严重缺陷时远程/本地 kill switch 停止查询和 index worker，清除可重建 projection，记录仍可通过类型列表和详情操作。

## References

- [SQLite FTS5 Extension](https://www.sqlite.org/fts5.html)
- [Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/)
- [Expo issue #38168：FTS close crash](https://github.com/expo/expo/issues/38168)
- [Unicode Standard Annex #15：Normalization Forms](https://www.unicode.org/reports/tr15/)
- [Unicode CaseFolding data](https://www.unicode.org/Public/UCD/latest/ucd/CaseFolding.txt)
- [Unicode Standard Annex #29：Text Segmentation](https://www.unicode.org/reports/tr29/)

## Revision history

| Date | Version | Change |
| --- | --- | --- |
| 2026-07-26 | v1.0 | 固化 SQLCipher 内 trigram + short-gram 混合索引、Unicode pipeline、A/B 重建、排名、安全和平台门。 |

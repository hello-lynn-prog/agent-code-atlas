# audit.json / comparison.json 数据模型(audit-schema)

创建或更新任何审计数据前必读。validator(`scripts/validate_audit.py`)按本文执行校验;本文与校验器不一致时以校验器为准并修复本文。

## 通用约定

- 编码 UTF-8。`schema_version` 当前为 `"1.0"`。
- 未注明可选的字段均为必填;列表字段必填但允许为空数组(空数组本身是结论:"未发现")。
- **ID**:全文档内唯一(跨集合也建议唯一),推荐前缀:`nd-`(节点)、`f-`(文件)、`sym-`(符号)、`ev-`(证据)、`rel-`(关系)、`fl-`(链路)、`st-`(状态模型)、`ep-`(扩展点)、`rc-`(配方)、`fd-`(发现)、`un-`(未知项)。ID 只用 `[A-Za-z0-9._-]`。
- **裸 ID 引用 vs 带类型引用**:
  - 集合内的 id 列表字段(如 `file_ids`、`symbol_ids`、`evidence_ids`、`architecture_node_ids`、`upstream_node_ids`、`files_to_read`)存**裸 ID**。
  - 需要跨类型引用的字段(`relations.from_ref/to_ref`、`state_models.*_refs`、`extension_points.*_refs`、`development_recipes.reference_implementations`、`findings.related_refs`、comparison 各处 `refs`)存**带类型引用字符串**,格式 `"<kind>:<id>"`,kind ∈ `node | file | symbol | state | extension | flow | external`。`external:` 后跟外部组件名(如 `external:anthropic-sdk`),始终合法,用于标记委托边界。
- **枚举**:
  - `confidence`:`high | medium | low`。
  - `implementation_status`(architecture_nodes):`implemented | delegated | absent | unknown`。比较矩阵单元格额外允许 `partial`。
  - `evidence.type`:`runtime | test | code | config | docs | inference`;等级 `runtime > test > code > config > docs > inference`。
  - `layer`:`boundary | interface | lifecycle | orchestration | context-state | integration | runtime | permissions | observability | extensibility | testing`。
  - `importance`:`core | high | normal | low`(校验器对其他值告警)。
  - `symbol.kind`:`function | method | class | interface | type | enum | variable | constant | module | package | command | handler | unknown`。
  - `relation.type`:`imports | exports | calls | constructs | implements | extends | registers | resolves | dispatches | invokes_model | invokes_tool | reads_state | writes_state | emits | subscribes | validates | authorizes | executes | serializes | deserializes | persists | restores | delegates | cancels | retries | maps_to | configured_by | depends_on`。
  - `risk_level`:`low | medium | high`;`significance`:`info | minor | major | critical`(告警级)。
- **行号**:1 起始;`start_line <= end_line`;必须为正整数。
- **excerpt 限制**:≤ 40 行且 ≤ 6000 字符(校验器强制)。
- 所有用户可见文本使用中文或英文均可,但同一报告保持一致。

## 顶层结构(单项目)

```json
{
  "schema_version": "1.0",
  "report_kind": "single_project",
  "project": {},
  "analysis": {},
  "statistics": {},
  "architecture_nodes": [],
  "files": [],
  "symbols": [],
  "relations": [],
  "execution_flows": [],
  "state_models": [],
  "extension_points": [],
  "development_recipes": [],
  "findings": [],
  "evidence": [],
  "unknowns": []
}
```

- `report_kind`:`single_project`(完整)或 `focused`(聚焦)。聚焦模式必须同时填 `analysis.mode="focused"` 与 `analysis.focus`。
- 必填顶层:`schema_version、report_kind、project、analysis、architecture_nodes、files、symbols、evidence`。其余键存在时必须为数组。`statistics` 为对象(自由结构,供状态栏/概览)。

## project

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | 项目标识,比较模式用于关联 |
| name | string | 项目名 |
| root | string | 审计时的仓库根绝对路径 |
| repository_url | string? | 可选 |
| revision | string? | git commit;非 git 仓库填 null 并在 analysis.warnings 说明 |
| analyzed_at | string | ISO 8601 时间 |
| languages | string[] | 按占比排序的语言名 |
| build_systems | string[] | 如 tsc、setuptools、cargo |
| package_managers | string[] | 如 npm、pnpm、uv、cargo |
| project_kind | string | sdk / library / harness / runtime / cli / product / protocol-adapter / framework / monorepo-multi-package |
| project_kind_confidence | string | 枚举 confidence |
| boundaries | object | `{ "owns": [], "delegates": [], "out_of_scope": [] }`,元素为字符串描述(委托项建议格式 `外部组件 — 承担的职责`) |
| external_dependencies | array | 依赖清单,元素 `{"name","role","evidence_ids"?}` 或字符串 |
| entry_points | array | `{"kind":"cli|sdk-api|http-rpc|command","path"?,"symbol"?,"summary"}` |

## analysis

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| mode | string | `full` 或 `focused` |
| focus | string[] | 聚焦专题(agent-loop / tool-system / model-provider / context-memory / permissions-sandbox / subagents / streaming-events / checkpoint-resume / extensibility / runtime-lifecycle);full 模式为空数组 |
| runtime_verification | string | `none`(默认)或 `authorized`(用户明确授权后才能填非 none,并在 limitations 记录实际做了什么) |
| included_paths | string[] | 实际纳入分析的路径 |
| excluded_paths | string[] | 排除路径及原因 `"path — 原因"` |
| limitations | string[] | 分析局限(如未运行测试、行号基于某 revision) |
| warnings | string[] | 过程告警 |
| analyzer_version | string | 如 `agent-code-atlas/1.0` |
| inventory_file | string? | 使用的 inventory.json 路径(工作目录,非用户输出目录) |
| refresh | object? | 刷新模式时填:`{"base_audit":"audit.json 路径","base_revision":"...","reused_node_ids":[],"invalidated":[],"added":[],"removed":[]}` |

## architecture_nodes

每个节点是一次"该概念由谁承担"的判定。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | `nd-` 前缀 |
| canonical_id | string | 本体概念 id(如 `orch.agent-loop`);自定义用 `custom.<slug>` |
| canonical_name | string | 统一概念名 |
| project_terms | string[] | 项目原始术语(代码里实际叫什么) |
| layer | string | 层枚举 |
| summary | string | 该职责在本项目如何实现,1-4 句 |
| implementation_status | string | 四值枚举 |
| confidence | string | 三值枚举 |
| file_ids | string[] | 裸 ID → files |
| symbol_ids | string[] | 裸 ID → symbols |
| evidence_ids | string[] | 裸 ID → evidence;high 置信度不允许为空 |
| upstream_node_ids | string[] | 裸 ID → architecture_nodes |
| downstream_node_ids | string[] | 同上 |
| extension_point_ids | string[] | 裸 ID → extension_points |
| notes | string | 实现变体(如 loop 的 7 种形态)、合并/拆分原因等 |

## files

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | `f-` 前缀 |
| path | string | 相对仓库根,`/` 分隔(Windows 路径转换) |
| language | string\|null | null 表示未知/非代码 |
| size | integer | 字节 |
| line_count | integer\|null | null 表示二进制或未统计 |
| generated / test / documentation | boolean | 判定标记 |
| importance | string | core/high/normal/low |
| summary | string | 该文件承担什么 |
| architecture_node_ids | string[] | 裸 ID |
| symbol_ids | string[] | 裸 ID(仅关键符号,不是全部符号) |
| evidence_ids | string[] | 裸 ID |

## symbols

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | `sym-` 前缀 |
| file_id | string | 裸 ID → files |
| name / qualified_name | string | 限定名如 `pkg.mod.Class.method` |
| kind | string | kind 枚举 |
| signature | string? | 一行签名 |
| start_line / end_line | integer | 正整数,start<=end |
| visibility | string? | public/internal/private 等项目语义 |
| exported | boolean | 是否公共 API |
| summary | string | 职责 |
| architecture_node_ids / evidence_ids | string[] | 裸 ID |

## relations

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | `rel-` 前缀 |
| type | string | relation.type 枚举 |
| from_ref / to_ref | string | 带类型引用,两端可解析或为 `external:*` |
| label | string | 简短关系说明 |
| summary | string | 细节(何时发生、条件) |
| confidence | string | 枚举 |
| evidence_ids | string[] | 裸 ID |

关系方向语义:`from --type--> to`,如 loop `dispatches` 工具、client `invokes_model` external。

## execution_flows 与 steps

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | `fl-` 前缀 |
| name | string | 如 "工具调用链路" |
| category | string | text-response / tool-call / error-retry / cancellation / subagent / checkpoint-resume / extension-registration / custom |
| summary | string | 链路概述 |
| trigger | string | 触发条件 |
| termination | string | 结束条件 |
| confidence | string | 枚举;high 时 evidence_ids 不允许为空 |
| evidence_ids | string[] | 裸 ID |
| steps | array | 见下 |

step:

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | 建议 `fl-xxx.s1` |
| order | integer | 必须 1..n 连续(校验器强制) |
| title | string | 步骤名 |
| actor | string | 执行者(node 或项目术语) |
| architecture_node_ids / file_ids / symbol_ids | string[] | 裸 ID |
| input / output | string | 数据进出 |
| state_reads / state_writes | string[] | 裸 ID → state_models |
| events_emitted | string[] | 事件名(与 obs 词汇一致) |
| errors | string[] | 可能错误及处理 |
| branching | string | 分支条件说明 |
| evidence_ids | string[] | 裸 ID |

## state_models

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | `st-` 前缀 |
| name / project_term | string | 统一名 / 项目术语 |
| category | string | message / session / run-context / tool-call / tool-result / event / provider-request / provider-response / checkpoint / other |
| summary | string | — |
| mutability | string | immutable / mutable / unknown(其他值告警) |
| lifetime | string | request / turn / run / session / persistent |
| persistence | string | none / file / database / external / unknown |
| creator_refs / reader_refs / writer_refs / serializer_refs | string[] | 带类型引用 |
| fields | array? | `{"name","type","summary"}` |
| evidence_ids | string[] | 裸 ID |

## extension_points

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | `ep-` 前缀 |
| name | string | — |
| category | string | provider / tool / middleware / hook / plugin / storage / prompt / executor / protocol / mcp / agent-type |
| stability | string | stable / experimental / unstable / internal / unknown(其他值告警) |
| public | boolean | 是否面向使用方公开 |
| registration_method | string | 如何注册(装饰器/配置/注册函数…) |
| interface_refs | string[] | 带类型引用(接口定义符号) |
| implementation_refs | string[] | 带类型引用(参考实现) |
| example_refs | string[] | 带类型引用(examples/tests) |
| constraints | string | 实现约束 |
| evidence_ids | string[] | 裸 ID |

## development_recipes

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | `rc-` 前缀 |
| goal | string | 如 "添加模型供应商" |
| applicability | string | 何时不适用 |
| summary | string | 推荐做法概述 |
| recommended_extension_points | string[] | 裸 ID → extension_points |
| files_to_read | string[] | 裸 ID → files |
| symbols_to_implement | string[] | 裸 ID → symbols |
| reference_implementations | string[] | 带类型引用(建议复制的模式) |
| affected_architecture_nodes | string[] | 裸 ID |
| invariants | string[] | 必须保持的不变量 |
| risks | string[] | 风险点 |
| risk_level | string | low/medium/high |
| validation_steps | string[] | 建议验证方式 |
| evidence_ids | string[] | 裸 ID |

## findings

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | `fd-` 前缀 |
| title | string | — |
| category | string | architecture / security / robustness / consistency / docs-mismatch / other |
| summary | string | — |
| significance | string | info/minor/major/critical(告警级) |
| confidence | string | 枚举;high 时 evidence_ids 不允许为空 |
| evidence_ids | string[] | 裸 ID |
| related_refs | string[] | 带类型引用 |

## evidence

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | `ev-` 前缀 |
| type | string | 六值枚举 |
| file_id | string? | 裸 ID;有行号时必填 |
| symbol_id | string? | 裸 ID |
| start_line / end_line | integer? | 正整数,start<=end |
| excerpt | string? | 原始代码片段,≤40 行且 ≤6000 字符;不得为整文件 |
| observation | string | 这段证据说明什么 |
| basis | string | **type=inference 时必填**:列出推断依据的事实 |
| supports | string | 支持哪个结论(canonical_id 或描述) |
| confidence | string | 枚举 |

规则:high 置信度的 node/finding/flow 不允许零证据;仅有 docs/inference 证据的 high 结论会收到告警。

## unknowns

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | `un-` 前缀 |
| question | string | 未确认的问题 |
| why_unknown | string | 为什么无法确认 |
| attempted_checks | string[] | 已尝试的检查 |
| likely_locations | string[] | 可能在哪(路径/符号) |
| impact | string | 对结论的影响 |
| recommended_verification | string | 建议验证方式(含是否需要 runtime 授权) |

## comparison.json(多项目比较)

```json
{
  "schema_version": "1.0",
  "report_kind": "comparison",
  "generated_at": "...",
  "analyzer_version": "agent-code-atlas/1.0",
  "projects": [
    {"id": "p1", "name": "...", "root": "...", "revision": "..."?, "audit_index": 0}
  ],
  "source_audits": [ { 完整的单项目 audit,project.id 与 projects 对应 } ],
  "capability_matrix": [],
  "concept_comparisons": [],
  "flow_comparisons": [],
  "extension_comparisons": [],
  "architectural_differences": [],
  "common_patterns": [],
  "tradeoffs": [],
  "unknowns": []
}
```

- `projects[].audit_index` 指向 `source_audits`;`source_audits` 强烈建议内嵌(渲染器的项目切换浏览依赖它),数量应与 projects 一致(不一致告警)。
- `capability_matrix` 行:`{"concept_id","concept_name","cells":[{"project_id","status"(五值含 partial),"summary"?,"refs"?}]}`。每行应覆盖所有项目。
- `concept_comparisons` 元素:`{"concept_id","concept_name","common_pattern"?,"difference_summary","per_project":[{"project_id","project_term","implementation","strategy","data_structures"[], "control_flow","extension","refs"[],"confidence","tradeoff"}]}`。
- `flow_comparisons` / `extension_comparisons`:同样按 topic 组织,`per_project` 含 summary 与 refs。
- `architectural_differences`:`{"id","title","summary","per_project":[{"project_id","statement"}],"significance"}`。
- `common_patterns`:`{"id","title","summary","refs"[]}`;`tradeoffs`:`{"id","project_id","title","summary"}`。
- comparison 的 `unknowns` 结构同单项目,可加 `project_id`。
- refs 解析:先在对应项目(按 project_id 找到其 audit)内解析;该项目未内嵌 audit 时降级为告警。

## 校验器行为摘要

`python scripts/validate_audit.py <file> [--strict] [--format text|json]`

错误(非零退出,逐条给出 JSON 路径与原因):缺必需字段/数组类型不符;ID 重复;文件 path 重复;枚举非法;引用(裸 ID 或带类型 ref)不可解析;flow steps order 非 1..n;行号非正或 start>end;excerpt 超限;high 置信度零证据;inference 缺 basis;有行号但无 file_id;comparison 的 project_id 不存在、cell 状态非法。

告警(默认不失败,`--strict` 时升级为错误):importance/mutability/stability/project_kind 等取建议枚举外的值;high 结论仅 docs/inference 证据;symbol 行号超出文件 line_count;comparison 未内嵌 source_audits 导致 ref 无法解析;空 files/symbols 等可疑空集。

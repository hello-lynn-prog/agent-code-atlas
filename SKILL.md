---
name: agent-code-atlas
description: 审计 Agent SDK / Agent Harness / Agent Runtime / CLI Agent / 多智能体编排框架等智能体项目的源码架构。把 agent loop、orchestrator、model provider、tool registry、tool executor、context/state、permission、sandbox、事件流、memory、checkpoint、subagent、扩展点等架构职责定位到具体目录、文件、类、函数和行级证据,生成统一数据模型 audit.json,并渲染为可离线 file:// 打开的交互式单文件 HTML 架构图谱 report.html。支持单项目完整审计、聚焦审计(仅 Agent loop / 工具系统 / 状态管理等专题)、多项目比较(comparison.json + comparison-report.html)和已有审计的增量刷新。当用户要求"审计 / 分析 / 梳理某个 agent 框架、Agent SDK、CLI coding agent 的源码架构""生成架构报告 / 架构图谱""比较多个 agent 项目"时使用。不适用于普通业务仓库的一般代码审查,也不适用于单个 bug 排查或只需检查个别文件的任务。
---

# Agent Code Atlas

对不同语言、不同架构风格的 Agent 项目做源码审计,回答:这个项目是什么类型、每项架构职责由哪些代码承担、证据在哪一行、如何二次开发。产出是一份交互式离线 HTML 报告和一个机器可读的 audit.json,而不是一篇 Markdown 文档。

## 何时使用

- 用户给出一个 Agent SDK / harness / runtime / CLI agent / 多智能体框架的本地源码路径,想理解其架构。
- 用户想在报告中从架构概念(agent loop、tool registry 等)定位到文件、类、函数、行号,或反向从文件查看其职责。
- 用户想追踪"用户输入 → 模型调用 → 工具执行 → 结果回填 → 下一轮"的完整链路。
- 用户想比较多个 Agent 项目,或想得到面向二次开发的修改入口、扩展点与风险提示。

## 何时不使用

- 普通业务仓库的一般代码审查、安全扫描、风格检查。
- 只排查一个 bug、只看一个文件的局部问题。
- 目标仓库不可本地访问(本 skill 不做在线克隆)。

## 工作模式

1. **单项目完整审计**:输入本地仓库路径(必填)、输出目录、分析范围、重点问题、是否允许 runtime verification(默认否)。输出 `audit.json` + `report.html`。
2. **聚焦审计**:只深入一个专题,如 agent-loop / tool-system / model-provider / context-memory / permissions-sandbox / subagents / streaming-events / checkpoint-resume / extensibility / runtime-lifecycle。聚焦模式仍需确认项目边界,写入 `analysis.mode = "focused"` 和 `analysis.focus`,其他概念只做浅层标记。
3. **多项目比较**:输入多个仓库路径,或多个已生成的 audit.json。基于统一架构概念比较,输出 `comparison.json` + `comparison-report.html`。
4. **审计刷新**:输出目录已有 audit.json 时,对比 git revision / 文件哈希 / 时间,复用仍有效的结论,标记新增、删除、变更的证据;行号或符号已失效时必须显式降级或标记,不得静默沿用。

## 安全边界(默认静态只读)

不修改目标仓库;不安装目标依赖;不执行目标代码或未知脚本;不运行有外部副作用的命令;不访问真实凭据或生产服务;不发送网络请求;不启动目标项目。只有用户明确授权 runtime verification 后才可运行目标项目的测试 / 构建 / 最小实验,且优先低风险、局部、可停止的验证。runtime 证据只能在授权后产生。

默认忽略 `.git`、`node_modules`、`vendor`、`dist`、`build`、`target`、`coverage`、`.venv`、`__pycache__`、生成代码目录和大型二进制资产目录(用户可显式要求包含)。

## 核心约束

- 判定单位是"哪个代码实体承担了哪项架构职责",不是目录名或关键词匹配。每个结论同时记录:统一架构概念(canonical id)、项目原始术语、代码位置、证据、置信度。
- 实现状态只用四种:`implemented`(本仓库实现)/ `delegated`(委托给宿主、依赖或上层应用)/ `absent`(设计上不提供)/ `unknown`(证据不足)。比较矩阵额外允许 `partial`。
- 证据等级:`runtime > test > code > config > docs > inference`。README 只是设计意图,不能单独证明执行路径。`inference` 证据必须写明推断依据(`basis` 字段)。
- 高置信度(high)的重要结论不允许没有任何证据。
- 降级置信度的情形:动态 import、运行时代码生成、反射、DI、宏、元编程、RPC 边界、闭源依赖、生成代码、配置驱动注册、环境分支、feature flags、插件运行时发现。

## 高层工作流程

阶段一 确认输入与边界(仓库根目录、输出目录、是否 monorepo、git revision、用户关注点、runtime verification 默认关闭)→ 阶段二 生成仓库画像(运行 `inventory_repo.py`)→ 阶段三 发现架构候选(路径 + 符号 + import + 注册表 + tests/examples + 公共 API,不得只靠关键词)→ 阶段四 双向追踪(自顶向下:入口→loop→模型→工具→状态→输出;自底向上:模型 SDK/executor/event→adapter→dispatcher→orchestrator→公共 API;两路应在核心控制层汇合,不能汇合记为 unknown 或委托边界)→ 阶段五 建立执行切片(文本响应 / 工具调用 / 错误重试 / 取消 / 子智能体 / checkpoint-resume / 扩展注册;只展示项目实际支持的链路)→ 阶段六 建立状态与数据流(Message、Session、RunContext、ToolCall、ToolResult、AgentEvent、Checkpoint 等:谁创建 / 读取 / 修改 / 序列化、生命周期、持久化边界)→ 阶段七 验证证据 → 阶段八 生成二次开发指南 → 阶段九 校验并渲染报告。

详细操作指引见 `references/audit-workflow.md`,必须在做完整审计前读取。

## 何时读取哪个 reference(逐步披露)

| 场景 | 读取 |
| --- | --- |
| 把代码映射到架构概念、判断某能力由谁承担 | `references/architecture-ontology.md` |
| 执行完整或聚焦审计的九个阶段 | `references/audit-workflow.md` |
| 创建或更新 audit.json / comparison.json 的任何字段 | `references/audit-schema.md` |
| 分析特定语言仓库时 | `references/language-strategies.md` 中对应语言小节 |
| 渲染报告前、或需要理解报告视图/交互约定 | `references/html-report-spec.md` |
| 多项目比较 | `references/comparison-method.md` |

披露规则:单项目审计不加载 comparison-method.md;TypeScript 项目不加载其他语言的详细策略;聚焦审计只加载相关本体小节与工作流中涉及的阶段。references 合计较大,按需读取。

## 脚本调用

全部为 Python 3 标准库,确定性、只读(除明确写出的输出文件)。`<skill-dir>` 指 skill 安装目录。

```bash
# 阶段二:仓库画像(只读扫描,不做语义判断)
python <skill-dir>/scripts/inventory_repo.py <repo-path> --out <work-dir>/inventory.json
#   可选: --include GLOB(可多次,限定范围并可使默认忽略目录被包含)
#         --exclude GLOB(可多次) --max-file-size BYTES
#         --follow-symlinks(默认关) --include-generated(默认关)

# 阶段九:校验 audit.json / comparison.json(引用完整性等,失败返回非零)
python <skill-dir>/scripts/validate_audit.py <audit.json> [--strict] [--format text|json]

# 阶段九:渲染自包含单文件 HTML
python <skill-dir>/scripts/render_report.py <audit.json> --out <output>/report.html
python <skill-dir>/scripts/render_report.py <comparison.json> --out <output>/comparison-report.html --mode comparison

# 验证 skill 自身(临时目录内构造样例数据,跑 validator + renderer + 静态检查)
python <skill-dir>/scripts/smoke_test.py
```

## 输出约定

- 用户指定输出路径则严格使用;未指定时用 `./agent-code-atlas-output/<repository-name>/`,并在开始前或结果中明确说明实际位置。
- 单项目:`<output>/audit.json`、`<output>/report.html`。比较:`<output>/comparison.json`、`<output>/comparison-report.html`。
- 临时分析文件(inventory、草稿)放临时/工作目录,不混入用户输出目录。
- 完成后向用户简要报告:项目类型;核心 loop、模型层、工具层、runtime 的位置;report.html 与 audit.json 路径;未确认的重要问题;是否执行了 runtime verification;如何离线打开报告(file:// 直接双击)。

## 失败与不确定性处理

- 分析中断 / 范围过大:优先保证已覆盖部分的证据质量,把未覆盖能力标为 `unknown` 并写入 `unknowns`,不猜测。
- 找不到某能力的实现:先排除 delegated(依赖/宿主负责)与 absent(设计不提供),仍不能确定才标 unknown。
- validator 报错必须修复 audit.json 后再渲染;不要为了通过校验而删掉 unknowns。
- 不声称:自动证明完整调用图、自动理解所有反射/动态注册、不运行代码就能确认全部 runtime 行为、精确解析所有语言、仅凭文件名或 README 确认职责。

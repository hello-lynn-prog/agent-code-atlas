# 审计工作流(audit-workflow)

完整或聚焦审计前必读。这是可调整的工作框架而非机械清单:小仓库可以合并阶段,大仓库应分批推进;但证据纪律(阶段七)与报告校验(阶段九)不可省略。

## 阶段一:确认输入与边界

- 仓库根目录(绝对路径;Windows 路径规范化)、输出目录(默认 `./agent-code-atlas-output/<repository-name>/`)。
- 判断单项目还是 monorepo:查看 workspace 配置(pnpm-workspace.yaml、Cargo workspace、go.work、settings.gradle、pyproject workspace)。monorepo 含多个独立 Agent 包时,与用户确认审计全部还是某个包;审计全部时每个包建独立的 node 集并在 project.boundaries 说明。
- 记录 git revision:`git rev-parse HEAD`(git 不可用时读 .git/HEAD,再不行标记 null + warning)。
- 记录用户关注点(重点问题、聚焦专题)。
- runtime_verification 默认 `none`,仅在用户明确授权后变更。

## 阶段二:生成仓库画像

```bash
python <skill-dir>/scripts/inventory_repo.py <repo> --out <work-dir>/inventory.json
```

从 inventory.json 提取:语言占比(决定读 `language-strategies.md` 哪节)、构建系统与包管理器、manifest 与 public packages、CLI/bin、tests/examples/docs 位置、生成代码、疑似 Agent 相关外部依赖(在 package manifests 里找 openai/anthropic/mcp/langchain 等名字,只作为线索)。把 manifest 关键内容(exports、bin、entry-points、dependencies)读一遍。

## 阶段三:发现架构候选

对本体(architecture-ontology.md)中的核心概念逐个提问"谁承担它"。线索组合使用,不得只靠关键词:

1. 文件路径与目录语义(cmd/、adapters/、providers/、tools/、runtime/);
2. 符号名(类/函数/接口/trait);
3. import/use 依赖方向;
4. 构造关系(谁 new/注入谁);
5. 注册表与工厂(map + register + resolve);
6. handler/callback/provider 被引用的位置;
7. tests 与 examples 断言的行为(它们锁定了真实调用路径);
8. 公共 API 导出面;
9. 配置 schema(配置项暗示可替换组件);
10. event/state 类型定义。

产出:候选清单(概念 → 若干候选文件/符号),此时允许低置信度。

## 阶段四:双向追踪

自顶向下:public API/CLI → Agent/Run/Session 创建 → orchestrator/loop → model call → tool dispatch → result → state update → output/事件。每一步记为 relation(`dispatches`、`invokes_model`、`invokes_tool`、`writes_state`、`emits`…)。

自底向上:模型 SDK 调用点 / 工具执行器 / 进程运行器 / 事件流 → 向上追调用者 → adapter/dispatcher → orchestrator → public API。

两路应在核心控制层(loop/orchestrator)汇合。不能汇合的分支:要么外部委托(建 `external:` 引用 + delegated 状态),要么记 unknown(进 unknowns,写明 attempted_checks)。

实用手法:对每个模型调用点问"谁调用它";对每个注册表问"谁消费它";对每个工具实现问"谁路由到它"。用 grep 找引用位置,再读上下文确认,而不是数关键词个数。

## 阶段五:建立关键执行切片

逐个尝试以下链路,只保留项目实际支持的(不存在的明确标 absent/unknown,不虚构):

- 普通文本响应(text-response):入口 → 上下文组装 → 模型调用 → 流式/整段输出 → 状态更新 → 结束。
- 工具调用(tool-call):模型响应含 tool call → 解析 → 权限检查 → 分派 → 执行 → 结果序列化 → 回填 → 下一轮。
- 错误与重试(error-retry):模型/工具失败 → 分类 → 重试或降级或终止。
- 取消(cancellation):取消信号产生 → 传播 → 执行中止 → 状态收尾。
- 子智能体(subagent):派生 → 子上下文 → 子执行 → 结果回传。
- checkpoint/resume:快照点 → 序列化 → 持久化 → 恢复。
- 扩展注册(extension-registration):插件/工具/供应商的声明 → 加载 → 注册 → 生效。

每条链路写成一个 execution_flow,steps 的 order 为 1..n。steps 里的 state_reads/writes 引用阶段六的状态模型。

## 阶段六:建立状态和数据流

识别核心数据类型(Message、Session、Thread、RunContext、ToolCall、ToolResult、AgentEvent、ProviderRequest、ProviderResponse、Checkpoint 等,以项目实际类型为准)。对每个:谁创建、谁读取、谁修改、谁序列化、生命周期、可变性、持久化边界。产出 state_models + 对应 relations(reads_state/writes_state/serializes/persists/restores)。

## 阶段七:验证证据

- 为每个 node/finding/flow 收集 evidence,标 type 与行号,excerpt 只取支持结论的最短片段(≤40 行)。
- 优先级 runtime > test > code > config > docs > inference;不为了提升等级而运行未授权代码。
- inference 证据必须填 basis(依据了哪些事实)。
- 高置信度结论必须至少有一条证据;只有 docs 的降为 medium 以下。
- README 只证明设计意图;代码与设计冲突时记 finding(category=docs-mismatch)。

## 阶段八:生成二次开发指南

从下列目标中选适用于本项目的:添加模型供应商、添加工具、修改 system prompt、修改 agent loop、添加 memory、添加 checkpoint/resume、接入 MCP、添加权限策略、添加 sandbox、接入 UI 或事件消费者、添加子智能体、修改流式响应、添加持久化、添加日志/tracing。

每个目标输出一个 development_recipe:推荐扩展点(优先公开扩展点而非改内部)、要读的文件、要实现的符号、可复制的参考实现、影响范围、不变量、风险与等级、建议验证(明确哪些需要 runtime 授权)。同时记录"不建议直接修改的内部实现"(写入 risks 或 invariants)。

## 阶段九:生成并验证报告

1. 组装 audit.json(结构见 audit-schema.md),自检:所有引用可解析、order 连续、行号合法。
2. `python <skill-dir>/scripts/validate_audit.py <output>/audit.json` —— 必须零错误后才继续;有告警逐条判断是否需要修数据或在 limitations 说明。
3. `python <skill-dir>/scripts/render_report.py <output>/audit.json --out <output>/report.html`。
4. 用浏览器(或让用户)file:// 打开抽查;发现问题回到 1。
5. 向用户汇报(SKILL.md 输出约定)。

## 刷新已有审计(模式 4)

1. 读旧 audit.json 的 revision 与 analysis;重新跑 inventory 对比文件集。
2. 对旧 node 逐个验证:其 file/symbol 是否仍存在、行号是否仍指向原符号(符号仍存在但行号漂移→修正行号并保留结论;符号已删/改名→该 node 降级或标 unknown,写进 analysis.refresh.invalidated)。
3. 新增文件按阶段三~七增量分析,进 analysis.refresh.added;已删文件的结论进 removed。
4. 行号与符号引用不允许静默沿用:凡未重新核对的,confidence 降一档并在 limitations 声明。
5. 第一版做保守刷新(全量核对、增量复用),不需要增量调用图算法。

## 聚焦模式(模式 2)的调整

- 阶段三~六只对聚焦专题做深;其他概念快速标记(状态可 unknown)。
- 阶段五只建相关链路;阶段八只写相关配方。
- report_kind="focused",analysis.focus 填专题名;HTML 报告会在 Overview 显示聚焦范围。

## 中断与降级

- 上下文/时间不够:优先保证已完成部分的证据质量,其余概念标 unknown 并入 unknowns;在 analysis.limitations 记录覆盖范围。
- 仓库过大:与用户确认缩小 included_paths,或先审计核心包。
- 语言不受支持/混合生成代码:降低 confidence,标记 limitations。

# Agent 架构本体(architecture-ontology)

统一架构概念表。审计时把仓库中的代码实体映射到这里的概念,每个映射产生一个 `architecture_nodes` 条目,同时记录:canonical_id(下表 id)、canonical_name、project_terms(项目原始术语)、代码位置、证据、置信度。

判定单位是"哪个代码实体承担了哪项架构职责"。同一概念在不同项目可能叫 runner、agent、executor、runtime、session、engine、coordinator——术语不可信,职责与证据才可信。反过来,文件名叫 `agent.py` 不代表它就是 agent loop。

## 层(layer)

`architecture_nodes[].layer` 使用以下固定值,HTML 架构视图按层分列:

| layer | 名称 | 对应域 |
| --- | --- | --- |
| boundary | 项目边界 | 域 1 |
| interface | 接口与入口 | 域 2 |
| lifecycle | 生命周期 | 域 3 |
| orchestration | 编排与控制流 | 域 4 |
| context-state | 上下文与状态 | 域 5 |
| integration | 模型与工具集成 | 域 6、7 |
| runtime | 执行运行时 | 域 8 |
| permissions | 权限与信任边界 | 域 9 |
| observability | 事件与可观测性 | 域 10 |
| extensibility | 扩展机制 | 域 11 |
| testing | 测试与示例 | 域 12 |

## 实现状态与证据(判定基础)

- 状态:`implemented`(本仓库实现)/ `delegated`(委托给宿主、外部依赖或上层应用)/ `absent`(设计上明确不提供)/ `unknown`(证据不足)。
- 证据等级:`runtime > test > code > config > docs > inference`。README/文档只是设计意图;`inference` 必须写明推断依据。

---

## 域 1:Project Boundary(项目边界)

产出 `project` 字段与 finding,通常不单独建 node;若仓库中存在明确的边界声明代码(如 capability flags、feature matrix),可建 node。

| id | 定义与判定 | 常见别名 | 可能证据 | 常见误报 |
| --- | --- | --- | --- | --- |
| boundary.project-kind | 项目类型:sdk / library / harness / runtime / cli / product / protocol-adapter / framework / monorepo-multi-package。判定看 manifest 的 exports/bin、入口形态、是否依赖宿主 | — | package.json exports、pyproject entry points、Cargo bin/lib、cmd/ 目录 | 把 monorepo 中一个包当成整个项目;把示例 CLI 当成产品 |
| boundary.owns | 当前仓库直接实现的能力清单 | scope | 源码中实际存在的实现 | 按 README 宣称归档 |
| boundary.delegates | 委托给外部依赖或宿主的能力:列出依赖名及其承担的职责 | external | dependencies 清单 + import 调用点 | 把依赖存在当成已被使用;漏掉宿主(UI/进程)承担的部分 |
| boundary.out-of-scope | 设计上明确不提供的能力(需有文档或代码证据,如显式不支持沙箱) | non-goals | README 非目标段、issue、代码注释 | 把"没做"直接当"设计上不做"(那是 absent vs unknown 的区别) |

## 域 2:Interface and Entry(接口与入口)

### entry.sdk-api(完整块)

- canonical id:`entry.sdk-api`
- 定义:SDK 的公共程序化入口——外部应用创建 Agent/Run/Session 并驱动它所用的导出 API。
- 判定标准(inclusion):出现在包导出(exports、`__init__.py`、lib.rs `pub use`)中,且参数/返回值直接构造或驱动 agent 生命周期。
- 排除标准(exclusion):内部函数、示例代码、仅类型导出而无行为入口。
- 常见别名:Client、Agent、createAgent、run、Session 构造器、ClientFactory。
- 可能证据:package.json exports 字段、入口文件 re-export、README 快速开始的第一个调用。
- 关联:被 lifecycle.* 与 orch.* 调用;是自顶向下追踪的起点。
- 实现变体:类构造函数、工厂函数、builder/fluent API、函数式 options 对象。
- 常见误报:把工具函数库的导出当成 SDK 入口;把 CLI 的内部 main 当 SDK API。

### entry.cli(完整块)

- 定义:命令行入口——二进制/bin 脚本解析参数后进入应用引导。
- 判定:bin 字段、`__main__.py`、cmd/ 包、main() 被入口引用。
- 排除:构建脚本、开发用脚本(dev-server 除外,若它是产品形态)。
- 别名:main、cli、program、Commander/Yargs/argparse/click 注册点。
- 证据:manifest bin/entry-points、shebang、参数解析调用。
- 关联:bootstrap.application。
- 变体:单命令、子命令框架、REPL 循环。
- 误报:测试脚手架命令;一次性迁移脚本。

| id | 定义与判定 | 别名 | 证据 | 误报 |
| --- | --- | --- | --- | --- |
| entry.http-rpc | HTTP/RPC 服务入口:HTTP handler、gRPC service、WebSocket server 的路由与请求入口 | server、routes、handler | 路由表、server.listen、controller | 内部调试 endpoint 当成主入口 |
| entry.command-handler | 命令/斜杠命令/子命令处理器:把一种用户意图分派到实现 | command、subcommand、slash | 命令注册表、装饰器 @command | 把事件 handler 当命令 |
| bootstrap.application | 应用引导:组装配置、依赖并启动首个组件 | App、bootstrap、setup、initialize | main 尾部/启动函数中的构造序列 | 把库初始化钩子当应用引导 |
| bootstrap.config-loading | 配置加载:读取文件/env/参数,校验并生成运行时配置 | Config、Settings、loadConfig | config 解析函数、schema 校验(zod/pydantic/env) | 散落的 getenv 调用点不是集中配置层 |
| bootstrap.dependency-construction | 依赖构造:DI 容器或手工装配,决定实现绑定 | container、provider、wire | DI 注册调用、工厂装配 | 仅有 DI 库依赖但未用于核心组件 |

## 域 3:Lifecycle(生命周期)

### lifecycle.session(完整块)

- 定义:跨多轮/多 run 的会话单元,持有消息历史与持久化身份。
- 判定:被公共 API 创建/获取;跨 turn 存续;常含 id、历史、序列化。
- 排除:单次请求对象(那是 run/task);纯配置对象。
- 别名:Session、Conversation、Thread、Chat、History。
- 证据:类定义 + 持久化调用(save/load);API 返回 session id。
- 关联:state.message-history、state.persistence、lifecycle.resume。
- 变体:内存对象 + 外部存储;数据库行;文件目录(jsonl)。
- 误报:名为 Session 的网络会话/认证会话;一次性的 run context。

| id | 定义与判定 | 别名 | 证据 | 误报 |
| --- | --- | --- | --- | --- |
| lifecycle.agent | Agent 实体:承载 prompt/工具集/配置的长生命周期对象,是用户配置行为的单位 | Agent、Assistant、Persona、Character | Agent 构造 + 被传入 run/loop | 只是数据容器的 "AgentConfig" |
| lifecycle.run | Run/执行实例:一次完整执行的跟踪单位,含状态机(pending/running/done/failed) | Run、Execution、Job、Invocation | run 状态枚举、run id 生成 | turn 被误标为 run |
| lifecycle.task | Task:编排器调度的最小工作单元(常见于多智能体框架) | Task、Step、Todo、WorkItem | 队列项、调度输入 | 把代码里的待办注释当成任务模型 |
| lifecycle.turn | Turn/轮:一次"模型调用(+工具执行)→ 结果"的基本循环单位 | Turn、Round、Step、Iteration | loop 内的单轮函数/状态 | 把整次 run 叫 turn |
| lifecycle.thread | Thread:并发/消息传递意义上的线程(goroutine、协程、消息 topic) | Thread、goroutine、actor | spawn 调用、channel | OS 线程池工具类被当成核心线程模型 |
| lifecycle.init | 初始化:资源/客户端/注册表就绪的阶段 | setup、initialize、onStart、init hook | 生命周期钩子调用顺序 | 模块 import 副作用未记为风险点 |
| lifecycle.cancel | 取消:中断执行的机制与传播路径 | cancel、abort、interrupt、AbortSignal/context | cancel 信号的产生与接收点 | 只捕获 Ctrl-C 未传播到工具 |
| lifecycle.shutdown | 关闭:进程/会话结束时的清理与flush | shutdown、close、dispose、graceful | finally/defer/清理注册 | 有函数但无调用路径(记 partial→unknown) |
| lifecycle.resume | 恢复:从持久化状态继续执行 | resume、replay、reattach | resume API + 状态加载点 | 仅重放 UI 历史而非执行状态 |
| lifecycle.cleanup | 清理:临时资源、沙箱、工作区的回收 | cleanup、teardown、gc | cleanup 调用与资源释放 | — |

## 域 4:Orchestration and Control Flow(编排与控制流)

### orch.agent-loop(完整块,最重要概念)

- canonical id:`orch.agent-loop`
- 定义:驱动"调用模型 → 解析意图 → 执行工具 → 回填结果 → 决定是否继续"的核心循环。整个审计的锚点概念。
- 判定标准:存在一个控制实体,迭代地调用模型并根据响应内容(尤其是 tool call)决定后续动作,直到停止条件满足。
- 排除标准:单次 request/response 封装(无迭代);纯任务队列;只做流式转发不做决策的管道。
- 常见别名:run loop、agent loop、main loop、executor、runner、engine、iterate、step、tick、REPL。
- 可能证据:while/for/loop 包裹模型调用;递归的 step 函数;状态机转移表;async iterator 的 next 驱动;测试中"模型返回工具调用→工具被执行→再次调用模型"的断言。
- 关联:上游 lifecycle.turn 与 model.client;下游 tool.dispatch、orch.stop-condition;读写 state.message-history。
- 实现变体(必须在 node.notes 中标注是哪种):
  1. 显式 while/for loop;
  2. 递归循环(step 完成后调用自身);
  3. 状态机(显式状态枚举 + 转移);
  4. 事件驱动(事件回调推动下一步);
  5. iterator/generator 驱动(外部消费 next());
  6. 由 tool call response 隐式推动(每轮 API 返回 tool call 即继续,无 stop 时停止);
  7. 外部宿主驱动(本仓库只提供单步,循环在宿主)→ 通常是 delegated。
- 常见误报:重试循环(循环的是网络请求不是任务);UI 渲染循环;把模型 SDK 的分页迭代当 agent loop。

### orch.subagent(完整块)

- 定义:主 agent 派生子 agent(独立上下文/工具集)并收集其结果的机制。
- 判定:存在子上下文的创建 + 结果回传父级;常见为 spawn/Task 工具。
- 排除:普通函数调用的"helper";并发执行多个互不相关的 job(那是 concurrency)。
- 别名:subagent、Task tool、spawn、worker、delegate、crew、team。
- 证据:创建子 run 的工具实现;子结果并入父消息的代码;深度/数量限制。
- 关联:orch.delegation、state.context-builder(隔离)、lifecycle.run。
- 变体:同步阻塞等待;异步并发 + 汇聚;树状递归委托。
- 误报:多角色 prompt 但共享同一上下文(无真子 agent);仅文档宣称。

| id | 定义与判定 | 别名 | 证据 | 误报 |
| --- | --- | --- | --- | --- |
| orch.orchestrator | 编排器:统筹多 agent/多步骤执行顺序与数据传递的高层控制 | orchestrator、coordinator、graph、pipeline、workflow | 图/流程定义 + 执行引擎 | 把 agent loop 本身叫 orchestrator(单 agent 无编排) |
| orch.planner | 规划器:把目标分解为计划(一次性或滚动) | planner、planner、decomposer | 生成 plan 数据结构并交给执行者的代码 | 模型 prompt 里"请先计划"而无代码结构 |
| orch.scheduler | 调度器:决定何时/以什么并发度运行任务 | scheduler、queue、dispatcher | 队列消费、定时器、并发闸 | OS 线程调度封装 |
| orch.turn-execution | 单轮执行:一轮内"准备请求→调用→处理响应"的函数 | step、executeTurn、runStep | loop 内被调的单轮函数 | 与整个 loop 混同 |
| orch.stop-condition | 停止条件:判定循环终止的逻辑(无工具调用/最大轮数/显式完成信号/预算) | stop、shouldContinue、maxIterations、finish | 循环退出分支 | 网络重试上限被当成停止条件 |
| orch.retry | 重试:对模型/工具失败的重新执行策略 | retry、backoff | 重试包装器、退避计算 | 幂等重发(无策略) |
| orch.fallback | 降级:主路径失败后切换备选(备用模型、简化行为) | fallback、failover | catch 中切换 provider/行为的分支 | — |
| orch.reflection | 反思:模型评估自身输出并触发修正循环 | reflection、critic、self-critique、verifier | 显式的评估→重写循环 | prompt 中一句"请检查" |
| orch.delegation | 委托:把子任务交给另一执行者(不一定是完整子 agent) | delegate、dispatch、forward | 转发调用 + 结果回传 | — |
| orch.concurrency | 并发:并行执行多任务/多工具的机制与上限 | parallel、Promise.all、gather、workerpool | 并发原语 + 信号量/上限 | — |
| orch.human-approval | 人工审批:暂停等待人确认后再继续 | approval、confirm、HITL、ask user | 等待输入的阻塞点 + 恢复路径 | 权限检查(不暂停循环)被误判 |

## 域 5:Context and State(上下文与状态)

### state.context-builder(完整块)

- 定义:为每次模型调用组装最终上下文的组件:system prompt、历史、工具清单、注入的动态信息。
- 判定:存在集中构造请求消息列表/prompt 的函数,而非散落拼接。
- 排除:单纯的消息数据类;模板渲染工具但未被主链路使用。
- 别名:buildMessages、context、prompt builder、compose、prepareRequest。
- 证据:在 model.client 调用前被调用的组装函数;测试断言组装结果。
- 关联:上游 state.message-history、state.system-prompt;下游 model.request-building;被 state.truncation/compaction 修饰。
- 变体:模板字符串;消息数组规范;增量 append。
- 误报:tokenizer 工具;UI 消息渲染。

| id | 定义与判定 | 别名 | 证据 | 误报 |
| --- | --- | --- | --- | --- |
| state.message-history | 消息历史:对话消息的存储与追加,含角色、tool call/result 记录 | messages、history、transcript、log | append 调用、消息类型定义 | UI 展示用的 transcript 副本(若同源则合并说明) |
| state.system-prompt | 系统提示词:模板、拼接与环境注入(日期、cwd、git 状态) | system prompt、instructions、base prompt | 模板常量 + 渲染函数 | 用户自定义 prompt 覆盖机制(那是 ext.prompt-customization) |
| state.token-budget | Token 预算:估算与限额控制 | budget、tokenLimit、usage check | 计数调用 + 分支 | 仅记录 usage 而不限制 |
| state.truncation | 截断:超限后丢弃/缩短历史的策略 | truncate、trim、sliding window | 截断函数 + 阈值 | 输出截断(exec.output-truncation) |
| state.compaction | 压缩:用摘要替换部分历史以释放上下文 | compact、summarize、prune | 摘要调用 + 历史替换 | 截断无摘要 |
| state.conversation-state | 会话状态:轮次间需要保持的非消息状态(等待中的审批、中间产物) | conversation state、sticky state、draft | 状态字段读写 | 纯常量配置 |
| state.execution-state | 执行状态:run/loop 级内部状态(当前步骤、重试计数、锁) | runState、ctx、context object | 状态对象在 loop 间传递 | 请求局部变量 |
| state.tool-state | 工具状态:跨调用保持的工具侧状态(会话缓存、锁、句柄) | tool state、session cache | 工具内的跨调用存储 | — |
| state.memory | 记忆:跨会话的知识存取(向量库、笔记、偏好) | memory、knowledge base、recall、embeddings | 存取 API + 注入 context 的调用 | 单会话历史就是 memory(过度宣称) |
| state.persistence | 持久化:把状态写入外部介质 | store、save、serialize、db | 写入调用 + 格式 | 日志文件 |
| state.checkpoint | 检查点:可恢复执行的完整快照 | checkpoint、snapshot、save state | 快照创建 + restore 入口 | 只有会话历史导出而无执行状态 |
| state.workspace-state | 工作区状态:目标工作目录的内容基线、变更跟踪、还原 | workspace、sandbox fs、diff tracking | 变更记录、restore 调用 | — |

## 域 6:Model Integration(模型集成)

### model.provider-abstraction(完整块)

- 定义:对"不同模型供应商"的统一抽象接口,使具体 provider 可插拔。
- 判定:存在接口/基类 + 多个实现,核心链路依赖接口而非具体 SDK。
- 排除:直接封装单一 SDK 的 client(无多实现即非 abstraction,标 model.client)。
- 别名:Provider、Model、LLM interface、ChatModel、BaseLLM。
- 证据:interface/trait/ABC 定义;实现注册表;工厂按名解析。
- 关联:model.client(实现侧)、model.provider-fallback、ext.provider-adapter。
- 变体:接口继承;协议/结构化类型;适配器注册表;配置驱动实例化。
- 误报:配置里能填多个 base_url 但代码只支持一种协议;仅枚举类型。

### model.client(完整块)

- 定义:实际执行模型 API 调用(含认证、传输、流式)的客户端封装。
- 判定:发出网络请求或调用官方 SDK 的位置,含错误分类。
- 排除:纯数据映射函数;mock。
- 别名:client、api、llm.ts、openai.ts、chat.completions。
- 证据:SDK import、网络调用、鉴权头、错误类型捕获。
- 关联:上游 model.request-building;下游 model.response-parsing、model.streaming。
- 变体:直接 REST;官方 SDK;统一网关代理。
- 误报:把官方 SDK 本身当本仓库实现(应为 delegated);embedding 客户端(除非在主链路)。

| id | 定义与判定 | 别名 | 证据 | 误报 |
| --- | --- | --- | --- | --- |
| model.message-mapping | 消息映射:内部消息模型 ↔ 供应商协议的双向转换 | convert、map messages、toOpenAI | 转换函数 + 测试 | — |
| model.request-building | 请求构造:组装参数(model、tools、temperature、响应格式) | buildRequest、createParams | 参数组装代码 | 与 context-builder 混同(此处是协议参数) |
| model.response-parsing | 响应解析:把供应商响应转成内部类型,提取文本/工具调用/结束原因 | parse、extract tool calls | 解析函数 | — |
| model.tool-schema-conversion | 工具 schema 转换:内部工具定义 → 供应商 JSON schema 形态 | toFunctionDefs、zod-to-schema | 转换函数 | — |
| model.streaming | 流式:分片接收与增量事件产出 | stream、SSE、delta、async iterator | stream 消费循环 | UI 打字机效果 |
| model.structured-output | 结构化输出:强制 JSON/schema 输出与校验 | json mode、responseFormat、withStructuredOutput | format 参数 + 校验 | prompt 里"请输出 JSON" |
| model.retry | 模型重试:对限流/网络/超时的重试策略 | retry、backoff、rate limit handler | 重试包装 | 工具重试(orch.retry) |
| model.rate-limit | 限流:主动的速率/配额控制 | rate limit、quota、semaphore | 限流器 | — |
| model.usage-accounting | 用量记账:token/费用统计与上报 | usage、tokens、cost | 计数累加与暴露 | — |
| model.provider-fallback | 供应商降级:多 provider 间切换 | failover、fallback provider | 切换逻辑 | — |

## 域 7:Tool System(工具系统)

### tool.registry(完整块)

- 定义:工具的登记与查找中心:工具如何被声明、注册、按名解析。
- 判定:存在注册表结构(map/数组)+ 注册入口 + 按名查找被 dispatch 使用。
- 排除:工具实现本身(那是 tool.builtin/各工具 node);硬编码 if/else 分发(无注册表,记为变体)。
- 别名:registry、toolset、tools map、registerTool、ToolProvider。
- 证据:注册函数、注册表数据结构、查找函数被调用点。
- 关联:tool.declaration(上游)、tool.dispatch(下游)、ext.tool-provider。
- 变体:集中注册表;装饰器注册;约定目录自动发现;配置文件声明。
- 误报:存在 registry 类但核心链路直接 new 工具(未使用);类型定义里的工具列表。

### tool.dispatch(完整块)

- 定义:执行路径上把模型给出的 tool call 解析到具体工具并调用的分派点。
- 判定:接收 tool name + args,查找并调用,返回结果;位于 loop 与工具实现之间。
- 排除:工具内部逻辑;CLI 命令分发(entry.command-handler)。
- 别名:executeTool、callTool、invoke、handleToolCall、runner。
- 证据:name→实现查找调用;参数校验入口;结果包装。
- 关联:上游 orch.agent-loop;下游 tool.param-validation、exec.executor;权限检查通常在此前。
- 变体:同步调用;并发执行;队列化;按工具路由到不同 executor。
- 误报:模型 SDK 的 function-calling 协议层;MCP 客户端的通用转发(若仅转发无本地工具,是 tool.mcp 的一部分)。

| id | 定义与判定 | 别名 | 证据 | 误报 |
| --- | --- | --- | --- | --- |
| tool.declaration | 工具声明:单个工具的名称、描述、参数 schema 的定义方式 | tool def、defineTool、@tool、Tool spec | 声明调用/装饰器/schema 定义 | — |
| tool.discovery | 工具发现:运行时或构建期自动发现可用工具 | auto-discover、scan、loadTools | 目录扫描、模块枚举 | 静态 import(那是显式注册) |
| tool.schema-generation | schema 生成:从代码签名/类型自动生成参数 schema | zod-to-json、typed tools | 转换函数 | 手写 schema |
| tool.param-validation | 参数校验:执行前校验模型给的参数 | validate、parse args | 校验调用 + 失败处理 | 只做类型标注未运行时校验 |
| tool.result-serialization | 结果序列化:工具输出 → 消息/模型可读文本(截断、格式化) | serialize、stringify、format result | 转换函数 | — |
| tool.builtin | 内置工具:仓库自带的核心工具(read/write/bash/search 等) | built-in tools、core tools | 工具实现文件 | 示例/demo 工具(标 testing.examples 相关) |
| tool.remote | 远程工具:经网络调用的工具端点 | remote tools、api tools | 网络调用封装 | — |
| tool.mcp | MCP 集成:MCP client/server 的接入、工具代理与转换 | mcp、Model Context Protocol | mcp SDK 依赖、server 启动、client 连接 | — |

## 域 8:Execution Runtime(执行运行时)

### exec.executor(完整块)

- 定义:实际执行工具/命令副作用的环境抽象:进程、文件系统、shell 的统一执行面。
- 判定:被 tool.dispatch 用于产生真实副作用;通常是子进程运行器或虚拟 FS。
- 排除:模型调用;纯数据变换工具(无执行环境)。
- 别名:executor、runner、process、shell、runtime、sandbox exec。
- 证据:spawn/exec 调用、工作目录设置、超时与取消参数。
- 关联:上游 tool.dispatch;侧联 exec.sandbox、perm.*;下游 exec.output-truncation。
- 变体:本地子进程;容器;远程执行服务;浏览器运行时。
- 误报:测试用执行器;构建系统调用(非运行时主链)。

### exec.sandbox(完整块)

- 定义:限制执行环境的隔离机制:文件系统/网络/进程级的边界。
- 判定:存在显式限制措施(容器、seccomp、chroot、临时目录、代理网络)。
- 排除:普通子进程(无限制);仅有超时(那是 exec.timeout)。
- 别名:sandbox、container、isolation、jail、workspace。
- 证据:容器化调用、权限参数、临时根目录。
- 关联:perm.sandbox-policy(策略)与本条(机制)。
- 变体:OS 容器;WASM;一次性 VM;目录级限制。
- 误报:换了工作目录就叫沙箱;依赖库存在但未接入主链路。

| id | 定义与判定 | 别名 | 证据 | 误报 |
| --- | --- | --- | --- | --- |
| exec.process-runner | 进程运行器:spawn 子进程并收集输出的底层封装 | spawn、exec、subprocess、runCommand | 进程调用封装 | — |
| exec.filesystem | 文件系统访问:读/写/列目录的统一访问层(含根目录约束) | fs、readFile、workspace fs | 文件 API 封装 + 路径检查 | 直接裸调 fs 且分散(记为无该层) |
| exec.shell | shell 访问:交互式/非交互 shell 会话的维持 | shell、bash、terminal、pty | pty/shell 调用 | 单次命令执行(process-runner) |
| exec.browser-runtime | 浏览器运行时:无头浏览器自动化执行环境 | browser、playwright、puppeteer、CDP | 浏览器驱动依赖与启动 | — |
| exec.working-dir | 工作目录:执行根目录的确定与约束 | cwd、root、workspace dir | cwd 参数传递链 | — |
| exec.env | 环境变量:执行环境的 env 注入与过滤 | env、environment | env 构造/过滤代码 | — |
| exec.timeout | 超时:执行时间上限与超时处理 | timeout、deadline | 超时参数与计时器 | — |
| exec.output-truncation | 输出截断:过长 stdout/stderr/结果的截断策略 | truncate output、maxOutput | 截断函数 + 阈值 | state.truncation(历史截断) |
| exec.cancel-propagation | 取消传播:取消信号传到执行中的进程/请求 | kill、abort、signal | 信号传递代码 | — |
| exec.resource-limits | 资源限制:内存/CPU/文件数/并发数限制 | limits、rlimit、cgroup | 限制设置调用 | — |

## 域 9:Permissions and Trust Boundaries(权限与信任边界)

### perm.authorization(完整块)

- 定义:决定"某操作是否被允许"的核心判定点,被工具执行或资源访问前调用。
- 判定:存在集中(或明确)的 allow/deny 判定函数,执行路径经过它。
- 排除:操作系统级权限;供应商 API 鉴权(那是 model.client 一部分)。
- 别名:permission、policy、guard、check、canUseTool、gatekeeper。
- 证据:判定函数 + 在 dispatch/executor 前的调用点;策略数据结构。
- 关联:perm.user-confirmation、perm.allow-deny-list、perm.sandbox-policy、orch.human-approval。
- 变体:布尔函数;策略对象;规则引擎;一次性启动时授权模式。
- 误报:只有配置字段无判定调用;仅 UI 弹窗无强制点。

### perm.user-confirmation(完整块)

- 定义:运行中向用户请求确认的交互机制(命令行提示、弹窗、回调)。
- 判定:存在阻塞/等待用户决定的代码路径,其结果影响是否继续执行。
- 排除:启动时一次性 config 接受;纯日志提示。
- 别名:confirm、ask、prompt user、approval flow。
- 证据:输入等待调用、UI 事件等待、回调注册。
- 关联:perm.authorization、orch.human-approval。
- 变体:同步 stdin;异步回调;带会话记忆的"不再询问"。
- 误报:权限提示只写日志仍继续执行(应标 finding)。

| id | 定义与判定 | 别名 | 证据 | 误报 |
| --- | --- | --- | --- | --- |
| perm.allow-deny-list | 允许/拒绝清单:预授权规则(glob、命令前缀、域名) | allowlist、denylist、rules、policy file | 规则结构与匹配函数 | 路径白名单只用于 UI 显示 |
| perm.sandbox-policy | 沙箱策略:隔离级别与允许能力的策略定义 | sandbox policy、isolation level | 策略枚举与选择逻辑 | exec.sandbox(机制本身) |
| perm.secrets | 秘密管理:凭据的读取、注入与遮蔽 | secrets、credentials、keychain、redact | 凭据读取点、日志遮蔽 | — |
| perm.untrusted-model-output | 不可信模型输出处理:对模型产出(路径、命令、URL)的再校验 | output validation、guardrails | 校验调用 | — |
| perm.untrusted-tool-output | 不可信工具输出处理:工具结果进入上下文前的处理(截断、脱敏、转义) | sanitize、redact | 清洗函数 | 仅截断(那是 exec.output-truncation) |
| perm.path-restriction | 路径限制:可访问路径的边界与逃逸检查 | path check、jail、root guard | 路径规范化 + 前缀检查 | — |
| perm.network-restriction | 网络限制:出站网络的白名单/禁用 | egress、proxy、network policy | 代理设置、域名过滤 | — |
| perm.child-process-restriction | 子进程限制:可启动命令的约束 | command allowlist、exec guard | 命令解析与匹配 | — |

## 域 10:Events and Observability(事件与可观测)

### obs.event-model(完整块)

- 定义:系统统一事件类型体系:流式输出、状态变更、工具调用生命周期都表达为事件。
- 判定:存在事件类型定义 + 产生点 + 消费点(而非散落的回调签名)。
- 排除:日志行;单一用途的回调参数。
- 别名:AgentEvent、StreamEvent、Event、update、delta、message。
- 证据:事件枚举/接口、emit 调用、订阅注册。
- 关联:obs.event-bus、obs.streaming-events、obs.ui-subscription;执行链路的 events_emitted 字段引用本概念词汇。
- 变体:判别联合(discriminated union);类层级;扁平字符串常量。
- 误报:内部异常类型;UI 组件的 DOM 事件。

| id | 定义与判定 | 别名 | 证据 | 误报 |
| --- | --- | --- | --- | --- |
| obs.event-bus | 事件总线:发布/订阅中枢 | bus、emitter、EventEmitter、pubsub | on/emit 注册表 | 直接回调参数传递 |
| obs.streaming-events | 流式事件:增量 token/分块的事件化输出 | stream events、onChunk、delta | 流事件产生点 | — |
| obs.callbacks | 回调:使用方注入的生命周期回调集合 | callbacks、listeners、hooks config | 回调注册与调用 | — |
| obs.hooks | 钩子:在固定点位拦截/修改行为的机制 | hooks、middleware、interceptor、before/after | 钩子调用点 | 与 ext.hooks 同源时合并并双向标注 |
| obs.middleware | 中间件:链式包装请求/执行管道 | middleware、chain、pipe | 组合函数、洋葱模型调用 | — |
| obs.logging | 日志:结构化或分级日志输出 | log、logger、debug | 日志调用 | — |
| obs.tracing | 追踪:跨组件的 trace/span | trace、span、otel | 追踪 API 调用 | — |
| obs.metrics | 指标:计数/延时的度量暴露 | metrics、statsd、prometheus | 指标上报 | — |
| obs.usage-cost | 用量与成本:token/费用的事件与聚合上报 | cost、usage event | 用量事件产生点 | model.usage-accounting(模型层)与之关联 |
| obs.ui-subscription | UI 订阅:界面消费事件/流的订阅接口 | subscribe、onUpdate、renderer | 订阅 API 暴露 | — |

## 域 11:Extensibility(扩展机制)

### ext.plugin-system(完整块)

- 定义:第三方扩展的发现、加载、生命周期管理的完整插件体系。
- 判定:存在扩展的声明规范 + 加载器 + 与核心的接入点,三者齐备才算 plugin system;只有接口无加载器只是扩展点。
- 排除:单一用途的注册表(tool.registry)。
- 别名:plugin、extension、addon、module、marketplace。
- 证据:插件清单 schema、加载目录约定、生命周期调用。
- 关联:ext.* 全部;obs.hooks。
- 变体:目录约定加载;包管理器安装;配置声明;进程外插件。
- 误报:文档说"可扩展"但只提供源码级修改;内部抽象被宣传成插件系统。

| id | 定义与判定 | 别名 | 证据 | 误报 |
| --- | --- | --- | --- | --- |
| ext.provider-adapter | 供应商适配:接入新模型供应商的扩展点 | custom provider、adapter interface | 抽象接口 + 注册方式 | — |
| ext.tool-provider | 工具提供者:注入自定义工具的扩展点 | custom tool、registerTool | 注册 API | — |
| ext.middleware | 中间件扩展:自定义管道环节的注册 | addMiddleware、use | 注册 API | — |
| ext.hooks | 钩子扩展:业务方挂载生命周期钩子 | onEvent、registerHook | 注册 API | — |
| ext.storage-adapter | 存储适配:自定义持久化后端的扩展点 | storage interface、driver | 接口 + 注入点 | — |
| ext.prompt-customization | 提示词定制:覆盖/追加 system prompt 的公开机制 | custom instructions、prompt override | 配置项或 API | — |
| ext.custom-executor | 自定义执行器:替换执行环境的扩展点 | custom runtime、executor interface | 接口 + 绑定点 | — |
| ext.protocol-adapter | 协议适配:对外/对内协议转换层(把本框架暴露为某协议服务) | adapter、bridge、gateway | 转换层代码 | — |
| ext.mcp-as-extension | 以 MCP 作为扩展通道:通过 MCP 动态获得工具/资源 | mcp tools、mcp servers config | 配置加载 + 动态注册 | 与 tool.mcp 互为表里:tool.mcp 记集成实现,本条记扩展机制定位 |
| ext.custom-agent-type | 自定义 agent 类型:注册新 agent 行为/角色模板的机制 | agent type、persona registry | 类型注册表 | — |

## 域 12:Testing and Examples(测试与示例)

产出对实现的佐证(test 证据来源),通常建为少量 node 并在 file.test 标记上配合。

| id | 定义与判定 | 别名 | 证据 | 误报 |
| --- | --- | --- | --- | --- |
| test.unit | 单元测试:对组件的隔离测试 | tests、spec | 测试目录、命名约定 | — |
| test.integration | 集成测试:跨组件真实组装的测试 | integration | 目录/标记 | 需要 mock 的仍属 unit |
| test.e2e | 端到端测试:完整入口驱动的测试 | e2e、smoke | e2e 目录、脚本 | — |
| test.examples | 示例:可运行的使用样例,兼作文档与证据 | examples、samples、docs 代码块 | examples 目录 | 不可运行的伪代码 |
| test.fixtures | 固件:测试用数据/录制响应 | fixtures、recordings、golden | fixture 文件 | — |
| test.mock-provider | 模拟模型:可控的模型替身 | mock llm、fake provider、echo model | mock 实现 | — |
| test.mock-tool | 模拟工具:可控的工具替身 | mock tool、stub tool | mock 实现 | — |
| test.architecture-tests | 架构测试:约束层间依赖的自动化测试(如 layer checks) | arch tests、dependency rules | 测试中的依赖断言 | — |

---

## 使用注意

- 一个代码实体可承担多个概念(一个函数既是 dispatch 又做校验)——分别建 node 或在一个 node 的 notes 说明合并原因。
- 一个概念也可由多个实体协作承担(接口 + 多实现)——建一个 node 指向多个 file/symbol。
- 概念表中未覆盖的自定义职责:可建 node,canonical_id 用 `custom.<slug>`,layer 取最接近的层,并在 notes 说明为何超出本体。
- 每个重要 node 都应尝试回答:它的上游是谁、下游是谁、读写哪些状态、发出哪些事件。

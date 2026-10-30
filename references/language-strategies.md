# 语言分析策略(language-strategies)

只读当前项目主语言对应的小节。第一版不做跨语言 AST:依靠仓库清单、文本搜索(grep)、符号位置、类型定义、import 关系、tests 与 examples,加上人工/模型语义判断。每个结论都要落到证据。

通用优先动作(所有语言):找入口 → 顺着入口读调用链 → 找注册表/工厂 → 找循环包裹模型调用的位置 → 用 tests/examples 交叉验证。

## TypeScript / JavaScript

- 常见入口:`package.json` 的 `bin`(CLI)与 `exports`(SDK);`src/index.ts` barrel re-export;`main` 字段;bin 脚本的 shebang。
- 包与模块边界:workspace(pnpm/yarn/lerna/turbo)的 `packages/*`;`tsconfig.json` 的 paths/references;ESM/CJS 混用时注意 `.mjs/.cjs`。
- 公共 API 识别:`exports` 映射、index barrel 的具名导出、`.d.ts`。仅类型导出不算行为入口。
- 接口与实现:interface/type + implements;抽象基类;判别联合(discriminated union)常用于事件与状态;工厂函数返回"接口"时靠调用方窄化确认。
- 注册表模式:`Map` + `register()`/`use()`;装饰器少见,常用显式数组/对象字面量注册(如 `tools: [...]`)。
- DI:构造函数注入、options 对象、context 传递;框架级 IoC 容器(zod 校验配置 + 手工装配)也常见。
- async/streaming:Promise 循环、`for await...of`(async generator 是 agent loop 的常见形态)、EventEmitter、AsyncIterator、web streams(ReadableStream)。SSE 解析点≈模型流式入口。
- 事件系统:EventEmitter `.on/.emit`、自定义回调集合、RxJS(少见)。React 仅是 UI 订阅方。
- 测试/示例:`*.test.ts`、`__tests__/`、`tests/`、vitest/jest 配置;`examples/`;README 代码块。
- Agent loop 常见表达:`while (true)` + `await model(...)`;递归 `runStep()`;async generator `function* run()` 由外部 `next()` 驱动;响应里的 `tool_calls` 驱动隐式循环(无工具调用即退出)。
- 容易误判:barrel 导出≠公共 API 全量(exports 字段才是准绳);EventEmitter 的 `error` 事件≠架构事件总线;zod schema 只是校验,不等于配置层;`agent.ts` 文件名;SDK 的分页 iterator 被当成 loop;React 重渲染循环。

## Python

- 常见入口:`pyproject.toml` 的 `[project.scripts]` / entry points;`__main__.py`;`cli.py` + click/typer/argparse;ASGI app 对象(http 入口)。
- 包边界:`src/` 布局;`__init__.py` 的 `__all__` 与 re-export 定义公共面。
- 公共 API 识别:`__all__`、导出的类/函数、文档字符串;`__init__` 里 `from .x import Y`。
- 接口与实现:`abc.ABC` + `abstractmethod`、`typing.Protocol`(结构化类型,靠注释/命名识别)、dataclass/pydantic 模型。
- 注册表模式:模块级 dict/list + `register()` 装饰器;entry points(`importlib.metadata`)插件发现。
- DI:构造注入、dataclass 配置对象、手动装配;框架级容器少见。
- async/streaming:`async def` + `await`;`async for` + async generator(`__aiter__/__aneturn__`);`asyncio.Queue/Task`;context manager(`__aenter__`)管理生命周期与清理。
- 事件系统:asyncio 事件/队列、回调列表、async iterator 产出事件对象;signals(SIGINT)→取消。
- 测试/示例:`tests/`、`test_*.py`、pytest fixtures;`examples/`。
- Agent loop 常见表达:`while True:` + `await client.chat(...)`;递归 `step()`;async generator(`yield` 每轮事件);状态机字典。
- 容易误判:Protocol 只是被定义未被注解使用(结构化类型靠使用点确认);装饰器注册表只有注册没有消费;`functools.cache` 被当成 memory;同步代码里的 while(仅是轮询)。

## Go

- 常见入口:`cmd/<name>/main.go`;`main.go`;HTTP handler 注册(`http.HandleFunc`)。
- 包边界:目录即包;`internal/` 不可外部导入——公共 API 边界的强信号。
- 公共 API 识别:导出标识符(首字母大写);非 internal 包的导出面。
- 接口与实现:`type X interface` + `func (t T) Method()` 隐式实现——接口在哪被消费(参数/字段类型)比在哪定义更能说明架构意图;小型接口(io.Reader 风格)组合。
- 注册表模式:`init()` 全局注册、`var registry = map[string]Factory`、`Register()` + `blank import`(_ "pkg/impl")驱动。
- DI:构造函数注入(`New(deps...)`)、functional options(`WithX(...)`)。
- async/streaming:goroutine + channel;`context.Context` 取消传播(找 `ctx.Done()` 分支);`errgroup` 并发;io.Reader 流式。
- 事件系统:channel 作为事件总线、回调函数字段、`sync.WaitGroup` 汇聚。
- 测试/示例:`*_test.go`(同包白盒测试注意区分)、`testdata/`、`example_test.go` 的 Example 函数。
- Agent loop 常见表达:`for { ... }` + select;`for resp := range ch`;递归少用。
- 容易误判:接口存在≠被用于解耦(可能只有单实现直接依赖);blank import 注册但主链路未引用;HTTP server 的 handler 循环;`time.Tick` 轮询。

## Rust

- 常见入口:`[[bin]]`/`src/main.rs` 与 `src/lib.rs`;wasm-lib 目标;clap/structopt 解析点。
- 包边界:crate 边界;workspace members;`pub use` 再导出;模块树(`mod`)。
- 公共 API 识别:`pub` 项 + lib.rs 导出面;feature-gated API 注意标注条件。
- 接口与实现:`trait` + `impl Trait for`、`dyn Trait` vs 泛型 `impl Trait`(泛型多为静态分发,架构上仍是抽象点);`Box<dyn>` 是运行时替换点。
- 注册表模式:`inventory`/`linkme` 链接期收集、lazy_static/once_cell 全局 map、builder 注册。
- DI:builder 模式、trait 对象注入;很少有容器。
- async/streaming:tokio 任务与 channel(mpsc/oneshot/broadcast)、`impl Stream` / async-stream、futures stream;`select!` 分支。
- 事件系统:channel 广播、回调 trait、tracing 事件(注意 tracing 是可观测不是事件总线)。
- 测试/示例:`#[cfg(test)]` 模块、`tests/` 集成测试、`examples/` 目录、doc tests。
- Agent loop 常见表达:`loop { }` + await;enum 状态机 + `match` 转移;stream 消费循环。
- 容易误判:trait 只有一个实现且被直接调用(可能只是风格);feature flag 关闭的代码路径(降置信度并注明 feature);`match` on enum ≠ 状态机(看是否跨迭代保持状态);宏生成代码。

## Java / Kotlin

- 常见入口:`public static void main`、Spring `@SpringBootApplication`/`CommandLineRunner`、Kotlin top-level main;`application.yml` 的 main-class。
- 包边界:Maven/Gradle 模块;`package-info`;JPMS 少见。
- 公共 API 识别:模块的 API 包命名(`api/`、`spi/`)、非 internal 注释;Gradle 的 `api` vs `implementation` 依赖暴露。
- 接口与实现:`interface` + `implements`;抽象类;SPI(`META-INF/services` + `ServiceLoader` 是插件系统的强证据);注解驱动(`@Component` 族)。
- 注册表模式:Spring 容器本身、`Map<String, Handler>` bean、`@Bean` 工厂方法。
- DI:构造注入(`@Autowired`/constructor)、Spring 容器、Dagger/Koin(Kotlin)。
- async/streaming:虚拟线程/`CompletableFuture`、Kotlin coroutines(`Flow`/`Channel`/`suspend`)、Reactor/RxJava(`Flux/Mono`);`@Async`。
- 事件系统:Spring `ApplicationEventPublisher` + `@EventListener`、Kotlin SharedFlow、EventBus 类。
- 测试/示例:`src/test/java`、JUnit5、Testcontainers(集成);`spring.factories`/自动配置。
- Agent loop 常见表达:`while(true)` + 阻塞调用;`Flow` 循环;递归 suspend 函数。
- 容易误判:接口遍地(风格)≠都被用作扩展点,看注入与替换点;`@Autowired` 字段注入使构造链不可见(用 IDE 式引用搜索);Lombok 生成代码;annotation processor 生成代码。

## C#

- 常见入口:`Program.cs`(top-level statements 或 `Main`)、`Startup.cs`/minimal hosting(`WebApplication.CreateBuilder`)。
- 包边界:.csproj、解决方案;solution 多项目即模块边界;`InternalsVisibleTo` 提示内部边界。
- 公共 API 识别:项目输出类型(ClassLibrary vs Exe)、导出类型的 `public` 面、NuGet 打包配置。
- 接口与实现:`interface` + `: IClass`;抽象类;`partial` 类(生成代码常见);默认接口方法。
- 注册表模式:DI 容器注册(`services.AddTransient<IFoo, Foo>`)是主要机制;静态字典注册。
- DI:Microsoft.Extensions.DependencyInjection 三件套(`Add`/`Build`/注入构造);options 模式(`IOptions<T>`)承载配置。
- async/streaming:`async/await`;`IAsyncEnumerable<T>`(agent loop 常见);`System.Threading.Channels`;`CancellationToken` 贯穿(取消传播证据)。
- 事件系统:`event`/delegate、`IObservable`/Rx、MediatR(进程内消息)、hosted service(`IHostedService`)后台循环。
- 测试/示例:`*.Tests` 项目、xUnit/NUnit、`examples/` 解决方案文件夹。
- Agent loop 常见表达:`while(true)` + await;`await foreach (var update in stream)`;状态机 enum + switch。
- 容易误判:DI 注册存在但被 `new` 绕过;`CancellationToken` 只是参数透传未真正触发取消;source generator/Designer 生成文件;WPF/WinForms UI 事件被当架构事件。

## 混合与生成代码

- 多语言仓库(polyglot):按语言分块分析,以主要语言为主链路,跨语言边界(HTTP/RPC/FFI/CLI 子进程)显式记为 relation `delegates` 或 `external:` 引用,并降置信度。
- 生成代码(.pb.go、_pb2.py、openapi 生成 client、g.dart):默认排除在分析外(inventory 已标记),引用其类型时标注"生成代码,以源头 schema 为准"。

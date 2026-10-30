# HTML 报告规范(html-report-spec)

渲染报告前必读。报告不是文档,是一个交互式源码架构浏览器,最终产物为单个自包含 HTML 文件,双击 file:// 打开即用。

## 离线与安全硬约束

- 不依赖 CDN、本地服务器、网络、远程字体;不在运行时 fetch 本地 JSON;CSS、JS、审计数据全部内嵌。
- 来自被审计仓库的一切文本(路径、符号名、代码片段、注释、summary)一律经 DOM textContent 或转义注入,禁止未转义进入 innerHTML——防脚本注入/DOM 注入。校验方式:含 `<script>`、HTML 标签、引号、非 ASCII 的样本文本在报告中只作为数据出现。
- 不把全部源码复制进报告;excerpt ≤ 40 行,且必须带准确路径+行号。
- 报告内不引用 assets 目录。

## 渲染管线(render_report.py)

1. 读 `assets/report/template.html`、`styles.css`、`app.js`(相对脚本位置的固定资产,不接受外部传入)。
2. 替换模板占位符:`__ATLAS_TITLE__`(经 HTML 转义的标题)、`/*__ATLAS_CSS__*/`、`/*__ATLAS_APP__*/`、`__ATLAS_DATA__`。
3. 数据嵌入 `<script type="application/json" id="audit-data">`:JSON 序列化后把 `</` 替换为 `<\/`(防提前终止)、U+2028/U+2029 转义;app.js 用 `JSON.parse(textContent)` 读取。
4. 资产自身不得包含 `</script>`/`</style>` 字面量(渲染器断言)。
5. 输出 UTF-8、确定性(数据中的时间戳除外);可选字段缺失时正常渲染;不访问网络。

## 布局

- **顶栏**:项目名、类型、revision、语言、审计时间;全局搜索(节点/文件/符号);置信度过滤、实现状态过滤;主题切换(深/浅,记忆偏好);报告说明(状态与置信度、证据类型的图例)。
- **左侧栏**:真实项目结构树(Physical)/ 逻辑架构树(Logical)切换;文件过滤框;开关:仅核心文件、隐藏测试、隐藏文档、隐藏生成;文件按其架构职责着色(层色点)。
- **中间**:tab 页 Overview / Architecture / Runtime Flows / State & Data / Source Index / Extensions / Development Guide / Comparison / Unknowns。
- **右侧**:当前选中对象详情(项目原始术语、职责、文件、符号、行号、代码片段、上游/下游、状态读写、事件、证据与类型、置信度)。
- **底部状态栏**:当前过滤状态;节点/文件/符号/未确认数量;报告生成版本。
- 比较报告:额外有项目切换器;Comparison 为默认 tab;其余 tab 浏览当前选中项目的内嵌 audit。

## 视图要求

1. **Overview**:项目类型与边界(owns/delegates/out-of-scope);核心能力卡片(核心入口、Agent loop、模型适配、工具系统、runtime、状态模型、扩展机制,各卡显示状态与置信度);推荐阅读顺序;关键 findings;关键限制;置信度/状态分布概览。聚焦模式显示聚焦范围。
2. **Architecture**:分层图(Interface / Lifecycle / Orchestration / Context & State / Model & Tool Integration / Runtime / Permissions / Events & Observability / Extensibility,含 Boundary/Testing 如有),HTML/CSS 确定性布局,不做自由漂浮 force graph,不依赖在线图形库。点击节点:左侧高亮相关文件、右侧展示证据、高亮上游(一类颜色)与下游(另一类颜色)节点;支持按状态/置信度过滤;可切换只看核心关系;支持复制路径与符号名。
3. **Project Tree**(左栏):Physical(真实目录)+ Logical(按架构职责重组);展开/折叠;文件类型与语义职责标签;重要程度;搜索与核心过滤;点击文件联动右侧详情与其架构节点。
4. **Runtime Flows**:步骤流(纵向 stepper/时序风格)展示文本响应、工具调用、错误重试、取消、子智能体、checkpoint/resume、扩展注册;每步可展开:actor、输入、输出、状态读写、发出事件、分支、错误、文件与符号、证据。
5. **State & Data**:核心状态对象卡片:创建者/读取者/写入者/序列化者(可点击引用)、生命周期、持久化边界、字段表、状态间转换。
6. **Source Index**:表:路径、语言、职责摘要、架构角色、关键符号、重要度、证据数;排序、过滤、全文搜索;点击行联动详情。
7. **Extensions**:扩展点名称、类别、公开性、稳定度、注册方式、接口、参考实现、约束、证据。
8. **Development Guide**:选择开发目标后显示:先读哪些文件、实现哪些接口/符号、参考实现、受影响模块、必须保持的不变量、风险等级、建议验证方式。
9. **Comparison**:比较报告显示能力矩阵、相同概念并排实现、链路差异、扩展机制差异、tradeoff、代码位置与证据;单项目报告显示"不可用"状态说明。
10. **Unknowns**:未确认问题、原因、已尝试检查、可能位置、影响、建议验证。

## 交互要求(必须实现)

全局搜索;树展开/折叠;tab 切换;架构节点选择;文件-符号-证据-节点双向联动;关系高亮;置信度过滤;实现状态过滤;复制源码路径;复制 `path:line`;深/浅主题;URL hash 深链接(`#view=...&sel=...&project=...`),浏览器前进后退正常;空数据状态;坏数据提示;基本键盘可访问性(原生 button、`/` 聚焦搜索、Esc 关闭弹层、方向键切 tab);窄窗口响应式(侧栏可收起)。

明确不做:完整 IDE、在线编辑、全量代码浏览器、拖拽画布、3D、大型前端框架。

## 视觉与颜色语义

工程分析工具风格:克制、信息密度高但不拥挤;不用花哨动画与装饰图表。颜色语义全局统一:

- 状态:implemented 绿 / delegated 蓝 / partial 黄 / unknown 灰 / absent 弱红。
- 置信度:high 实线高对比 / medium 常规 / low 虚线或低对比。
- 层色:每个架构层一个稳定色相,树中文件圆点与架构卡片同色。
- 深浅两主题下均保证对比度;推断类内容(inference 证据)以斜体或"推断"徽标区分。

## app.js 实现约定(维护时遵守)

- 首行 `JSON.parse` 读 `#audit-data`;`report_kind` 决定单项目/比较模式。
- 所有仓库文本经 `h()` 辅助函数(DOM API + textContent)注入;禁止对仓库文本使用字符串拼 HTML。
- 视图容器与关键控件使用模板中的固定 id(smoke test 依赖):`view-overview`、`view-architecture`、`view-flows`、`view-state`、`view-source`、`view-extensions`、`view-dev`、`view-comparison`、`view-unknowns`。
- 不出现网络 API(fetch/XMLHttpRequest)、不含 `http://`/`https://` 字面量(因此架构图用 HTML/CSS 而非需要 namespace 字符串的 SVG)。
- hash 驱动路由:所有导航写 `location.hash`,`hashchange` 统一渲染,避免回退失效。

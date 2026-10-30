# 多项目比较方法(comparison-method)

多项目比较前必读。比较的唯一合法坐标是统一架构本体(architecture-ontology.md)的 canonical id,不是目录名、项目术语或 README 措辞。

## 输入

- 多个本地仓库:先各自完成单项目审计(audit.json),再进入比较;或
- 多个已生成的 audit.json。

## 方法

1. **对齐概念**:取各 audit 的 architecture_nodes,按 canonical_id 分组。某项目缺某概念时,先回该项目确认是 delegated/absent 还是漏审(unknown),不允许默认填 absent。
2. **建能力矩阵**:每个概念一行、每个项目一列。单元格值:`implemented / delegated / absent / unknown / partial`,附一句实现摘要与 refs(指向该项目内 audit 的 node/file/symbol)。`partial` 仅用于矩阵:能力存在但覆盖不完整(如有 checkpoint 无 resume)。
3. **概念深比**:对关键概念(agent loop、tool registry、model abstraction、context/state、permissions、subagent、扩展机制)写 concept_comparisons:各项目 project_term、实现位置、实现策略、关键数据结构、控制流差异、扩展方式、tradeoff、证据与置信度。
4. **链路比较**:对共同支持的执行切片(工具调用链路等)对比步骤结构与谁承担每步。
5. **扩展机制比较**:各项目实现同一自定义目标的路径差异。
6. **归纳**:architectural_differences(结构性差异)、common_patterns(共同模式)、tradeoffs(各项目的取舍及代价)。
7. **unknowns 汇总**:任何项目中的 unknown 概念在比较结论中保持 unknown,不得在比较中被"平均"掉。

## 必须避免的偏差

- 把不同抽象层的项目强行等价(SDK 与完整产品比较时,SDK 缺 UI 不是缺陷)。
- 把宿主/依赖负责的能力当成该项目"未实现"——那是 delegated。
- 根据 README 宣传文字判断能力(只能作 docs 级证据)。
- 只比较文件名、目录名、项目自造术语。
- 把代码量(LOC)当成架构成熟度。
- 用一个项目的术语体系描述另一个项目(一律用 canonical id + 各自 project_term)。

## 输出

`comparison.json`(结构见 audit-schema.md 的 comparison 小节;强烈建议内嵌全部 source_audits,报告的项目切换浏览依赖它)+ `comparison-report.html`(`render_report.py --mode comparison`)。输出目录约定同单项目:`<output>/comparison.json`、`<output>/comparison-report.html`。

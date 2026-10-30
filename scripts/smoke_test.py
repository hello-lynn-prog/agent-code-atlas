#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""agent-code-atlas | smoke_test.py — 端到端自检。

在临时目录内构造样例审计数据(含 <script>/HTML/引号/非 ASCII 恶意样本文本),
调用 validate_audit.py 与 render_report.py,并对产物做静态检查:
  - HTML 存在且非空;数据/CSS/JS 已内嵌;必需视图容器存在;
  - 不含 http(s)://、cdn、fetch(、@import、外部字体、XMLHttpRequest;
  - 嵌入的 </script> 已转义(真实闭合标签数量正确),恶意文本只作为惰性数据存在;
  - 无效 symbol 引用、非法行号、非法枚举、high 零证据会被 validator 拒绝;
  - 大量字段为空的最小 audit 仍能校验与渲染;comparison 模式可渲染。
测试后清理临时目录。全部通过返回 0。
"""
from __future__ import annotations

import copy
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
VALIDATOR = SCRIPTS / "validate_audit.py"
RENDERER = SCRIPTS / "render_report.py"

REQUIRED_VIEW_IDS = [
    "view-overview", "view-architecture", "view-flows", "view-state",
    "view-source", "view-extensions", "view-dev", "view-comparison", "view-unknowns",
]
FORBIDDEN_SUBSTRINGS = ["http://", "https://", "cdn", "fetch(", "@import", "fonts.", "XMLHttpRequest"]

MALICIOUS_EXCERPT = (
    "while True:\n"
    "    resp = client.chat(messages)  # <script>alert('xss')</script> & <b>tags</b> \"quotes\"\n"
    "    # 调用模型并处理工具调用 — 你好世界\n"
    "    if resp.tool_calls:\n"
    "        results = registry.dispatch(resp.tool_calls)\n"
)

RESULTS: list[tuple[bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    RESULTS.append((ok, name + (" :: " + detail if detail and not ok else "")))
    print("[%s] %s%s" % ("PASS" if ok else "FAIL", name, (" :: " + detail) if detail and not ok else ""))
    return ok


def run_tool(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable] + [str(a) for a in args],
                          capture_output=True, text=True, encoding="utf-8", errors="replace")


def base_audit() -> dict:
    return {
        "schema_version": "1.0",
        "report_kind": "single_project",
        "project": {
            "id": "mini-agent-py",
            "name": "mini-agent-py",
            "root": "C:/tmp/mini-agent-py",
            "revision": "0f1e2d3c4b5a6978897a6b5c4d3e2f1001121314",
            "analyzed_at": "2026-09-30T12:00:00+00:00",
            "languages": ["Python"],
            "build_systems": ["setuptools"],
            "package_managers": ["pip"],
            "project_kind": "sdk",
            "project_kind_confidence": "high",
            "boundaries": {
                "owns": ["agent loop", "tool registry 与 dispatch"],
                "delegates": ["openai-python — 模型 API 调用"],
                "out_of_scope": ["沙箱隔离"],
            },
            "external_dependencies": [{"name": "openai", "role": "模型 API 客户端"}],
            "entry_points": [{"kind": "sdk-api", "path": "src/agent/__init__.py",
                              "summary": "导出 run_agent"}],
        },
        "analysis": {
            "mode": "full",
            "focus": [],
            "runtime_verification": "none",
            "included_paths": ["src", "tests"],
            "excluded_paths": ["docs — 非代码"],
            "limitations": ["静态审计,未运行测试"],
            "warnings": [],
            "analyzer_version": "agent-code-atlas/1.0",
        },
        "statistics": {"node_count": 5, "evidence_count": 5},
        "architecture_nodes": [
            {
                "id": "nd-loop", "canonical_id": "orch.agent-loop", "canonical_name": "Agent Loop",
                "project_terms": ["run_agent"],
                "layer": "orchestration",
                "summary": "显式 while 循环:调用模型,执行 tool_calls,回填后进入下一轮。",
                "implementation_status": "implemented", "confidence": "high",
                "file_ids": ["f-loop"], "symbol_ids": ["sym-run-agent"],
                "evidence_ids": ["ev-loop-code", "ev-loop-test"],
                "upstream_node_ids": [], "downstream_node_ids": ["nd-dispatch"],
                "extension_point_ids": [], "notes": "loop 变体:显式 while loop",
            },
            {
                "id": "nd-registry", "canonical_id": "tool.registry", "canonical_name": "Tool Registry",
                "project_terms": ["ToolRegistry"],
                "layer": "integration", "summary": "以字典注册工具,按名解析。",
                "implementation_status": "implemented", "confidence": "high",
                "file_ids": ["f-tools"], "symbol_ids": ["sym-tool-registry"],
                "evidence_ids": ["ev-registry"],
                "upstream_node_ids": [], "downstream_node_ids": ["nd-dispatch"],
                "extension_point_ids": ["ep-custom-tool"], "notes": "",
            },
            {
                "id": "nd-dispatch", "canonical_id": "tool.dispatch", "canonical_name": "Tool Dispatch",
                "project_terms": ["ToolRegistry.dispatch"],
                "layer": "integration", "summary": "解析 tool call 并执行对应工具。",
                "implementation_status": "implemented", "confidence": "medium",
                "file_ids": ["f-tools"], "symbol_ids": ["sym-dispatch"],
                "evidence_ids": ["ev-dispatch-test"],
                "upstream_node_ids": ["nd-loop"], "downstream_node_ids": [],
                "extension_point_ids": [], "notes": "",
            },
            {
                "id": "nd-model", "canonical_id": "model.provider-abstraction",
                "canonical_name": "Provider Abstraction",
                "project_terms": ["ModelClient"],
                "layer": "integration", "summary": "仅封装 openai-python,单实现,无多供应商抽象。",
                "implementation_status": "delegated", "confidence": "medium",
                "file_ids": ["f-model"], "symbol_ids": ["sym-chat"],
                "evidence_ids": ["ev-provider-delegated"],
                "upstream_node_ids": ["nd-loop"], "downstream_node_ids": [],
                "extension_point_ids": [], "notes": "委托给 openai-python",
            },
            {
                "id": "nd-sandbox", "canonical_id": "exec.sandbox", "canonical_name": "Sandbox",
                "project_terms": [],
                "layer": "runtime", "summary": "无沙箱,子进程直接在宿主执行。",
                "implementation_status": "absent", "confidence": "low",
                "file_ids": [], "symbol_ids": [], "evidence_ids": [],
                "upstream_node_ids": [], "downstream_node_ids": [],
                "extension_point_ids": [], "notes": "",
            },
        ],
        "files": [
            {"id": "f-loop", "path": "src/agent/loop.py", "language": "Python", "size": 5400,
             "line_count": 220, "generated": False, "test": False, "documentation": False,
             "importance": "core",
             "summary": "核心 agent loop(含 <img src=x onerror=alert(1)> 样式的不可信文本仅作转义测试)",
             "architecture_node_ids": ["nd-loop"], "symbol_ids": ["sym-run-agent"],
             "evidence_ids": ["ev-loop-code"]},
            {"id": "f-tools", "path": "src/agent/tools.py", "language": "Python", "size": 3200,
             "line_count": 140, "generated": False, "test": False, "documentation": False,
             "importance": "core", "summary": "工具注册表与分派。",
             "architecture_node_ids": ["nd-registry", "nd-dispatch"],
             "symbol_ids": ["sym-tool-registry", "sym-dispatch"], "evidence_ids": ["ev-registry"]},
            {"id": "f-model", "path": "src/agent/model.py", "language": "Python", "size": 2100,
             "line_count": 90, "generated": False, "test": False, "documentation": False,
             "importance": "high", "summary": "模型客户端封装。",
             "architecture_node_ids": ["nd-model"], "symbol_ids": ["sym-chat"],
             "evidence_ids": ["ev-provider-delegated"]},
            {"id": "f-tests", "path": "tests/test_loop.py", "language": "Python", "size": 1500,
             "line_count": 60, "generated": False, "test": True, "documentation": False,
             "importance": "normal", "summary": "loop 行为测试。",
             "architecture_node_ids": ["nd-loop"], "symbol_ids": [],
             "evidence_ids": ["ev-loop-test", "ev-dispatch-test"]},
            {"id": "f-readme", "path": "README.md", "language": "Markdown", "size": 900,
             "line_count": 40, "generated": False, "test": False, "documentation": True,
             "importance": "low", "summary": "项目说明。", "architecture_node_ids": [],
             "symbol_ids": [], "evidence_ids": ["ev-readme-docs"]},
        ],
        "symbols": [
            {"id": "sym-run-agent", "file_id": "f-loop", "name": "run_agent",
             "qualified_name": "agent.loop.run_agent", "kind": "function",
             "signature": "async def run_agent(session, tools) -> AsyncIterator[Event]",
             "start_line": 10, "end_line": 88, "visibility": "public", "exported": True,
             "summary": "驱动主循环。", "architecture_node_ids": ["nd-loop"],
             "evidence_ids": ["ev-loop-code"]},
            {"id": "sym-tool-registry", "file_id": "f-tools", "name": "ToolRegistry",
             "qualified_name": "agent.tools.ToolRegistry", "kind": "class",
             "signature": "class ToolRegistry", "start_line": 5, "end_line": 70,
             "visibility": "public", "exported": True, "summary": "注册表。",
             "architecture_node_ids": ["nd-registry"], "evidence_ids": ["ev-registry"]},
            {"id": "sym-dispatch", "file_id": "f-tools", "name": "dispatch",
             "qualified_name": "agent.tools.ToolRegistry.dispatch", "kind": "method",
             "signature": "def dispatch(self, calls: list[ToolCall]) -> list[ToolResult]",
             "start_line": 30, "end_line": 58, "visibility": "public", "exported": True,
             "summary": "分派工具调用。", "architecture_node_ids": ["nd-dispatch"],
             "evidence_ids": ["ev-dispatch-test"]},
            {"id": "sym-chat", "file_id": "f-model", "name": "chat",
             "qualified_name": "agent.model.ModelClient.chat", "kind": "method",
             "signature": "async def chat(self, messages)", "start_line": 12, "end_line": 60,
             "visibility": "public", "exported": True, "summary": "调用模型。",
             "architecture_node_ids": ["nd-model"], "evidence_ids": ["ev-provider-delegated"]},
        ],
        "relations": [
            {"id": "rel-1", "type": "dispatches", "from_ref": "node:nd-loop", "to_ref": "node:nd-dispatch",
             "label": "loop 分派工具", "summary": "resp.tool_calls 非空时调用 dispatch。",
             "confidence": "high", "evidence_ids": ["ev-loop-code"]},
            {"id": "rel-2", "type": "invokes_model", "from_ref": "node:nd-loop",
             "to_ref": "external:openai-python", "label": "经 ModelClient 调用",
             "summary": "", "confidence": "medium", "evidence_ids": ["ev-provider-delegated"]},
            {"id": "rel-3", "type": "reads_state", "from_ref": "node:nd-loop", "to_ref": "state:st-messages",
             "label": "读取消息历史", "summary": "", "confidence": "high", "evidence_ids": ["ev-loop-code"]},
            {"id": "rel-4", "type": "writes_state", "from_ref": "node:nd-dispatch",
             "to_ref": "state:st-messages", "label": "回填工具结果", "summary": "",
             "confidence": "medium", "evidence_ids": ["ev-dispatch-test"]},
        ],
        "execution_flows": [
            {"id": "fl-tool-call", "name": "工具调用链路", "category": "tool-call",
             "summary": "用户输入到工具结果回填的完整链路。", "trigger": "用户提交消息",
             "termination": "模型返回不含 tool_calls 的响应", "confidence": "high",
             "evidence_ids": ["ev-loop-code", "ev-loop-test"],
             "steps": [
                 {"id": "fl-tool-call.s1", "order": 1, "title": "组装上下文", "actor": "run_agent",
                  "architecture_node_ids": ["nd-loop"], "file_ids": ["f-loop"],
                  "symbol_ids": ["sym-run-agent"], "input": "session", "output": "messages",
                  "state_reads": ["st-messages"], "state_writes": [], "events_emitted": [],
                  "errors": [], "branching": "", "evidence_ids": ["ev-loop-code"]},
                 {"id": "fl-tool-call.s2", "order": 2, "title": "模型返回 tool_call", "actor": "ModelClient",
                  "architecture_node_ids": ["nd-model"], "file_ids": ["f-model"],
                  "symbol_ids": ["sym-chat"], "input": "messages", "output": "resp.tool_calls",
                  "state_reads": [], "state_writes": [], "events_emitted": ["model.response"],
                  "errors": ["网络错误 → 重试"], "branching": "无 tool_calls 则直接输出",
                  "evidence_ids": ["ev-provider-delegated"]},
                 {"id": "fl-tool-call.s3", "order": 3, "title": "分派执行工具", "actor": "ToolRegistry.dispatch",
                  "architecture_node_ids": ["nd-dispatch"], "file_ids": ["f-tools"],
                  "symbol_ids": ["sym-dispatch"], "input": "tool_calls", "output": "results",
                  "state_reads": [], "state_writes": [], "events_emitted": ["tool.result"],
                  "errors": [], "branching": "", "evidence_ids": ["ev-dispatch-test"]},
                 {"id": "fl-tool-call.s4", "order": 4, "title": "结果回填", "actor": "run_agent",
                  "architecture_node_ids": ["nd-loop"], "file_ids": ["f-loop"],
                  "symbol_ids": ["sym-run-agent"], "input": "results", "output": "下一轮 messages",
                  "state_reads": [], "state_writes": ["st-messages"], "events_emitted": [],
                  "errors": [], "branching": "", "evidence_ids": ["ev-loop-code"]},
             ]},
        ],
        "state_models": [
            {"id": "st-messages", "name": "Message History", "project_term": "session.messages",
             "category": "message", "summary": "对话消息列表。", "mutability": "mutable",
             "lifetime": "run", "persistence": "none",
             "creator_refs": ["node:nd-loop"], "reader_refs": ["node:nd-model"],
             "writer_refs": ["node:nd-loop", "node:nd-dispatch"], "serializer_refs": [],
             "fields": [{"name": "role", "type": "str", "summary": ""}],
             "evidence_ids": ["ev-loop-code"]},
        ],
        "extension_points": [
            {"id": "ep-custom-tool", "name": "自定义工具", "category": "tool", "stability": "stable",
             "public": True, "registration_method": "ToolRegistry.register(tool)",
             "interface_refs": ["symbol:sym-tool-registry"],
             "implementation_refs": ["symbol:sym-dispatch"],
             "example_refs": ["file:f-tests"],
             "constraints": "工具必须是纯函数签名;结果需可 JSON 序列化。",
             "evidence_ids": ["ev-registry"]},
        ],
        "development_recipes": [
            {"id": "rc-add-tool", "goal": "添加工具", "applicability": "需要在 loop 中暴露新能力时",
             "summary": "实现 Tool 协议并注册。", "recommended_extension_points": ["ep-custom-tool"],
             "files_to_read": ["f-tools"], "symbols_to_implement": ["sym-tool-registry"],
             "reference_implementations": ["symbol:sym-dispatch"],
             "affected_architecture_nodes": ["nd-registry", "nd-dispatch"],
             "invariants": ["不得在工具内直接修改 messages"], "risks": ["阻塞 loop 的长任务"],
             "risk_level": "low", "validation_steps": ["运行 tests/test_loop.py"],
             "evidence_ids": ["ev-registry"]},
        ],
        "findings": [
            {"id": "fd-1", "title": "README 声称支持沙箱但代码无实现",
             "category": "docs-mismatch", "summary": "README 提及 sandbox,仓库内无相关代码。",
             "significance": "minor", "confidence": "medium", "evidence_ids": ["ev-readme-docs"],
             "related_refs": ["node:nd-sandbox"]},
        ],
        "evidence": [
            {"id": "ev-loop-code", "type": "code", "file_id": "f-loop",
             "symbol_id": "sym-run-agent", "start_line": 12, "end_line": 17,
             "excerpt": MALICIOUS_EXCERPT,
             "observation": "while True 循环内调用模型并分派工具。",
             "supports": "orch.agent-loop", "confidence": "high"},
            {"id": "ev-loop-test", "type": "test", "file_id": "f-tests",
             "start_line": 20, "end_line": 35,
             "excerpt": "async def test_tool_roundtrip():\n    ...",
             "observation": "测试断言工具调用会回填并触发下一轮。", "supports": "orch.agent-loop",
             "confidence": "high"},
            {"id": "ev-registry", "type": "code", "file_id": "f-tools",
             "symbol_id": "sym-tool-registry", "start_line": 5, "end_line": 20,
             "excerpt": "class ToolRegistry:\n    def __init__(self):\n        self._tools = {}",
             "observation": "字典注册表。", "supports": "tool.registry", "confidence": "high"},
            {"id": "ev-dispatch-test", "type": "test", "file_id": "f-tests",
             "start_line": 40, "end_line": 55,
             "excerpt": "def test_dispatch():\n    ...",
             "observation": "测试覆盖 dispatch 路由。", "supports": "tool.dispatch",
             "confidence": "medium"},
            {"id": "ev-provider-delegated", "type": "config", "file_id": "f-model",
             "start_line": 1, "end_line": 5,
             "excerpt": "import openai",
             "observation": "依赖 openai-python,模型调用被委托。", "supports": "model.provider-abstraction",
             "confidence": "medium"},
            {"id": "ev-readme-docs", "type": "docs", "file_id": "f-readme",
             "start_line": 5, "end_line": 9,
             "excerpt": "## Features\n- sandboxed execution",
             "observation": "文档声称沙箱(docs 级证据)。", "supports": "docs-mismatch",
             "confidence": "low"},
        ],
        "unknowns": [
            {"id": "un-1", "question": "取消信号是否传播到工具子进程?",
             "why_unknown": "工具实现分散且未运行验证", "attempted_checks": ["grep cancel/abort"],
             "likely_locations": ["src/agent/tools.py"],
             "impact": "取消链路结论保持 unknown", "recommended_verification": "授权后运行取消场景测试"},
        ],
    }


def minimal_audit() -> dict:
    return {
        "schema_version": "1.0",
        "report_kind": "single_project",
        "project": {
            "id": "bare", "name": "bare", "root": "C:/tmp/bare", "analyzed_at": "2026-09-30T00:00:00+00:00",
            "languages": [], "project_kind": "library", "project_kind_confidence": "low",
            "boundaries": {"owns": [], "delegates": [], "out_of_scope": []},
        },
        "analysis": {
            "mode": "full", "focus": [], "runtime_verification": "none",
            "included_paths": [], "excluded_paths": [], "limitations": ["最小数据"],
            "warnings": [], "analyzer_version": "agent-code-atlas/1.0",
        },
        "architecture_nodes": [], "files": [], "symbols": [], "relations": [],
        "execution_flows": [], "state_models": [], "extension_points": [],
        "development_recipes": [], "findings": [], "evidence": [], "unknowns": [],
    }


def comparison_data(a1: dict, a2: dict) -> dict:
    return {
        "schema_version": "1.0",
        "report_kind": "comparison",
        "generated_at": "2026-09-30T12:00:00+00:00",
        "analyzer_version": "agent-code-atlas/1.0",
        "projects": [
            {"id": "p1", "name": "mini-agent-py", "root": "C:/tmp/mini-agent-py",
             "revision": "0f1e2d", "audit_index": 0},
            {"id": "p2", "name": "mini-agent-cli", "root": "C:/tmp/mini-agent-cli",
             "revision": "9a8b7c", "audit_index": 1},
        ],
        "source_audits": [a1, a2],
        "capability_matrix": [
            {"concept_id": "orch.agent-loop", "concept_name": "Agent Loop",
             "cells": [
                 {"project_id": "p1", "status": "implemented", "summary": "显式 while loop",
                  "refs": ["node:nd-loop"]},
                 {"project_id": "p2", "status": "implemented", "summary": "async generator",
                  "refs": ["node:nd-loop"]},
             ]},
            {"concept_id": "tool.registry", "concept_name": "Tool Registry",
             "cells": [
                 {"project_id": "p1", "status": "implemented", "summary": "字典注册表",
                  "refs": ["node:nd-registry"]},
                 {"project_id": "p2", "status": "partial", "summary": "仅装饰器注册,无解析",
                  "refs": ["node:nd-registry"]},
             ]},
            {"concept_id": "exec.sandbox", "concept_name": "Sandbox",
             "cells": [
                 {"project_id": "p1", "status": "absent", "summary": "无"},
                 {"project_id": "p2", "status": "delegated", "summary": "容器运行时",
                  "refs": ["external:docker"]},
             ]},
        ],
        "concept_comparisons": [
            {"concept_id": "orch.agent-loop", "concept_name": "Agent Loop",
             "common_pattern": "都由模型 tool_calls 驱动继续",
             "difference_summary": "p1 显式循环,p2 async generator。",
             "per_project": [
                 {"project_id": "p1", "project_term": "run_agent", "implementation": "while loop",
                  "strategy": "同步阻塞", "data_structures": ["messages"],
                  "control_flow": "顺序", "extension": "注册工具", "refs": ["node:nd-loop"],
                  "confidence": "high", "tradeoff": "简单但难以流式暂停"},
                 {"project_id": "p2", "project_term": "Agent.stream", "implementation": "async generator",
                  "strategy": "事件流", "data_structures": ["events"],
                  "control_flow": "iterator 驱动", "extension": "注册工具", "refs": ["node:nd-loop"],
                  "confidence": "medium", "tradeoff": "可流式但调试较难"},
             ]},
        ],
        "flow_comparisons": [
            {"topic": "工具调用链路",
             "per_project": [{"project_id": "p1", "summary": "4 步", "refs": ["flow:fl-tool-call"]},
                             {"project_id": "p2", "summary": "事件化 3 步"}],
             "difference_summary": "p2 无独立回填步骤。"},
        ],
        "extension_comparisons": [
            {"topic": "自定义工具",
             "per_project": [{"project_id": "p1", "summary": "register()"},
                             {"project_id": "p2", "summary": "装饰器"}],
             "difference_summary": "注册方式不同。"},
        ],
        "architectural_differences": [
            {"id": "ad-1", "title": "状态位置", "summary": "p1 会话内,p2 事件日志。",
             "per_project": [{"project_id": "p1", "statement": "messages 列表"},
                             {"project_id": "p2", "statement": "事件日志"}],
             "significance": "major"},
        ],
        "common_patterns": [
            {"id": "cp-1", "title": "tool_calls 驱动循环", "summary": "两边一致。",
             "refs": ["node:nd-loop"]},
        ],
        "tradeoffs": [
            {"id": "to-1", "project_id": "p1", "title": "简单 vs 流式",
             "summary": "同步实现牺牲流式能力。"},
        ],
        "unknowns": [
            {"id": "un-c1", "project_id": "p2", "question": "p2 的取消传播?",
             "why_unknown": "未深入分析", "attempted_checks": [], "likely_locations": [],
             "impact": "低", "recommended_verification": "阅读 runtime 模块"},
        ],
    }


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    tmp = Path(tempfile.mkdtemp(prefix="agent-code-atlas-smoke-"))
    try:
        audit = base_audit()

        # 1) 合法单项目数据通过校验
        audit_path = tmp / "audit.json"
        write_json(audit_path, audit)
        r = run_tool([VALIDATOR, audit_path])
        check("validator accepts valid single audit", r.returncode == 0, r.stdout + r.stderr)

        # 2) 渲染 + 静态检查
        report_path = tmp / "report.html"
        r = run_tool([RENDERER, audit_path, "--out", report_path])
        check("renderer exits 0", r.returncode == 0, r.stdout + r.stderr)
        html_text = report_path.read_text(encoding="utf-8") if report_path.exists() else ""
        check("report.html exists and non-empty", len(html_text) > 1000, "size=%d" % len(html_text))
        check("audit data embedded", 'id="audit-data"' in html_text)
        check("css embedded", ".app-root" in html_text)
        check("app.js embedded", "audit-data" in html_text and "use strict" in html_text)
        check("all required views present", all('id="%s"' % v in html_text for v in REQUIRED_VIEW_IDS),
              ", ".join(v for v in REQUIRED_VIEW_IDS if 'id="%s"' % v not in html_text))
        found_forbidden = [s for s in FORBIDDEN_SUBSTRINGS if s in html_text]
        check("no external resource references", not found_forbidden, str(found_forbidden))
        script_close = "</" + "script>"
        script_close_count = html_text.count(script_close)
        check("embedded script closer escaped (exactly 2 real closers)", script_close_count == 2,
              "count=%d" % script_close_count)
        check("malicious payload present as inert data", "alert('xss')" in html_text)
        check("escaped closing tag present", "<\\/script>" in html_text)

        # 3) 无效数据必须被拒绝
        def expect_fail(name: str, mutate) -> None:
            bad = copy.deepcopy(audit)
            mutate(bad)
            p = tmp / ("bad-%s.json" % name)
            write_json(p, bad)
            r = run_tool([VALIDATOR, p])
            check("validator rejects %s" % name, r.returncode != 0 and "ERROR" in r.stdout,
                  "rc=%d out=%s" % (r.returncode, r.stdout[:300]))

        expect_fail("missing symbol ref",
                    lambda d: d["architecture_nodes"][0]["symbol_ids"].append("sym-ghost"))
        expect_fail("bad line numbers",
                    lambda d: d["symbols"][0].update(start_line=50, end_line=10))
        expect_fail("bad implementation_status",
                    lambda d: d["architecture_nodes"][0].update(implementation_status="maybe"))
        expect_fail("high confidence without evidence",
                    lambda d: d["architecture_nodes"][0].update(evidence_ids=[]))
        expect_fail("non-monotonic flow steps",
                    lambda d: d["execution_flows"][0]["steps"][1].update(order=5))

        # 4) 最小数据仍合法且可渲染
        min_path = tmp / "minimal.json"
        write_json(min_path, minimal_audit())
        r = run_tool([VALIDATOR, min_path])
        check("validator accepts minimal audit", r.returncode == 0, r.stdout)
        min_report = tmp / "minimal-report.html"
        r = run_tool([RENDERER, min_path, "--out", min_report])
        check("renderer handles minimal audit",
              r.returncode == 0 and min_report.exists() and min_report.stat().st_size > 1000,
              r.stdout + r.stderr)

        # 5) 比较:校验 + 渲染
        audit2 = copy.deepcopy(audit)
        audit2["project"] = dict(audit2["project"], id="mini-agent-cli", name="mini-agent-cli",
                                 root="C:/tmp/mini-agent-cli", project_kind="cli")
        cmp_path = tmp / "comparison.json"
        write_json(cmp_path, comparison_data(audit, audit2))
        r = run_tool([VALIDATOR, cmp_path])
        check("validator accepts comparison", r.returncode == 0, r.stdout + r.stderr)
        cmp_report = tmp / "comparison-report.html"
        r = run_tool([RENDERER, cmp_path, "--out", cmp_report, "--mode", "comparison"])
        check("renderer produces comparison report",
              r.returncode == 0 and cmp_report.exists() and cmp_report.stat().st_size > 1000,
              r.stdout + r.stderr)
        cmp_html = cmp_report.read_text(encoding="utf-8") if cmp_report.exists() else ""
        check("comparison report has no external references",
              not [s for s in FORBIDDEN_SUBSTRINGS if s in cmp_html])
        check("comparison report embeds both projects",
              "mini-agent-py" in cmp_html and "mini-agent-cli" in cmp_html)

        failed = [msg for ok, msg in RESULTS if not ok]
        print("-" * 60)
        print("smoke test: %d/%d passed" % (len(RESULTS) - len(failed), len(RESULTS)))
        return 1 if failed else 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())

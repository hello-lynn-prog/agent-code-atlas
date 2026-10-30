#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""agent-code-atlas | validate_audit.py — 校验 audit.json / comparison.json。

用法:
    python validate_audit.py <audit.json|comparison.json> [--strict] [--format text|json]

不止检查 JSON 可解析:还检查枚举、ID 唯一性、行号区间、excerpt 上限、
引用完整性(裸 ID 与 kind:id 带类型引用)、flow step 顺序、高置信度零证据等。
错误时返回非零退出码,并逐条给出 JSON 路径与原因。
"""
from __future__ import annotations

import argparse
import json
import re
import sys

ENUM_CONFIDENCE = {"high", "medium", "low"}
ENUM_STATUS_NODE = {"implemented", "delegated", "absent", "unknown"}
ENUM_STATUS_CELL = ENUM_STATUS_NODE | {"partial"}
ENUM_EVIDENCE_TYPE = {"runtime", "test", "code", "config", "docs", "inference"}
ENUM_LAYER = {"boundary", "interface", "lifecycle", "orchestration", "context-state",
              "integration", "runtime", "permissions", "observability", "extensibility", "testing"}
ENUM_SYMBOL_KIND = {"function", "method", "class", "interface", "type", "enum", "variable",
                    "constant", "module", "package", "command", "handler", "unknown"}
ENUM_RELATION_TYPE = {
    "imports", "exports", "calls", "constructs", "implements", "extends", "registers",
    "resolves", "dispatches", "invokes_model", "invokes_tool", "reads_state", "writes_state",
    "emits", "subscribes", "validates", "authorizes", "executes", "serializes", "deserializes",
    "persists", "restores", "delegates", "cancels", "retries", "maps_to", "configured_by",
    "depends_on",
}
ENUM_IMPORTANCE = {"core", "high", "normal", "low"}
ENUM_RISK = {"low", "medium", "high"}
ENUM_SIGNIFICANCE = {"info", "minor", "major", "critical"}
ENUM_MUTABILITY = {"immutable", "mutable", "unknown"}
ENUM_STABILITY = {"stable", "experimental", "unstable", "internal", "unknown"}
ENUM_MODE = {"full", "focused"}
ENUM_PROJECT_KIND = {"sdk", "library", "harness", "runtime", "cli", "product",
                     "protocol-adapter", "framework", "monorepo-multi-package"}

MAX_EXCERPT_LINES = 40
MAX_EXCERPT_CHARS = 6000
ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")
CANONICAL_RE = re.compile(r"^[a-z0-9]+([.-][a-z0-9]+)*$")


class Report:
    def __init__(self, path_label: str):
        self.path_label = path_label
        self.errors: list[tuple[str, str]] = []
        self.warnings: list[tuple[str, str]] = []

    def err(self, jpath: str, msg: str) -> None:
        self.errors.append((jpath, msg))

    def warn(self, jpath: str, msg: str) -> None:
        self.warnings.append((jpath, msg))

    @property
    def ok(self) -> bool:
        return not self.errors


def is_str(v) -> bool:
    return isinstance(v, str) and v.strip() != ""


def is_str_list(v) -> bool:
    return isinstance(v, list) and all(isinstance(x, str) for x in v)


class Refs:
    """单个 audit 内的 id 注册表与带类型引用解析。"""

    def __init__(self):
        self.nodes: set[str] = set()
        self.files: set[str] = set()
        self.symbols: set[str] = set()
        self.states: set[str] = set()
        self.extensions: set[str] = set()
        self.flows: set[str] = set()
        self.by_kind = {
            "node": self.nodes, "file": self.files, "symbol": self.symbols,
            "state": self.states, "extension": self.extensions, "flow": self.flows,
        }

    def resolve(self, ref) -> tuple[bool, str]:
        if not isinstance(ref, str) or ":" not in ref:
            return False, "引用必须形如 kind:id(如 node:nd-loop)"
        kind, _, ident = ref.partition(":")
        if kind == "external":
            return (True, "") if is_str(ident) else (False, "external: 后缺少组件名")
        table = self.by_kind.get(kind)
        if table is None:
            return False, "引用前缀非法:%s(允许 node|file|symbol|state|extension|flow|external)" % kind
        if ident not in table:
            return False, "引用了不存在的 %s id '%s'" % (kind, ident)
        return True, ""


def check_confidence(rep, jpath, val):
    if val not in ENUM_CONFIDENCE:
        rep.err(jpath, "confidence 非法:%r(允许 %s)" % (val, sorted(ENUM_CONFIDENCE)))


def check_id_list(rep, jpath, val, table: set, what: str, required=True):
    if val is None:
        if required:
            rep.err(jpath, "缺少必填字段")
        return
    if not isinstance(val, list):
        rep.err(jpath, "必须是数组")
        return
    for i, x in enumerate(val):
        if not isinstance(x, str) or x not in table:
            rep.err("%s[%d]" % (jpath, i), "引用了不存在的 %s id %r" % (what, x))


def check_ref_list(rep, jpath, val, refs: Refs, required=True):
    if val is None:
        if required:
            rep.err(jpath, "缺少必填字段")
        return
    if not isinstance(val, list):
        rep.err(jpath, "必须是数组")
        return
    for i, x in enumerate(val):
        ok, why = refs.resolve(x)
        if not ok:
            rep.err("%s[%d]" % (jpath, i), why)


def check_lines(rep, jpath, start, end, *, required=True):
    if start is None and end is None:
        if required:
            rep.err(jpath + ".start_line", "缺少必填字段 start_line/end_line")
        return
    if (start is None) != (end is None):
        rep.err(jpath, "start_line 与 end_line 必须同时提供")
        return
    for name, v in (("start_line", start), ("end_line", end)):
        if not isinstance(v, int) or isinstance(v, bool) or v < 1:
            rep.err(jpath + "." + name, "行号必须为正整数,得到 %r" % (v,))
            return
    if start > end:
        rep.err(jpath, "start_line(%d) 大于 end_line(%d)" % (start, end))


def excerpt_ok(rep, jpath, excerpt):
    if excerpt is None:
        return
    if not isinstance(excerpt, str):
        rep.err(jpath, "excerpt 必须是字符串")
        return
    if excerpt.count("\n") + 1 > MAX_EXCERPT_LINES:
        rep.err(jpath, "excerpt 超过 %d 行" % MAX_EXCERPT_LINES)
    if len(excerpt) > MAX_EXCERPT_CHARS:
        rep.err(jpath, "excerpt 超过 %d 字符" % MAX_EXCERPT_CHARS)


def validate_evidence_set(rep, jpath, evidence_ids, evidence_type_by_id, confidence):
    """高置信度结论必须有证据;仅 docs/inference 证据时告警。"""
    if confidence == "high":
        if not evidence_ids:
            rep.err(jpath + ".evidence_ids", "high 置信度结论不允许没有证据")
            return
        weak = [e for e in evidence_ids if evidence_type_by_id.get(e) in ("docs", "inference")]
        if len(weak) == len(evidence_ids):
            rep.warn(jpath + ".evidence_ids", "high 置信度仅有 docs/inference 级证据")


def validate_audit(data, rep: Report, prefix: str = "$") -> Refs:
    if not isinstance(data, dict):
        rep.err(prefix, "audit 必须是 JSON 对象")
        return Refs()

    missing_top = [key for key in ("schema_version", "report_kind", "project", "analysis",
                                   "architecture_nodes", "files", "symbols", "evidence")
                   if key not in data]
    for key in missing_top:
        rep.err(prefix, "缺少必需顶层字段 %s" % key)
    if missing_top:
        return Refs()

    if data.get("schema_version") != "1.0":
        rep.warn(prefix + ".schema_version", "schema_version 不是 '1.0':%r" % data.get("schema_version"))
    rk = data.get("report_kind")
    if rk not in ("single_project", "focused", "comparison"):
        rep.err(prefix + ".report_kind", "report_kind 非法:%r" % rk)
    for key in ("relations", "execution_flows", "state_models", "extension_points",
                "development_recipes", "findings", "unknowns"):
        if key in data and not isinstance(data[key], list):
            rep.err("%s.%s" % (prefix, key), "必须是数组")

    # ---- project ----
    proj = data.get("project")
    pj = prefix + ".project"
    if not isinstance(proj, dict):
        rep.err(pj, "必须是对象")
    else:
        for key in ("id", "name", "root", "analyzed_at", "languages", "project_kind",
                    "project_kind_confidence", "boundaries"):
            if key not in proj:
                rep.err(pj, "缺少必需字段 %s" % key)
        for key in ("languages", "build_systems", "package_managers"):
            if key in proj and not is_str_list(proj[key]):
                rep.err("%s.%s" % (pj, key), "必须是字符串数组")
        if isinstance(proj, dict) and proj.get("project_kind") not in ENUM_PROJECT_KIND:
            rep.warn(pj + ".project_kind", "project_kind 不在建议枚举内:%r" % proj.get("project_kind"))
        check_confidence(rep, pj + ".project_kind_confidence", proj.get("project_kind_confidence", ""))
        if "entry_points" in proj and not isinstance(proj["entry_points"], list):
            rep.err(pj + ".entry_points", "必须是数组")

    # ---- analysis ----
    ana = data.get("analysis")
    aj = prefix + ".analysis"
    if not isinstance(ana, dict):
        rep.err(aj, "必须是对象")
    else:
        for key in ("mode", "runtime_verification", "included_paths", "excluded_paths",
                    "limitations", "warnings", "analyzer_version"):
            if key not in ana:
                rep.err(aj, "缺少必需字段 %s" % key)
        if ana.get("mode") not in ENUM_MODE:
            rep.warn(aj + ".mode", "mode 不在建议枚举 %s 内:%r" % (sorted(ENUM_MODE), ana.get("mode")))
        if ana.get("runtime_verification") not in ("none", "authorized"):
            rep.err(aj + ".runtime_verification",
                    "runtime_verification 非法:%r(允许 none|authorized)" % ana.get("runtime_verification"))
        if ana.get("mode") == "focused" and not ana.get("focus"):
            rep.err(aj + ".focus", "focused 模式必须填写 focus 专题")
        for key in ("focus", "included_paths", "excluded_paths", "limitations", "warnings"):
            if key in ana and not is_str_list(ana[key]):
                rep.err("%s.%s" % (aj, key), "必须是字符串数组")

    # ---- 两个方向都要用的注册表 ----
    refs = Refs()
    files_by_id: dict[str, dict] = {}

    for i, f in enumerate(data["files"]):
        jp = "%s.files[%d]" % (prefix, i)
        if not isinstance(f, dict):
            rep.err(jp, "必须是对象")
            continue
        fid = f.get("id")
        if not is_str(fid) or not ID_RE.match(fid):
            rep.err(jp + ".id", "id 非法:%r" % fid)
            continue
        if fid in refs.files:
            rep.err(jp + ".id", "file id 重复:%s" % fid)
            continue
        if not is_str(f.get("path")):
            rep.err(jp + ".path", "缺少 path")
        refs.files.add(fid)
        files_by_id[fid] = f
    seen_paths: dict[str, str] = {}
    for fid, f in files_by_id.items():
        path = f.get("path")
        if is_str(path):
            if path in seen_paths:
                rep.err("%s.files[id=%s].path" % (prefix, fid),
                        "path 重复(与 id=%s):%s" % (seen_paths[path], path))
            seen_paths[path] = fid
        if "\\" in (path or ""):
            rep.warn("%s.files[id=%s].path" % (prefix, fid), "path 含反斜杠,应使用 / 分隔")

    evidence_type_by_id: dict[str, str] = {}
    for i, ev in enumerate(data["evidence"]):
        jp = "%s.evidence[%d]" % (prefix, i)
        if not isinstance(ev, dict):
            rep.err(jp, "必须是对象")
            continue
        eid = ev.get("id")
        if not is_str(eid) or not ID_RE.match(eid):
            rep.err(jp + ".id", "id 非法:%r" % eid)
            continue
        if eid in evidence_type_by_id:
            rep.err(jp + ".id", "evidence id 重复:%s" % eid)
            continue
        etype = ev.get("type")
        if etype not in ENUM_EVIDENCE_TYPE:
            rep.err(jp + ".type", "type 非法:%r(允许 %s)" % (etype, sorted(ENUM_EVIDENCE_TYPE)))
        else:
            evidence_type_by_id[eid] = etype
        check_confidence(rep, jp + ".confidence", ev.get("confidence", ""))
        if not is_str(ev.get("observation")):
            rep.err(jp + ".observation", "缺少 observation")
        if etype == "inference" and not is_str(ev.get("basis")):
            rep.err(jp + ".basis", "inference 证据必须填写 basis(推断依据)")
        has_lines = ev.get("start_line") is not None or ev.get("end_line") is not None
        if has_lines:
            if not is_str(ev.get("file_id")):
                rep.err(jp + ".file_id", "提供了行号但缺少 file_id")
            check_lines(rep, jp, ev.get("start_line"), ev.get("end_line"), required=False)
        excerpt_ok(rep, jp + ".excerpt", ev.get("excerpt"))

    for i, sym in enumerate(data["symbols"]):
        jp = "%s.symbols[%d]" % (prefix, i)
        if not isinstance(sym, dict):
            rep.err(jp, "必须是对象")
            continue
        sid = sym.get("id")
        if not is_str(sid) or not ID_RE.match(sid):
            rep.err(jp + ".id", "id 非法:%r" % sid)
            continue
        if sid in refs.symbols:
            rep.err(jp + ".id", "symbol id 重复:%s" % sid)
            continue
        refs.symbols.add(sid)
        if sym.get("file_id") not in refs.files:
            rep.err(jp + ".file_id", "引用了不存在的 file id %r" % sym.get("file_id"))
        if sym.get("kind") not in ENUM_SYMBOL_KIND:
            rep.err(jp + ".kind", "kind 非法:%r" % sym.get("kind"))
        if not is_str(sym.get("name")):
            rep.err(jp + ".name", "缺少 name")
        check_lines(rep, jp, sym.get("start_line"), sym.get("end_line"))
        f = files_by_id.get(sym.get("file_id"))
        if f and isinstance(f.get("line_count"), int) and isinstance(sym.get("end_line"), int) \
                and sym["end_line"] > f["line_count"]:
            rep.warn(jp + ".end_line", "行号超出文件行数(file line_count=%d)" % f["line_count"])

    for i, nd in enumerate(data["architecture_nodes"]):
        if not isinstance(nd, dict):
            rep.err("%s.architecture_nodes[%d]" % (prefix, i), "必须是对象")
            continue
        nid = nd.get("id")
        if not is_str(nid) or not ID_RE.match(nid):
            rep.err("%s.architecture_nodes[%d].id" % (prefix, i), "id 非法:%r" % nid)
        elif nid in refs.nodes:
            rep.err("%s.architecture_nodes[%d].id" % (prefix, i), "architecture_node id 重复:%s" % nid)
        else:
            refs.nodes.add(nid)
    for i, nd in enumerate(data["architecture_nodes"]):
        jp = "%s.architecture_nodes[%d]" % (prefix, i)
        if not isinstance(nd, dict):
            continue
        nid = nd.get("id")
        if not is_str(nid) or nid not in refs.nodes:
            continue
        cid = nd.get("canonical_id")
        if not is_str(cid) or not CANONICAL_RE.match(cid):
            rep.err(jp + ".canonical_id", "canonical_id 非法:%r(应如 orch.agent-loop 或 custom.x)" % cid)
        if nd.get("layer") not in ENUM_LAYER:
            rep.err(jp + ".layer", "layer 非法:%r(允许 %s)" % (nd.get("layer"), sorted(ENUM_LAYER)))
        if nd.get("implementation_status") not in ENUM_STATUS_NODE:
            rep.err(jp + ".implementation_status",
                    "implementation_status 非法:%r(允许 %s;partial 仅用于比较矩阵)"
                    % (nd.get("implementation_status"), sorted(ENUM_STATUS_NODE)))
        conf = nd.get("confidence", "")
        check_confidence(rep, jp + ".confidence", conf)
        if not is_str(nd.get("canonical_name")):
            rep.err(jp + ".canonical_name", "缺少 canonical_name")
        if not is_str(nd.get("summary")):
            rep.err(jp + ".summary", "缺少 summary")
        for key, table, what in (
            ("file_ids", refs.files, "file"),
            ("symbol_ids", refs.symbols, "symbol"),
            ("evidence_ids", set(evidence_type_by_id), "evidence"),
            ("upstream_node_ids", refs.nodes, "architecture_node"),
            ("downstream_node_ids", refs.nodes, "architecture_node"),
        ):
            check_id_list(rep, "%s.%s" % (jp, key), nd.get(key), table, what)
        validate_evidence_set(rep, jp, nd.get("evidence_ids"), evidence_type_by_id, conf)
        if not is_str_list(nd.get("project_terms", [])):
            if nd.get("project_terms") is not None:
                rep.err(jp + ".project_terms", "必须是字符串数组")

    for st_entry in data.get("state_models") or []:
        if isinstance(st_entry, dict) and is_str(st_entry.get("id")):
            sid0 = st_entry["id"]
            if sid0 in refs.states:
                continue
            refs.states.add(sid0)
    for i, st in enumerate(data.get("state_models") or []):
        jp = "%s.state_models[%d]" % (prefix, i)
        if not isinstance(st, dict):
            rep.err(jp, "必须是对象")
            continue
        sid = st.get("id")
        if not is_str(sid) or not ID_RE.match(sid):
            rep.err(jp + ".id", "id 非法:%r" % sid)
            continue
        if not is_str(st.get("name")):
            rep.err(jp + ".name", "缺少 name")
        if st.get("mutability") not in ENUM_MUTABILITY:
            rep.warn(jp + ".mutability", "mutability 不在建议枚举内:%r" % st.get("mutability"))
        for key in ("creator_refs", "reader_refs", "writer_refs", "serializer_refs"):
            check_ref_list(rep, "%s.%s" % (jp, key), st.get(key), refs)

    for i, ep in enumerate(data.get("extension_points") or []):
        jp = "%s.extension_points[%d]" % (prefix, i)
        if not isinstance(ep, dict):
            rep.err(jp, "必须是对象")
            continue
        eid = ep.get("id")
        if not is_str(eid) or not ID_RE.match(eid):
            rep.err(jp + ".id", "id 非法:%r" % eid)
            continue
        if eid in refs.extensions:
            rep.err(jp + ".id", "extension_point id 重复:%s" % eid)
            continue
        refs.extensions.add(eid)
        if not is_str(ep.get("name")):
            rep.err(jp + ".name", "缺少 name")
        if ep.get("stability") not in ENUM_STABILITY:
            rep.warn(jp + ".stability", "stability 不在建议枚举内:%r" % ep.get("stability"))
        for key in ("interface_refs", "implementation_refs", "example_refs"):
            check_ref_list(rep, "%s.%s" % (jp, key), ep.get(key), refs)

    # extension_points 注册晚于 nodes,这里补查 nodes 对扩展点的引用
    for i, nd in enumerate(data["architecture_nodes"]):
        if isinstance(nd, dict):
            check_id_list(rep, "%s.architecture_nodes[%d].extension_point_ids" % (prefix, i),
                          nd.get("extension_point_ids"), refs.extensions, "extension_point")

    all_step_ids: set[str] = set()
    for i, fl in enumerate(data.get("execution_flows") or []):
        jp = "%s.execution_flows[%d]" % (prefix, i)
        if not isinstance(fl, dict):
            rep.err(jp, "必须是对象")
            continue
        fid = fl.get("id")
        if not is_str(fid) or not ID_RE.match(fid):
            rep.err(jp + ".id", "id 非法:%r" % fid)
            continue
        if fid in refs.flows:
            rep.err(jp + ".id", "execution_flow id 重复:%s" % fid)
            continue
        refs.flows.add(fid)
        steps = fl.get("steps")
        if not isinstance(steps, list) or not steps:
            rep.err(jp + ".steps", "steps 必须是非空数组")
            steps = steps or []
        orders = []
        for j, s in enumerate(steps):
            sjp = "%s.steps[%d]" % (jp, j)
            if not isinstance(s, dict):
                rep.err(sjp, "必须是对象")
                continue
            sid = s.get("id")
            if not is_str(sid):
                rep.err(sjp + ".id", "缺少 id")
            elif sid in all_step_ids:
                rep.err(sjp + ".id", "step id 重复:%s" % sid)
            else:
                all_step_ids.add(sid)
            if isinstance(s.get("order"), int) and not isinstance(s.get("order"), bool):
                orders.append(s["order"])
            else:
                rep.err(sjp + ".order", "order 必须是整数,得到 %r" % s.get("order"))
            for key, table, what in (
                ("architecture_node_ids", refs.nodes, "architecture_node"),
                ("file_ids", refs.files, "file"),
                ("symbol_ids", refs.symbols, "symbol"),
                ("evidence_ids", set(evidence_type_by_id), "evidence"),
                ("state_reads", refs.states, "state_model"),
                ("state_writes", refs.states, "state_model"),
            ):
                check_id_list(rep, "%s.%s" % (sjp, key), s.get(key), table, what)
        if orders and orders != list(range(1, len(steps) + 1)):
            rep.err(jp + ".steps", "step order 必须是 1..%d 连续递增,得到 %r" % (len(steps), orders))
        conf = fl.get("confidence", "")
        check_confidence(rep, jp + ".confidence", conf)
        validate_evidence_set(rep, jp, fl.get("evidence_ids"), evidence_type_by_id, conf)

    for i, rel in enumerate(data.get("relations") or []):
        jp = "%s.relations[%d]" % (prefix, i)
        if not isinstance(rel, dict):
            rep.err(jp, "必须是对象")
            continue
        rid = rel.get("id")
        if not is_str(rid) or not ID_RE.match(rid):
            rep.err(jp + ".id", "id 非法:%r" % rid)
            continue
        if rel.get("type") not in ENUM_RELATION_TYPE:
            rep.err(jp + ".type", "type 非法:%r" % rel.get("type"))
        for key in ("from_ref", "to_ref"):
            ok, why = refs.resolve(rel.get(key))
            if not ok:
                rep.err("%s.%s" % (jp, key), why)
        check_confidence(rep, jp + ".confidence", rel.get("confidence", ""))
        check_id_list(rep, jp + ".evidence_ids", rel.get("evidence_ids"),
                      set(evidence_type_by_id), "evidence", required=False)

    for i, rc in enumerate(data.get("development_recipes") or []):
        jp = "%s.development_recipes[%d]" % (prefix, i)
        if not isinstance(rc, dict):
            rep.err(jp, "必须是对象")
            continue
        if not is_str(rc.get("id")):
            rep.err(jp + ".id", "缺少 id")
        if not is_str(rc.get("goal")):
            rep.err(jp + ".goal", "缺少 goal")
        if rc.get("risk_level") not in ENUM_RISK:
            rep.err(jp + ".risk_level", "risk_level 非法:%r" % rc.get("risk_level"))
        check_id_list(rep, jp + ".recommended_extension_points",
                      rc.get("recommended_extension_points"), refs.extensions, "extension_point")
        check_id_list(rep, jp + ".files_to_read", rc.get("files_to_read"), refs.files, "file")
        check_id_list(rep, jp + ".symbols_to_implement",
                      rc.get("symbols_to_implement"), refs.symbols, "symbol")
        check_id_list(rep, jp + ".affected_architecture_nodes",
                      rc.get("affected_architecture_nodes"), refs.nodes, "architecture_node")
        check_ref_list(rep, jp + ".reference_implementations",
                       rc.get("reference_implementations"), refs)

    for i, fd in enumerate(data.get("findings") or []):
        jp = "%s.findings[%d]" % (prefix, i)
        if not isinstance(fd, dict):
            rep.err(jp, "必须是对象")
            continue
        if not is_str(fd.get("id")):
            rep.err(jp + ".id", "缺少 id")
        if not is_str(fd.get("title")):
            rep.err(jp + ".title", "缺少 title")
        if fd.get("significance") not in ENUM_SIGNIFICANCE:
            rep.warn(jp + ".significance", "significance 不在建议枚举内:%r" % fd.get("significance"))
        conf = fd.get("confidence", "")
        check_confidence(rep, jp + ".confidence", conf)
        validate_evidence_set(rep, jp, fd.get("evidence_ids"), evidence_type_by_id, conf)
        check_ref_list(rep, jp + ".related_refs", fd.get("related_refs"), refs)

    for i, un in enumerate(data.get("unknowns") or []):
        jp = "%s.unknowns[%d]" % (prefix, i)
        if not isinstance(un, dict):
            rep.err(jp, "必须是对象")
            continue
        if not is_str(un.get("id")):
            rep.err(jp + ".id", "缺少 id")
        for key in ("question", "why_unknown", "impact", "recommended_verification"):
            if not is_str(un.get(key)):
                rep.err("%s.%s" % (jp, key), "缺少 %s" % key)
        for key in ("attempted_checks", "likely_locations"):
            if not is_str_list(un.get(key)):
                rep.err("%s.%s" % (jp, key), "必须是字符串数组")

    if not data["files"]:
        rep.warn(prefix + ".files", "files 为空:审计至少应包含被分析的文件")
    if not data["architecture_nodes"]:
        rep.warn(prefix + ".architecture_nodes", "architecture_nodes 为空")
    return refs


def validate_comparison(data, rep: Report) -> None:
    prefix = "$"
    for key in ("schema_version", "report_kind", "projects", "capability_matrix"):
        if key not in data:
            rep.err(prefix, "comparison 缺少必需顶层字段 %s" % key)
    if not rep.ok:
        return
    if data.get("report_kind") != "comparison":
        rep.err(prefix + ".report_kind", "comparison 文件的 report_kind 必须是 'comparison'")
    projects = data.get("projects")
    project_ids: set[str] = set()
    if not isinstance(projects, list) or not projects:
        rep.err(prefix + ".projects", "projects 必须是非空数组")
        projects = []
    for i, pr in enumerate(projects):
        jp = "%s.projects[%d]" % (prefix, i)
        if not isinstance(pr, dict):
            rep.err(jp, "必须是对象")
            continue
        pid = pr.get("id")
        if not is_str(pid):
            rep.err(jp + ".id", "缺少 id")
        elif pid in project_ids:
            rep.err(jp + ".id", "project id 重复:%s" % pid)
        else:
            project_ids.add(pid)
        if not is_str(pr.get("name")):
            rep.err(jp + ".name", "缺少 name")
        idx = pr.get("audit_index")
        if idx is not None and not (isinstance(idx, int) and 0 <= idx < len(data.get("source_audits") or [])):
            rep.err(jp + ".audit_index", "audit_index 超出 source_audits 范围:%r" % idx)

    audits = data.get("source_audits")
    audits = audits if isinstance(audits, list) else []
    matrix = data.get("capability_matrix")
    if not isinstance(matrix, list):
        rep.err(prefix + ".capability_matrix", "capability_matrix 必须是数组")
        matrix = []
    if not audits:
        rep.warn(prefix + ".source_audits", "未内嵌 source_audits:比较报告将无法浏览各项目细节,refs 也只能告警")
    elif len(audits) != len(projects):
        rep.warn(prefix + ".source_audits", "source_audits 数量(%d)与 projects(%d)不一致" % (len(audits), len(projects)))
    audit_refs: dict[str, Refs] = {}
    embedded_project_ids: dict[int, str] = {}
    for i, a in enumerate(audits):
        refs_i = validate_audit(a, rep, "%s.source_audits[%d]" % (prefix, i))
        audit_refs[i] = refs_i
        pid = a.get("project", {}).get("id") if isinstance(a, dict) else None
        embedded_project_ids[i] = pid

    def resolve_in_project(pid, ref):
        if pid not in project_ids:
            return "error", "project_id 不存在:%r" % pid
        idx = None
        for i, pr in enumerate(projects):
            if isinstance(pr, dict) and pr.get("id") == pid:
                idx = pr.get("audit_index", i)
                break
        if idx in audit_refs:
            ok, why = audit_refs[idx].resolve(ref)
            return ("ok" if ok else "warn"), why
        return "warn", "该项目未内嵌 audit,无法解析 ref:%s" % ref

    for i, row in enumerate(data.get("capability_matrix") or []):
        jp = "%s.capability_matrix[%d]" % (prefix, i)
        if not isinstance(row, dict):
            rep.err(jp, "必须是对象")
            continue
        if not is_str(row.get("concept_id")):
            rep.err(jp + ".concept_id", "缺少 concept_id")
        if not is_str(row.get("concept_name")):
            rep.err(jp + ".concept_name", "缺少 concept_name")
        cells = row.get("cells")
        if not isinstance(cells, list) or not cells:
            rep.err(jp + ".cells", "cells 必须是非空数组")
            continue
        covered = set()
        for j, cell in enumerate(cells):
            cjp = "%s.cells[%d]" % (jp, j)
            if not isinstance(cell, dict):
                rep.err(cjp, "必须是对象")
                continue
            pid = cell.get("project_id")
            if pid not in project_ids:
                rep.err(cjp + ".project_id", "引用了不存在的 project id %r" % pid)
            else:
                covered.add(pid)
            if cell.get("status") not in ENUM_STATUS_CELL:
                rep.err(cjp + ".status", "status 非法:%r(允许 %s)" % (cell.get("status"), sorted(ENUM_STATUS_CELL)))
            cell_refs = cell.get("refs")
            if cell_refs is not None and not isinstance(cell_refs, list):
                rep.err(cjp + ".refs", "refs 必须是数组")
                cell_refs = []
            for r in cell_refs or []:
                level, why = resolve_in_project(pid, r)
                if level == "error":
                    rep.err(cjp + ".refs", why)
                elif level == "warn":
                    rep.warn(cjp + ".refs", why)
        missing = project_ids - covered
        if missing:
            rep.warn(jp + ".cells", "矩阵行未覆盖项目:%s" % ", ".join(sorted(missing)))

    for i, cc in enumerate(data.get("concept_comparisons") or []):
        jp = "%s.concept_comparisons[%d]" % (prefix, i)
        if not isinstance(cc, dict):
            rep.err(jp, "必须是对象")
            continue
        if not is_str(cc.get("concept_id")):
            rep.err(jp + ".concept_id", "缺少 concept_id")
        pp = cc.get("per_project")
        if not isinstance(pp, list) or not pp:
            rep.err(jp + ".per_project", "per_project 必须是非空数组")
            pp = pp or []
        for j, entry in enumerate(pp):
            ejp = "%s.per_project[%d]" % (jp, j)
            if not isinstance(entry, dict):
                rep.err(ejp, "必须是对象")
                continue
            pid = entry.get("project_id")
            if pid not in project_ids:
                rep.err(ejp + ".project_id", "引用了不存在的 project id %r" % pid)
            for r in entry.get("refs") or []:
                level, why = resolve_in_project(pid, r)
                if level == "error":
                    rep.err(ejp + ".refs", why)
                elif level == "warn":
                    rep.warn(ejp + ".refs", why)

    for key, label in (("flow_comparisons", "flow_comparisons"), ("extension_comparisons", "extension_comparisons")):
        for i, item in enumerate(data.get(key) or []):
            jp = "%s.%s[%d]" % (prefix, key, i)
            if not isinstance(item, dict):
                rep.err(jp, "必须是对象")
                continue
            if not is_str(item.get("topic")):
                rep.err(jp + ".topic", "缺少 topic")
            for j, entry in enumerate(item.get("per_project") or []):
                ejp = "%s.per_project[%d]" % (jp, j)
                pid = entry.get("project_id") if isinstance(entry, dict) else None
                if pid not in project_ids:
                    rep.err(ejp + ".project_id", "引用了不存在的 project id %r" % pid)

    for key in ("architectural_differences", "common_patterns", "tradeoffs"):
        for i, item in enumerate(data.get(key) or []):
            jp = "%s.%s[%d]" % (prefix, key, i)
            if not isinstance(item, dict):
                rep.err(jp, "必须是对象")
                continue
            if not is_str(item.get("id")):
                rep.err(jp + ".id", "缺少 id")
            if not is_str(item.get("title")):
                rep.err(jp + ".title", "缺少 title")

    for i, un in enumerate(data.get("unknowns") or []):
        jp = "%s.unknowns[%d]" % (prefix, i)
        if not isinstance(un, dict) or not is_str(un.get("question")) or not is_str(un.get("why_unknown")):
            rep.err(jp, "unknowns 条目必须包含 question 与 why_unknown")


def load(path: str):
    with open(path, "r", encoding="utf-8-sig") as fh:
        return json.load(fh)


def main() -> int:
    ap = argparse.ArgumentParser(description="agent-code-atlas audit/comparison validator")
    ap.add_argument("file", help="audit.json 或 comparison.json 路径")
    ap.add_argument("--strict", action="store_true", help="把告警也当作失败")
    ap.add_argument("--format", choices=["text", "json"], default="text")
    args = ap.parse_args()

    try:
        data = load(args.file)
    except (OSError, json.JSONDecodeError) as e:
        print("error: 无法读取/解析 %s: %s" % (args.file, e), file=sys.stderr)
        return 2

    rep = Report(args.file)
    if isinstance(data, dict) and data.get("report_kind") == "comparison":
        validate_comparison(data, rep)
    else:
        validate_audit(data, rep)

    failed = not rep.ok or (args.strict and rep.warnings)
    if args.format == "json":
        print(json.dumps({
            "ok": not failed,
            "error_count": len(rep.errors),
            "warning_count": len(rep.warnings),
            "errors": [{"path": p, "message": m} for p, m in rep.errors],
            "warnings": [{"path": p, "message": m} for p, m in rep.warnings],
        }, ensure_ascii=False, indent=2))
    else:
        print("%s: %d error(s), %d warning(s)%s" % (args.file, len(rep.errors), len(rep.warnings),
                                                    " [strict]" if args.strict else ""))
        for p, m in rep.errors:
            print("ERROR %s -> %s" % (p, m))
        for p, m in rep.warnings:
            print("WARN  %s -> %s" % (p, m))
        print("result: %s" % ("FAIL" if failed else "PASS"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

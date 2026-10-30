#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""agent-code-atlas | render_report.py — 把 audit.json / comparison.json 渲染为自包含单文件 HTML。

用法:
    python render_report.py <audit.json> --out <report.html>
    python render_report.py <comparison.json> --out <comparison-report.html> --mode comparison

    --mode auto|single|comparison  (默认 auto:按 report_kind 判断)

约束:仅 Python 标准库;模板/CSS/JS 来自 skill 自带 assets/report/(不读外部来源);
CSS、JS、JSON 全部内联;输出 UTF-8、确定性(数据自带时间戳除外);不访问网络。
"""
from __future__ import annotations

import argparse
import html
import json
import sys
from pathlib import Path

ASSETS = Path(__file__).resolve().parent.parent / "assets" / "report"
PLACEHOLDER_CSS = "/*__ATLAS_CSS__*/"
PLACEHOLDER_APP = "/*__ATLAS_APP__*/"
PLACEHOLDER_DATA = "__ATLAS_DATA__"
PLACEHOLDER_TITLE = "__ATLAS_TITLE__"


def encode_data_for_script(data) -> str:
    """序列化为可安全内嵌在 <script type="application/json"> 中的文本。

    JSON 里 '</' 只可能出现在字符串值内,替换为 '<\\/' 后仍是合法 JSON,
    且不会提前终止 script 块;U+2028/U+2029 一并转义。
    """
    s = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    s = s.replace("</", "<\\/")
    s = s.replace(chr(0x2028), "\\u2028").replace(chr(0x2029), "\\u2029")
    return s


def load_assets() -> tuple[str, str, str]:
    template = (ASSETS / "template.html").read_text(encoding="utf-8")
    css = (ASSETS / "styles.css").read_text(encoding="utf-8")
    app = (ASSETS / "app.js").read_text(encoding="utf-8")
    for name, text in (("styles.css", css), ("app.js", app)):
        if "</style" in text or "</script" in text:
            raise SystemExit("error: asset %s contains a closing style/script tag literal" % name)
    for ph in (PLACEHOLDER_CSS, PLACEHOLDER_APP, PLACEHOLDER_DATA, PLACEHOLDER_TITLE):
        if ph not in template:
            raise SystemExit("error: template.html is missing placeholder %s" % ph)
    return template, css, app


def default_title(data: dict, mode: str) -> str:
    if mode == "comparison":
        names = [p.get("name", p.get("id", "?")) for p in data.get("projects", [])
                 if isinstance(p, dict)]
        return "Agent Code Atlas — " + (" vs ".join(names) if names else "Comparison")
    proj = data.get("project", {})
    name = proj.get("name") or "unknown-project"
    return "Agent Code Atlas — %s" % name


def render(data: dict, out_path: Path, mode: str) -> None:
    template, css, app = load_assets()
    title = html.escape(default_title(data, mode), quote=True)
    html_out = (
        template
        .replace(PLACEHOLDER_TITLE, title)
        .replace(PLACEHOLDER_CSS, css)
        .replace(PLACEHOLDER_APP, app)
        .replace(PLACEHOLDER_DATA, encode_data_for_script(data))
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(html_out)
    print("rendered %s (%d bytes)" % (out_path, len(html_out.encode("utf-8"))))


def main() -> int:
    ap = argparse.ArgumentParser(description="agent-code-atlas single-file HTML renderer")
    ap.add_argument("data", help="audit.json 或 comparison.json")
    ap.add_argument("--out", required=True, help="输出 HTML 路径")
    ap.add_argument("--mode", choices=["auto", "single", "comparison"], default="auto")
    args = ap.parse_args()

    try:
        with open(args.data, "r", encoding="utf-8-sig") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError) as e:
        print("error: 无法读取/解析 %s: %s" % (args.data, e), file=sys.stderr)
        return 2
    if not isinstance(data, dict):
        print("error: 输入必须是 JSON 对象", file=sys.stderr)
        return 2

    mode = args.mode
    if mode == "auto":
        mode = "comparison" if data.get("report_kind") == "comparison" else "single"
    if mode == "comparison" and data.get("report_kind") != "comparison":
        print("error: --mode comparison 但输入 report_kind=%r" % data.get("report_kind"),
              file=sys.stderr)
        return 2

    render(data, Path(args.out), mode)
    return 0


if __name__ == "__main__":
    sys.exit(main())

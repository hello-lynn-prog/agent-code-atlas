/* agent-code-atlas | app.js — 交互逻辑。
   约定:所有来自被审计仓库的文本一律通过 DOM API/textContent 注入,不做字符串拼 HTML;
   不使用任何网络 API;路由由 location.hash 驱动,支持浏览器前进/后退。 */
(function () {
  'use strict';

  function byId(id) { return document.getElementById(id); }
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v == null) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v);
      }
    }
    if (kids != null) {
      if (!Array.isArray(kids)) kids = [kids];
      for (var i = 0; i < kids.length; i++) {
        var kid = kids[i];
        if (kid == null) continue;
        el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
      }
    }
    return el;
  }
  function t(v, fb) { return (v == null || v === '') ? (fb == null ? '—' : fb) : String(v); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function debounce(fn, ms) {
    var id = null;
    return function () {
      var self = this, a = arguments;
      clearTimeout(id);
      id = setTimeout(function () { fn.apply(self, a); }, ms);
    };
  }

  /* ---------------- data ---------------- */
  var RAW = JSON.parse(byId('audit-data').textContent);
  var IS_CMP = RAW && RAW.report_kind === 'comparison';
  var AUDITS = IS_CMP ? arr(RAW.source_audits) : [RAW];
  var PROJECTS = IS_CMP ? arr(RAW.projects) : (RAW && RAW.project ? [RAW.project] : []);

  var LAYER_ORDER = ['boundary', 'interface', 'lifecycle', 'orchestration', 'context-state',
    'integration', 'runtime', 'permissions', 'observability', 'extensibility', 'testing'];
  var LAYER_LABEL = { 'boundary': '项目边界', 'interface': '接口与入口', 'lifecycle': '生命周期',
    'orchestration': '编排与控制流', 'context-state': '上下文与状态', 'integration': '模型与工具集成',
    'runtime': '执行运行时', 'permissions': '权限与信任', 'observability': '事件与可观测',
    'extensibility': '扩展机制', 'testing': '测试与示例' };
  var IMPORTANCE_RANK = { core: 0, high: 1, normal: 2, low: 3 };
  var VIEW_IDS = ['overview', 'architecture', 'flows', 'state', 'source', 'extensions',
    'dev', 'comparison', 'unknowns'];

  var idxMap = [];
  function ctx() { return AUDITS[state.project] || AUDITS[0] || (IS_CMP ? null : RAW); }
  function hasCtx() { return !!ctx(); }
  function idx() {
    var a = ctx();
    if (!a) return { nodes: {}, files: {}, symbols: {}, evidence: {}, states: {}, extensions: {},
      flows: {}, nodesByLayer: {}, filesByNode: {}, relFrom: {}, relTo: {} };
    for (var i = 0; i < idxMap.length; i++) { if (idxMap[i].audit === a) return idxMap[i].ix; }
    var ix = { nodes: {}, files: {}, symbols: {}, evidence: {}, states: {}, extensions: {},
      flows: {}, nodesByLayer: {}, filesByNode: {}, relFrom: {}, relTo: {} };
    function reg(list, map) {
      arr(list).forEach(function (x) { if (x && x.id) map[x.id] = x; });
    }
    reg(a.architecture_nodes, ix.nodes);
    reg(a.files, ix.files);
    reg(a.symbols, ix.symbols);
    reg(a.evidence, ix.evidence);
    reg(a.state_models, ix.states);
    reg(a.extension_points, ix.extensions);
    reg(a.execution_flows, ix.flows);
    arr(a.architecture_nodes).forEach(function (n) {
      var l = n.layer || 'other';
      if (!ix.nodesByLayer[l]) ix.nodesByLayer[l] = [];
      ix.nodesByLayer[l].push(n);
      arr(n.file_ids).forEach(function (fid) {
        if (!ix.filesByNode[fid]) ix.filesByNode[fid] = [];
        ix.filesByNode[fid].push(n);
      });
    });
    arr(a.relations).forEach(function (r) {
      if (r && r.from_ref) (ix.relFrom[r.from_ref] = ix.relFrom[r.from_ref] || []).push(r);
      if (r && r.to_ref) (ix.relTo[r.to_ref] = ix.relTo[r.to_ref] || []).push(r);
    });
    idxMap.push({ audit: a, ix: ix });
    return ix;
  }

  var state = {
    view: IS_CMP ? 'comparison' : 'overview',
    sel: null, project: 0, conf: '', status: '',
    tree: 'physical', treeCoreOnly: false, treeHideTests: false, treeHideDocs: false,
    treeHideGenerated: false, coreRelOnly: false, recipe: null,
  };

  /* ---------------- shared widgets ---------------- */
  function statusBadge(st) {
    return h('span', { class: 'badge st-' + st, text: t(st, '?') });
  }
  function confBadge(c) { return h('span', { class: 'conf conf-' + t(c, 'na'), text: t(c) }); }
  function typeChip(tp) {
    var rank = { runtime: 'runtime', test: 'test', code: '', config: '', docs: '', inference: '' };
    return h('span', { class: 'ev-type ev-type-' + tp, text: t(tp) });
  }
  function layerDot(layer) { return h('span', { class: 'dot layer-' + (layer || 'other') }); }

  var toastTimer = null;
  function toast(msg) {
    var el = byId('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2200);
  }
  function copyText(text) {
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (e) { return false; }
    }
    function done(ok) {
      toast((ok ? '已复制:' : '复制失败,请手动复制:') + (text.length > 64 ? text.slice(0, 61) + '…' : text));
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); },
        function () { done(fallback()); });
    } else done(fallback());
  }
  function copyBtn(text, label, title) {
    return h('button', { class: 'btn btn-xs btn-copy', type: 'button', text: label || '复制',
      title: title || text, onclick: function () { copyText(text); } });
  }

  function describeRef(kind, id) {
    var ix = idx();
    if (kind === 'node') { var n = ix.nodes[id]; return n ? n.canonical_name : 'node:' + id; }
    if (kind === 'file') { var f = ix.files[id]; return f ? f.path : 'file:' + id; }
    if (kind === 'symbol') { var s = ix.symbols[id]; return s ? (s.qualified_name || s.name) : 'symbol:' + id; }
    if (kind === 'state') { var m = ix.states[id]; return m ? m.name : 'state:' + id; }
    if (kind === 'extension') { var e = ix.extensions[id]; return e ? e.name : 'extension:' + id; }
    if (kind === 'flow') { var fl = ix.flows[id]; return fl ? fl.name : 'flow:' + id; }
    return kind + ':' + id;
  }
  function refLink(ref, labelOverride) {
    var parts = String(ref).split(':');
    var kind = parts[0];
    var id = parts.slice(1).join(':');
    if (kind === 'external') return h('span', { class: 'chip', text: 'external: ' + id });
    return h('button', { class: 'btn-link', type: 'button', text: labelOverride || describeRef(kind, id),
      onclick: function () { select(kind, id); } });
  }
  function refLinks(refs) {
    return arr(refs).map(function (r) { return refLink(r); });
  }
  function kvRow(dl, label) {
    var dt = h('dt', { text: label });
    var dd = h('dd');
    dl.appendChild(dt); dl.appendChild(dd);
    return dd;
  }
  function kvList(pairs) {
    var dl = h('dl', { class: 'kv' });
    pairs.forEach(function (p) {
      var dd = kvRow(dl, p[0]);
      if (p[1] == null) dd.appendChild(document.createTextNode('—'));
      else if (typeof p[1] === 'string') dd.appendChild(document.createTextNode(p[1]));
      else if (Array.isArray(p[1])) {
        if (!p[1].length) dd.appendChild(document.createTextNode('—'));
        else p[1].forEach(function (item) {
          if (item && item.nodeType) dd.appendChild(item);
          else dd.appendChild(document.createTextNode(String(item)));
          dd.appendChild(document.createTextNode(' '));
        });
      } else dd.appendChild(p[1]);
    });
    return dl;
  }
  function emptyBox(msg) { return h('div', { class: 'empty', text: msg }); }
  function evLocText(ev) {
    var ix = idx();
    var f = ix.files[ev.file_id];
    var base = f ? f.path : (ev.file_id || '');
    if (ev.start_line != null) base += ':' + ev.start_line + (ev.end_line != null && ev.end_line !== ev.start_line ? '-' + ev.end_line : '');
    return base;
  }
  function evidenceCard(ev) {
    var card = h('div', { class: 'ev-card' });
    var head = h('div', { class: 'ev-head' });
    head.appendChild(typeChip(ev.type));
    head.appendChild(confBadge(ev.confidence));
    var loc = evLocText(ev);
    if (loc) {
      head.appendChild(h('span', { class: 'ev-loc', text: loc }));
      if (ev.file_id && ev.start_line != null) head.appendChild(copyBtn(loc, '复制 path:line'));
    }
    card.appendChild(head);
    if (ev.excerpt) card.appendChild(h('pre', { class: 'excerpt', text: ev.excerpt }));
    if (ev.observation) card.appendChild(h('p', { class: 'note', text: ev.observation }));
    if (ev.type === 'inference' && ev.basis) {
      card.appendChild(h('p', { class: 'note', text: '推断依据:' + ev.basis }));
    }
    if (ev.supports) card.appendChild(h('p', { class: 'note', text: '支持:' + ev.supports }));
    return card;
  }
  function evidenceList(ids) {
    var ix = idx();
    var wrap = h('div');
    var list = arr(ids).map(function (id) { return ix.evidence[id]; }).filter(Boolean);
    if (!list.length) { wrap.appendChild(emptyBox('无证据')); return wrap; }
    list.forEach(function (ev) { wrap.appendChild(evidenceCard(ev)); });
    return wrap;
  }

  /* ---------------- navigation / hash ---------------- */
  function sig() {
    return state.view + '|' + (state.sel ? state.sel.kind + ':' + state.sel.id : '') + '|' + state.project;
  }
  function writeHash() {
    var parts = ['view=' + state.view];
    if (state.sel) parts.push('sel=' + encodeURIComponent(state.sel.kind + ':' + state.sel.id));
    if (IS_CMP && state.project) parts.push('project=' + state.project);
    var target = '#' + parts.join('&');
    if (location.hash !== target) location.hash = target;
  }
  function readHash() {
    var m = {};
    location.hash.replace(/^#/, '').split('&').forEach(function (kv) {
      var p = kv.split('=');
      if (p[0]) m[p[0]] = decodeURIComponent(p.slice(1).join('='));
    });
    if (m.view && VIEW_IDS.indexOf(m.view) >= 0) state.view = m.view;
    if (m.sel) {
      var q = m.sel.split(':');
      if (q.length >= 2) state.sel = { kind: q[0], id: q.slice(1).join(':') };
    }
    if (m.project) {
      var pi = parseInt(m.project, 10);
      if (!isNaN(pi) && pi >= 0 && pi < AUDITS.length) state.project = pi;
    }
  }
  window.addEventListener('hashchange', function () {
    var before = sig();
    readHash();
    if (sig() !== before) renderAll();
  });

  function select(kind, id, view) {
    state.sel = { kind: kind, id: id };
    if (view) state.view = view;
    renderAll();
    writeHash();
    var dp = byId('details');
    if (dp) {
      dp.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
      dp.classList.remove('flash');
      void dp.offsetWidth;
      dp.classList.add('flash');
      setTimeout(function () { dp.classList.remove('flash'); }, 1000);
    }
  }
  function clearSel() {
    state.sel = null;
    renderAll();
    writeHash();
  }

  /* ---------------- filters ---------------- */
  function nodeVisible(n) {
    if (state.conf && n.confidence !== state.conf) return false;
    if (state.status && n.implementation_status !== state.status) return false;
    return true;
  }
  function filtersActive() { return !!(state.conf || state.status); }

  /* ---------------- tabs / topbar / status ---------------- */
  var TABS = [['overview', 'Overview'], ['architecture', 'Architecture'], ['flows', 'Runtime Flows'],
    ['state', 'State & Data'], ['source', 'Source Index'], ['extensions', 'Extensions'],
    ['dev', 'Development Guide'], ['comparison', 'Comparison'], ['unknowns', 'Unknowns']];
  function renderTabs() {
    var nav = byId('tabs');
    nav.textContent = '';
    TABS.forEach(function (tb) {
      var locked = tb[0] === 'comparison' && !IS_CMP;
      var b = h('button', {
        class: 'tab-btn' + (state.view === tb[0] ? ' active' : ''), type: 'button', text: tb[1],
        title: locked ? '本报告为单项目审计,无比较数据。用比较模式生成 comparison.json 后可查看。' : '',
      });
      if (locked) {
        b.disabled = true;
      } else {
        b.addEventListener('click', function () {
          state.view = tb[0];
          renderAll();
          writeHash();
        });
      }
      nav.appendChild(b);
    });
    nav.setAttribute('role', 'tablist');
  }
  function renderTopbar() {
    var a = ctx();
    var proj = (a && a.project) || {};
    var titleEl = byId('proj-title');
    var metaEl = byId('proj-meta');
    titleEl.textContent = IS_CMP ? ('多项目比较(' + PROJECTS.length + ')') : t(proj.name, '未命名项目');
    var bits = [];
    if (IS_CMP) {
      if (a && a.project) bits.push('当前:' + t(a.project.name));
    } else {
      if (proj.project_kind) bits.push(proj.project_kind);
      if (proj.revision) bits.push(String(proj.revision).slice(0, 12));
      if (arr(proj.languages).length) bits.push(arr(proj.languages).slice(0, 4).join('/'));
      if (proj.analyzed_at) bits.push(String(proj.analyzed_at).replace('T', ' ').slice(0, 19));
    }
    metaEl.textContent = bits.join(' · ');

    var sw = byId('project-switcher');
    sw.textContent = '';
    if (IS_CMP && AUDITS.length > 1) {
      var sel = h('select', { 'aria-label': '切换项目' });
      AUDITS.forEach(function (au, i) {
        var p = au.project || {};
        sel.appendChild(h('option', { value: String(i), text: (i + 1) + '. ' + t(p.name, '项目' + (i + 1)) }));
      });
      sel.value = String(state.project);
      sel.addEventListener('change', function () {
        state.project = parseInt(this.value, 10) || 0;
        state.sel = null;
        renderAll();
        writeHash();
      });
      sw.appendChild(sel);
    }
  }
  function renderStatus() {
    var a = ctx();
    var ix = idx();
    var f = [];
    if (state.conf) f.push('置信度=' + state.conf);
    if (state.status) f.push('状态=' + state.status);
    byId('status-filters').textContent = f.length ? ('过滤:' + f.join(' · ')) : '无过滤';
    if (hasCtx()) {
      byId('status-counts').textContent =
        arr(a.architecture_nodes).length + ' 节点 · ' + arr(a.files).length + ' 文件 · ' +
        arr(a.symbols).length + ' 符号 · ' + arr(a.evidence).length + ' 证据 · ' +
        arr(a.unknowns).length + ' 未确认';
      var ana = a.analysis || {};
      byId('status-version').textContent =
        t(ana.analyzer_version, '') + ' · schema ' + t(a.schema_version, '?') +
        (ana.runtime_verification === 'authorized' ? ' · runtime verification 已授权' : '');
    } else {
      byId('status-counts').textContent = '未内嵌项目审计数据';
      byId('status-version').textContent = t(RAW && RAW.analyzer_version, '') + ' · schema ' + t(RAW && RAW.schema_version, '?');
    }
  }

  /* ---------------- tree ---------------- */
  function fileVisible(f) {
    var ix = idx();
    if (state.treeCoreOnly && f.importance !== 'core' && f.importance !== 'high') return false;
    if (state.treeHideTests && f.test) return false;
    if (state.treeHideDocs && f.documentation) return false;
    if (state.treeHideGenerated && f.generated) return false;
    if (filtersActive()) {
      var nodes = arr(f.architecture_node_ids).map(function (id) { return ix.nodes[id]; }).filter(Boolean);
      return nodes.some(nodeVisible);
    }
    return true;
  }
  function fileRow(f) {
    var ix = idx();
    var nodes = arr(f.architecture_node_ids).map(function (id) { return ix.nodes[id]; }).filter(Boolean);
    var row = h('div', {
      class: 'tree-row' + (state.sel && state.sel.kind === 'file' && state.sel.id === f.id ? ' selected' : ''),
      'data-path': f.path, title: f.path, tabindex: '0', role: 'treeitem',
    });
    row.appendChild(h('span', { class: 'dot layer-' + (nodes.length ? (nodes[0].layer || 'other') : 'none'),
      title: nodes.map(function (n) { return n.canonical_name; }).join(', ') || '无架构职责' }));
    row.appendChild(h('span', { class: 'file-name', text: String(f.path).split('/').pop() }));
    if (f.importance === 'core') row.appendChild(h('span', { class: 'tag tag-core', text: 'core' }));
    if (f.test) row.appendChild(h('span', { class: 'tag', text: 'test' }));
    if (f.documentation) row.appendChild(h('span', { class: 'tag', text: 'doc' }));
    if (f.generated) row.appendChild(h('span', { class: 'tag', text: 'gen' }));
    function pick() { select('file', f.id); }
    row.addEventListener('click', pick);
    row.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
    });
    return row;
  }
  function physicalTree(files) {
    var root = { dirs: {}, files: [] };
    files.forEach(function (f) {
      var parts = String(f.path).split('/');
      var node = root;
      for (var i = 0; i < parts.length - 1; i++) {
        if (!node.dirs[parts[i]]) node.dirs[parts[i]] = { dirs: {}, files: [] };
        node = node.dirs[parts[i]];
      }
      node.files.push(f);
    });
    function build(dnode, container, depth) {
      Object.keys(dnode.dirs).sort().forEach(function (name) {
        var d = dnode.dirs[name];
        var det = h('details', { class: 'tree-dir', open: depth < 1 });
        det.appendChild(h('summary', { text: name + '/' }));
        var kids = h('div');
        build(d, kids, depth + 1);
        det.appendChild(kids);
        container.appendChild(det);
      });
      dnode.files.sort(function (a, b) { return a.path < b.path ? -1 : 1; }).forEach(function (f) {
        container.appendChild(fileRow(f));
      });
    }
    var wrap = h('div', { class: 'tree' });
    build(root, wrap, 0);
    return wrap;
  }
  function logicalTree() {
    var ix = idx();
    var wrap = h('div', { class: 'tree' });
    var layers = Object.keys(ix.nodesByLayer).sort(function (a, b) {
      return LAYER_ORDER.indexOf(a) - LAYER_ORDER.indexOf(b);
    });
    if (!layers.length) { wrap.appendChild(emptyBox('无架构节点')); return wrap; }
    layers.forEach(function (layer) {
      var det = h('details', { class: 'tree-dir', open: true });
      var sum = h('summary');
      sum.appendChild(layerDot(layer));
      sum.appendChild(document.createTextNode(' ' + (LAYER_LABEL[layer] || layer)));
      det.appendChild(sum);
      var kids = h('div');
      ix.nodesByLayer[layer].filter(nodeVisible).forEach(function (n) {
        var row = h('div', {
          class: 'tree-row node-row' + (state.sel && state.sel.kind === 'node' && state.sel.id === n.id ? ' selected' : ''),
          'data-path': n.canonical_id, tabindex: '0',
        });
        row.appendChild(layerDot(n.layer));
        row.appendChild(h('span', { class: 'file-name', text: n.canonical_name }));
        row.appendChild(h('span', { class: 'tag', text: t(n.implementation_status, '?') }));
        function pick() { select('node', n.id, 'architecture'); }
        row.addEventListener('click', pick);
        row.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
        });
        kids.appendChild(row);
        arr(n.file_ids).forEach(function (fid) {
          var f = ix.files[fid];
          if (f && fileVisible(f)) kids.appendChild(fileRow(f));
        });
      });
      det.appendChild(kids);
      wrap.appendChild(det);
    });
    return wrap;
  }
  function renderTree() {
    var cont = byId('tree-container');
    cont.textContent = '';
    if (!hasCtx()) { cont.appendChild(emptyBox('比较报告未内嵌 source_audits,无法浏览项目树。')); return; }
    var files = arr(ctx().files).filter(fileVisible);
    if (state.tree === 'physical') {
      if (!files.length) { cont.appendChild(emptyBox('无匹配文件(调整过滤条件)')); return; }
      cont.appendChild(physicalTree(files));
    } else {
      cont.appendChild(logicalTree());
    }
    byId('tree-tab-physical').classList.toggle('active', state.tree === 'physical');
    byId('tree-tab-logical').classList.toggle('active', state.tree === 'logical');
  }

  /* ---------------- overview ---------------- */
  var KEY_CONCEPTS = [
    ['entry.cli', 'CLI 入口'], ['entry.sdk-api', 'SDK 公共 API'], ['entry.http-rpc', 'HTTP/RPC 入口'],
    ['orch.agent-loop', 'Agent Loop'], ['model.provider-abstraction', '模型供应商抽象'],
    ['model.client', '模型客户端'], ['tool.registry', '工具注册表'], ['tool.dispatch', '工具分派'],
    ['exec.executor', '执行运行时'], ['exec.sandbox', '沙箱'], ['perm.authorization', '权限判定'],
    ['state.checkpoint', 'Checkpoint'], ['state.memory', '记忆'], ['tool.mcp', 'MCP 集成'],
    ['ext.plugin-system', '插件系统'], ['orch.subagent', '子智能体'],
  ];
  function findNodeByCanonical(ix, cid) {
    var ids = Object.keys(ix.nodes);
    for (var i = 0; i < ids.length; i++) { if (ix.nodes[ids[i]].canonical_id === cid) return ix.nodes[ids[i]]; }
    return null;
  }
  function renderOverview(sec) {
    var a = ctx(), ix = idx(), proj = a.project || {}, ana = a.analysis || {};
    var head = h('div', { class: 'flow-head' });
    head.appendChild(h('h2', { text: t(proj.name) }));
    head.appendChild(statusBadge(proj.project_kind || 'unknown'));
    head.appendChild(confBadge(proj.project_kind_confidence));
    sec.appendChild(head);
    var meta = [];
    if (proj.revision) meta.push('revision ' + String(proj.revision).slice(0, 12));
    if (proj.root) meta.push(proj.root);
    if (arr(proj.languages).length) meta.push('语言:' + arr(proj.languages).join(', '));
    if (proj.analyzed_at) meta.push('审计于 ' + proj.analyzed_at);
    if (ana.mode === 'focused') meta.push('聚焦审计:' + arr(ana.focus).join(', '));
    meta.push(ana.runtime_verification === 'authorized' ? 'runtime verification:已授权' : 'runtime verification:未执行');
    sec.appendChild(h('p', { class: 'note', text: meta.join(' · ') }));

    var b = proj.boundaries || {};
    sec.appendChild(h('h3', { text: '项目边界' }));
    var bc = h('div', { class: 'cards' });
    [['本仓库负责', arr(b.owns)], ['委托给外部/宿主', arr(b.delegates)], ['设计上不提供', arr(b.out_of_scope)]]
      .forEach(function (pair) {
        var card = h('div', { class: 'card' });
        card.appendChild(h('h4', { text: pair[0] }));
        card.appendChild(h('ul', { class: 'list-plain' },
          pair[1].map(function (x) { return h('li', { text: String(x) }); })));
        bc.appendChild(card);
      });
    sec.appendChild(bc);

    sec.appendChild(h('h3', { text: '核心能力' }));
    var cc = h('div', { class: 'cards' });
    KEY_CONCEPTS.forEach(function (pair) {
      var n = findNodeByCanonical(ix, pair[0]);
      var card = h('div', { class: 'card' });
      var title = h('h4');
      title.appendChild(document.createTextNode(pair[1]));
      card.appendChild(title);
      if (n) {
        var chips = h('div');
        chips.appendChild(statusBadge(n.implementation_status));
        chips.appendChild(document.createTextNode(' '));
        chips.appendChild(confBadge(n.confidence));
        card.appendChild(chips);
        card.appendChild(h('p', { class: 'muted', text: t(n.summary, '') }));
        var more = h('button', { class: 'btn btn-xs', type: 'button', text: '查看证据' });
        more.addEventListener('click', function () { select('node', n.id, 'architecture'); });
        card.appendChild(more);
      } else {
        card.appendChild(h('p', { class: 'muted', text: '本次审计未识别(可能 absent/unknown 或不在范围)' }));
      }
      cc.appendChild(card);
    });
    sec.appendChild(cc);

    sec.appendChild(h('h3', { text: '推荐阅读顺序' }));
    var readIds = ['entry.sdk-api', 'entry.cli', 'orch.agent-loop', 'model.provider-abstraction',
      'tool.registry', 'tool.dispatch', 'exec.executor'];
    var readList = h('ol', { class: 'list-plain' });
    readIds.forEach(function (cid) {
      var n = findNodeByCanonical(ix, cid);
      if (!n) return;
      var li = h('li');
      li.appendChild(refLink('node:' + n.id, n.canonical_name));
      var ix2 = idx();
      var files = arr(n.file_ids).map(function (fid) { return ix2.files[fid]; }).filter(Boolean);
      if (files.length) {
        li.appendChild(document.createTextNode(' — ' + files.map(function (f) { return f.path; }).join(', ')));
      }
      readList.appendChild(li);
    });
    if (!readList.childNodes.length) readList.appendChild(h('li', { text: '未识别入口与循环' }));
    sec.appendChild(readList);

    sec.appendChild(h('h3', { text: '关键发现' }));
    var fds = arr(a.findings).slice(0).sort(function (x, y) {
      var r = { critical: 0, major: 1, minor: 2, info: 3 };
      return (r[x.significance] || 9) - (r[y.significance] || 9);
    }).slice(0, 6);
    if (!fds.length) sec.appendChild(h('p', { class: 'note', text: '无 findings。' }));
    var fc = h('div', { class: 'cards' });
    fds.forEach(function (fd) {
      var card = h('div', { class: 'card' });
      card.appendChild(h('h4', { text: t(fd.title) }));
      card.appendChild(h('p', { class: 'muted', text: t(fd.summary) + ' [' + t(fd.significance) + '/' + t(fd.confidence) + ']' }));
      fc.appendChild(card);
    });
    sec.appendChild(fc);

    sec.appendChild(h('h3', { text: '置信度概览' }));
    var nodes = arr(a.architecture_nodes);
    function bar(label, count, color) {
      var row = h('div', { class: 'bar-row' });
      row.appendChild(h('span', { class: 'bar-label', text: label }));
      var track = h('div', { class: 'bar-track' });
      var pct = nodes.length ? Math.round(count * 100 / nodes.length) : 0;
      track.appendChild(h('div', { class: 'bar-fill', style: 'width:' + pct + '%;background:' + color }));
      row.appendChild(track);
      row.appendChild(h('span', { class: 'bar-num', text: String(count) }));
      return row;
    }
    var cssVar = getComputedStyle(document.documentElement);
    ['implemented', 'delegated', 'unknown', 'absent'].forEach(function (st) {
      var count = nodes.filter(function (n) { return n.implementation_status === st; }).length;
      sec.appendChild(bar(st, count, cssVar.getPropertyValue('--st-' + st).trim() || '#888'));
    });
    ['high', 'medium', 'low'].forEach(function (cf) {
      var count = nodes.filter(function (n) { return n.confidence === cf; }).length;
      sec.appendChild(bar('conf:' + cf, count, cssVar.getPropertyValue('--accent').trim() || '#888'));
    });

    sec.appendChild(h('h3', { text: '分析范围与限制' }));
    var lims = arr(ana.limitations).concat(arr(ana.warnings));
    sec.appendChild(lims.length ? h('ul', { class: 'list-plain' },
      lims.map(function (x) { return h('li', { text: String(x) }); }))
      : h('p', { class: 'note', text: '无特别限制记录。' }));
  }

  /* ---------------- architecture ---------------- */
  function nodeNeighbors(n) {
    var up = {}, down = {};
    arr(n.upstream_node_ids).forEach(function (id) { up[id] = true; });
    arr(n.downstream_node_ids).forEach(function (id) { down[id] = true; });
    arr(ctx().relations).forEach(function (r) {
      var from = String(r.from_ref || ''), to = String(r.to_ref || '');
      var meNode = 'node:' + n.id;
      if (to === meNode && from.indexOf('node:') === 0) up[from.slice(5)] = true;
      if (from === meNode && to.indexOf('node:') === 0) down[to.slice(5)] = true;
    });
    return { up: Object.keys(up), down: Object.keys(down) };
  }
  function renderArchitecture(sec) {
    var a = ctx(), ix = idx();
    var bar = h('div', { class: 'arch-toolbar' });
    var coreCb = h('input', { type: 'checkbox', id: 'core-rel-only' });
    coreCb.checked = state.coreRelOnly;
    coreCb.addEventListener('change', function () { state.coreRelOnly = this.checked; renderView(); });
    var lbl = h('label', {}, [coreCb, ' 仅核心关系(两端 implemented 且置信度 ≥ medium)']);
    bar.appendChild(lbl);
    bar.appendChild(h('span', { text: '点击节点查看证据;蓝框=上游,绿框=下游。' }));
    sec.appendChild(bar);

    var layers = LAYER_ORDER.filter(function (l) { return (ix.nodesByLayer[l] || []).length; });
    var extra = Object.keys(ix.nodesByLayer).filter(function (l) { return LAYER_ORDER.indexOf(l) < 0; });
    layers = layers.concat(extra);
    if (!layers.length) { sec.appendChild(emptyBox('无架构节点。')); return; }
    var selNode = state.sel && state.sel.kind === 'node' ? ix.nodes[state.sel.id] : null;
    var nb = selNode ? nodeNeighbors(selNode) : { up: [], down: [] };
    var cols = h('div', { class: 'arch-columns' });
    layers.forEach(function (layer) {
      var col = h('div', { class: 'arch-col' });
      var hd = h('h4');
      hd.appendChild(layerDot(layer));
      hd.appendChild(document.createTextNode(' ' + (LAYER_LABEL[layer] || layer)));
      col.appendChild(hd);
      ix.nodesByLayer[layer].forEach(function (n) {
        var card = h('div', {
          class: 'node-card conf-border-' + t(n.confidence, 'na') +
            (selNode && n.id === selNode.id ? ' selected' : '') +
            (nb.up.indexOf(n.id) >= 0 ? ' hl-up' : '') +
            (nb.down.indexOf(n.id) >= 0 ? ' hl-down' : '') +
            (!nodeVisible(n) ? ' dim' : ''),
        });
        card.setAttribute('data-node', n.id);
        var name = h('div', { class: 'nc-name', text: n.canonical_name });
        card.appendChild(name);
        if (arr(n.project_terms).length) {
          card.appendChild(h('div', { class: 'nc-terms', text: '项目术语:' + arr(n.project_terms).join(', ') }));
        }
        var meta = h('div', { class: 'nc-meta' });
        meta.appendChild(statusBadge(n.implementation_status));
        meta.appendChild(confBadge(n.confidence));
        meta.appendChild(h('span', { class: 'tag', text: arr(n.evidence_ids).length + ' 证据' }));
        card.appendChild(meta);
        var files = arr(n.file_ids).map(function (fid) { return ix.files[fid]; }).filter(Boolean);
        if (files.length) card.appendChild(h('div', { class: 'nc-files',
          text: files.map(function (f) { return f.path; }).join(' · ') }));
        card.addEventListener('click', function () { select('node', n.id, 'architecture'); });
        col.appendChild(card);
      });
      cols.appendChild(col);
    });
    sec.appendChild(cols);
    if (filtersActive()) {
      sec.appendChild(h('p', { class: 'note', text: '注意:置信度/状态过滤已应用,不符合的节点被淡化显示(不隐藏,便于观察上下游)。' }));
    }
  }

  /* ---------------- flows ---------------- */
  function renderFlows(sec) {
    var a = ctx(), ix = idx();
    var flows = arr(a.execution_flows);
    if (!flows.length) { sec.appendChild(emptyBox('未定义执行链路。')); return; }
    flows.forEach(function (fl) {
      var block = h('div', { class: 'flow-block' });
      var head = h('div', { class: 'flow-head' });
      head.appendChild(h('h3', { text: t(fl.name), style: 'margin:0' }));
      head.appendChild(h('span', { class: 'chip', text: t(fl.category) }));
      head.appendChild(confBadge(fl.confidence));
      block.appendChild(head);
      block.appendChild(h('p', { class: 'note', text: t(fl.summary, '') }));
      block.appendChild(kvList([
        ['触发', t(fl.trigger, '')],
        ['终止', t(fl.termination, '')],
        ['证据', evidenceList(fl.evidence_ids)],
      ]));
      arr(fl.steps).slice().sort(function (x, y) { return (x.order || 0) - (y.order || 0); })
        .forEach(function (s) {
          var det = h('details', { class: 'step' });
          var sum = h('summary');
          sum.appendChild(h('span', { class: 'step-no', text: String(s.order) + '.' }));
          sum.appendChild(h('span', { class: 'step-title', text: t(s.title) }));
          if (s.actor) sum.appendChild(h('span', { class: 'step-actor', text: '↳ ' + s.actor }));
          det.appendChild(sum);
          var body = h('div');
          body.appendChild(kvList([
            ['输入', t(s.input, '')],
            ['输出', t(s.output, '')],
            ['读取状态', refLinks(arr(s.state_reads).map(function (id) { return 'state:' + id; }))],
            ['写入状态', refLinks(arr(s.state_writes).map(function (id) { return 'state:' + id; }))],
            ['发出事件', arr(s.events_emitted).join(', ') || null],
            ['分支', t(s.branching, '')],
            ['错误', arr(s.errors).join('; ') || null],
            ['架构节点', refLinks(arr(s.architecture_node_ids).map(function (id) { return 'node:' + id; }))],
            ['文件', refLinks(arr(s.file_ids).map(function (id) { return 'file:' + id; }))],
            ['符号', refLinks(arr(s.symbol_ids).map(function (id) { return 'symbol:' + id; }))],
          ]));
          var evs = arr(s.evidence_ids);
          if (evs.length) body.appendChild(evidenceList(evs));
          det.appendChild(body);
          block.appendChild(det);
        });
      sec.appendChild(block);
    });
  }

  /* ---------------- state view ---------------- */
  function renderState(sec) {
    var a = ctx();
    var sts = arr(a.state_models);
    if (!sts.length) { sec.appendChild(emptyBox('未定义状态模型。')); return; }
    var grid = h('div', { class: 'cards' });
    sts.forEach(function (st) {
      var card = h('div', { class: 'card' });
      var hd = h('h4');
      hd.appendChild(document.createTextNode(t(st.name)));
      card.appendChild(hd);
      card.appendChild(h('p', { class: 'muted', text: '项目术语:' + t(st.project_term) + ' · 类别:' + t(st.category) }));
      card.appendChild(h('p', { class: 'muted', text: t(st.summary, '') }));
      card.appendChild(kvList([
        ['可变性', t(st.mutability)],
        ['生命周期', t(st.lifetime)],
        ['持久化', t(st.persistence)],
        ['创建者', refLinks(arr(st.creator_refs))],
        ['读取者', refLinks(arr(st.reader_refs))],
        ['写入者', refLinks(arr(st.writer_refs))],
        ['序列化', refLinks(arr(st.serializer_refs))],
      ]));
      if (arr(st.fields).length) {
        var tbl = h('table', { class: 'mini-table' });
        tbl.appendChild(h('thead', {}, [h('tr', {}, [h('th', { text: '字段' }), h('th', { text: '类型' }), h('th', { text: '说明' })])]));
        var tb = h('tbody');
        arr(st.fields).forEach(function (f) {
          tb.appendChild(h('tr', {}, [
            h('td', { text: t(f.name) }), h('td', { text: t(f.type, '') }), h('td', { text: t(f.summary, '') }),
          ]));
        });
        tbl.appendChild(tb);
        card.appendChild(tbl);
      }
      var evs = arr(st.evidence_ids);
      if (evs.length) card.appendChild(evidenceList(evs));
      grid.appendChild(card);
    });
    sec.appendChild(grid);
  }

  /* ---------------- source index ---------------- */
  var sourceSort = { key: 'path', dir: 1 };
  function renderSource(sec) {
    var a = ctx(), ix = idx();
    var wrap = h('div');
    var filterInput = h('input', { type: 'search', placeholder: '过滤路径 / 摘要…' });
    wrap.appendChild(filterInput);
    sec.appendChild(wrap);
    var tableWrap = h('div', { class: 'table-wrap' });
    sec.appendChild(tableWrap);
    function draw(q) {
      tableWrap.textContent = '';
      var rows = arr(a.files).filter(function (f) {
        if (filtersActive()) {
          var nodes = arr(f.architecture_node_ids).map(function (id) { return ix.nodes[id]; }).filter(Boolean);
          if (!nodes.some(nodeVisible)) return false;
        }
        if (!q) return true;
        var hay = (f.path + ' ' + t(f.summary, '')).toLowerCase();
        return hay.indexOf(q) >= 0;
      });
      rows.sort(function (x, y) {
        var vx, vy;
        if (sourceSort.key === 'path') { vx = x.path; vy = y.path; }
        else if (sourceSort.key === 'language') { vx = t(x.language, ''); vy = t(y.language, ''); }
        else if (sourceSort.key === 'importance') {
          vx = IMPORTANCE_RANK[x.importance] != null ? IMPORTANCE_RANK[x.importance] : 9;
          vy = IMPORTANCE_RANK[y.importance] != null ? IMPORTANCE_RANK[y.importance] : 9;
        } else if (sourceSort.key === 'roles') { vx = arr(x.architecture_node_ids).length; vy = arr(y.architecture_node_ids).length; }
        else if (sourceSort.key === 'symbols') { vx = arr(x.symbol_ids).length; vy = arr(y.symbol_ids).length; }
        else { vx = arr(x.evidence_ids).length; vy = arr(y.evidence_ids).length; }
        if (vx < vy) return -1 * sourceSort.dir;
        if (vx > vy) return 1 * sourceSort.dir;
        return x.path < y.path ? -1 : 1;
      });
      if (!rows.length) { tableWrap.appendChild(emptyBox('无匹配文件。')); return; }
      var table = h('table', { class: 'tbl' });
      var cols = [['path', '路径'], ['language', '语言'], ['summary', '职责摘要'], ['roles', '架构角色'],
        ['symbols', '关键符号'], ['importance', '重要度'], ['evidence', '证据数']];
      var thead = h('thead');
      var trh = h('tr');
      cols.forEach(function (c) {
        var th = h('th', { text: c[1] + (sourceSort.key === c[0] ? (sourceSort.dir > 0 ? ' ↑' : ' ↓') : '') });
        th.addEventListener('click', function () {
          if (sourceSort.key === c[0]) sourceSort.dir = -sourceSort.dir;
          else { sourceSort.key = c[0]; sourceSort.dir = 1; }
          draw(q);
        });
        trh.appendChild(th);
      });
      thead.appendChild(trh);
      table.appendChild(thead);
      var tb = h('tbody');
      rows.forEach(function (f) {
        var tr = h('tr', { style: 'cursor:pointer' });
        var pathCell = h('td', { class: 'wrap' });
        var pbtn = h('button', { class: 'btn-link', type: 'button', text: f.path });
        pbtn.addEventListener('click', function () { select('file', f.id, 'source'); });
        pathCell.appendChild(pbtn);
        pathCell.appendChild(copyBtn(f.path, '⧉'));
        tr.appendChild(pathCell);
        tr.appendChild(h('td', { text: t(f.language, '') }));
        tr.appendChild(h('td', { class: 'wrap', text: t(f.summary, '') }));
        var roles = h('td', { class: 'wrap' });
        arr(f.architecture_node_ids).forEach(function (id) {
          var n = ix.nodes[id];
          if (n) roles.appendChild(refLink('node:' + id));
          if (n) roles.appendChild(document.createTextNode(' '));
        });
        tr.appendChild(roles);
        var syms = h('td', { class: 'wrap' });
        arr(f.symbol_ids).forEach(function (id) {
          var s = ix.symbols[id];
          if (s) {
            syms.appendChild(refLink('symbol:' + id));
            syms.appendChild(document.createTextNode(' '));
          }
        });
        tr.appendChild(syms);
        tr.appendChild(h('td', { text: t(f.importance, '') }));
        tr.appendChild(h('td', { class: 'num', text: String(arr(f.evidence_ids).length) }));
        tr.addEventListener('click', function (e) {
          if (e.target && e.target.tagName === 'BUTTON') return;
          select('file', f.id, 'source');
        });
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      tableWrap.appendChild(table);
    }
    draw('');
    filterInput.addEventListener('input', debounce(function () {
      draw(this.value.trim().toLowerCase());
    }, 160));
  }

  /* ---------------- extensions ---------------- */
  function renderExtensions(sec) {
    var a = ctx();
    var eps = arr(a.extension_points);
    if (!eps.length) { sec.appendChild(emptyBox('未识别扩展点。')); return; }
    var grid = h('div', { class: 'cards' });
    eps.forEach(function (ep) {
      var card = h('div', { class: 'card' });
      card.appendChild(h('h4', { text: t(ep.name) }));
      var chips = h('div');
      chips.appendChild(h('span', { class: 'chip', text: t(ep.category) }));
      chips.appendChild(h('span', { class: 'chip', text: ep.public ? 'public' : 'internal' }));
      chips.appendChild(h('span', { class: 'chip', text: '稳定性:' + t(ep.stability) }));
      card.appendChild(chips);
      card.appendChild(kvList([
        ['注册方式', t(ep.registration_method, '')],
        ['接口', refLinks(arr(ep.interface_refs))],
        ['参考实现', refLinks(arr(ep.implementation_refs))],
        ['示例', refLinks(arr(ep.example_refs))],
        ['约束', t(ep.constraints, '')],
      ]));
      var evs = arr(ep.evidence_ids);
      if (evs.length) card.appendChild(evidenceList(evs));
      grid.appendChild(card);
    });
    sec.appendChild(grid);
  }

  /* ---------------- development guide ---------------- */
  function renderDev(sec) {
    var a = ctx(), ix = idx();
    var rcs = arr(a.development_recipes);
    if (!rcs.length) { sec.appendChild(emptyBox('未提供开发配方。')); return; }
    if (!state.recipe || !rcs.some(function (r) { return r.id === state.recipe; })) state.recipe = rcs[0].id;
    var split = h('div', { class: 'section-split' });
    var nav = h('div');
    rcs.forEach(function (rc) {
      var item = h('button', { class: 'recipe-item' + (rc.id === state.recipe ? ' active' : ''), type: 'button' });
      item.appendChild(h('div', { text: t(rc.goal), style: 'font-weight:600' }));
      var riskColor = { low: 'var(--st-implemented)', medium: 'var(--st-partial)', high: 'var(--st-absent)' };
      item.appendChild(h('span', { class: 'tag', text: 'risk:' + t(rc.risk_level),
        style: 'color:' + (riskColor[rc.risk_level] || 'inherit') + ';border-color:' + (riskColor[rc.risk_level] || 'inherit') }));
      item.addEventListener('click', function () { state.recipe = rc.id; renderView(); });
      nav.appendChild(item);
    });
    split.appendChild(nav);
    var rc = rcs.filter(function (r) { return r.id === state.recipe; })[0];
    var detail = h('div', { class: 'card' });
    detail.appendChild(h('h4', { text: '目标:' + t(rc.goal) }));
    detail.appendChild(h('p', { class: 'muted', text: '适用:' + t(rc.applicability, '') }));
    detail.appendChild(h('p', { text: t(rc.summary, '') }));
    function fileLinks(ids) {
      return refLinks(arr(ids).map(function (id) { return 'file:' + id; }));
    }
    detail.appendChild(kvList([
      ['先读文件', fileLinks(rc.files_to_read)],
      ['实现符号', refLinks(arr(rc.symbols_to_implement).map(function (id) { return 'symbol:' + id; }))],
      ['参考实现', refLinks(arr(rc.reference_implementations))],
      ['推荐扩展点', refLinks(arr(rc.recommended_extension_points).map(function (id) { return 'extension:' + id; }))],
      ['影响范围', refLinks(arr(rc.affected_architecture_nodes).map(function (id) { return 'node:' + id; }))],
      ['不变量', arr(rc.invariants).map(function (x) { return '• ' + x; })],
      ['风险', arr(rc.risks).map(function (x) { return '• ' + x; })],
      ['风险等级', t(rc.risk_level)],
      ['建议验证', arr(rc.validation_steps).map(function (x) { return '• ' + x; })],
    ]));
    split.appendChild(detail);
    sec.appendChild(split);
  }

  /* ---------------- unknowns ---------------- */
  function renderUnknowns(sec) {
    var a = ctx();
    var uns = arr(a.unknowns);
    if (!uns.length) { sec.appendChild(emptyBox('没有记录在案的未确认问题。')); return; }
    var grid = h('div', { class: 'cards' });
    uns.forEach(function (un) {
      var card = h('div', { class: 'card' });
      card.appendChild(h('h4', { text: t(un.question) }));
      card.appendChild(kvList([
        ['为何未知', t(un.why_unknown, '')],
        ['已尝试', arr(un.attempted_checks).join('; ') || null],
        ['可能在', arr(un.likely_locations).join(', ') || null],
        ['影响', t(un.impact, '')],
        ['建议验证', t(un.recommended_verification, '')],
      ]));
      grid.appendChild(card);
    });
    sec.appendChild(grid);
  }

  /* ---------------- comparison ---------------- */
  function renderComparison(sec) {
    if (!IS_CMP) {
      sec.appendChild(emptyBox('本报告为单项目审计,Comparison 视图不可用。需要比较模式:对多个项目分别审计后生成 comparison.json 并渲染。'));
      return;
    }
    var projects = PROJECTS;
    var pc = h('div', { class: 'cards' });
    projects.forEach(function (p) {
      var card = h('div', { class: 'card' });
      card.appendChild(h('h4', { text: t(p.name) }));
      card.appendChild(h('p', { class: 'muted', text: [p.root, p.revision ? String(p.revision).slice(0, 12) : ''].filter(Boolean).join(' · ') }));
      pc.appendChild(card);
    });
    sec.appendChild(pc);

    sec.appendChild(h('h3', { text: '能力矩阵' }));
    var matrix = arr(RAW.capability_matrix);
    if (!matrix.length) sec.appendChild(h('p', { class: 'note', text: '无矩阵数据。' }));
    matrix.forEach(function (row) {
      var wrapEl = h('div', { class: 'table-wrap' });
      var tbl = h('table', { class: 'tbl' });
      var trh = h('tr', {}, [h('th', { text: t(row.concept_name) + '(' + t(row.concept_id) + ')' })]);
      projects.forEach(function (p) { trh.appendChild(h('th', { text: t(p.name) })); });
      tbl.appendChild(h('thead', {}, [trh]));
      var tr = h('tr');
      var conceptCell = h('td', { class: 'wrap', text: '状态 / 摘要' });
      tr.appendChild(conceptCell);
      var cellsByPid = {};
      arr(row.cells).forEach(function (c) { cellsByPid[c.project_id] = c; });
      projects.forEach(function (p) {
        var c = cellsByPid[p.id];
        var td = h('td', { class: 'cell-' + (c ? c.status : 'unknown') + ' wrap' });
        if (c) {
          td.appendChild(statusBadge(c.status));
          if (c.summary) td.appendChild(h('div', { class: 'muted', text: c.summary, style: 'margin-top:3px' }));
          arr(c.refs).forEach(function (r) {
            td.appendChild(document.createTextNode(' '));
            td.appendChild(refLink(r));
          });
        } else td.appendChild(statusBadge('unknown'));
        tr.appendChild(td);
      });
      tbl.appendChild(h('tbody', {}, [tr]));
      wrapEl.appendChild(tbl);
      sec.appendChild(wrapEl);
    });

    function perProjectBlocks(title, items, renderEntry) {
      sec.appendChild(h('h3', { text: title }));
      if (!arr(items).length) { sec.appendChild(h('p', { class: 'note', text: '无数据。' })); return; }
      arr(items).forEach(function (item) {
        var block = h('div', { class: 'flow-block' });
        var head = h('div', { class: 'flow-head' });
        head.appendChild(h('h4', { text: t(item.topic || item.concept_name || item.title), style: 'margin:0' }));
        if (item.difference_summary || item.difference_summary === '') {
          block.appendChild(h('p', { class: 'note', text: t(item.difference_summary, '') }));
        }
        block.appendChild(head);
        var grid = h('div', { class: 'cards' });
        arr(item.per_project).forEach(function (entry) {
          var card = h('div', { class: 'card' });
          var pname = '?';
          projects.forEach(function (p) { if (p.id === entry.project_id) pname = p.name; });
          card.appendChild(h('h4', { text: pname }));
          renderEntry(card, entry);
          grid.appendChild(card);
        });
        block.appendChild(grid);
        sec.appendChild(block);
      });
    }
    perProjectBlocks('概念对比', RAW.concept_comparisons, function (card, e) {
      card.appendChild(kvList([
        ['项目术语', t(e.project_term, '')],
        ['实现', t(e.implementation, '')],
        ['策略', t(e.strategy, '')],
        ['数据结构', arr(e.data_structures).join(', ') || null],
        ['控制流', t(e.control_flow, '')],
        ['扩展方式', t(e.extension, '')],
        ['tradeoff', t(e.tradeoff, '')],
        ['置信度', t(e.confidence, '')],
        ['引用', refLinks(arr(e.refs))],
      ]));
    });
    perProjectBlocks('链路对比', RAW.flow_comparisons, function (card, e) {
      card.appendChild(h('p', { text: t(e.summary, '') }));
      card.appendChild(kvList([['引用', refLinks(arr(e.refs))]]));
    });
    perProjectBlocks('扩展机制对比', RAW.extension_comparisons, function (card, e) {
      card.appendChild(h('p', { text: t(e.summary, '') }));
    });

    sec.appendChild(h('h3', { text: '架构差异' }));
    var diffs = arr(RAW.architectural_differences);
    if (!diffs.length) sec.appendChild(h('p', { class: 'note', text: '无数据。' }));
    diffs.forEach(function (d) {
      var card = h('div', { class: 'card' });
      card.appendChild(h('h4', { text: t(d.title) + ' [' + t(d.significance, '') + ']' }));
      card.appendChild(h('p', { class: 'muted', text: t(d.summary, '') }));
      var tbl = h('table', { class: 'mini-table' });
      arr(d.per_project).forEach(function (pp) {
        var pname = pp.project_id;
        projects.forEach(function (p) { if (p.id === pp.project_id) pname = p.name; });
        tbl.appendChild(h('tr', {}, [h('td', { text: pname }), h('td', { text: t(pp.statement, '') })]));
      });
      card.appendChild(tbl);
      sec.appendChild(card);
    });

    sec.appendChild(h('h3', { text: '共同模式与取舍' }));
    var half = h('div', { class: 'cards' });
    arr(RAW.common_patterns).forEach(function (cp) {
      var card = h('div', { class: 'card' });
      card.appendChild(h('h4', { text: '共同:' + t(cp.title) }));
      card.appendChild(h('p', { class: 'muted', text: t(cp.summary, '') }));
      half.appendChild(card);
    });
    arr(RAW.tradeoffs).forEach(function (to) {
      var card = h('div', { class: 'card' });
      var pname = to.project_id;
      projects.forEach(function (p) { if (p.id === to.project_id) pname = p.name; });
      card.appendChild(h('h4', { text: '取舍(' + pname + '):' + t(to.title) }));
      card.appendChild(h('p', { class: 'muted', text: t(to.summary, '') }));
      half.appendChild(card);
    });
    if (!half.childNodes.length) sec.appendChild(h('p', { class: 'note', text: '无数据。' }));
    else sec.appendChild(half);

    sec.appendChild(h('h3', { text: '比较中的未确认项' }));
    var cu = arr(RAW.unknowns);
    if (!cu.length) sec.appendChild(h('p', { class: 'note', text: '无。' }));
    var grid2 = h('div', { class: 'cards' });
    cu.forEach(function (un) {
      var card = h('div', { class: 'card' });
      card.appendChild(h('h4', { text: (un.project_id ? '[' + un.project_id + '] ' : '') + t(un.question) }));
      card.appendChild(h('p', { class: 'muted', text: t(un.why_unknown, '') }));
      grid2.appendChild(card);
    });
    sec.appendChild(grid2);
  }

  /* ---------------- details panel ---------------- */
  function renderDetails() {
    var body = byId('details-body');
    body.textContent = '';
    if (!state.sel) {
      body.appendChild(emptyBox('在项目树、架构图或表格中点击一个节点 / 文件 / 符号,这里会展示原始术语、行号与代码证据。'));
      return;
    }
    var ix = idx();
    var s = state.sel;
    if (s.kind === 'node' && ix.nodes[s.id]) return nodeDetails(ix.nodes[s.id], body);
    if (s.kind === 'file' && ix.files[s.id]) return fileDetails(ix.files[s.id], body);
    if (s.kind === 'symbol' && ix.symbols[s.id]) return symbolDetails(ix.symbols[s.id], body);
    if (s.kind === 'state' && ix.states[s.id]) return stateDetails(ix.states[s.id], body);
    if (s.kind === 'extension' && ix.extensions[s.id]) return extDetails(ix.extensions[s.id], body);
    body.appendChild(emptyBox('所选对象在当前项目中不存在(可能属于其他项目或引用已失效)。'));
  }
  function nodeDetails(n, body) {
    var ix = idx();
    body.appendChild(h('h3', { text: n.canonical_name, style: 'margin:4px 0' }));
    if (arr(n.project_terms).length) {
      body.appendChild(h('p', { class: 'note', text: '项目术语:' + arr(n.project_terms).join(', ') }));
    }
    var chips = h('p');
    chips.appendChild(statusBadge(n.implementation_status));
    chips.appendChild(document.createTextNode(' '));
    chips.appendChild(confBadge(n.confidence));
    chips.appendChild(document.createTextNode(' '));
    chips.appendChild(h('span', { class: 'chip', text: t(n.layer) }));
    body.appendChild(chips);
    body.appendChild(h('p', { text: t(n.summary, '') }));
    if (n.notes) body.appendChild(h('p', { class: 'note', text: n.notes }));
    var files = arr(n.file_ids).map(function (fid) { return ix.files[fid]; }).filter(Boolean);
    if (files.length) {
      body.appendChild(h('h4', { text: '文件' }));
      files.forEach(function (f) {
        var line = h('p', { style: 'margin:2px 0;overflow-wrap:anywhere' });
        line.appendChild(refLink('file:' + f.id, f.path));
        line.appendChild(copyBtn(f.path, '⧉'));
        body.appendChild(line);
      });
    }
    var syms = arr(n.symbol_ids).map(function (sid) { return ix.symbols[sid]; }).filter(Boolean);
    if (syms.length) {
      body.appendChild(h('h4', { text: '符号' }));
      syms.forEach(function (sym) {
        var line = h('p', { style: 'margin:2px 0;overflow-wrap:anywhere' });
        line.appendChild(refLink('symbol:' + sym.id, sym.qualified_name || sym.name));
        var loc = (ix.files[sym.file_id] ? ix.files[sym.file_id].path : '') + ':' + (sym.start_line || '?');
        line.appendChild(copyBtn(loc, '⧉ path:line', loc));
        body.appendChild(line);
      });
    }
    var nb = nodeNeighbors(n);
    body.appendChild(h('h4', { text: '上游 / 下游' }));
    body.appendChild(kvList([
      ['上游', refLinks(nb.up.map(function (id) { return 'node:' + id; }))],
      ['下游', refLinks(nb.down.map(function (id) { return 'node:' + id; }))],
      ['相关状态', refLinks(stateRefsOfNode(n))],
      ['扩展点', refLinks(arr(n.extension_point_ids).map(function (id) { return 'extension:' + id; }))],
    ]));
    body.appendChild(h('h4', { text: '证据(' + arr(n.evidence_ids).length + ')' }));
    body.appendChild(evidenceList(n.evidence_ids));
  }
  function stateRefsOfNode(n) {
    var out = [];
    arr(ctx().relations).forEach(function (r) {
      var meNode = 'node:' + n.id;
      if ((r.type === 'reads_state' || r.type === 'writes_state') &&
        (r.from_ref === meNode || r.to_ref === meNode)) {
        var other = r.from_ref === meNode ? r.to_ref : r.from_ref;
        if (String(other).indexOf('state:') === 0) out.push(other + ' (' + r.type + ')');
      }
    });
    return out.map(function (x) { return x; });
  }
  function fileDetails(f, body) {
    var ix = idx();
    body.appendChild(h('h3', { text: f.path, style: 'overflow-wrap:anywhere' }));
    body.appendChild(copyBtn(f.path, '复制路径'));
    body.appendChild(h('p', { class: 'note', text:
      [t(f.language, ''), f.size != null ? f.size + ' B' : '', f.line_count != null ? f.line_count + ' 行' : '',
        f.importance ? '重要度:' + f.importance : ''].filter(Boolean).join(' · ') }));
    var flags = [];
    if (f.test) flags.push('test');
    if (f.documentation) flags.push('documentation');
    if (f.generated) flags.push('generated');
    if (flags.length) body.appendChild(h('p', { class: 'note', text: '标记:' + flags.join(', ') }));
    body.appendChild(h('p', { text: t(f.summary, '') }));
    body.appendChild(kvList([
      ['架构职责', refLinks(arr(f.architecture_node_ids).map(function (id) { return 'node:' + id; }))],
      ['关键符号', arr(f.symbol_ids).map(function (id) {
        var s = ix.symbols[id];
        return s ? (s.qualified_name || s.name) + ' :' + (s.start_line || '?') : id;
      })],
    ]));
    body.appendChild(h('h4', { text: '证据(' + arr(f.evidence_ids).length + ')' }));
    body.appendChild(evidenceList(f.evidence_ids));
    var src = codeSource(f.id);
    if (src) {
      body.appendChild(h('h4', { text: '源码(内嵌离线,' + String(src).split('\n').length + ' 行)' }));
      body.appendChild(codeView(src, 1));
    }
  }
  function codeSource(fid) {
    var st = (RAW && RAW.statistics) || {};
    var m = st.sources;
    return m && Object.prototype.hasOwnProperty.call(m, fid) ? m[fid] : null;
  }
  function codeView(src, startLine) {
    var lines = String(src).split('\n');
    var start = startLine || 1;
    var gutter = String(lines.length + start).length;
    var pre = h('pre', { class: 'code-view' });
    pre.textContent = lines.map(function (ln, i) {
      var n = String(start + i);
      while (n.length < gutter) n = ' ' + n;
      return n + ' │ ' + ln;
    }).join('\n');
    return pre;
  }
  function symbolDetails(sym, body) {
    var ix = idx();
    body.appendChild(h('h3', { text: sym.qualified_name || sym.name, style: 'overflow-wrap:anywhere' }));
    body.appendChild(copyBtn(sym.qualified_name || sym.name, '复制符号名'));
    var f = ix.files[sym.file_id];
    var loc = (f ? f.path : '') + ':' + (sym.start_line || '?') +
      (sym.end_line && sym.end_line !== sym.start_line ? '-' + sym.end_line : '');
    body.appendChild(h('p', { class: 'note', text: [sym.kind, loc, sym.exported ? 'exported' : '', t(sym.visibility, '')].filter(Boolean).join(' · ') }));
    body.appendChild(copyBtn(loc, '复制 path:line', loc));
    if (sym.signature) body.appendChild(h('div', { class: 'sig', text: sym.signature }));
    body.appendChild(h('p', { text: t(sym.summary, '') }));
    body.appendChild(kvList([
      ['文件', f ? refLink('file:' + f.id, f.path) : t(sym.file_id)],
      ['架构职责', refLinks(arr(sym.architecture_node_ids).map(function (id) { return 'node:' + id; }))],
    ]));
    body.appendChild(h('h4', { text: '证据(' + arr(sym.evidence_ids).length + ')' }));
    body.appendChild(evidenceList(sym.evidence_ids));
    var symSrc = f ? codeSource(f.id) : null;
    if (symSrc && sym.start_line) {
      var allLines = String(symSrc).split('\n');
      var from = Math.max(1, sym.start_line - 3);
      var to = Math.min(allLines.length, (sym.end_line || sym.start_line) + 3);
      body.appendChild(h('h4', { text: '源码片段 :' + from + '-' + to }));
      body.appendChild(codeView(allLines.slice(from - 1, to).join('\n'), from));
    }
  }
  function stateDetails(st, body) {
    body.appendChild(h('h3', { text: st.name }));
    body.appendChild(h('p', { class: 'note', text: '项目术语:' + t(st.project_term) + ' · ' + t(st.category) }));
    body.appendChild(h('p', { text: t(st.summary, '') }));
    body.appendChild(kvList([
      ['可变性', t(st.mutability)], ['生命周期', t(st.lifetime)], ['持久化', t(st.persistence)],
      ['创建者', refLinks(arr(st.creator_refs))], ['读取者', refLinks(arr(st.reader_refs))],
      ['写入者', refLinks(arr(st.writer_refs))], ['序列化', refLinks(arr(st.serializer_refs))],
    ]));
    body.appendChild(h('h4', { text: '证据' }));
    body.appendChild(evidenceList(st.evidence_ids));
  }
  function extDetails(ep, body) {
    body.appendChild(h('h3', { text: ep.name }));
    var chips = h('p');
    chips.appendChild(h('span', { class: 'chip', text: t(ep.category) }));
    chips.appendChild(h('span', { class: 'chip', text: ep.public ? 'public' : 'internal' }));
    chips.appendChild(h('span', { class: 'chip', text: '稳定性:' + t(ep.stability) }));
    body.appendChild(chips);
    body.appendChild(h('p', { text: '注册方式:' + t(ep.registration_method, '') }));
    body.appendChild(h('p', { class: 'note', text: '约束:' + t(ep.constraints, '') }));
    body.appendChild(kvList([
      ['接口', refLinks(arr(ep.interface_refs))],
      ['参考实现', refLinks(arr(ep.implementation_refs))],
      ['示例', refLinks(arr(ep.example_refs))],
    ]));
    body.appendChild(h('h4', { text: '证据' }));
    body.appendChild(evidenceList(ep.evidence_ids));
  }

  /* ---------------- view switching ---------------- */
  var RENDERERS = {
    overview: renderOverview, architecture: renderArchitecture, flows: renderFlows,
    state: renderState, source: renderSource, extensions: renderExtensions,
    dev: renderDev, comparison: renderComparison, unknowns: renderUnknowns,
  };
  function renderView() {
    VIEW_IDS.forEach(function (v) {
      var sec = byId('view-' + v);
      if (sec) sec.hidden = (v !== state.view);
    });
    var sec = byId('view-' + state.view);
    if (!sec) return;
    sec.textContent = '';
    if ((state.view !== 'comparison') && !hasCtx()) {
      sec.appendChild(emptyBox('该比较报告未内嵌项目审计数据(source_audits),无法浏览此视图。'));
      return;
    }
    RENDERERS[state.view](sec);
  }

  function renderAll() {
    renderTabs();
    renderTopbar();
    renderTree();
    renderView();
    renderDetails();
    renderStatus();
  }

  /* ---------------- global search ---------------- */
  function globalSearch(q) {
    var box = byId('search-results');
    box.textContent = '';
    if (!q) { box.hidden = true; return; }
    if (!hasCtx()) {
      box.appendChild(h('div', { class: 'search-empty', text: '无可搜索的项目数据' }));
      box.hidden = false;
      return;
    }
    var ix = idx();
    var ql = q.toLowerCase();
    var out = [];
    Object.keys(ix.nodes).forEach(function (id) {
      var n = ix.nodes[id];
      var hay = (n.canonical_name + ' ' + n.canonical_id + ' ' + arr(n.project_terms).join(' ') + ' ' + t(n.summary, '')).toLowerCase();
      if (hay.indexOf(ql) >= 0) out.push(['node', id, n.canonical_name, arr(n.project_terms).join(', ')]);
    });
    Object.keys(ix.files).forEach(function (id) {
      var f = ix.files[id];
      if ((f.path + ' ' + t(f.summary, '')).toLowerCase().indexOf(ql) >= 0) out.push(['file', id, f.path, t(f.summary, '')]);
    });
    Object.keys(ix.symbols).forEach(function (id) {
      var s = ix.symbols[id];
      if (((s.qualified_name || '') + ' ' + (s.name || '')).toLowerCase().indexOf(ql) >= 0) {
        out.push(['symbol', id, s.qualified_name || s.name, s.kind]);
      }
    });
    out = out.slice(0, 24);
    if (!out.length) box.appendChild(h('div', { class: 'search-empty', text: '无匹配结果' }));
    out.forEach(function (r) {
      var view = r[0] === 'node' ? 'architecture' : (r[0] === 'file' ? 'source' : null);
      var row = h('button', { class: 'search-row', type: 'button' });
      row.appendChild(h('span', { class: 'kind', text: r[0] }));
      row.appendChild(h('span', { class: 'title', text: r[2] }));
      if (r[3]) row.appendChild(h('span', { class: 'sub', text: r[3] }));
      row.addEventListener('click', function () {
        box.hidden = true;
        byId('global-search').value = '';
        select(r[0], r[1], view);
      });
      box.appendChild(row);
    });
    box.hidden = false;
  }

  /* ---------------- wiring ---------------- */
  function applyTheme(th) {
    document.documentElement.setAttribute('data-theme', th);
    try { localStorage.setItem('agent-code-atlas-theme', th); } catch (e) { /* file: 下可能不可用 */ }
  }
  byId('btn-theme').addEventListener('click', function () {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });
  (function () {
    var th = null;
    try { th = localStorage.getItem('agent-code-atlas-theme'); } catch (e) { th = null; }
    if (th === 'dark' || th === 'light') document.documentElement.setAttribute('data-theme', th);
  })();

  byId('filter-confidence').addEventListener('change', function () {
    state.conf = this.value;
    renderAll();
  });
  byId('filter-status').addEventListener('change', function () {
    state.status = this.value;
    renderAll();
  });
  var gs = byId('global-search');
  gs.addEventListener('input', debounce(function () { globalSearch(gs.value.trim()); }, 140));
  gs.addEventListener('focus', function () { if (gs.value.trim()) globalSearch(gs.value.trim()); });
  gs.addEventListener('keydown', function (e) { if (e.key === 'Escape') byId('search-results').hidden = true; });
  document.addEventListener('click', function (e) {
    var box = byId('search-results');
    if (!box.hidden && !box.contains(e.target) && e.target !== gs) box.hidden = true;
  });
  document.addEventListener('keydown', function (e) {
    var tag = document.activeElement && document.activeElement.tagName;
    if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
      e.preventDefault();
      gs.focus();
    } else if (e.key === 'Escape') {
      byId('search-results').hidden = true;
      byId('about').removeAttribute('open');
    }
  });

  byId('tree-tab-physical').addEventListener('click', function () { state.tree = 'physical'; renderTree(); });
  byId('tree-tab-logical').addEventListener('click', function () { state.tree = 'logical'; renderTree(); });
  byId('tree-search').addEventListener('input', debounce(function () {
    var q = this.value.trim().toLowerCase();
    var cont = byId('tree-container');
    var rows = cont.querySelectorAll('.tree-row');
    Array.prototype.forEach.call(rows, function (row) {
      var path = row.getAttribute('data-path') || '';
      var show = !q || path.toLowerCase().indexOf(q) >= 0;
      row.classList.toggle('hide', !show);
      if (show) {
        var p = row.parentElement;
        while (p && p !== cont) {
          if (p.tagName === 'DETAILS') p.open = true;
          p = p.parentElement;
        }
      }
    });
  }, 120));
  [['tree-core-only', 'treeCoreOnly'], ['tree-hide-tests', 'treeHideTests'],
    ['tree-hide-docs', 'treeHideDocs'], ['tree-hide-generated', 'treeHideGenerated']].forEach(function (pair) {
    var cb = byId(pair[0]);
    cb.checked = state[pair[1]];
    cb.addEventListener('change', function () { state[pair[1]] = this.checked; renderTree(); });
  });
  byId('btn-sidebar').addEventListener('click', function () {
    byId('sidebar').classList.toggle('open');
  });
  byId('btn-close-details').addEventListener('click', clearSel);

  /* ---------------- boot ---------------- */
  readHash();
  if (VIEW_IDS.indexOf(state.view) < 0) state.view = IS_CMP ? 'comparison' : 'overview';
  if (!document.documentElement.getAttribute('data-theme')) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
  renderAll();
})();

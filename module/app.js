(function () {
  'use strict';

  var X = window.XCountdown;
  var D = window.XTodoData;
  var body = document.body;
  var boxWide = document.getElementById('wide');
  var boxCompact = document.getElementById('compact');

  var state = {
    cfg: { warnDays: 3, dayStartHour: 0 },
    todos: [],
    nowMs: Date.now(),
    loadedAt: 0,
    variant: 'wide',
    status: 'loading',   // loading | ready | error
    error: ''
  };

  function xhub() { return window.xhub || null; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ------------------------------------------------------------------ */
  /* 形态：query 首帧 → DOM 属性 → 宿主广播                              */
  /* ------------------------------------------------------------------ */

  function normalizeVariant(v) {
    if (v === 'compact') return 'compact';
    if (v === 'standard' || v === 'wide') return 'wide';   // 兼容旧 id
    return 'wide';
  }

  function applyVariant(v) {
    state.variant = normalizeVariant(v);
    document.documentElement.setAttribute('data-xhub-variant', state.variant);
    render();
  }

  function readVariant() {
    var q = new URLSearchParams(location.search).get('xhub-variant');
    var attr = document.documentElement.getAttribute('data-xhub-variant');
    return q || attr || 'wide';
  }

  /* ------------------------------------------------------------------ */
  /* 数据                                                               */
  /* ------------------------------------------------------------------ */

  async function readConfig() {
    var all = null;
    try { all = await xhub().config.all(); } catch (e) {}
    var cfg = Object.assign({ warnDays: 3, dayStartHour: 0 }, all || {});
    state.cfg = {
      warnDays: Math.min(60, Math.max(0, parseInt(cfg.warnDays, 10) || 0)),
      dayStartHour: Math.min(23, Math.max(0, parseInt(cfg.dayStartHour, 10) || 0))
    };
  }

  /** 适配层模型 → 倒计时计算字段（唯一一处映射） */
  function toCalcModels(list) {
    return list.map(function (t) {
      return {
        id: t.id,
        title: t.title,
        done: t.done,
        priority: t.priority,
        due_at: t.dueAt,
        parent_id: t.parentId,
        repeat_mode: t.repeatMode,
        description: t.description
      };
    });
  }

  async function load() {
    if (!state.todos.length) {
      state.status = 'loading';
      render();
    }

    if (!xhub()) {
      state.status = 'error';
      state.error = '未检测到 x-hub 宿主';
      render();
      return;
    }

    try { await readConfig(); } catch (e) {}

    var res = await D.fetchTodos();
    state.loadedAt = res.at;
    state.nowMs = Date.now();

    if (res.status === 'error') {
      state.status = 'error';
      state.error = res.error;
      render();
      return;
    }

    state.status = 'ready';
    state.error = '';
    state.todos = res.todos;
    render();
  }

  /* ------------------------------------------------------------------ */
  /* 计算                                                               */
  /* ------------------------------------------------------------------ */

  function summary() {
    var items = X.prepare(toCalcModels(state.todos), state.nowMs, state.cfg);
    return { items: items, s: X.summarize(items) };
  }

  function nearest(items, n) {
    return items
      .filter(function (it) { return !it.hidden && it.status !== 'none' && it.status !== 'done'; })
      .sort(X.compareItems)
      .slice(0, n);
  }

  function shortLabel(it) {
    if (it.status === 'overdue') return '逾期 ' + (-it.days) + ' 天';
    if (it.status === 'today') return it.hasTime && it.dueTimePassed ? '今天已过' : '今天';
    if (it.days === 1) return '明天';
    return it.days + ' 天';
  }

  /* ------------------------------------------------------------------ */
  /* 渲染                                                               */
  /* ------------------------------------------------------------------ */

  function hintHtml(text, withRetry, isError) {
    return '<div class="hint' + (isError ? ' error' : '') + '">' +
      '<span>' + esc(text) + '</span>' +
      (withRetry ? '<button type="button" class="act" data-act="retry">重试</button>' : '') +
      '</div>';
  }

  function render() {
    try {
      renderUnsafe();
    } catch (err) {
      var msg = (err && err.message) || '渲染失败';
      boxWide.innerHTML = hintHtml('加载失败：' + msg, true, true);
      boxCompact.innerHTML = hintHtml('加载失败', false, true);
    }
  }

  function renderUnsafe() {
    if (state.status === 'error' && !state.todos.length) {
      boxCompact.innerHTML = hintHtml('读取失败', false, true);
      boxWide.innerHTML = hintHtml('读取失败：' + state.error, true, true);
      return;
    }

    if (state.status === 'loading' && !state.todos.length) {
      boxCompact.innerHTML = hintHtml('读取中…', false, false);
      boxWide.innerHTML = hintHtml('读取中…', false, false);
      return;
    }

    var r = summary();
    var s = r.s;

    /* 紧凑：一个主数字 + 一行副信息 */
    var hero;
    if (s.overdue > 0) hero = { n: s.overdue, cls: 'red', lbl: '逾期' };
    else if (s.today > 0) hero = { n: s.today, cls: 'orange', lbl: '今天到期' };
    else if (s.soon > 0) hero = { n: s.soon, cls: 'amber', lbl: '临期' };
    else hero = { n: s.active, cls: 'dim', lbl: s.active ? '有排期' : '无待办' };

    boxCompact.innerHTML =
      '<div><span class="n ' + hero.cls + '">' + hero.n + '</span>' +
      '<span class="lbl"> ' + hero.lbl + '</span></div>' +
      '<div class="sub">今天 ' + s.today + ' · 临期 ' + s.soon + '</div>';

    /* 通栏：三段统计 + 最近三条 */
    var list = nearest(r.items, 3);
    var rows = list.length
      ? list.map(function (it) {
          var tone = (X.STATUS_META[it.status] || {}).tone || 'gray';
          return '<div class="row" data-tone="' + tone + '">' +
            '<span class="dot"></span>' +
            '<span class="nm">' + esc(it.title) + '</span>' +
            '<span class="d">' + esc(shortLabel(it)) + '</span>' +
            '</div>';
        }).join('')
      : hintHtml(s.active ? '没有临期待办' : '暂无带截止日的待办', false, false);

    boxWide.innerHTML =
      '<div class="tiles">' +
      '<div class="tile" data-tone="red"><b>' + s.overdue + '</b><span>逾期</span></div>' +
      '<div class="tile" data-tone="orange"><b>' + s.today + '</b><span>今天</span></div>' +
      '<div class="tile" data-tone="amber"><b>' + s.soon + '</b><span>临期</span></div>' +
      '</div>' +
      '<div class="rows">' + rows + '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* 交互                                                               */
  /* ------------------------------------------------------------------ */

  function openView() {
    try { xhub().runtime.open('view'); } catch (e) {}
  }

  body.addEventListener('click', function (e) {
    if (e.target.closest('[data-act="retry"]')) {
      e.stopPropagation();
      state.todos = [];
      load();
      return;
    }
    openView();
  });

  body.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openView(); }
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && Date.now() - state.loadedAt > 5000) load();
  });
  window.addEventListener('focus', function () {
    if (Date.now() - state.loadedAt > 5000) load();
  });

  setInterval(function () {
    state.nowMs = Date.now();
    if (state.status === 'ready') render();
  }, 60000);

  // 未捕获异常也要可见，不能停在“读取中…”
  function fail(err) {
    state.status = 'error';
    state.error = (err && (err.message || (err.reason && err.reason.message))) || '脚本错误';
    try {
      boxWide.innerHTML = hintHtml('加载失败：' + state.error, true, true);
      boxCompact.innerHTML = hintHtml('加载失败', false, true);
    } catch (e) {}
  }
  window.addEventListener('error', function (e) { fail(e.error || e.message); });
  window.addEventListener('unhandledrejection', function (e) { fail(e.reason); });

  /* ------------------------------------------------------------------ */

  (function boot() {
    if (!xhub()) {
      fail({ message: '未检测到 x-hub 宿主，请在扩展中心打开' });
      return;
    }
    applyVariant(readVariant());
    try {
      if (xhub().events && xhub().events.on) {
        xhub().events.on('xhub:variant-changed', function (v) { applyVariant(v); });
      }
    } catch (e) {}
    load().catch(fail);
  })();
})();

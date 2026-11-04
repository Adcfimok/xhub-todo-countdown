(function () {
  'use strict';

  var X = window.XCountdown;
  var DAY = 86400000;
  var card = document.getElementById('card');
  var boxCompact = document.getElementById('compact');
  var boxStandard = document.getElementById('standard');

  var state = { cfg: { warnDays: 3, dayStartHour: 0 }, todos: [], nowMs: Date.now(), loadedAt: 0, variant: 'standard' };

  function xhub() { return window.xhub || null; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* 形态：query 首帧 → DOM 属性 → 宿主广播；三处都落到 data-xhub-variant 上，纯 CSS 才好分支 */
  function applyVariant(v) {
    var val = (v === 'compact' || v === 'standard') ? v : 'standard';
    state.variant = val;
    document.documentElement.setAttribute('data-xhub-variant', val);
    try { document.documentElement.style.setProperty('--xhub-variant', val); } catch (e) {}
    render();
  }

  function readVariant() {
    var q = new URLSearchParams(location.search).get('xhub-variant');
    var attr = document.documentElement.getAttribute('data-xhub-variant');
    return q || attr || 'standard';
  }

  async function load() {
    try {
      var all = null;
      try { all = await xhub().config.all(); } catch (e) {}
      var cfg = Object.assign({ warnDays: 3, dayStartHour: 0, showCompleted: false }, all || {});
      state.cfg = {
        warnDays: Math.min(60, Math.max(0, parseInt(cfg.warnDays, 10) || 0)),
        dayStartHour: Math.min(23, Math.max(0, parseInt(cfg.dayStartHour, 10) || 0)),
        showCompleted: !!cfg.showCompleted
      };
      var list = await xhub().data.todos.list();
      state.todos = Array.isArray(list) ? list : [];
      state.loadedAt = Date.now();
    } catch (e) {
      state.todos = [];
    }
    state.nowMs = Date.now();
    render();
  }

  function summary() {
    var items = X.prepare(state.todos, state.nowMs, state.cfg);
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

  function render() {
    var r = summary();
    var s = r.s;

    if (!state.loadedAt) {
      boxCompact.innerHTML = '<div class="foot">读取中…</div>';
      boxStandard.innerHTML = '<div class="empty">读取中…</div>';
      return;
    }

    /* 紧凑：一个主数字（逾期优先，其次今天、临期）+ 一行副信息 */
    var hero;
    if (s.overdue > 0) hero = { n: s.overdue, cls: 'red', lbl: '逾期' };
    else if (s.today > 0) hero = { n: s.today, cls: 'orange', lbl: '今天到期' };
    else if (s.soon > 0) hero = { n: s.soon, cls: 'amber', lbl: '临期' };
    else hero = { n: s.active, cls: 'dim', lbl: s.active ? '有排期' : '无待办' };

    boxCompact.innerHTML =
      '<div class="hero"><span class="n num ' + hero.cls + '">' + hero.n + '</span><span class="lbl">' + hero.lbl + '</span></div>' +
      '<div class="sub">今天 <b>' + s.today + '</b> · 临期 <b>' + s.soon + '</b></div>' +
      '<div class="foot">' + (s.active ? '共 ' + s.active + ' 项有截止日' : '暂无可倒计的待办') + '</div>';

    /* 标准 */
    var list = nearest(r.items, 3);
    var itemsHtml = list.length
      ? list.map(function (it) {
          return '<div class="item" data-tone="' + (X.STATUS_META[it.status] || {}).tone + '">' +
            '<span class="dot"></span>' +
            '<span class="t">' + esc(it.title) + '</span>' +
            '<span class="d">' + esc(shortLabel(it)) + '</span></div>';
        }).join('')
      : '<div class="empty">' + (s.active ? '没有临期待办' : '暂无带截止日的待办') + '</div>';

    boxStandard.innerHTML =
      '<div class="head"><span class="title">待办倒计时</span><span class="more">看全部 ›</span></div>' +
      '<div class="tiles">' +
      '<div class="tile" data-tone="red"><span class="n num">' + s.overdue + '</span><span class="l">逾期</span></div>' +
      '<div class="tile" data-tone="orange"><span class="n num">' + s.today + '</span><span class="l">今天</span></div>' +
      '<div class="tile" data-tone="amber"><span class="n num">' + s.soon + '</span><span class="l">临期</span></div>' +
      '</div>' +
      '<div class="list">' + itemsHtml + '</div>';
  }

  function openView() {
    try { xhub().runtime.open('view'); } catch (e) {}
  }

  card.addEventListener('click', openView);
  card.addEventListener('keydown', function (e) {
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
    if (state.todos.length) render();
  }, 60000);

  (function boot() {
    if (!xhub()) {
      boxStandard.innerHTML = '<div class="empty">未检测到 x-hub 宿主</div>';
      return;
    }
    applyVariant(readVariant());
    try {
      if (xhub().events && xhub().events.on) {
        xhub().events.on('xhub:variant-changed', function (v) { applyVariant(v); });
      }
    } catch (e) {}
    load();
  })();
})();

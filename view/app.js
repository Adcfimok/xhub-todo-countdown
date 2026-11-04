(function () {
  'use strict';

  var X = window.XCountdown;
  var DAY = 86400000;
  var CFG_FALLBACK = {
    warnDays: 3,
    dayStartHour: 0,
    showCompleted: false,
    notifyEnabled: true,
    notifyCooldownHours: 12,
    maxNotifyPerRun: 3
  };

  var el = {
    chips: document.getElementById('chips'),
    warn: document.getElementById('warnDays'),
    showDone: document.getElementById('showDone'),
    refresh: document.getElementById('refresh'),
    list: document.getElementById('list'),
    alert: document.getElementById('alert'),
    alertText: document.getElementById('alertText'),
    alertClose: document.getElementById('alertClose'),
    updated: document.getElementById('updated'),
    mode: document.getElementById('mode'),
    preview: document.getElementById('previewBadge')
  };

  var state = {
    cfg: Object.assign({}, CFG_FALLBACK),
    todos: [],
    items: [],
    summary: null,
    nowMs: Date.now(),
    loading: true,
    error: null,
    filter: 'all',
    expanded: Object.create(null),
    lastLoadedAt: 0,
    notifyBlocked: false,
    notifyHint: '',
    dayTimer: null,
    scrollY: 0
  };

  /* ------------------------------------------------------------------ */
  /* 宿主调用（一律带兜底，缺能力时不至于整页崩）                        */
  /* ------------------------------------------------------------------ */

  function xhub() { return window.xhub || null; }

  async function readConfig() {
    var all = null;
    try { all = await xhub().config.all(); } catch (e) { all = null; }
    var cfg = Object.assign({}, CFG_FALLBACK, all || {});
    cfg.warnDays = clampInt(cfg.warnDays, 0, 60, 3);
    cfg.dayStartHour = clampInt(cfg.dayStartHour, 0, 23, 0);
    cfg.showCompleted = !!cfg.showCompleted;
    cfg.notifyEnabled = cfg.notifyEnabled !== false;
    cfg.notifyCooldownHours = clampInt(cfg.notifyCooldownHours, 1, 168, 12);
    cfg.maxNotifyPerRun = clampInt(cfg.maxNotifyPerRun, 0, 10, 3);
    state.cfg = cfg;
  }

  function clampInt(v, min, max, dft) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) return dft;
    return Math.min(max, Math.max(min, n));
  }

  async function saveConfig(patch) {
    Object.assign(state.cfg, patch);
    try {
      for (var k in patch) await xhub().config.set(k, patch[k]);
    } catch (e) {
      console.warn('[待办倒计时] 配置保存失败', e);
    }
  }

  async function readStorage(key) {
    try { return await xhub().storage.get(key); } catch (e) { return null; }
  }
  async function writeStorage(key, value) {
    try { await xhub().storage.set(key, value); } catch (e) { /* 只影响提醒去重，忽略 */ }
  }

  async function loadTodos() {
    state.loading = state.todos.length === 0;
    state.error = null;
    render();
    try {
      var list = await xhub().data.todos.list();
      state.todos = Array.isArray(list) ? list : [];
      state.lastLoadedAt = Date.now();
      state.loading = false;
    } catch (e) {
      state.loading = false;
      state.error = (e && e.message) || '读取待办失败';
    }
    state.nowMs = Date.now();
    render();
    if (!state.error) maybeNotify();
  }

  /* ------------------------------------------------------------------ */
  /* 提醒                                                               */
  /* ------------------------------------------------------------------ */

  async function maybeNotify() {
    if (!state.cfg.notifyEnabled || state.cfg.maxNotifyPerRun <= 0) return;
    if (!xhub() || !xhub().ui || !xhub().ui.notify) return;

    var seen = (await readStorage('remindState')) || {};
    if (typeof seen !== 'object') seen = {};

    var list = X.pickReminders(state.items, {
      nowMs: state.nowMs,
      maxPerRun: state.cfg.maxNotifyPerRun,
      cooldownHours: state.cfg.notifyCooldownHours,
      seen: seen
    });
    if (!list.length) return;

    var sent = 0;
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      try {
        await xhub().ui.notify('待办倒计时 · ' + r.title, r.body);
        seen[r.key] = state.nowMs;
        sent++;
      } catch (e) {
        // 没给 notify 权限：退化为页面内提醒条，不再重试
        state.notifyBlocked = true;
        state.notifyHint = (e && e.message) || '通知权限未开启';
        break;
      }
    }
    if (sent) {
      Object.keys(seen).forEach(function (k) {
        if (!seen[k] || state.nowMs - seen[k] > 7 * DAY) delete seen[k];
      });
      await writeStorage('remindState', seen);
    }
    render();
  }

  /* ------------------------------------------------------------------ */
  /* 渲染                                                               */
  /* ------------------------------------------------------------------ */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function timeText(ms) {
    var d = new Date(ms);
    return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }

  function plainDescription(md) {
    if (!md) return '';
    var s = String(md)
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^#{1,6}\s*/gm, '')
      .replace(/[*_~]{1,3}/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return s.length > 180 ? s.slice(0, 180) + '…' : s;
  }

  function badgeHtml(it) {
    var meta = X.STATUS_META[it.status] || X.STATUS_META.later;
    if (it.status === 'done') {
      return '<span class="badge" data-tone="gray"><span class="badge-main"><span class="word">完成</span></span></span>';
    }
    if (it.status === 'none') return '<span class="badge" data-tone="gray"></span>';

    var main;
    if (it.status === 'today') main = '<span class="word">今天</span>';
    else main = '<span class="num">' + Math.abs(it.days) + '</span><span class="unit">天</span>';

    var cap;
    if (it.status === 'overdue') cap = '已逾期';
    else if (it.status === 'today') cap = it.hasTime ? (it.dueTimePassed ? timeText(it.dueMs) + ' 已过' : timeText(it.dueMs) + ' 截止') : '全天';
    else if (it.days === 1) cap = '明天';
    else if (it.days === 2) cap = '后天';
    else cap = '';

    return '<span class="badge" data-tone="' + meta.tone + '">' +
      '<span class="badge-main">' + main + '</span>' +
      '<span class="badge-cap">' + esc(cap) + '</span></span>';
  }

  function rowHtml(it) {
    var raw = it.raw || {};
    var meta = X.STATUS_META[it.status] || X.STATUS_META.later;
    var desc = plainDescription(raw.description);
    var open = !!state.expanded[it.id];

    var chips = [];
    if (it.dueMs) chips.push('<span class="due">截止 ' + esc(X.formatDueCompact(it.dueMs)) + '</span>');
    else chips.push('<span class="due">未设置截止日</span>');
    if (it.isRepeating) chips.push('<span class="tag" data-kind="repeat">周期</span>');
    if (it.childCount > 0) chips.push('<span class="tag" data-kind="child">含 ' + it.childCount + ' 个子项</span>');
    if (it.priority === 2) chips.push('<span class="tag">高优先级</span>');

    return '<button type="button" class="row' + (it.status === 'done' ? ' done' : '') + '"' +
      ' data-id="' + esc(it.id) + '" data-tone="' + meta.tone + '"' +
      ' aria-expanded="' + (desc ? (open ? 'true' : 'false') : 'false') + '"' +
      ' title="含当天口径：' + (it.remainingInclusive == null ? '—' : (it.remainingInclusive > 0 ? '还剩 ' + it.remainingInclusive + ' 天' : (it.remainingInclusive === 0 ? '今天到期' : '已逾期 ' + (-it.remainingInclusive) + ' 天'))) + '">' +
      '<span class="rail"></span>' +
      '<span class="body">' +
      '<span class="title">' + esc(it.title) + '</span>' +
      '<span class="meta">' + chips.join('') + '</span>' +
      (desc ? '<span class="desc"' + (open ? '' : ' hidden') + '>' + esc(desc) + '</span>' : '') +
      '</span>' +
      badgeHtml(it) +
      '</button>';
  }

  function groupHtml(g) {
    var meta = X.STATUS_META[g.key] || X.STATUS_META.later;
    return '<section class="group" data-tone="' + meta.tone + '" aria-label="' + esc(g.title) + '">' +
      '<div class="group-head"><span>' + esc(g.title) + '</span>' +
      '<span class="count num">' + g.items.length + '</span><span class="line"></span></div>' +
      '<div class="rows">' + g.items.map(rowHtml).join('') + '</div>' +
      '</section>';
  }

  function chipsHtml(s) {
    var defs = [
      { key: 'overdue', label: '逾期', n: s.overdue, tone: 'red' },
      { key: 'today', label: '今天', n: s.today, tone: 'orange' },
      { key: 'soon', label: '临期', n: s.soon, tone: 'amber' }
    ];
    return defs.map(function (d) {
      var on = state.filter === d.key;
      return '<button type="button" class="chip" data-tone="' + d.tone + '" data-filter="' + d.key + '"' +
        ' aria-pressed="' + (on ? 'true' : 'false') + '">' +
        '<span class="label">' + d.label + '</span><b class="num">' + d.n + '</b></button>';
    }).join('');
  }

  function emptyHtml() {
    if (state.loading) {
      return '<div class="skeleton"><i></i><i></i><i></i></div>';
    }
    if (state.error) {
      return '<div class="error">读取待办失败：' + esc(state.error) +
        '<div><button type="button" class="ghost" data-act="retry">重试</button></div></div>';
    }
    if (!state.todos.length) {
      return '<div class="empty">还没有待办。去 x-hub 待办页添加一条，并给它设置截止日期。</div>';
    }
    if (state.filter !== 'all') {
      return '<div class="empty">这个分组暂时没有待办。</div>';
    }
    return '<div class="empty">所有待办都还没有设置截止日期，倒计时暂无内容。</div>';
  }

  function renderAlert() {
    var s = state.summary || { overdue: 0, today: 0 };
    var dismissed = false;
    try { dismissed = sessionStorage.getItem('tc-alert-dismissed') === '1'; } catch (e) {}

    if (state.notifyBlocked) {
      el.alert.hidden = false;
      el.alert.dataset.kind = 'info';
      el.alertText.innerHTML = '通知权限未开启，临期提醒只在页面内显示。<a href="#" data-act="perm" style="color:var(--tc-accent)">去开启</a>';
      return;
    }
    if (!dismissed && (s.overdue > 0 || s.today > 0)) {
      el.alert.hidden = false;
      el.alert.dataset.kind = 'warn';
      var parts = [];
      if (s.overdue) parts.push('<b>' + s.overdue + ' 项已逾期</b>');
      if (s.today) parts.push('<span class="warn">' + s.today + ' 项今天到期</span>');
      el.alertText.innerHTML = parts.join('，') + '，建议优先处理。';
      return;
    }
    el.alert.hidden = true;
  }

  function render() {
    state.nowMs = state.nowMs || Date.now();
    var items = X.prepare(state.todos, state.nowMs, state.cfg);
    state.items = items;
    var summary = X.summarize(items);
    state.summary = summary;

    var groups = X.group(items, {
      warnDays: state.cfg.warnDays,
      showDone: state.cfg.showCompleted
    });
    if (state.filter !== 'all') {
      groups = groups.filter(function (g) { return g.key === state.filter; });
    }

    // 保留滚动位置（每 60s 全量重绘也不跳）
    var scroller = document.scrollingElement || document.documentElement;
    var keepY = scroller.scrollTop;

    el.chips.innerHTML = chipsHtml(summary);
    el.showDone.checked = state.cfg.showCompleted;
    if ([].some.call(el.warn.options, function (o) { return Number(o.value) === state.cfg.warnDays; })) {
      el.warn.value = String(state.cfg.warnDays);
    }

    el.list.innerHTML = groups.length ? groups.map(groupHtml).join('') : emptyHtml();

    if (state.lastLoadedAt) {
      var d = new Date(state.lastLoadedAt);
      el.updated.textContent = '更新于 ' + timeText(state.lastLoadedAt) + ':' + String(d.getSeconds()).padStart(2, '0');
    } else {
      el.updated.textContent = state.loading ? '正在读取…' : '—';
    }
    if (window.__xhubMock) {
      el.preview.hidden = false;
      el.mode.textContent = '预览模式：模拟数据' + (window.__xhubMock.offsetDays ? '（时间 +' + window.__xhubMock.offsetDays + ' 天）' : '');
    } else {
      el.mode.textContent = '数据来自 x-hub 待办';
    }

    renderAlert();
    if (keepY) scroller.scrollTop = keepY;
  }

  /* ------------------------------------------------------------------ */
  /* 交互                                                               */
  /* ------------------------------------------------------------------ */

  el.chips.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-filter]');
    if (!btn) return;
    var key = btn.getAttribute('data-filter');
    state.filter = state.filter === key ? 'all' : key;
    render();
  });

  el.list.addEventListener('click', function (e) {
    var retry = e.target.closest('[data-act="retry"]');
    if (retry) { loadTodos(); return; }

    var row = e.target.closest('.row');
    if (!row) return;
    var id = row.getAttribute('data-id');
    var desc = row.querySelector('.desc');
    if (!desc) return;
    var open = state.expanded[id] = !state.expanded[id];
    if (open) desc.removeAttribute('hidden'); else desc.setAttribute('hidden', '');
    row.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  el.warn.addEventListener('change', function () {
    saveConfig({ warnDays: Number(el.warn.value) });
    render();
  });

  el.showDone.addEventListener('change', function () {
    saveConfig({ showCompleted: el.showDone.checked });
    render();
  });

  el.refresh.addEventListener('click', function () {
    state.expanded = Object.create(null);
    loadTodos();
  });

  el.alertClose.addEventListener('click', function () {
    el.alert.hidden = true;
    try { sessionStorage.setItem('tc-alert-dismissed', '1'); } catch (e) {}
  });

  el.alert.addEventListener('click', function (e) {
    if (e.target.closest('[data-act="perm"]')) {
      e.preventDefault();
      try { xhub().openPermissions(); } catch (err) {}
    }
  });

  /* ------------------------------------------------------------------ */
  /* 刷新策略                                                           */
  /* ------------------------------------------------------------------ */

  function scheduleDayBoundary() {
    if (state.dayTimer) clearTimeout(state.dayTimer);
    var delay = X.msUntilNextDayStart(Date.now(), state.cfg.dayStartHour);
    state.dayTimer = setTimeout(async function () {
      state.nowMs = Date.now();
      await loadTodos();          // 跨天：数据也可能变了，重新拉一次
      scheduleDayBoundary();
    }, delay);
  }

  // 每 60 秒重算一次「现在」：够用且几乎无开销；休眠/改表后靠 focus 兜底
  setInterval(function () {
    state.nowMs = Date.now();
    if (state.todos.length) render();
  }, 60000);

  var lastFocusReload = 0;
  function reloadIfStale() {
    if (Date.now() - lastFocusReload < 5000) return;
    if (Date.now() - state.lastLoadedAt < 5000) return;
    lastFocusReload = Date.now();
    loadTodos();
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) reloadIfStale();
  });
  window.addEventListener('focus', reloadIfStale);

  /* ------------------------------------------------------------------ */
  /* 启动                                                               */
  /* ------------------------------------------------------------------ */

  (async function boot() {
    if (!xhub()) {
      el.list.innerHTML = '<div class="error">未检测到 x-hub 宿主。请在 x-hub 扩展中心打开本扩展，或带 ?mock=1 预览。</div>';
      return;
    }
    await readConfig();
    scheduleDayBoundary();
    await loadTodos();
  })();
})();

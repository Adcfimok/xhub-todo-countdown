(function () {
  'use strict';

  var X = window.XCountdown;
  var D = window.XTodoData;
  var card = document.getElementById('card');
  var boxCompact = document.getElementById('compact');
  var boxStandard = document.getElementById('standard');

  var state = {
    cfg: { warnDays: 3, dayStartHour: 0 },
    todos: [],
    nowMs: Date.now(),
    loadedAt: 0,
    variant: 'standard',
    status: 'loading',    // loading | ready | error
    error: ''
  };

  function xhub() { return window.xhub || null; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ------------------------------------------------------------------ */
  /* 形态                                                               */
  /* ------------------------------------------------------------------ */

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

  /* ------------------------------------------------------------------ */
  /* 数据：配置 + 待办                                                   */
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

  /** 适配层模型 → 倒计时计算所需的宿主字段名（唯一一处字段映射） */
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
    // 已有数据时静默刷新，避免卡片闪成骨架
    if (!state.todos.length) {
      state.status = 'loading';
      render();
    }

    if (!xhub()) {
      state.status = 'error';
      state.error = '未检测到宿主';
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
      // 保留上一次的数据，出错时不至于整卡清空（只在首屏无数据时显示错误页）
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
  /* 卡面明暗：按**实际画出来的底色**决定文字反色，而不是靠主题属性猜     */
  /* ------------------------------------------------------------------ */

  function parseColor(str) {
    if (!str) return null;
    var s = String(str).trim();
    if (!s || s === 'transparent') return [0, 0, 0, 0];
    var m = s.match(/^#([0-9a-f]{3,8})$/i);
    if (m) {
      var h = m[1];
      if (h.length === 3 || h.length === 4) h = h.split('').map(function (c) { return c + c; }).join('');
      return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
        h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
      ];
    }
    m = s.match(/^rgba?\(([^)]+)\)$/i);
    if (m) {
      var p = m[1].split(',').map(function (x) { return parseFloat(x); });
      return [p[0] || 0, p[1] || 0, p[2] || 0, p.length > 3 ? p[3] : 1];
    }
    return null;
  }

  function luminance(rgb) {
    var c = rgb.slice(0, 3).map(function (v) {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function readVar(name) {
    try {
      return parseColor(getComputedStyle(document.documentElement).getPropertyValue(name));
    } catch (e) { return null; }
  }

  function composite(fg, bg) {
    var a = fg[3] === undefined ? 1 : fg[3];
    return [0, 1, 2].map(function (i) { return fg[i] * a + bg[i] * (1 - a); });
  }

  /**
   * 宿主可能把 --xhub-bg-card 设成空值/非法值，此时 var() 会让 background 整条失效，
   * 卡片直接露出 iframe 的白底。这里用探针实测它到底能不能解析成颜色：
   * 能 → 跟随宿主卡片色；不能 → 由宿主文字色推卡面明暗，用组件自带的底色兜底。
   */
  function hostCardBg() {
    try {
      var probe = document.createElement('i');
      probe.style.cssText = 'position:fixed;left:-9px;top:-9px;width:1px;height:1px;background:var(--xhub-bg-card)';
      document.body.appendChild(probe);
      var c = parseColor(getComputedStyle(probe).backgroundColor);
      probe.remove();
      return c && c[3] > 0.02 ? c : null;
    } catch (e) { return null; }
  }

  function syncSurface() {
    try {
      // 以“实际生效的文字色”为锚点决定卡面，然后用**内联样式 + 内联自定义属性**写死配色。
      // 实测宿主里出现过样式表 background 失效、文字色与卡面来源不一致的情况（白底浅字），
      // 内联样式不参与层叠竞争，且自定义属性会继承给子元素，最稳。
      var bodyColor = parseColor(getComputedStyle(document.body).color) || [236, 238, 244, 1];
      var dark = luminance(bodyColor) > 0.5;

      card.style.setProperty('background-color', dark ? 'rgba(24,26,33,0.96)' : 'rgba(255,255,255,0.96)', 'important');
      card.style.setProperty('color', dark ? '#eceef4' : '#15171c', 'important');
      card.setAttribute('data-surface', dark ? 'dark' : 'light');

      var palette = dark
        ? {
            '--tc-text-1': '#eceef4', '--tc-text-2': '#b9bfcd', '--tc-text-3': '#8f96a5',
            '--tc-red': '#ff6b6f', '--tc-orange': '#ff8a3d', '--tc-amber': '#f5c542', '--tc-blue': '#7aa2ff'
          }
        : {
            '--tc-text-1': '#15171c', '--tc-text-2': '#4a5060', '--tc-text-3': '#6b7280',
            '--tc-red': '#c62b30', '--tc-orange': '#c2570a', '--tc-amber': '#8a5f00', '--tc-blue': '#2f56c9'
          };

      for (var k in palette) card.style.setProperty(k, palette[k]);
    } catch (e) { /* 量不到就保持 CSS 默认（深色） */ }
  }

  /* ------------------------------------------------------------------ */
  /* 渲染                                                               */
  /* ------------------------------------------------------------------ */

  function retryHtml(msg) {
    return '<div class="empty error">' +
      '<span>读取失败：' + esc(msg) + '</span>' +
      '<button type="button" class="retry" data-act="retry">重试</button>' +
      '</div>';
  }

  function loadingHtml() {
    return '<div class="empty"><span>读取中…</span></div>';
  }

  function render() {
    try {
      renderUnsafe();
    } catch (err) {
      boxStandard.innerHTML = retryHtml((err && err.message) || '渲染失败');
      boxCompact.innerHTML = '<div class="foot">加载失败</div>';
    } finally {
      // DOM 就位后再统一上色：卡面 + 磁贴 + 分隔线
      syncSurface();
    }
  }

  function renderUnsafe() {
    /* 空数据/错误：两种形态都给可读反馈 */
    if (state.status === 'error' && !state.todos.length) {
      boxCompact.innerHTML = '<div class="foot">读取失败</div>';
      boxStandard.innerHTML = retryHtml(state.error);
      return;
    }
    if (state.status === 'loading' && !state.todos.length) {
      boxCompact.innerHTML = '<div class="foot">读取中…</div>';
      boxStandard.innerHTML = loadingHtml();
      return;
    }

    var r = summary();
    var s = r.s;

    /* 紧凑：一个主数字（逾期优先 → 今天 → 临期）+ 一行副信息 */
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

  /* ------------------------------------------------------------------ */
  /* 交互                                                               */
  /* ------------------------------------------------------------------ */

  function openView() {
    try { xhub().runtime.open('view'); } catch (e) {}
  }

  card.addEventListener('click', function (e) {
    if (e.target.closest('[data-act="retry"]')) {
      e.stopPropagation();
      state.todos = [];
      load();
      return;
    }
    openView();
  });

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
    if (state.status === 'ready') render();
  }, 60000);

  /* ------------------------------------------------------------------ */

  // 任何未捕获异常都落到卡片上，绝不静默停在“读取中…”
  function fail(err) {
    state.status = 'error';
    state.error = (err && (err.message || err.reason && err.reason.message)) || '脚本错误';
    try {
      boxStandard.innerHTML = retryHtml(state.error);
      boxCompact.innerHTML = '<div class="foot">加载失败</div>';
    } catch (e) {}
  }
  window.addEventListener('error', function (e) { fail(e.error || e.message); });
  window.addEventListener('unhandledrejection', function (e) { fail(e.reason); });

  (function boot() {
    if (!xhub()) {
      state.status = 'error';
      state.error = '未检测到 x-hub 宿主，请在扩展中心打开';
      render();
      return;
    }
    // 宿主没注入主题变量时兜底，避免深色宿主上出现浅色卡片
    if (!document.documentElement.getAttribute('data-xhub-theme')) {
      document.documentElement.setAttribute('data-xhub-theme', 'dark');
    }
    applyVariant(readVariant());
    try {
      if (xhub().events && xhub().events.on) {
        xhub().events.on('xhub:variant-changed', function (v) { applyVariant(v); });
        if (xhub().events.on) {
          xhub().events.on('theme-changed', function () { setTimeout(syncSurface, 50); });
        }
      }
    } catch (e) {}
    load().catch(fail);
  })();
})();

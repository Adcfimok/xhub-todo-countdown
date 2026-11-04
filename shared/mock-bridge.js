/*!
 * 预览用的模拟宿主（只在没有真宿主、且显式 ?mock=1 或 file:// 打开时生效）。
 * 真实 x-hub 会注入 window.xhub，本文件直接返回，不干扰线上行为。
 *
 * 支持的 query：
 *   mock=1                强制启用
 *   theme=dark|light
 *   variant=standard|compact   （module 形态）
 *   offset=1.5            时间旅行：把「现在」往后推 1.5 天（验证跨天/临期）
 *   scene=normal|empty|crowded|dirty|alldone
 */
(function () {
  'use strict';

  var qs = new URLSearchParams(location.search);
  var isFile = location.protocol === 'file:';
  var explicit = qs.get('mock') === '1';
  if (window.xhub) return;                      // 真宿主优先
  if (!isFile && !explicit) return;             // 普通网页里不启用

  var DAY = 86400000;
  var offsetDays = parseFloat(qs.get('offset') || '0') || 0;
  var scene = qs.get('scene') || 'normal';
  var themeMode = qs.get('theme') || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  // 数据锚定在「真实现在」，时间旅行只推进 now，这样条目会真的变旧
  var realNowMs = Date.now();
  if (offsetDays) {
    var realNow = Date.now;
    Date.now = function () { return realNow() + offsetDays * DAY; };
  }

  // 主体今天（用于生成数据）
  var base = new Date(realNowMs);

  function at(dayOffset, hh, mm, ss) {
    var d = new Date(base.getTime());
    d.setDate(d.getDate() + dayOffset);
    if (hh === null || hh === undefined) d.setHours(0, 0, 0, 0);
    else d.setHours(hh, mm || 0, ss || 0, 0);
    return d.getTime();
  }

  var id = 0;
  function t(title, due, extra) {
    id += 1;
    return Object.assign({
      id: id,
      title: title,
      done: false,
      priority: 0,
      created_at: new Date(base.getTime() - 3 * DAY).toISOString(),
      updated_at: new Date(base.getTime()).toISOString(),
      completed_at: null,
      due_at: due,
      remind_at: null,
      remind_fired: false,
      parent_id: null,
      sort_order: null,
      version: 1,
      description: '',
      pinned: false,
      repeat_mode: 'once',
      repeat_every: null,
      repeat_unit: null,
      repeat_weekdays: null,
      repeat_month_day: null,
      repeat_month_nth: null,
      repeat_end_mode: null,
      repeat_end_at: null,
      repeat_count: null,
      repeat_done_count: 0,
      repeat_last_done_at: null
    }, extra || {});
  }

  var todos = [];

  if (scene === 'empty') {
    todos = [];
  } else if (scene === 'crowded') {
    var words = ['对齐会材料', '客户回访', '合同用印', '代码评审', '供应商比价', '月度对账', '培训报名', '版本发布', '数据复盘', '文档归档'];
    for (var i = 0; i < 120; i++) {
      var off = (i % 37) - 6;
      todos.push(t(words[i % words.length] + ' #' + (i + 1), at(off, i % 3 === 0 ? 18 : null, 0), { priority: i % 3 }));
    }
  } else if (scene === 'dirty') {
    todos = [
      t('截止时间缺失', null),
      t('截止时间是 0（脏数据）', 0),
      t('截止时间是字符串（脏数据）', '2026-11-06T10:00:00Z'),
      t('截止时间越界（脏数据）', 8.7e15),
      t('标题很长很长很长很长很长很长很长很长很长很长很长很长的待办', at(2, 12, 0)),
      t('已完成的逾期项不应计入逾期', at(-9, 12, 0), { done: true, completed_at: new Date().toISOString() }),
      t('正常项（对照组）', at(1, 9, 0))
    ];
  } else if (scene === 'alldone') {
    todos = [t('全部完成的 A', at(-1, 12, 0), { done: true }), t('全部完成的 B', at(2, 12, 0), { done: true })];
  } else {
    var parent = t('季度预算终稿提交', at(0, 18, 0), { priority: 2, description: '需财务 BP 复核后上传 OA；附件命名 `2026Q3-预算-终稿.pdf`。' });
    todos = [
      t('报销单提交（财务月结）', at(-5, 18, 0), { priority: 1, description: '月结截止前必须提交，否则顺延到下月。' }),
      t('给爸妈打电话', at(-1, 20, 0)),
      t('晨会纪要发给团队', at(0, 9, 0)),
      parent,
      t('体检预约确认', at(0, null, 0)),
      t('机票改签（北京 → 深圳）', at(1, 12, 0), { priority: 2 }),
      t('周报汇总', at(2, 10, 0), { repeat_mode: 'weekly', repeat_weekdays: 8 }),
      t('域名续费', at(3, null, 0), { description: 'x-hub 相关域名，别让它过期。' }),
      t('读完《深度工作》', at(6, 22, 0)),
      t('年度体检', at(12, 9, 0)),
      t('驾照换证', at(45, null, 0)),
      t('整理桌面收藏夹', null),
      t('订酒店', at(-2, 12, 0), { done: true, completed_at: new Date(base.getTime() - DAY).toISOString() }),
      t('收集各小组预算表', at(0, 15, 0), { parent_id: parent.id }),
      t('同步 HR 编制口径', at(-3, 12, 0), { done: true, parent_id: parent.id })
    ];
  }

  // ---- 主题 ----
  // bg=dark|light：让卡片底色与主题**故意错开**，用来验证“按实际底色反色”的兜底
  var bgOverride = qs.get('bg');
  var cardBg = bgOverride === 'dark' ? 'rgba(24,26,33,.72)'
    : bgOverride === 'light' ? 'rgba(255,255,255,.74)'
    : (themeMode === 'dark' ? 'rgba(25,27,33,.72)' : 'rgba(255,255,255,.74)');

  var theme = {
    mode: themeMode,
    preset: null,
    accent: '#5b6cff',
    wallpaper: { on: false, clear: false, immersive: false },
    tokens: {
      accent: '#5b6cff', brand: '#5b6cff', brandSoft: 'rgba(91,108,255,.14)',
      bgPage: themeMode === 'dark' ? '#14161b' : '#f6f7fb',
      pageBg: themeMode === 'dark' ? '#14161b' : '#f6f7fb',
      bgCard: cardBg,
      surface: themeMode === 'dark' ? '#191b21' : '#ffffff',
      text1: themeMode === 'dark' ? '#eceef4' : '#15171c',
      text2: themeMode === 'dark' ? '#a3a9b8' : '#5a6070',
      text3: themeMode === 'dark' ? '#767d8d' : '#8d93a3',
      border: themeMode === 'dark' ? 'rgba(255,255,255,.08)' : 'rgba(18,22,33,.09)',
      red: '#e5484d', green: '#30a46c', yellow: '#f5c542', blue: '#3e63dd', orange: '#f76b15',
      radiusLg: '14px'
    }
  };
  // 和真宿主同一套动作：数据属性 + CSS 变量，扩展侧样式无需为预览单开分支
  (function applyTheme() {
    var root = document.documentElement;
    root.setAttribute('data-xhub-theme', theme.mode);
    // nobg=1：模拟“宿主在卡片背后垫了别的颜色”，此时不铺预览底色
    if (qs.get('nobg') !== '1') root.setAttribute('data-xhub-preview', '1');
    var t = theme.tokens;
    var map = {
      '--xhub-accent': t.accent,
      '--xhub-brand': t.brand,
      '--xhub-brand-soft': t.brandSoft,
      '--xhub-bg-page': t.bgPage,
      '--xhub-page-bg': t.pageBg,
      '--xhub-bg-card': t.bgCard,
      '--xhub-surface': t.surface,
      '--xhub-text-1': t.text1,
      '--xhub-text-2': t.text2,
      '--xhub-text-3': t.text3,
      '--xhub-border': t.border,
      '--xhub-red': t.red,
      '--xhub-green': t.green,
      '--xhub-yellow': t.yellow,
      '--xhub-blue': t.blue,
      '--xhub-orange': t.orange,
      '--xhub-radius-lg': t.radiusLg
    };
    for (var k in map) root.style.setProperty(k, map[k]);
  })();

  // ---- 本地存储（模拟） ----
  var mem = {};
  var store = {
    get: function (k) { try { var v = localStorage.getItem('xhubmock:' + k); return v == null ? mem[k] : JSON.parse(v); } catch (e) { return mem[k]; } },
    set: function (k, v) { mem[k] = v; try { localStorage.setItem('xhubmock:' + k, JSON.stringify(v)); } catch (e) {} },
    remove: function (k) { delete mem[k]; try { localStorage.removeItem('xhubmock:' + k); } catch (e) {} }
  };

  var overrides = {};
  var manifestConfig = {
    warnDays: 3, dayStartHour: 0, showCompleted: false,
    notifyEnabled: true, notifyCooldownHours: 12, maxNotifyPerRun: 3
  };

  function toast(title, body) {
    var host = document.getElementById('xhub-mock-toasts');
    if (!host) {
      host = document.createElement('div');
      host.id = 'xhub-mock-toasts';
      host.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:99;display:flex;flex-direction:column;gap:8px;max-width:300px';
      document.body.appendChild(host);
    }
    var el = document.createElement('div');
    el.style.cssText = 'padding:10px 12px;border-radius:10px;background:#1f2229;color:#eceef4;font-size:12px;line-height:1.5;box-shadow:0 8px 24px rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.1)';
    el.innerHTML = '<b style="display:block;margin-bottom:2px"></b><span></span>';
    el.querySelector('b').textContent = title;
    el.querySelector('span').textContent = body;
    host.appendChild(el);
    setTimeout(function () { el.remove(); }, 6000);
  }

  window.__xhubMock = { enabled: true, scene: scene, offsetDays: offsetDays };

  var failMode = qs.get('fail');          // fail=1：模拟接口报错；fail=denied：模拟缺权限
  var delayMs = parseInt(qs.get('delay') || '0', 10) || 0;

  window.xhub = {
    data: {
      todos: {
        list: function () {
          if (failMode) {
            var e = new Error(failMode === 'denied' ? '缺少 data:read 权限' : '模拟后端错误: list failed');
            e.code = failMode === 'denied' ? 'PERMISSION_DENIED' : 'INTERNAL';
            return Promise.reject(e);
          }
          var payload = todos.map(function (x) { return Object.assign({}, x); });
          return new Promise(function (resolve) {
            setTimeout(function () { resolve(payload); }, delayMs);
          });
        },
        get: function (opts) { return Promise.resolve(todos.find(function (x) { return x.id === opts.id; }) || null); }
      }
    },
    config: {
      get: function (k) { return Promise.resolve(k in overrides ? overrides[k] : (k in manifestConfig ? manifestConfig[k] : null)); },
      set: function (k, v) { overrides[k] = v; return Promise.resolve(v); },
      remove: function (k) { delete overrides[k]; return Promise.resolve(); },
      all: function () { return Promise.resolve(Object.assign({}, manifestConfig, overrides)); }
    },
    storage: {
      get: function (k) { return Promise.resolve(store.get(k)); },
      set: function (k, v) { store.set(k, v); return Promise.resolve(); },
      remove: function (k) { store.remove(k); return Promise.resolve(); },
      clear: function () { mem = {}; return Promise.resolve(); }
    },
    theme: { get: function () { return Promise.resolve(theme); } },
    ui: {
      notify: function (title, body) { toast(title, body); return Promise.resolve(); },
      toast: function (m) { toast('提示', m); return Promise.resolve(); }
    },
    runtime: {
      info: function () { return Promise.resolve({ id: 'com.zhou.todo-countdown', name: '待办倒计时', version: '1.0.0', runtime: 'web', serviceReady: false, proxyPrefix: null, capabilities: [] }); },
      open: function (surface) {
        var u = new URL(location.href);
        u.pathname = u.pathname.replace(/\/(view|module)\/[^/]*$/, '/view/index.html');
        u.searchParams.set('mock', '1');
        location.href = u.toString();
        return Promise.resolve();
      }
    },
    events: { on: function () { return function () {}; }, off: function () {}, emit: function () { return Promise.resolve(); } }
  };
})();

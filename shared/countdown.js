/*!
 * 待办倒计时核心逻辑（纯函数，无 DOM / 无宿主依赖）
 * ---------------------------------------------------------------
 * 契约：
 *   - due_at 是「毫秒时间戳」，与宿主 todos.due_at 一致；null / 非法值 = 未排期。
 *   - 一切「天数」都按**本地时区的自然日**计算，不做 ms / 86400000 的粗略除法，
 *     因此夏令时（23h / 25h 的一天）、跨年、闰年都不会算错。
 *   - 天数差 d = 截止日 - 今天：
 *        d > 0 还有 d 天；d = 0 今天到期（含当天）；d < 0 已逾期 -d 天。
 *   - 「含当天口径」remainingInclusive = d + 1（今天到期 = 还剩 1 天）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.XCountdown = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DAY_MS = 86400000;
  var MIN_YEAR = 1970;
  var MAX_YEAR = 2200;

  /* ------------------------------------------------------------------ */
  /* 基础工具                                                           */
  /* ------------------------------------------------------------------ */

  function clampHour(h) {
    var n = typeof h === 'number' ? h : parseInt(h, 10);
    if (!isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > 23) return 23;
    return Math.floor(n);
  }

  /**
   * 把时间戳归一到「业务日序号」（自 1970-01-01 起的整数天）。
   * 用 UTC 拼装本地日历字段 → 得到纯整数天，绕开夏令时 23/25 小时的坑。
   */
  function dayIndex(ms, dayStartHour) {
    var h = clampHour(dayStartHour);
    var d = new Date(ms - h * 3600000);
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
  }

  /** 解析截止时间；返回 { ms, ok, reason }。 */
  function parseDue(value) {
    if (value === null || value === undefined || value === '') {
      return { ms: null, ok: false, reason: 'empty' };
    }
    var n = typeof value === 'number' ? value : Number(value);
    if (!isFinite(n)) return { ms: null, ok: false, reason: 'nan' };
    if (n <= 0) return { ms: null, ok: false, reason: 'non-positive' };
    if (n > 8.64e15) return { ms: null, ok: false, reason: 'out-of-range' };
    var y = new Date(n).getFullYear();
    if (y < MIN_YEAR || y > MAX_YEAR) return { ms: null, ok: false, reason: 'year' };
    return { ms: n, ok: true, reason: null };
  }

  /** 该时间戳是否带「时分」语义（00:00 视为纯日期）。 */
  function hasTimePart(ms) {
    var d = new Date(ms);
    return !(d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0);
  }

  function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  var WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  /** 2026年11月6日 周五 18:00（无时分则省略时间） */
  function formatDue(ms, opts) {
    opts = opts || {};
    if (!parseDue(ms).ok) return '';
    var d = new Date(ms);
    var date = (opts.short ? '' : d.getFullYear() + '年') + (d.getMonth() + 1) + '月' + d.getDate() + '日';
    var week = opts.noWeek ? '' : ' ' + WEEK_CN[d.getDay()];
    var time = hasTimePart(ms) ? ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) : '';
    return date + week + time;
  }

  /** 11-06 18:00（列表右侧的紧凑写法） */
  function formatDueCompact(ms) {
    if (!parseDue(ms).ok) return '';
    var d = new Date(ms);
    var s = pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    if (hasTimePart(ms)) s += ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    return s;
  }

  /* ------------------------------------------------------------------ */
  /* 状态判定                                                           */
  /* ------------------------------------------------------------------ */

  var STATUS_ORDER = ['overdue', 'today', 'soon', 'week', 'later', 'none', 'done'];

  var STATUS_META = {
    overdue: { key: 'overdue', title: '已逾期', tone: 'red' },
    today: { key: 'today', title: '今天到期', tone: 'orange' },
    soon: { key: 'soon', title: '临期', tone: 'amber' },
    week: { key: 'week', title: '一周内', tone: 'blue' },
    later: { key: 'later', title: '更远', tone: 'gray' },
    none: { key: 'none', title: '未排期', tone: 'gray' },
    done: { key: 'done', title: '已完成', tone: 'gray' }
  };

  /**
   * 计算单条待办的倒计时描述。
   * @param {object} todo  宿主 XHubTodo（只读使用 due_at / done / repeat_mode / parent_id / priority）
   * @param {number} nowMs 当前时间戳
   * @param {object} opts  { warnDays, dayStartHour }
   */
  function describe(todo, nowMs, opts) {
    opts = opts || {};
    var warnDays = Math.max(0, Math.min(60, opts.warnDays == null ? 3 : Number(opts.warnDays) || 0));
    var dayStartHour = clampHour(opts.dayStartHour);
    var due = parseDue(todo && todo.due_at);

    if (todo && todo.done) {
      return {
        id: todo.id,
        status: 'done',
        days: null,
        remainingInclusive: null,
        badge: '已完成',
        caption: '已完成',
        badgeNum: null,
        badgeUnit: '',
        dueMs: due.ok ? due.ms : null,
        dueText: due.ok ? formatDue(due.ms) : '',
        hasTime: due.ok && hasTimePart(due.ms),
        dueTimePassed: false,
        isRepeating: !!(todo && todo.repeat_mode && todo.repeat_mode !== 'once'),
        priority: (todo && todo.priority) || 0,
        sortKey: Number.MAX_SAFE_INTEGER,
        warn: false
      };
    }

    if (!due.ok) {
      return {
        id: todo && todo.id,
        status: 'none',
        days: null,
        remainingInclusive: null,
        badge: '',
        caption: '未设置截止日期',
        badgeNum: null,
        badgeUnit: '',
        dueMs: null,
        dueText: '',
        hasTime: false,
        dueTimePassed: false,
        isRepeating: !!(todo && todo.repeat_mode && todo.repeat_mode !== 'once'),
        priority: (todo && todo.priority) || 0,
        sortKey: Number.MAX_SAFE_INTEGER - 1,
        warn: false
      };
    }

    var days = dayIndex(due.ms, dayStartHour) - dayIndex(nowMs, dayStartHour);
    var hasTime = hasTimePart(due.ms);
    var dueTimePassed = hasTime && nowMs > due.ms;

    var status;
    if (days < 0) status = 'overdue';
    else if (days === 0) status = 'today';
    else if (days <= warnDays) status = 'soon';
    else if (days <= 7) status = 'week';
    else status = 'later';

    var badge, badgeNum, badgeUnit, caption;
    if (status === 'overdue') {
      badgeNum = -days;
      badgeUnit = '天';
      badge = '逾期';
      caption = '已逾期 ' + -days + ' 天';
    } else if (status === 'today') {
      badgeNum = 0;
      badgeUnit = '';
      badge = '今天';
      caption = hasTime
        ? (dueTimePassed ? '今天 ' + pad2(new Date(due.ms).getHours()) + ':' + pad2(new Date(due.ms).getMinutes()) + ' 已过' : '今天 ' + pad2(new Date(due.ms).getHours()) + ':' + pad2(new Date(due.ms).getMinutes()) + ' 截止')
        : '今天截止（全天）';
    } else if (days === 1) {
      badgeNum = 1;
      badgeUnit = '天';
      badge = '明天';
      caption = '明天 ' + (hasTime ? pad2(new Date(due.ms).getHours()) + ':' + pad2(new Date(due.ms).getMinutes()) : '全天');
    } else if (days === 2) {
      badgeNum = 2;
      badgeUnit = '天';
      badge = '后天';
      caption = '还剩 2 天';
    } else {
      badgeNum = days;
      badgeUnit = '天';
      badge = '剩';
      caption = '还剩 ' + days + ' 天';
    }

    return {
      id: todo.id,
      status: status,
      days: days,
      remainingInclusive: days + 1,
      badge: badge,
      badgeNum: badgeNum,
      badgeUnit: badgeUnit,
      caption: caption,
      dueMs: due.ms,
      dueText: formatDue(due.ms),
      hasTime: hasTime,
      dueTimePassed: dueTimePassed,
      isRepeating: !!(todo.repeat_mode && todo.repeat_mode !== 'once'),
      priority: todo.priority || 0,
      sortKey: days,
      warn: status === 'today' || status === 'soon' || status === 'overdue'
    };
  }

  /* ------------------------------------------------------------------ */
  /* 排序 / 分组 / 统计                                                 */
  /* ------------------------------------------------------------------ */

  function compareItems(a, b) {
    if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
    if (b.priority !== a.priority) return b.priority - a.priority;
    return String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hans-CN');
  }

  /**
   * 预处理：合并子待办、标记隐藏项。
   * 规则：
   *  - 顶层（parent_id 为空）= 正常展示与统计；
   *  - 子待办若父级**有**截止日 → 折叠进父级（只记 childCount），避免同一件事算两次；
   *  - 子待办若父级**没有**截止日 → 提升为独立条目，否则它的截止日会被彻底忽略。
   */
  function prepare(todos, nowMs, opts) {
    var list = Array.isArray(todos) ? todos : [];
    var byId = Object.create(null);
    list.forEach(function (t) { if (t && t.id != null) byId[t.id] = t; });

    var items = list.map(function (t) {
      var d = describe(t, nowMs, opts);
      d.title = (t && t.title) || '';
      d.raw = t;
      d.parentId = t && t.parent_id != null ? t.parent_id : null;
      d.pinned = !!(t && t.pinned);
      d.childCount = 0;
      d.hidden = false;
      d.promoted = false;
      return d;
    });

    var byIdItem = Object.create(null);
    items.forEach(function (it) { if (it.id != null) byIdItem[it.id] = it; });

    items.forEach(function (it) {
      if (it.parentId == null) return;
      var parent = byIdItem[it.parentId];
      if (!parent) { it.promoted = true; return; }          // 父级不在本次列表里
      var parentHasDue = parent.status !== 'none' && parent.status !== 'done';
      if (parentHasDue) {
        parent.childCount += 1;
        it.hidden = true;
      } else {
        it.promoted = true;
      }
    });

    return items;
  }

  function summarize(items) {
    var s = { overdue: 0, today: 0, soon: 0, week: 0, later: 0, none: 0, done: 0, total: 0, active: 0 };
    items.forEach(function (it) {
      if (it.hidden) return;
      s[it.status] = (s[it.status] || 0) + 1;
      s.total += 1;
      if (it.status !== 'done' && it.status !== 'none') s.active += 1;
    });
    return s;
  }

  var GROUP_TITLES = {
    overdue: '已逾期',
    today: '今天到期',
    soon: '临期',
    week: '一周内',
    later: '更远',
    none: '未排期',
    done: '已完成'
  };

  function group(items, opts) {
    opts = opts || {};
    var buckets = {};
    STATUS_ORDER.forEach(function (k) { buckets[k] = []; });
    items.forEach(function (it) {
      if (it.hidden) return;
      if (it.status === 'done' && !opts.showDone) return;
      (buckets[it.status] || buckets.later).push(it);
    });
    Object.keys(buckets).forEach(function (k) { buckets[k].sort(compareItems); });

    var warnDays = opts.warnDays == null ? 3 : Number(opts.warnDays);
    var out = [];
    STATUS_ORDER.forEach(function (k) {
      var arr = buckets[k];
      if (!arr.length) return;
      if (k === 'soon' && warnDays === 3) out.push({ key: k, title: '3 天内', items: arr });
      else out.push({ key: k, title: GROUP_TITLES[k] || k, items: arr });
    });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* 提醒                                                               */
  /* ------------------------------------------------------------------ */

  /** 提醒去重键：同一待办 + 同一截止时刻 + 同一阶段，只提醒一次。 */
  function remindKey(item) {
    return [item.id, item.dueMs, item.status].join(':');
  }

  /**
   * 挑选本次需要推送的提醒。
   * 只在「已逾期 / 今天 / 临期」三档触发；按紧迫度排序，限流 maxPerRun。
   */
  function pickReminders(items, opts) {
    opts = opts || {};
    var max = opts.maxPerRun == null ? 3 : opts.maxPerRun;
    var seen = opts.seen || null;
    var nowMs = opts.nowMs || Date.now();
    var cooldownMs = (opts.cooldownHours == null ? 12 : opts.cooldownHours) * 3600000;

    var picked = items
      .filter(function (it) { return !it.hidden && it.warn && it.status !== 'done'; })
      .sort(compareItems)
      .filter(function (it) {
        if (!seen) return true;
        var at = seen[remindKey(it)];
        return !at || (nowMs - at) > cooldownMs;
      })
      .slice(0, Math.max(0, max));

    return picked.map(function (it) {
      var body;
      if (it.status === 'overdue') body = '已逾期 ' + -it.days + ' 天 · 截止 ' + it.dueText;
      else if (it.status === 'today') body = it.hasTime
        ? (it.dueTimePassed ? '今天 ' + formatDue(it.dueMs).slice(-5) + ' 已过截止时刻' : '今天 ' + formatDue(it.dueMs).slice(-5) + ' 截止')
        : '今天截止（全天）';
      else body = '还有 ' + it.days + ' 天 · 截止 ' + it.dueText;
      return {
        key: remindKey(it),
        id: it.id,
        status: it.status,
        title: it.title || '待办',
        body: body
      };
    });
  }

  /* ------------------------------------------------------------------ */
  /* 跨天刷新                                                           */
  /* ------------------------------------------------------------------ */

  /** 距下一个「业务日零点」还有多少毫秒（再加 1.5s 余量，确保已跨过边界）。 */
  function msUntilNextDayStart(nowMs, dayStartHour) {
    var h = clampHour(dayStartHour);
    var d = new Date(nowMs);
    var next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, 0, 0, 0);
    if (next.getTime() <= nowMs) next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, h, 0, 0, 0);
    return Math.max(1000, next.getTime() - nowMs + 1500);
  }

  /* ------------------------------------------------------------------ */

  return {
    DAY_MS: DAY_MS,
    STATUS_ORDER: STATUS_ORDER,
    STATUS_META: STATUS_META,
    dayIndex: dayIndex,
    parseDue: parseDue,
    hasTimePart: hasTimePart,
    formatDue: formatDue,
    formatDueCompact: formatDueCompact,
    describe: describe,
    prepare: prepare,
    summarize: summarize,
    group: group,
    compareItems: compareItems,
    remindKey: remindKey,
    pickReminders: pickReminders,
    msUntilNextDayStart: msUntilNextDayStart
  };
});

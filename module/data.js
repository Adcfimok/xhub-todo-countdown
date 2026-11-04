/*!
 * 卡片数据适配层
 * ---------------------------------------------------------------
 * 唯一数据源：宿主桥 xhub.data.todos.list()（x-hub 内置 SQLite 待办）。
 * 预览时的模拟数据由 shared/mock-bridge.js 在**同一接口**后面提供，
 * 所以适配层不需要区分“真后端/假后端”。
 *
 * 这一层只做三件事：
 *   1. 取数（带超时、错误归一）
 *   2. 字段归一（宿主字段 → 卡片模型，容忍类型/单位/缺字段差异）
 *   3. 暴露加载状态
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.XTodoData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEFAULT_TIMEOUT = 8000;

  /* ---------------- 字段归一 ---------------- */

  function toNumber(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = typeof v === 'number' ? v : Number(v);
    return isFinite(n) ? n : null;
  }

  /**
   * 时间戳归一：毫秒为主，兼容秒级（10 位）与字符串。
   * 后端差异：老数据/外部导入可能把 due_at 存成秒，直接当毫秒用会显示成 1970 年。
   */
  function toMs(v) {
    var n = toNumber(v);
    if (n === null || n <= 0) return null;
    if (n < 1e11) n = n * 1000;          // 秒级 → 毫秒
    if (n < 1e11 || n > 8.64e15) return null;
    return n;
  }

  function toBool(v) {
    if (v === true || v === 1) return true;
    if (v === false || v === 0 || v === null || v === undefined) return false;
    var s = String(v).toLowerCase();
    return s === '1' || s === 'true' || s === 'yes';
  }

  function toText(v, fallback) {
    if (v === null || v === undefined) return fallback;
    var s = String(v).replace(/\s+/g, ' ').trim();
    return s || fallback;
  }

  /**
   * 单条待办 → 卡片模型。
   * 未知字段一律忽略（后端加字段不会影响卡片），缺字段走默认值。
   */
  function normalizeTodo(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var id = raw.id !== undefined && raw.id !== null ? raw.id : null;
    if (id === null) return null;                 // 没有主键的行无法渲染，直接丢弃

    var priority = toNumber(raw.priority);
    priority = priority === null ? 0 : Math.min(2, Math.max(0, priority));

    return {
      id: id,
      title: toText(raw.title, '（未命名待办）'),
      dueAt: toMs(raw.due_at !== undefined ? raw.due_at : raw.dueAt),
      done: toBool(raw.done),
      priority: priority,
      parentId: raw.parent_id !== undefined ? raw.parent_id : (raw.parentId !== undefined ? raw.parentId : null),
      repeatMode: toText(raw.repeat_mode || raw.repeatMode, 'once'),
      description: raw.description == null ? '' : String(raw.description),
      completedAt: raw.completed_at || raw.completedAt || null,
      /* 同时保留原始对象：倒计时计算用宿主字段即可，但排查问题时能对得上 */
      raw: raw
    };
  }

  /** 列表响应 → 数组。兼容裸数组与 { data | items | rows } 包装。 */
  function unwrapList(res) {
    if (Array.isArray(res)) return res;
    if (!res || typeof res !== 'object') return [];
    var keys = ['data', 'items', 'rows', 'list'];
    for (var i = 0; i < keys.length; i++) {
      if (Array.isArray(res[keys[i]])) return res[keys[i]];
    }
    return [];
  }

  /** 错误 → 可读文案（宿主错误码已在 bridge 里带到 e.code） */
  function toMessage(err) {
    if (!err) return '未知错误';
    var code = err.code || '';
    if (code === 'PERMISSION_DENIED') return '缺少 data:read 权限';
    if (code === 'NOT_FOUND') return '待办数据不存在';
    if (code === 'TIMEOUT') return '读取超时';
    var msg = err.message || String(err);
    if (/permission/i.test(msg)) return '缺少 data:read 权限';
    return msg.length > 60 ? msg.slice(0, 60) + '…' : msg;
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        var e = new Error('读取超时');
        e.code = 'TIMEOUT';
        reject(e);
      }, ms);
      Promise.resolve(promise).then(function (v) {
        clearTimeout(timer);
        resolve(v);
      }, function (e) {
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  /**
   * 取数。返回统一结构，调用方不需要 try/catch：
   *   { status: 'ready' | 'error', todos, error, at, dropped }
   * dropped = 因缺主键被丢弃的行数，便于排查后端异常。
   */
  async function fetchTodos(options) {
    options = options || {};
    var api = (typeof window !== 'undefined' ? window : globalThis).xhub;
    var at = Date.now();

    if (!api || !api.data || !api.data.todos || typeof api.data.todos.list !== 'function') {
      return { status: 'error', todos: [], error: '未检测到宿主待办接口', at: at, dropped: 0 };
    }

    try {
      var res = await withTimeout(api.data.todos.list(), options.timeoutMs || DEFAULT_TIMEOUT);
      var rows = unwrapList(res);
      var todos = [];
      var dropped = 0;
      for (var i = 0; i < rows.length; i++) {
        var t = normalizeTodo(rows[i]);
        if (t) todos.push(t);
        else dropped++;
      }
      return { status: 'ready', todos: todos, error: null, at: at, dropped: dropped };
    } catch (err) {
      return { status: 'error', todos: [], error: toMessage(err), at: at, dropped: 0 };
    }
  }

  return {
    DEFAULT_TIMEOUT: DEFAULT_TIMEOUT,
    normalizeTodo: normalizeTodo,
    unwrapList: unwrapList,
    toMs: toMs,
    toBool: toBool,
    toMessage: toMessage,
    fetchTodos: fetchTodos
  };
});

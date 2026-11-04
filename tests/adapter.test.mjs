/**
 * 数据适配层测试：node tests/adapter.test.mjs
 * 只测纯函数与取数契约，不碰 DOM。
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const D = require('../module/data.js');

let pass = 0;
const fails = [];
const eq = (name, a, b) => {
  if (Object.is(a, b)) pass++;
  else fails.push(`${name}  →  ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};
const ok = (name, cond, extra) => {
  if (cond) pass++;
  else fails.push(`${name}${extra === undefined ? '' : '  →  ' + JSON.stringify(extra)}`);
};

const TODAY_MS = new Date(2026, 10, 4, 12, 0).getTime();

/* ---------- 字段归一 ---------- */
{
  const t = D.normalizeTodo({
    id: 7, title: '  报销单   提交  ', due_at: TODAY_MS, done: 0,
    priority: '2', parent_id: 3, repeat_mode: '', description: null,
    unknown_field: 'ignored'
  });
  eq('id 保留', t.id, 7);
  eq('标题压缩空白', t.title, '报销单 提交');
  eq('priority 字符串转数字', t.priority, 2);
  eq('repeat_mode 空串回落 once', t.repeatMode, 'once');
  eq('description null → 空串', t.description, '');
  eq('done 0 → false', t.done, false);
  eq('parent_id 透传', t.parentId, 3);
  ok('未知字段不进入模型', !('unknown_field' in t));
}

{
  const t = D.normalizeTodo({ id: '9', title: null, due_at: null, done: 'true' });
  eq('id 字符串保留', t.id, '9');
  eq('缺标题用占位', t.title, '（未命名待办）');
  eq('无截止 → null', t.dueAt, null);
  eq('done "true" → true', t.done, true);
  eq('priority 缺省 0', t.priority, 0);
}

{
  eq('无 id 的行被丢弃', D.normalizeTodo({ title: 'x' }), null);
  eq('null 输入返回 null', D.normalizeTodo(null), null);
  eq('非对象返回 null', D.normalizeTodo('oops'), null);
}

/* ---------- 时间单位容错 ---------- */
{
  const sec = Math.floor(TODAY_MS / 1000);
  eq('秒级时间戳自动 ×1000', D.toMs(sec), sec * 1000);
  eq('毫秒时间戳原样', D.toMs(TODAY_MS), TODAY_MS);
  eq('字符串时间戳', D.toMs(String(TODAY_MS)), TODAY_MS);
  eq('0 → null', D.toMs(0), null);
  eq('负数 → null', D.toMs(-1), null);
  eq('NaN → null', D.toMs('abc'), null);
  eq('超范围 → null', D.toMs(9e15), null);
}

/* ---------- 布尔容错 ---------- */
{
  eq('done 1', D.toBool(1), true);
  eq('done "1"', D.toBool('1'), true);
  eq('done "yes"', D.toBool('yes'), true);
  eq('done 0', D.toBool(0), false);
  eq('done null', D.toBool(null), false);
}

/* ---------- 列表包装容错 ---------- */
{
  eq('裸数组', D.unwrapList([{ id: 1 }]).length, 1);
  eq('{data}', D.unwrapList({ data: [{ id: 1 }, { id: 2 }] }).length, 2);
  eq('{items}', D.unwrapList({ items: [{ id: 1 }] }).length, 1);
  eq('{rows}', D.unwrapList({ rows: [] }).length, 0);
  eq('null → 空数组', D.unwrapList(null).length, 0);
  eq('未知包装 → 空数组', D.unwrapList({ foo: 1 }).length, 0);
}

/* ---------- 取数：成功 ---------- */
{
  globalThis.xhub = {
    data: {
      todos: {
        list: async () => ({ data: [
          { id: 1, title: 'A', due_at: TODAY_MS, done: 0 },
          { title: '没有 id，应丢弃' },
          { id: 2, title: 'B', due_at: null, done: 1 }
        ] })
      }
    }
  };
  const res = await D.fetchTodos();
  eq('成功状态', res.status, 'ready');
  eq('保留 2 条', res.todos.length, 2);
  eq('记录丢弃条数', res.dropped, 1);
  eq('错误为空', res.error, null);
  ok('返回时间戳', typeof res.at === 'number');
}

/* ---------- 取数：错误归一 ---------- */
{
  globalThis.xhub = { data: { todos: { list: async () => { const e = new Error('boom'); e.code = 'PERMISSION_DENIED'; throw e; } } } };
  const res = await D.fetchTodos();
  eq('错误状态', res.status, 'error');
  eq('权限错误文案', res.error, '缺少 data:read 权限');
  eq('错误时清空数据', res.todos.length, 0);
}

{
  globalThis.xhub = { data: { todos: { list: () => new Promise(() => {}) } } };
  const t0 = Date.now();
  const res = await D.fetchTodos({ timeoutMs: 120 });
  ok('超时被捕获', res.status === 'error' && /超时/.test(res.error), res.error);
  ok('超时不早于设定值', Date.now() - t0 >= 100);
}

{
  globalThis.xhub = null;
  const res = await D.fetchTodos();
  eq('无宿主 → 错误', res.status, 'error');
  ok('无宿主提示可读', /宿主/.test(res.error), res.error);
}

/* ---------- 结果 ---------- */
const total = pass + fails.length;
if (fails.length) {
  console.error(`\n✗ 失败 ${fails.length} / ${total}`);
  fails.forEach((f) => console.error('   - ' + f));
  process.exit(1);
}
console.log(`✓ 数据适配层全部通过：${total} 项断言`);

/**
 * 倒计时核心逻辑的单元测试（node --test 不依赖，直接 node 运行）
 *   node tests/countdown.test.mjs
 * 想顺带验证夏令时，可加 TZ：
 *   TZ=America/New_York node tests/countdown.test.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const X = require('../shared/countdown.js');

let pass = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) { pass++; }
  else failures.push(name + (extra === undefined ? '' : '  →  ' + JSON.stringify(extra)));
}
function eq(name, actual, expected) {
  ok(name, Object.is(actual, expected), { actual, expected });
}

/* 以「本地时间」构造：算法本身就是按本地自然日算的 */
const at = (y, m, d, hh = 0, mm = 0, ss = 0) => new Date(y, m - 1, d, hh, mm, ss).getTime();
const todo = (due, extra) => Object.assign({ id: 1, title: 'T', done: false, due_at: due, priority: 0, repeat_mode: 'once', parent_id: null }, extra || {});

const NOW = at(2026, 11, 3, 10, 0);          // 2026-11-03 10:00 周二
const opts = { warnDays: 3, dayStartHour: 0 };

/* ---------- 1. 今天 / 明天 / 后天 ---------- */
{
  const d0 = X.describe(todo(at(2026, 11, 3, 0, 0)), NOW, opts);
  eq('今天 00:00 → days=0', d0.days, 0);
  eq('今天 00:00 → status=today', d0.status, 'today');
  eq('今天 00:00 → 含当天剩 1 天', d0.remainingInclusive, 1);
  eq('今天 00:00 → 无时分', d0.hasTime, false);

  const d1 = X.describe(todo(at(2026, 11, 3, 23, 59)), NOW, opts);
  eq('今天 23:59 → status=today', d1.status, 'today');
  eq('今天 23:59 → 有截止时刻', d1.hasTime, true);
  eq('今天 23:59 → 未过点', d1.dueTimePassed, false);

  const early = X.describe(todo(at(2026, 11, 3, 9, 0)), NOW, opts);
  eq('今天 09:00（已过）仍在今天组', early.status, 'today');
  eq('今天 09:00 → 标记已过时刻', early.dueTimePassed, true);
  ok('今天 09:00 → caption 提示已过', /已过/.test(early.caption), early.caption);

  const tm = X.describe(todo(at(2026, 11, 4, 0, 0)), NOW, opts);
  eq('明天 → days=1', tm.days, 1);
  eq('明天 → 文案', tm.badge, '明天');
  eq('明天 → status=soon', tm.status, 'soon');

  const dat = X.describe(todo(at(2026, 11, 5, 12, 0)), NOW, opts);
  eq('后天 → 文案', dat.badge, '后天');
}

/* ---------- 2. 逾期 ---------- */
{
  const y1 = X.describe(todo(at(2026, 11, 2, 23, 59)), NOW, opts);
  eq('昨天 23:59 → days=-1', y1.days, -1);
  eq('昨天 → status=overdue', y1.status, 'overdue');
  eq('昨天 → 逾期 1 天', y1.badgeNum, 1);
  eq('昨天 → 含当天口径 = 0', y1.remainingInclusive, 0);

  const y5 = X.describe(todo(at(2026, 10, 29, 0, 0)), NOW, opts);
  eq('5 天前 → 逾期 5 天', y5.badgeNum, 5);
  eq('5 天前 → 含当天口径 = -4', y5.remainingInclusive, -4);
  ok('逾期文案', /逾期 5 天/.test(y5.caption), y5.caption);
}

/* ---------- 3. 分档与阈值 ---------- */
{
  eq('+3 → soon', X.describe(todo(at(2026, 11, 6, 12, 0)), NOW, opts).status, 'soon');
  eq('+4 → week', X.describe(todo(at(2026, 11, 7, 12, 0)), NOW, opts).status, 'week');
  eq('+7 → week', X.describe(todo(at(2026, 11, 10, 12, 0)), NOW, opts).status, 'week');
  eq('+8 → later', X.describe(todo(at(2026, 11, 11, 12, 0)), NOW, opts).status, 'later');
  eq('warnDays=7 时 +5 → soon', X.describe(todo(at(2026, 11, 8, 12, 0)), NOW, { warnDays: 7 }).status, 'soon');
  eq('warnDays=0 时 +1 → week', X.describe(todo(at(2026, 11, 4, 12, 0)), NOW, { warnDays: 0 }).status, 'week');
  eq('warnDays=0 时今天仍是 today', X.describe(todo(at(2026, 11, 3, 12, 0)), NOW, { warnDays: 0 }).status, 'today');
}

/* ---------- 4. 日界线（dayStartHour）---------- */
{
  // 凌晨 3 点仍算「昨天」，业务日 04:00 切换
  const nowEarly = at(2026, 11, 3, 3, 0);
  const d = X.describe(todo(at(2026, 11, 2, 23, 0)), nowEarly, { warnDays: 3, dayStartHour: 4 });
  eq('04:00 日界线：03:00 属于前一天', d.days, 0);
  eq('04:00 日界线：昨晚 23:00 = 今天', d.status, 'today');

  const nowLate = at(2026, 11, 3, 5, 0);
  const d2 = X.describe(todo(at(2026, 11, 2, 23, 0)), nowLate, { warnDays: 3, dayStartHour: 4 });
  eq('04:00 日界线：05:00 已跨日 → 逾期', d2.status, 'overdue');
  eq('04:00 日界线：逾期 1 天', d2.badgeNum, 1);
}

/* ---------- 5. 非法 / 缺失截止时间 ---------- */
{
  const cases = [null, undefined, '', 0, -1, NaN, 'abc', 8.65e15, Infinity];
  cases.forEach((v, i) => {
    const d = X.describe(todo(v), NOW, opts);
    eq('非法 due_at[' + i + '] → none', d.status, 'none');
    eq('非法 due_at[' + i + '] → 无数字', d.badgeNum, null);
  });
  eq('parseDue 年份越界', X.parseDue(new Date(2400, 0, 1).getTime()).ok, false);
  eq('parseDue 正常值', X.parseDue(NOW).ok, true);
}

/* ---------- 6. 已完成 ---------- */
{
  const d = X.describe(todo(at(2026, 10, 1, 9, 0), { done: true }), NOW, opts);
  eq('已完成 → status=done', d.status, 'done');
  eq('已完成 → 不显示天数', d.badgeNum, null);
  const s = X.summarize(X.prepare([{ id: 1, title: 'A', due_at: at(2026, 10, 1), done: true }], NOW, opts));
  eq('已完成不计入逾期', s.overdue, 0);
  eq('已完成计入 done', s.done, 1);
}

/* ---------- 7. 跨年 / 闰年 / 夏令时 ---------- */
{
  const ny = at(2026, 12, 31, 22, 0);
  eq('跨年 12-31 → 01-01 = 1 天', X.describe(todo(at(2027, 1, 1, 0, 0)), ny, opts).days, 1);

  const leap = at(2028, 2, 28, 12, 0);
  eq('闰年 02-28 → 02-29 = 1 天', X.describe(todo(at(2028, 2, 29, 12, 0)), leap, opts).days, 1);

  const dst = at(2026, 3, 7, 12, 0);           // 美东 3/8 进入夏令时（23 小时的一天）
  eq('夏令时跨越仍为 2 天', X.describe(todo(at(2026, 3, 9, 12, 0)), dst, opts).days, 2);

  const dstFall = at(2026, 10, 31, 12, 0);     // 11/1 退出夏令时（25 小时的一天）
  eq('夏令时回拨仍为 2 天', X.describe(todo(at(2026, 11, 2, 12, 0)), dstFall, opts).days, 2);
}

/* ---------- 8. 子待办折叠与提升 ---------- */
{
  const parentWithDue = { id: 1, title: '父', due_at: at(2026, 11, 6, 0, 0), done: false, parent_id: null };
  const child = { id: 2, title: '子', due_at: at(2026, 11, 4, 0, 0), done: false, parent_id: 1 };
  const items = X.prepare([parentWithDue, child], NOW, opts);
  eq('父有截止 → 子被折叠', items[1].hidden, true);
  eq('父记录子项数量', items[0].childCount, 1);

  const parentNoDue = { id: 3, title: '父2', due_at: null, done: false, parent_id: null };
  const child2 = { id: 4, title: '子2', due_at: at(2026, 11, 4, 0, 0), done: false, parent_id: 3 };
  const items2 = X.prepare([parentNoDue, child2], NOW, opts);
  eq('父无截止 → 子提升展示', items2[1].hidden, false);
  eq('提升后计入统计', X.summarize(items2).soon, 1);

  const orphan = X.prepare([{ id: 9, title: '孤儿', due_at: at(2026, 11, 4), parent_id: 99 }], NOW, opts);
  eq('父级缺失 → 不隐藏', orphan[0].hidden, false);
}

/* ---------- 9. 分组与排序 ---------- */
{
  const list = [
    { id: 1, title: 'B', due_at: at(2026, 11, 6, 0, 0), priority: 0 },
    { id: 2, title: 'A', due_at: at(2026, 11, 6, 0, 0), priority: 2 },
    { id: 3, title: 'C', due_at: at(2026, 11, 4, 0, 0), priority: 0 },
    { id: 4, title: 'D', due_at: null, priority: 0 },
    { id: 5, title: 'E', due_at: at(2026, 11, 1, 0, 0), priority: 0 }
  ];
  const items = X.prepare(list, NOW, opts);
  const gs = X.group(items, opts);
  eq('分组顺序：逾期在最前', gs[0].key, 'overdue');
  eq('分组顺序：未排期在更远之后', gs[gs.length - 1].key, 'none');
  const soonGroup = gs.find((g) => g.key === 'soon');
  eq('组内先按日期升序', soonGroup.items.map((i) => i.title).join(''), 'CAB');
  const sameDay = soonGroup.items.filter((i) => i.days === 3);
  eq('同一天按优先级降序', sameDay[0].title, 'A');
  eq('3 天阈值分组标题', soonGroup.title, '3 天内');

  const withDone = X.prepare([{ id: 1, title: 'x', due_at: at(2026, 11, 4), done: true }], NOW, opts);
  eq('默认隐藏已完成分组', X.group(withDone, opts).some((g) => g.key === 'done'), false);
  eq('可开启已完成分组', X.group(withDone, { ...opts, showDone: true }).some((g) => g.key === 'done'), true);
}

/* ---------- 10. 统计 ---------- */
{
  const list = [
    { id: 1, title: 'a', due_at: at(2026, 10, 30) },            // overdue
    { id: 2, title: 'b', due_at: at(2026, 11, 3, 18, 0) },      // today
    { id: 3, title: 'c', due_at: at(2026, 11, 5) },             // soon
    { id: 4, title: 'd', due_at: at(2026, 11, 9) },             // week
    { id: 5, title: 'e', due_at: at(2026, 12, 1) },             // later
    { id: 6, title: 'f', due_at: null },                        // none
    { id: 7, title: 'g', due_at: at(2026, 10, 1), done: true }  // done
  ];
  const s = X.summarize(X.prepare(list, NOW, opts));
  eq('统计 overdue', s.overdue, 1);
  eq('统计 today', s.today, 1);
  eq('统计 soon', s.soon, 1);
  eq('统计 week', s.week, 1);
  eq('统计 later', s.later, 1);
  eq('统计 none', s.none, 1);
  eq('统计 done', s.done, 1);
  eq('活跃待办（有截止且未完成）', s.active, 5);
}

/* ---------- 11. 提醒 ---------- */
{
  const items = X.prepare([
    { id: 1, title: '逾期项', due_at: at(2026, 10, 30) },
    { id: 2, title: '今天项', due_at: at(2026, 11, 3, 18, 0) },
    { id: 3, title: '临期项', due_at: at(2026, 11, 5) },
    { id: 4, title: '远期项', due_at: at(2026, 12, 20) },
    { id: 5, title: '未排期', due_at: null },
    { id: 6, title: '已完成', due_at: at(2026, 10, 1), done: true }
  ], NOW, opts);

  const r = X.pickReminders(items, { nowMs: NOW, maxPerRun: 10 });
  eq('提醒只覆盖逾期/今天/临期', r.length, 3);
  eq('提醒按紧迫度排序', r[0].title, '逾期项');
  eq('提醒条数限流', X.pickReminders(items, { nowMs: NOW, maxPerRun: 1 }).length, 1);

  const seen = {};
  seen[X.remindKey(items[0])] = NOW - 3600000;      // 1 小时前提醒过
  const r2 = X.pickReminders(items, { nowMs: NOW, maxPerRun: 10, seen, cooldownHours: 12 });
  eq('冷却期内不重复', r2.some((x) => x.id === 1), false);

  const seen2 = {};
  seen2[X.remindKey(items[0])] = NOW - 13 * 3600000; // 13 小时前
  const r3 = X.pickReminders(items, { nowMs: NOW, maxPerRun: 10, seen: seen2, cooldownHours: 12 });
  eq('超过冷却期再次提醒', r3.some((x) => x.id === 1), true);

  ok('提醒文案含逾期天数', /逾期 4 天/.test(r[0].body), r[0].body);
}

/* ---------- 12. 跨天定时器 ---------- */
{
  const delay = X.msUntilNextDayStart(NOW, 0);
  ok('跨天延时在 (0, 24h] 内', delay > 0 && delay <= X.DAY_MS, delay);
  const nextAt = NOW + delay - 1500;
  const d = new Date(nextAt);
  eq('跨天延时落在次日 00:00', d.getHours() === 0 && d.getMinutes() === 0, true);

  const delay4 = X.msUntilNextDayStart(at(2026, 11, 3, 2, 0), 4);
  const n4 = new Date(at(2026, 11, 3, 2, 0) + delay4 - 1500);
  eq('dayStartHour=4 时落在 04:00', n4.getHours() === 4 && n4.getMinutes() === 0, true);
}

/* ---------- 13. 格式化 ---------- */
{
  eq('formatDue 含时分', X.formatDue(at(2026, 11, 6, 18, 30)), '2026年11月6日 周五 18:30');
  eq('formatDue 纯日期省略时间', X.formatDue(at(2026, 11, 6, 0, 0)), '2026年11月6日 周五');
  eq('formatDueCompact', X.formatDueCompact(at(2026, 11, 6, 18, 30)), '11-06 18:30');
  eq('formatDue 非法值返回空串', X.formatDue(null), '');
  eq('hasTimePart 00:00 = false', X.hasTimePart(at(2026, 11, 6, 0, 0)), false);
  eq('hasTimePart 09:30 = true', X.hasTimePart(at(2026, 11, 6, 9, 30)), true);
}

/* ---------- 结果 ---------- */
const total = pass + failures.length;
if (failures.length) {
  console.error('\n✗ 失败 ' + failures.length + ' / ' + total);
  failures.forEach((f) => console.error('   - ' + f));
  process.exit(1);
} else {
  console.log('✓ 全部通过：' + total + ' 项断言（TZ=' + (process.env.TZ || '系统默认') + '）');
}

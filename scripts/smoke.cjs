/* 冒烟自检：用最小 DOM 模拟执行 app.js，捕获运行时错误。node scripts/smoke.cjs */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const D = JSON.parse(fs.readFileSync(path.join(root, 'data/dashboard.json'), 'utf8'));

function El(id) {
  return {
    id, innerHTML: '', textContent: '', hidden: false, style: {}, dataset: {}, value: '',
    clientWidth: 1100, offsetWidth: 200, offsetHeight: 100,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return 'false'; },
    addEventListener() {}, querySelector() { return El('child'); }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 1100, height: 360 }; },
    insertAdjacentHTML() {},
  };
}
const cache = new Map();
const document = {
  querySelector(s) { if (!cache.has(s)) cache.set(s, El(s)); return cache.get(s); },
  querySelectorAll() { return []; },
  body: El('body'),
};
const window = { __DASHBOARD__: D, addEventListener() {} };
const ctx = vm.createContext({ window, document, console });
try {
  vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), ctx, { filename: 'app.js' });
} catch (e) {
  console.error('SMOKE FAIL:', e.stack);
  process.exit(1);
}
const checks = [
  ['stats', cache.get('#stats')],
  ['chart', cache.get('#chart')],
  ['compare-strip', cache.get('#compare-strip')],
  ['signal-box', cache.get('#signal-box')],
  ['signal-foot', cache.get('#signal-foot')],
  ['scenario-table', cache.get('#scenario-table')],
  ['scenario-foot', cache.get('#scenario-foot')],
  ['cal-stats', cache.get('#cal-stats')],
  ['reasons', cache.get('#reasons')],
  ['anchor-table tbody', cache.get('#anchor-table tbody')],
  ['notes', cache.get('#notes')],
  ['events', cache.get('#events')],
  ['source-list', cache.get('#source-list')],
  ['pool-chips', cache.get('#pool-chips')],
];
let bad = 0;
for (const [name, el] of checks) {
  const len = el ? (el.innerHTML || '').length : 0;
  console.log((len > 40 ? 'OK  ' : 'FAIL') + '  ' + name + '  ' + len + ' chars');
  if (len <= 40) bad++;
}
console.log('notice:', cache.get('#notice-text').textContent);
console.log('index:', cache.get('#idx-name').textContent, '· indices in data:', (D.indices || []).length);
console.log('chart-foot:', cache.get('#chart-foot').innerHTML.slice(0, 90));
if (bad) process.exit(1);
if (!(D.indices || []).length) { console.error('SMOKE FAIL: 缺少 indices'); process.exit(1); }
const ev = D.events || [];
if (ev.length < 6) { console.error('SMOKE FAIL: 事件流少于 6 条'); process.exit(1); }
if (ev.some((e) => !e.date || !e.title || !e.url)) { console.error('SMOKE FAIL: 事件缺少 date/title/url'); process.exit(1); }
console.log('events:', ev.length, '条，全部有出处 ·', ev[ev.length - 1].date, ev[ev.length - 1].source);
const sc = (D.indices || []).map((i) => i.scenario).filter(Boolean);
if (!sc.length) { console.error('SMOKE FAIL: 缺少 scenario'); process.exit(1); }
if (!sc[0].windows || !sc[0].windows.length) { console.error('SMOKE FAIL: scenario 缺少 windows'); process.exit(1); }
if (!sc[0].current) { console.error('SMOKE FAIL: scenario 缺少 current'); process.exit(1); }
console.log('scenario windows:', sc[0].windows.map((w) => `${w.id}(pool ${w.samplePool})`).join(' '));
for (const w of sc[0].windows) {
  console.log('  ' + w.name + ': ' + w.rows.map((r) => `${r.id} n=${r.n} med20=${r.f20.med}% win=${r.f20.win}%`).join(' | '));
}
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const count = (re) => (html.match(re) || []).length;
const segs = { 'data-range': 4, 'data-scenario-range': 4, 'data-index': 2 };
for (const [attr, want] of Object.entries(segs)) {
  const got = count(new RegExp(`data-${attr.slice(5)}="`, 'g'));
  console.log((got === want ? 'OK  ' : 'FAIL') + '  ' + attr + ' 按钮 ' + got + ' 个（应为 ' + want + '）');
  if (got !== want) bad++;
}
if (bad) process.exit(1);

/* 冒烟自检：用最小 DOM 模拟执行 app.js，捕获运行时错误。node scripts/smoke.cjs */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const D = JSON.parse(fs.readFileSync(path.join(root, 'data/dashboard.json'), 'utf8'));

function El(id, classes) {
  const set = new Set(classes || []);
  return {
    id, innerHTML: '', textContent: '', hidden: false, style: {}, dataset: {}, value: '',
    clientWidth: 1100, offsetWidth: 200, offsetHeight: 100, parentNode: null, tagName: 'DIV',
    classList: {
      add(c) { set.add(c); }, remove(c) { set.delete(c); },
      toggle(c, on) { if (on === undefined) { set.has(c) ? set.delete(c) : set.add(c); } else if (on) set.add(c); else set.delete(c); },
      contains(c) { return set.has(c); },
    },
    setAttribute() {}, getAttribute() { return 'false'; },
    addEventListener() {}, querySelector() { return El('child'); }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 1100, height: 360 }; },
    insertAdjacentHTML() {}, scrollIntoView() {},
  };
}

const cache = new Map();
const get = (s) => { if (!cache.has(s)) cache.set(s, El(s)); return cache.get(s); };

/* 四个模块与四个导航项，让导航逻辑真正被执行到 */
const sections = ['daily', 'calibration', 'method', 'sources'].map((id) => El(id, ['section']));
const navItems = sections.map((s) => { const a = El('nav-' + s.id, ['nav-item']); a.dataset.nav = s.id; return a; });

const method = sections[2];
const n7 = El('N7');           // 脚注节点：自身不是模块，父级是 #method
n7.parentNode = method;

const listeners = {};
const document = {
  body: El('body'),
  querySelector(s) { if (s === '#N7') return n7; return get(s); },
  querySelectorAll(s) {
    if (s === '.section') return sections;
    if (s === '.nav-item') return navItems;
    return [];
  },
  addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
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
if (bad) process.exit(1);
if (!(D.indices || []).length) { console.error('SMOKE FAIL: 缺少 indices'); process.exit(1); }

/* ---- 事件流 ---- */
const ev = D.events || [];
if (ev.length < 6) { console.error('SMOKE FAIL: 事件流少于 6 条'); process.exit(1); }
if (ev.some((e) => !e.date || !e.title || !e.url)) { console.error('SMOKE FAIL: 事件缺少 date/title/url'); process.exit(1); }
const sorted = ev.every((e, i) => i === 0 || String(ev[i - 1].date) <= String(e.date));
console.log((sorted ? 'OK  ' : 'FAIL') + '  events ' + ev.length + ' 条，按日期升序，全部有出处 · 最近 ' + ev[ev.length - 1].date + ' ' + ev[ev.length - 1].source);
if (!sorted) bad++;

/* ---- 情景窗口 ---- */
const sc = (D.indices || []).map((i) => i.scenario).filter(Boolean);
if (!sc.length) { console.error('SMOKE FAIL: 缺少 scenario'); process.exit(1); }
if (!sc[0].windows || !sc[0].windows.length) { console.error('SMOKE FAIL: scenario 缺少 windows'); process.exit(1); }
if (!sc[0].current) { console.error('SMOKE FAIL: scenario 缺少 current'); process.exit(1); }
console.log('scenario windows:', sc[0].windows.map((w) => `${w.id}(pool ${w.samplePool})`).join(' '));

/* ---- 导航：点击左侧导航只显示对应模块 ---- */
const click = (href) => {
  const anchor = { tagName: 'A', parentNode: null, getAttribute: (k) => (k === 'href' ? href : null) };
  let prevented = false;
  (listeners.click || []).forEach((fn) => fn({ target: anchor, preventDefault() { prevented = true; } }));
  return prevented;
};
if (!(listeners.click || []).length) { console.error('SMOKE FAIL: 未注册点击监听'); process.exit(1); }

const visible = () => sections.filter((s) => !s.hidden).map((s) => s.id);
const active = () => navItems.filter((a) => a.classList.contains('is-active')).map((a) => a.dataset.nav);

click('#calibration');
const afterCal = visible();
const navCal = active();
console.log((afterCal.length === 1 && afterCal[0] === 'calibration' ? 'OK  ' : 'FAIL') + '  点「校准层」后仅显示 ' + afterCal.join(',') + ' · 导航高亮 ' + navCal.join(','));
if (!(afterCal.length === 1 && afterCal[0] === 'calibration')) bad++;
if (!(navCal.length === 1 && navCal[0] === 'calibration')) bad++;

click('#N7');
const afterFn = visible();
console.log((afterFn.length === 1 && afterFn[0] === 'method' ? 'OK  ' : 'FAIL') + '  点脚注 [N7] 后自动展开 ' + afterFn.join(','));
if (!(afterFn.length === 1 && afterFn[0] === 'method')) bad++;

click('#daily');
const afterDaily = visible();
console.log((afterDaily.length === 1 && afterDaily[0] === 'daily' ? 'OK  ' : 'FAIL') + '  回到「日频台账」仅显示 ' + afterDaily.join(','));
if (!(afterDaily.length === 1 && afterDaily[0] === 'daily')) bad++;
if (bad) process.exit(1);

/* ---- 静态结构 ---- */
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const count = (re) => (html.match(re) || []).length;
const segs = { 'data-range': 4, 'data-scenario-range': 4, 'data-index': 2 };
for (const [attr, want] of Object.entries(segs)) {
  const got = count(new RegExp(`data-${attr.slice(5)}="`, 'g'));
  console.log((got === want ? 'OK  ' : 'FAIL') + '  ' + attr + ' 按钮 ' + got + ' 个（应为 ' + want + '）');
  if (got !== want) bad++;
}
const hiddenSections = (html.match(/<section[^>]*\shidden/g) || []).length;
console.log((hiddenSections === 3 ? 'OK  ' : 'FAIL') + '  非默认模块默认 hidden ' + hiddenSections + ' 个（应为 3）');
if (hiddenSections !== 3) bad++;
if (bad) process.exit(1);

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
console.log('chart-foot:', cache.get('#chart-foot').innerHTML.slice(0, 90));
if (bad) process.exit(1);

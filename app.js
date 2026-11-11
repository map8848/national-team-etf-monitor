/* 申赎台账 · 零依赖前端。数据来自 data/dashboard.js（由 scripts/build.mjs 生成）。 */
(function () {
  'use strict';
  var D = window.__DASHBOARD__;
  if (!D) { document.body.insertAdjacentHTML('afterbegin', '<p style="padding:24px">数据文件未加载，请先运行 node scripts/build.mjs</p>'); return; }

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  function fmt(n, d) { d = d == null ? 2 : d; if (n == null || !isFinite(n)) return '—'; return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function signed(n, d) { d = d == null ? 2 : d; return (n > 0 ? '+' : n < 0 ? '-' : '') + fmt(Math.abs(n), d); }
  var PS = D.meta.poolSize;
  var last = D.latest;
  var prev = D.daily[D.daily.length - 2] || last;

  /* ---------- 顶部与侧栏 ---------- */
  $('#notice-text').textContent = D.meta.disclaimer + ' · 数据截至 ' + D.meta.tradeDate;
  $('#side-date').textContent = D.meta.tradeDate;
  $('#side-sessions').textContent = D.meta.sessions;
  $('#side-pool').textContent = PS + ' 只';
  $('#side-report').textContent = D.meta.reportDate;
  $('#foot-meta').textContent = 'method ' + D.meta.methodVersion + ' · source ' + (D.meta.sourceGeneratedAt || '—') + ' · ' + D.meta.sessions + ' 交易日';

  /* ---------- stat cards ---------- */
  function stat(label, layer, value, unit, change, cls) {
    return '<div class="stat">' +
      '<div class="stat-label">' + esc(label) + ' <span class="dim">' + esc(layer) + '</span></div>' +
      '<div class="stat-value ' + (cls || '') + '">' + value + (unit ? '<span class="stat-unit">' + esc(unit) + '</span>' : '') + '</div>' +
      '<div class="stat-change">' + change + '</div>' +
      '</div>';
  }
  var scoreVal = last.applicable ? fmt(last.score, 0) : '—';
  var scoreChange = last.applicable
    ? '近 60 日分位 <span class="dim">·</span> <span class="mono">' + (last.reasons[0] ? last.reasons[0].value : '—') + '</span> <span class="dim">依据可展开</span>'
    : '当日为净赎回，入场强度不适用 <a class="fn" href="#N5">[N5]</a>';
  $('#stats').innerHTML =
    stat('当日全池净申购', '实测 · L1 / 匿名净额', signed(last.netYi), '亿元', '较前一日 <span class="mono">' + signed(last.netYi - prev.netYi) + '</span> 亿元 <a class="fn" href="#N4">[N4]</a>', last.netYi < 0 ? 'is-neg' : '') +
    stat('疑似入场强度', '测算 · L2', scoreVal, last.applicable ? '/ 100' : '', scoreChange, last.applicable ? 'is-accent' : 'is-neg') +
    stat('池内同步净申购只数', '实测 · L1', last.breadth + '<span class="stat-unit">/ ' + PS + '</span>', '', '较前一日 <span class="mono">' + (last.breadth - prev.breadth) + '</span> 只 <span class="dim">· 连续 ' + last.streak + ' 日</span>') +
    stat('年内累计净申购', '实测 · L1', signed(last.cumYi, 2), '亿元', '自 ' + D.daily[1].date + ' 起累计 <a class="fn" href="#N1">[N1]</a>', last.cumYi < 0 ? 'is-neg' : '');

  var maxCheck = 0;
  D.calibration.check.forEach(function (c) { if (c.diffPct > maxCheck) maxCheck = c.diffPct; });
  $('#cal-stats').innerHTML =
    stat('实名锚点报告期', '实测 · L3', D.meta.reportDate, '', '上期 ' + D.meta.prevReportDate + ' <span class="dim">· 共 ' + D.calibration.holderPeriods + ' 个报告期</span>') +
    stat('锚点隐含占比冲突', '校准 · L3', D.calibration.attributionGap.conflictCount + '<span class="stat-unit">/ ' + PS + '</span>', '', '实名份额若不变，占比将超过 100%') +
    stat('交易所口径校验', '实测 · L1', D.calibration.check.length, '项', '上交所日报 vs 本页序列，最大偏差 <span class="mono">' + fmt(maxCheck, 4) + '%</span>') +
    stat('归因误差', '校准 · L3', '未闭合', '', '待 ' + D.calibration.nextReportWindow + ' 才能回测', 'is-neg');

  /* ---------- 主图 ---------- */
  var wrap = $('#chart-wrap');
  var svg = $('#chart');
  var tip = $('#tooltip');
  var chartRows = [];
  var chartGeom = null;
  var range = 'all';

  function niceMax(v) { if (v <= 0) return 1; var e = Math.pow(10, Math.floor(Math.log10(v))); var m = v / e; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * e; }

  function renderChart() {
    var n = range === 'all' ? D.daily.length : Math.min(Number(range), D.daily.length);
    chartRows = D.daily.slice(-n);
    var W = Math.max(640, wrap.clientWidth || 1000);
    var H = 360;
    var pad = { l: 66, r: 66, t: 16, b: 36 };
    var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('height', H);

    var absMax = niceMax(Math.max.apply(null, chartRows.map(function (r) { return Math.abs(r.netYi); })));
    var cum = 0;
    var cums = chartRows.map(function (r) { cum += r.netYi; return cum; });
    var cumMin = Math.min.apply(null, cums.concat([0]));
    var cumMax = Math.max.apply(null, cums.concat([0]));
    var cumPad = (cumMax - cumMin) * 0.08 || 1;
    cumMin -= cumPad; cumMax += cumPad;

    var step = iw / chartRows.length;
    var bw = Math.max(1.4, step * 0.7);
    var yBar = function (v) { return pad.t + ih / 2 - (v / absMax) * (ih / 2); };
    var yCum = function (v) { return pad.t + ih - ((v - cumMin) / (cumMax - cumMin)) * ih; };
    var xAt = function (i) { return pad.l + (i + 0.5) * step; };

    var s = [];
    // 静音网格 + 左轴
    [-1, -0.5, 0, 0.5, 1].forEach(function (f) {
      var y = yBar(absMax * f);
      s.push('<line x1="' + pad.l + '" y1="' + y + '" x2="' + (W - pad.r) + '" y2="' + y + '" stroke="' + (f === 0 ? '#d6d2c7' : '#edeae2') + '" stroke-width="1"/>');
      s.push('<text x="' + (pad.l - 10) + '" y="' + (y + 3.5) + '" text-anchor="end" font-family="ui-monospace, monospace" font-size="10.5" fill="#929087">' + signed(absMax * f, 0) + '</text>');
    });
    // 右轴累计参考线
    [cumMin + cumPad, (cumMax + cumMin) / 2, cumMax - cumPad].forEach(function (v) {
      var y = yCum(v);
      s.push('<text x="' + (W - pad.r + 10) + '" y="' + (y + 3.5) + '" text-anchor="start" font-family="ui-monospace, monospace" font-size="10.5" fill="#a8a59c">' + fmt(v / 1000, 1) + 'k</text>');
    });
    // 柱
    chartRows.forEach(function (r, i) {
      var y0 = yBar(0), y1 = yBar(r.netYi);
      var top = Math.min(y0, y1), h = Math.max(1, Math.abs(y1 - y0));
      var fill = r.netYi >= 0 ? '#2e5a7a' : '#bcb7ab';
      s.push('<rect x="' + (xAt(i) - bw / 2) + '" y="' + top + '" width="' + bw + '" height="' + h + '" fill="' + fill + '"/>');
    });
    // 累计线
    var pts = cums.map(function (v, i) { return xAt(i) + ',' + yCum(v); }).join(' ');
    s.push('<polyline points="' + pts + '" fill="none" stroke="#57534a" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>');
    // x 轴月份标签
    var lastMonth = '';
    chartRows.forEach(function (r, i) {
      var m = r.date.slice(0, 7);
      if (m !== lastMonth) {
        lastMonth = m;
        s.push('<line x1="' + xAt(i) + '" y1="' + (pad.t + ih) + '" x2="' + xAt(i) + '" y2="' + (pad.t + ih + 4) + '" stroke="#d6d2c7" stroke-width="1"/>');
        s.push('<text x="' + xAt(i) + '" y="' + (pad.t + ih + 18) + '" text-anchor="middle" font-family="ui-monospace, monospace" font-size="10.5" fill="#929087">' + r.date.slice(5, 7) + '月</text>');
      }
    });
    s.push('<line id="hover-line" x1="0" y1="' + pad.t + '" x2="0" y2="' + (pad.t + ih) + '" stroke="#2e5a7a" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>');
    svg.innerHTML = s.join('');
    chartGeom = { W: W, H: H, pad: pad, iw: iw, ih: ih, step: step, xAt: xAt, cums: cums };

    var f = chartRows[0].date + ' — ' + chartRows[chartRows.length - 1].date;
    $('#chart-foot').innerHTML = '区间 ' + f + ' <span class="dim">·</span> 共 ' + chartRows.length + ' 个交易日。左轴为当日净申购（亿元），右轴为区间累计净申购（千亿元）。份额跳变也可能包含份额折算等非申赎因素，本页未做剔除 <a class="fn" href="#N1">[N1]</a>';
  }

  wrap.addEventListener('mousemove', function (ev) {
    if (!chartGeom) return;
    var box = wrap.getBoundingClientRect();
    var scale = chartGeom.W / box.width;
    var mx = (ev.clientX - box.left) * scale;
    var i = Math.floor((mx - chartGeom.pad.l) / chartGeom.step);
    if (i < 0 || i >= chartRows.length) { tip.hidden = true; return; }
    var r = chartRows[i];
    var line = $('#hover-line');
    if (line) { line.setAttribute('x1', chartGeom.xAt(i)); line.setAttribute('x2', chartGeom.xAt(i)); line.setAttribute('opacity', '0.55'); }
    tip.innerHTML = '<div class="tt-date">' + esc(r.date) + '</div>' +
      '<div class="tt-row"><span>当日净申购</span><b>' + signed(r.netYi) + ' 亿</b></div>' +
      '<div class="tt-row"><span>区间累计</span><b>' + signed(chartGeom.cums[i]) + ' 亿</b></div>' +
      '<div class="tt-row"><span>同步只数</span><b>' + r.breadth + '/' + PS + '</b></div>' +
      '<div class="tt-row"><span>池内加权涨跌</span><b>' + signed(r.weightedReturnPct) + '%</b></div>' +
      '<div class="tt-row"><span>入场强度</span><b>' + (r.applicable ? r.score + '（测算）' : '不适用') + '</b></div>';
    tip.hidden = false;
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    var px = Math.min(Math.max(8, ev.clientX - box.left + 14), box.width - tw - 8);
    var py = Math.min(Math.max(8, ev.clientY - box.top - th - 10), box.height - th - 8);
    tip.style.left = px + 'px'; tip.style.top = py + 'px';
  });
  wrap.addEventListener('mouseleave', function () {
    tip.hidden = true;
    var line = $('#hover-line'); if (line) line.setAttribute('opacity', '0');
  });

  $$('.seg').forEach(function (b) {
    b.addEventListener('click', function () {
      $$('.seg').forEach(function (x) { x.classList.remove('is-active'); });
      b.classList.add('is-active');
      range = b.dataset.range;
      $('#head-range').textContent = range === 'all' ? '2026 年完整序列' : '近 ' + range + ' 个交易日';
      renderChart();
    });
  });
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function () { renderChart(); });
    ro.observe(wrap);
  } else { window.addEventListener('resize', renderChart); }
  renderChart();

  /* ---------- 强度分与依据 ---------- */
  var scoreBig = last.applicable
    ? '<div class="score-big">' + fmt(last.score, 0) + '</div><div class="score-meta">满分 100，仅表示公开数据下的入场特征吻合程度<br>不是概率，不是身份认定，也不是买卖建议</div>'
    : '<div class="score-big is-na">—</div><div class="score-meta">当日全池为净赎回（' + fmt(last.netYi) + ' 亿元），本版的强度分只刻画入场特征，不刻画离场 <a class="fn" href="#N5">[N5]</a></div>';
  $('#score-body').innerHTML = '<div class="score-line">' + scoreBig + '</div>' +
    '<div class="score-meter"><i style="width:' + (last.applicable ? last.score : 0) + '%"></i></div>' +
    '<div class="score-scale"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>';

  $('#reasons').innerHTML =
    last.reasons.map(function (r) {
      return '<div class="reason-row"><span class="reason-dot ' + (r.hit ? 'hit' : '') + '"></span>' +
        '<div><div class="reason-label">' + esc(r.label) + '</div><div class="reason-detail">' + esc(r.detail) + '</div></div>' +
        '<span class="reason-val">' + esc(r.value) + '</span><span class="reason-pts">' + fmt(r.points, 1) + ' 分</span></div>';
    }).join('') +
    '<div class="reason-unavail"><h4>未接入的依据（不参与打分）</h4>' +
    last.unavailable.map(function (u) { return '<div><span>' + esc(u.label) + '</span><span>' + esc(u.reason) + '</span></div>'; }).join('') + '</div>';
  var btn = $('#disclose');
  btn.addEventListener('click', function () {
    var open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!open));
    $('#reasons').hidden = open;
    btn.querySelector('span').textContent = open ? '展开命中依据与未接入项' : '收起命中依据与未接入项';
  });

  /* ---------- 逐只排名 ---------- */
  var per = last.perEtf.slice().sort(function (a, b) { return Math.abs(b.netYi) - Math.abs(a.netYi); }).slice(0, 10);
  var maxPer = Math.max.apply(null, per.map(function (e) { return Math.abs(e.netYi); }).concat([1]));
  $('#rank-title').textContent = last.date + ' 逐只净申购';
  $('#rank-sub').textContent = '逐只 Δ份额 × 当日收盘价，按绝对金额排序，显示前 10 只';
  $('#rank-list').innerHTML = per.map(function (e) {
    return '<div class="rank-row"><span class="rank-code">' + esc(e.code) + '</span>' +
      '<div><div class="rank-bar"><i class="' + (e.netYi < 0 ? 'neg' : '') + '" style="width:' + (Math.abs(e.netYi) / maxPer * 100) + '%"></i></div>' +
      '<div class="rank-name">' + esc(e.name) + '</div></div>' +
      '<span class="rank-value">' + signed(e.netYi) + ' 亿</span></div>';
  }).join('');

  /* ---------- 关键交易日 ---------- */
  function dayList(items, neg) {
    var mx = Math.max.apply(null, items.map(function (r) { return Math.abs(r.netYi); }).concat([1]));
    return items.map(function (r) {
      return '<div class="day-row"><span class="day-date">' + esc(r.date) + '</span>' +
        '<div><div class="day-bar"><i class="' + (neg ? 'neg' : '') + '" style="width:' + (Math.abs(r.netYi) / mx * 100) + '%"></i></div>' +
        '<div class="day-note">同步 ' + r.breadth + '/' + PS + ' 只 · 份额环比 ' + signed(r.shareChangePct) + '% · 强度 ' + (r.applicable ? r.score : '不适用') + '</div></div>' +
        '<span class="day-value">' + signed(r.netYi) + ' 亿</span></div>';
    }).join('');
  }
  $('#day-in').innerHTML = dayList(D.topIn, false);
  $('#day-out').innerHTML = dayList(D.topOut, true);

  /* ---------- 校准层 ---------- */
  $('#anchor-sub').textContent = '报告期 ' + D.meta.reportDate + ' 的实名持有份额（前十大持有人合计）与该日总份额之比，同当前总份额对照';
  $('#anchor-table tbody').innerHTML = D.anchors.map(function (a) {
    return '<tr><td class="code">' + esc(a.code) + '</td><td>' + esc(a.name) + '</td>' +
      '<td class="num">' + (a.ntAmount == null ? '—' : fmt(a.ntAmount / 1e8, 2)) + '</td>' +
      '<td class="num">' + (a.ntRatio == null ? '—' : fmt(a.ntRatio, 2) + '%') + '</td>' +
      '<td class="num">' + (a.currentShare == null ? '—' : fmt(a.currentShare / 1e8, 2)) + '</td>' +
      '<td class="num">' + (a.impliedRatio == null ? '—' : fmt(a.impliedRatio, 1) + '%') + '</td>' +
      '<td>' + (a.conflict ? '<span class="tag-conflict">锚点已过期</span>' : '<span class="tag-ok">可对照</span>') + '</td></tr>';
  }).join('');
  $('#anchor-foot').innerHTML = '锚点隐含占比 = 报告期实名持有份额 ÷ 当前总份额。若该值超过 100%，说明锚点份额已不可能保持不变，期间必然发生赎回；但日频序列是全市场匿名净额，无法判断其中哪一部分属于国家队。共 <b>' + D.calibration.attributionGap.conflictCount + '</b> 只标的出现此冲突 <a class="fn" href="#N7">[N7]</a>';

  var byDate = {};
  D.calibration.check.forEach(function (c) {
    if (!byDate[c.date]) byDate[c.date] = { n: 0, max: 0, sumDiff: 0 };
    byDate[c.date].n++; byDate[c.date].max = Math.max(byDate[c.date].max, c.diffPct); byDate[c.date].sumDiff += Math.abs(c.diff);
  });
  $('#sse-check').innerHTML = Object.keys(byDate).sort().map(function (d) {
    return '<div class="check-row"><span>' + esc(d) + ' <span class="dim">· ' + byDate[d].n + ' 只沪市标的</span></span>' +
      '<strong>最大偏差 ' + fmt(byDate[d].max, 4) + '% · 合计 ' + fmt(byDate[d].sumDiff, 0) + ' 份</strong></div>';
  }).join('') + '<div class="card-foot">官方份额日报单位为万份，乘以 10000 后与本页逐日序列比对。差异来自浮点取整，不是口径分歧。这一校验只覆盖上交所标的；深市份额来自该库的深交所日报，未在本版做独立回源。</div>';

  $('#gap-body').innerHTML = '<div class="gap-quote">' + esc(D.calibration.attributionGap.note) + '</div>' +
    '<div class="gap-list">' +
    '<div>实名锚点日期 <b>' + esc(D.meta.reportDate) + '</b>，日频序列覆盖 <b>' + esc(D.meta.firstDate) + ' — ' + esc(D.meta.lastDate) + '</b></div>' +
    '<div>下一次可校验窗口 <b>' + esc(D.calibration.nextReportWindow) + '</b></div>' +
    '<div>本版误差状态 <b>unresolved</b>，不显示伪造的「国家队净流入」数值</div>' +
    '<div>个股前十大流通股东口径与 ETF 口径存在底层重复计算，本页不含个股持仓 <a class="fn" href="#N8">[N8]</a></div>' +
    '</div>';

  /* ---------- 口径 / 事件 ---------- */
  $('#notes').innerHTML = D.notes.map(function (n) {
    return '<div class="note" id="' + esc(n.id) + '"><div class="note-head"><span class="note-id">' + esc(n.id) + '</span><span class="note-title">' + esc(n.title) + '</span></div><div class="note-body">' + esc(n.body) + '</div></div>';
  }).join('');
  var kinds = { policy: '政策', announcement: '公告', press: '媒体' };
  $('#events').innerHTML = D.events.map(function (e) {
    return '<div class="event-row"><span class="event-date">' + esc(e.date) + '</span>' +
      '<span class="event-kind">' + esc(kinds[e.kind] || e.kind) + '</span>' +
      '<span class="event-title">' + esc(e.title) + '<a href="' + esc(e.url) + '" target="_blank" rel="noopener noreferrer">' + esc(e.source) + ' ↗</a></span></div>';
  }).join('');

  /* ---------- 数据源 / 字典 ---------- */
  $('#source-list').innerHTML = D.meta.sources.map(function (s) {
    return '<div class="src-row"><div><div class="src-name">' + esc(s.name) + '</div><div class="src-role">' + esc(s.role) + '</div></div><a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">来源 ↗</a></div>';
  }).join('') + '<div class="card-foot">采集脚本 <span class="mono">scripts/gather.mjs</span> 用 Node 内置 https 抓取，仅需 <span class="mono">node scripts/gather.mjs</span>；计算脚本 <span class="mono">scripts/build.mjs</span> 生成 <span class="mono">data/dashboard.json</span> 与 <span class="mono">data/dashboard.js</span>。整站无后端、无构建、无第三方运行时依赖。</div>';

  $('#entity-list').innerHTML = D.entities.tiers.map(function (t) {
    var names = D.entities.rules.filter(function (r) { return r.tier === t.id; }).map(function (r) { return '<span class="chip">' + esc(r.name) + '</span>'; }).join('');
    return '<div class="tier-block"><div class="tier-name">' + esc(t.id) + '</div><div class="tier-desc">' + esc(t.description) + '</div><div class="tier-rules">' + names + '</div></div>';
  }).join('');

  $('#false-positives').innerHTML = '<div class="fp-list">' + D.entities.falsePositives.map(function (p) {
    var parts = p.split('（');
    return '<div><code>' + esc(parts[0]) + '</code>' + (parts[1] ? ' <span class="dim">' + esc('（' + parts[1]) + '</span>' : '') + '</div>';
  }).join('') + '</div>';

  $('#pool-boundary').textContent = D.notes.filter(function (n) { return n.id === 'N9'; }).map(function (n) { return n.body; })[0] || '';
  $('#pool-chips').innerHTML = D.pool.map(function (p) {
    return '<span class="pool-chip"><b>' + esc(p.code) + '</b>' + esc(p.name) + ' <span class="dim">· ' + esc(p.group) + '</span></span>';
  }).join('');

  /* ---------- 导航高亮 ---------- */
  if (window.IntersectionObserver) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        $$('.nav-item').forEach(function (a) { a.classList.toggle('is-active', a.dataset.nav === en.target.id); });
      });
    }, { rootMargin: '-15% 0px -70% 0px', threshold: 0 });
    $$('.section').forEach(function (s) { io.observe(s); });
  }
})();

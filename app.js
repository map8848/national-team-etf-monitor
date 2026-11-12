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
  // 涨跌色：红涨绿跌（A 股习惯），与 styles.css 的 --up / --down 保持一致
  var UP = '#bf4342', DOWN = '#3a7355';

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

  /* ---------- 主图：大盘日 K 与净申购上下对照 ---------- */
  var wrap = $('#chart-wrap');
  var svg = $('#chart');
  var tip = $('#tooltip');
  var chartRows = [];
  var chartGeom = null;
  var range = 'all';
  var indexId = 'sh000001';
  var indices = D.indices || [];
  var idx = null;
  var idxByDate = {};

  function niceMax(v) { if (v <= 0) return 1; var e = Math.pow(10, Math.floor(Math.log10(v))); var m = v / e; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * e; }

  function reindex() {
    idx = indices.filter(function (x) { return x.id === indexId; })[0] || indices[0] || null;
    idxByDate = {};
    if (idx) idx.rows.forEach(function (r) { idxByDate[r.date] = r; });
    $('#idx-name').textContent = idx ? idx.name : '大盘指数';
  }

  function renderCompare() {
    if (!idx) {
      $('#compare-strip').innerHTML = '<div class="cmp-foot">指数快照暂缺，全年对照读数不可用 <a class="fn" href="#N12">[N12]</a></div>';
      return;
    }
    var a = idx.compare.all, b = idx.compare.recent60;
    var cells = [
      ['区间涨跌', signed(idx.periodPct) + '%', idx.coverage.first + ' 开盘至 ' + idx.coverage.last + ' 收盘'],
      ['涨跌幅 × 净申购相关', a.corr == null ? '—' : signed(a.corr, 3), '全年 ' + a.sessions + ' 个交易日逐日配对'],
      ['逆势日', a.contrarianDays + ' / ' + a.downDays, '指数收跌且当日净申购为正'],
      ['近 60 日相关', b.corr == null ? '—' : signed(b.corr, 3), b.sessions + ' 个交易日，短窗口波动大'],
    ];
    var html = '<div class="cmp-grid">' + cells.map(function (c) {
      return '<div class="cmp-item"><span class="cmp-label">' + esc(c[0]) + '</span>' +
        '<b class="cmp-value">' + esc(c[1]) + '</b><span class="cmp-note">' + esc(c[2]) + '</span></div>';
    }).join('') + '</div>';
    html += '<div class="cmp-foot">全年对照读数，不随上方时间范围切换。指数下跌 ' + a.downDays + ' 日的全池净申购合计 <span class="mono">' + signed(a.downNetYi) + '</span> 亿元，上涨 ' + a.upDays + ' 日合计 <span class="mono">' + signed(a.upNetYi) + '</span> 亿元。' +
      idx.name + ' 日 K 由腾讯与东财双源比对，覆盖 ' + idx.crossCheck.matched + ' 日，最大偏差 <span class="mono">' + fmt(idx.crossCheck.maxDiff, 2) + '</span> 点。相关不等于归因，份额变动是全市场匿名净额 <a class="fn" href="#N12">[N12]</a></div>';
    $('#compare-strip').innerHTML = html;
  }

  var scenarioRange = 'all';

  function activeWindow() {
    var sc = idx && idx.scenario;
    if (!sc || !sc.windows || !sc.windows.length) return null;
    for (var i = 0; i < sc.windows.length; i++) {
      if (sc.windows[i].id === scenarioRange) return sc.windows[i];
    }
    return sc.windows[sc.windows.length - 1];
  }

  function bucketOf(win, cur) {
    if (!win || !cur) return null;
    var p80 = win.thresholds.p80, p20 = win.thresholds.p20;
    if (cur.netYi >= p80) return 'bigBuy';
    if (cur.netYi <= p20) return 'bigSell';
    if (cur.netYi > 0 && cur.pct < 0) return 'contra';
    return 'normal';
  }

  function rowById(win, id) {
    if (!win) return null;
    for (var i = 0; i < win.rows.length; i++) {
      if (win.rows[i].id === id) return win.rows[i];
    }
    return null;
  }

  function renderSignal() {
    var box = $('#signal-box');
    if (!box) return;
    var win = activeWindow();
    var cur = idx && idx.scenario && idx.scenario.current;
    if (!win || !cur) {
      box.innerHTML = '<div class="scenario-na">指数快照暂缺，方向读数不可用 <a class="fn" href="#N13">[N13]</a></div>';
      $('#signal-foot').textContent = '';
      return;
    }
    var bid = bucketOf(win, cur);
    var bucket = rowById(win, bid) || rowById(win, 'all');
    var base = rowById(win, 'all');
    var lean = 'neutral', leanText = '中性';
    if (bucket && base && bucket.f20.med != null && base.f20.med != null && bucket.n >= 10) {
      if (bucket.f20.med > base.f20.med + 0.3 && bucket.f20.win >= base.f20.win + 5) { lean = 'up'; leanText = '偏多'; }
      else if (bucket.f20.med < base.f20.med - 0.3 && bucket.f20.win <= base.f20.win - 5) { lean = 'down'; leanText = '偏弱'; }
    }
    var thin = bucket && bucket.n < 10;

    var lines = [];
    lines.push('<div class="signal-line">最新 <span class="mono">' + esc(cur.date) + '</span>：全池净申购 <span class="mono">' + signed(cur.netYi) + ' 亿</span>，' + esc(idx.name) + ' <span class="mono">' + signed(cur.pct) + '%</span>，归入「' + esc(bucket ? bucket.name : '—') + '」</div>');
    if (bucket && base) {
      lines.push('<div class="signal-line">该情景在<b>' + esc(win.name) + '</b>窗口 n=<span class="mono">' + bucket.n + '</span>，后 20 日中位数 <span class="mono">' + signed(bucket.f20.med) + '%</span>、<span class="mono">' + bucket.f20.win + '%</span> 为正；全样本为中位数 <span class="mono">' + signed(base.f20.med) + '%</span>、<span class="mono">' + base.f20.win + '%</span> 为正</div>');
    }

    box.innerHTML = '<div class="signal-row">' +
      '<div class="signal-tag is-' + lean + '">' + leanText + '</div>' +
      '<div class="signal-main">' + lines.join('') + '</div>' +
      '</div>' +
      (thin ? '<div class="signal-warn">该情景样本不足 10 个，读数仅供参考</div>' : '');

    var parts = [];
    parts.push('读数随上方窗口切换，判定规则为：后 20 日中位数比全样本高 0.3 个百分点以上且胜率高出 5 个百分点记为偏多，反向记为偏弱，其余为中性');
    parts.push('这是历史条件分布的位置读数，不是对未来的预测；单年样本、短窗口样本更少，组间差异可能落在噪声内');
    parts.push('大额净申购、逆势申购、普通日三行条件可能重叠，当前日按「大额申购 → 大额赎回 → 逆势申购 → 普通日」的优先序归入一类');
    $('#signal-foot').innerHTML = parts.join('；') + ' <a class="fn" href="#N13">[N13]</a>';
  }

  function renderScenario() {
    var box = $('#scenario-table');
    if (!box) return;
    $('#scenario-index').textContent = idx ? idx.name : '大盘指数';
    var win = activeWindow();
    if (!win) {
      box.innerHTML = '<div class="scenario-na">样本不足，暂不输出情景对照 <a class="fn" href="#N13">[N13]</a></div>';
      $('#scenario-foot').textContent = '';
      return;
    }
    var head = '<tr><th>情景</th><th class="num">样本</th><th class="num">后 5 日</th><th class="num">后 10 日</th><th class="num">后 20 日</th></tr>';
    var cell = function (s) {
      if (!s || s.med == null) return '<td class="num"><i class="scenario-na">—</i></td>';
      var cls = s.med > 0 ? 'is-up' : (s.med < 0 ? 'is-down' : '');
      return '<td class="num"><b class="' + cls + '">' + signed(s.med) + '%</b><i>' + s.win + '% 为正</i></td>';
    };
    var bid = bucketOf(win, idx.scenario.current);
    var body = win.rows.map(function (r) {
      return '<tr' + (r.id === bid ? ' class="is-current"' : '') + '><td>' + esc(r.name) + '</td><td class="num">' + r.n + '</td>' + cell(r.f5) + cell(r.f10) + cell(r.f20) + '</tr>';
    }).join('');
    box.innerHTML = '<table class="scenario"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
    $('#scenario-foot').innerHTML = '窗口 <b>' + esc(win.name) + '</b>：样本池 <span class="mono">' + win.samplePool + '</span> 个交易日（取可用候选的最后 ' + win.samplePool + ' 个，因为最近 20 个交易日还没有 t+20 结果）。阈值按本窗口重算：大额净申购 ≥ <span class="mono">' + signed(win.thresholds.p80) + ' 亿</span>，大额净赎回 ≤ <span class="mono">' + signed(win.thresholds.p20) + ' 亿</span>。各行条件可能重叠，不是互斥分桶；中位数与正收益占比都是历史统计，不构成方向预测 <a class="fn" href="#N13">[N13]</a>';
  }

  function renderChart() {
    var n = range === 'all' ? D.daily.length : Math.min(Number(range), D.daily.length);
    chartRows = D.daily.slice(-n);
    var W = Math.max(640, wrap.clientWidth || 1000);
    var H = 520;
    var pad = { l: 66, r: 66, t: 16, b: 36 };
    var iw = W - pad.l - pad.r;
    var kTop = pad.t, kH = 176;
    var bTop = kTop + kH + 32;
    var bH = H - pad.b - bTop;
    var bBottom = bTop + bH;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    var step = iw / chartRows.length;
    var bw = Math.max(1.2, Math.min(step * 0.68, 9));
    var xAt = function (i) { return pad.l + (i + 0.5) * step; };
    var kRows = chartRows.map(function (r) { return idxByDate[r.date] || null; });

    var kLo = Infinity, kHi = -Infinity;
    kRows.forEach(function (k) { if (k) { if (k.l < kLo) kLo = k.l; if (k.h > kHi) kHi = k.h; } });
    if (!isFinite(kLo)) { kLo = 0; kHi = 1; }
    var kPad = (kHi - kLo) * 0.08 || 1;
    kLo -= kPad; kHi += kPad;
    var yK = function (v) { return kTop + kH - ((v - kLo) / (kHi - kLo)) * kH; };

    var absMax = niceMax(Math.max.apply(null, chartRows.map(function (r) { return Math.abs(r.netYi); })));
    var cum = 0;
    var cums = chartRows.map(function (r) { cum += r.netYi; return cum; });
    var cumMin = Math.min.apply(null, cums.concat([0]));
    var cumMax = Math.max.apply(null, cums.concat([0]));
    var cumPad = (cumMax - cumMin) * 0.08 || 1;
    cumMin -= cumPad; cumMax += cumPad;
    var yBar = function (v) { return bTop + bH / 2 - (v / absMax) * (bH / 2); };
    var yCum = function (v) { return bTop + bH - ((v - cumMin) / (cumMax - cumMin)) * bH; };

    var s = [];
    // 上 panel：静音网格与左轴点位
    [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
      var v = kLo + (kHi - kLo) * f, y = yK(v);
      s.push('<line x1="' + pad.l + '" y1="' + y + '" x2="' + (W - pad.r) + '" y2="' + y + '" stroke="#edeae2" stroke-width="1"/>');
      s.push('<text x="' + (pad.l - 10) + '" y="' + (y + 3.5) + '" text-anchor="end" font-family="ui-monospace, monospace" font-size="11" fill="#929087">' + fmt(v, 0) + '</text>');
    });
    s.push('<text x="' + (pad.l + 4) + '" y="' + (kTop + 14) + '" font-family="ui-monospace, monospace" font-size="11" fill="#a8a59c">' + esc(idx ? idx.name : '大盘指数') + ' 日 K · 点</text>');
    // 蜡烛：红涨绿跌，收涨空心、收跌实心；净申购柱继续用强调色
    kRows.forEach(function (k, i) {
      if (!k) return;
      var x = xAt(i), up = k.c >= k.o;
      var col = up ? UP : DOWN;
      var yO = yK(k.o), yC = yK(k.c);
      s.push('<line x1="' + x + '" y1="' + yK(k.h) + '" x2="' + x + '" y2="' + yK(k.l) + '" stroke="' + col + '" stroke-width="1"/>');
      var top = Math.min(yO, yC), h = Math.max(1, Math.abs(yC - yO));
      s.push('<rect x="' + (x - bw / 2) + '" y="' + top + '" width="' + bw + '" height="' + h + '" fill="' + (up ? '#ffffff' : col) + '" stroke="' + col + '" stroke-width="1"/>');
    });
    // 下 panel：静音网格与左轴
    [-1, -0.5, 0, 0.5, 1].forEach(function (f) {
      var y = yBar(absMax * f);
      s.push('<line x1="' + pad.l + '" y1="' + y + '" x2="' + (W - pad.r) + '" y2="' + y + '" stroke="' + (f === 0 ? '#d6d2c7' : '#edeae2') + '" stroke-width="1"/>');
      s.push('<text x="' + (pad.l - 10) + '" y="' + (y + 3.5) + '" text-anchor="end" font-family="ui-monospace, monospace" font-size="11" fill="#929087">' + signed(absMax * f, 0) + '</text>');
    });
    s.push('<text x="' + (pad.l + 4) + '" y="' + (bTop + 14) + '" font-family="ui-monospace, monospace" font-size="11" fill="#a8a59c">全池净申购 · 亿元</text>');
    // 右轴累计参考
    [cumMin + cumPad, (cumMax + cumMin) / 2, cumMax - cumPad].forEach(function (v) {
      var y = yCum(v);
      s.push('<text x="' + (W - pad.r + 10) + '" y="' + (y + 3.5) + '" text-anchor="start" font-family="ui-monospace, monospace" font-size="11" fill="#a8a59c">' + fmt(v / 1000, 1) + 'k</text>');
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
    // 共享 x 轴月份标签
    var lastMonth = '';
    chartRows.forEach(function (r, i) {
      var m = r.date.slice(0, 7);
      if (m !== lastMonth) {
        lastMonth = m;
        s.push('<line x1="' + xAt(i) + '" y1="' + bBottom + '" x2="' + xAt(i) + '" y2="' + (bBottom + 4) + '" stroke="#d6d2c7" stroke-width="1"/>');
        s.push('<text x="' + xAt(i) + '" y="' + (bBottom + 20) + '" text-anchor="middle" font-family="ui-monospace, monospace" font-size="11" fill="#929087">' + r.date.slice(5, 7) + '月</text>');
      }
    });
    s.push('<line id="hover-line" x1="0" y1="' + kTop + '" x2="0" y2="' + bBottom + '" stroke="#2e5a7a" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>');
    svg.innerHTML = s.join('');
    chartGeom = { W: W, H: H, pad: pad, iw: iw, step: step, xAt: xAt, cums: cums, kRows: kRows };

    var f = chartRows[0].date + ' — ' + chartRows[chartRows.length - 1].date;
    $('#chart-foot').innerHTML = '区间 ' + f + ' <span class="dim">·</span> 共 ' + chartRows.length + ' 个交易日。上下面板共用同一交易日历，指数行情比份额日报多出的交易日不画 <a class="fn" href="#N11">[N11]</a>；上左轴为点位，下左轴为当日净申购（亿元），下右轴为区间累计（千亿元）。份额跳变也可能包含份额折算等非申赎因素，本页未做剔除 <a class="fn" href="#N1">[N1]</a>';
  }

  wrap.addEventListener('mousemove', function (ev) {
    if (!chartGeom) return;
    var box = wrap.getBoundingClientRect();
    var scale = chartGeom.W / box.width;
    var mx = (ev.clientX - box.left) * scale;
    var i = Math.floor((mx - chartGeom.pad.l) / chartGeom.step);
    if (i < 0 || i >= chartRows.length) { tip.hidden = true; return; }
    var r = chartRows[i], k = chartGeom.kRows[i];
    var line = $('#hover-line');
    if (line) { line.setAttribute('x1', chartGeom.xAt(i)); line.setAttribute('x2', chartGeom.xAt(i)); line.setAttribute('opacity', '0.55'); }
    var kHtml = k
      ? '<div class="tt-row"><span>' + esc(idx ? idx.name : '指数') + ' 收盘</span><b>' + fmt(k.c) + ' · <span style="color:' + (k.pct >= 0 ? UP : DOWN) + '">' + signed(k.pct) + '%</span></b></div>' +
        '<div class="tt-row"><span>开 / 高 / 低</span><b>' + fmt(k.o) + ' / ' + fmt(k.h) + ' / ' + fmt(k.l) + '</b></div>'
      : '<div class="tt-row"><span>指数日 K</span><b>—</b></div>';
    tip.innerHTML = '<div class="tt-date">' + esc(r.date) + '</div>' + kHtml +
      '<div class="tt-sep"></div>' +
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

  $$('.seg[data-range]').forEach(function (b) {
    b.addEventListener('click', function () {
      $$('.seg[data-range]').forEach(function (x) { x.classList.remove('is-active'); });
      b.classList.add('is-active');
      range = b.dataset.range;
      $('#head-range').textContent = range === 'all' ? '2026 年完整序列' : '近 ' + range + ' 个交易日';
      renderChart();
    });
  });
  $$('.seg[data-index]').forEach(function (b) {
    b.addEventListener('click', function () {
      $$('.seg[data-index]').forEach(function (x) { x.classList.remove('is-active'); });
      b.classList.add('is-active');
      indexId = b.dataset.index;
      reindex();
      renderCompare();
      renderSignal();
      renderScenario();
      renderChart();
    });
  });
  $$('.seg[data-scenario-range]').forEach(function (b) {
    b.addEventListener('click', function () {
      $$('.seg[data-scenario-range]').forEach(function (x) { x.classList.remove('is-active'); });
      b.classList.add('is-active');
      scenarioRange = b.dataset.scenarioRange;
      renderSignal();
      renderScenario();
    });
  });
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function () { renderChart(); });
    ro.observe(wrap);
  } else { window.addEventListener('resize', renderChart); }
  reindex();
  renderCompare();
  renderSignal();
  renderScenario();
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

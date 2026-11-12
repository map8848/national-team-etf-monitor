#!/usr/bin/env node
/**
 * 由 data/raw/ 的公开快照计算派生数据，输出 data/dashboard.json。
 *
 * 三条不可动摇的口径：
 *  1. 金额必须逐只算：net_i[t] = (share_i[t] - share_i[t-1]) * price_i[t]，再求和。
 *     绝不把不同 ETF 的份额相加后乘一个价格（各只单位净值不同）。
 *  2. 份额 T+1：份额当日数据次日披露，行情日对齐到份额披露日的前一交易日。
 *  3. 日频份额变动是全市场匿名净额，不是国家队净额。强度分是启发式推测，不是身份认定。
 *
 * 用法： node scripts/build.mjs
 * 依赖： 无（仅 Node 内置 fs / path）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data', 'raw');
const DATA = path.join(ROOT, 'data');
const read = (f) => JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
const readMaybe = (f) => { try { return read(f); } catch { return null; } };
const readConfig = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'config', f), 'utf8'));
const round = (n, d = 2) => Number(n.toFixed(d));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const YI = 1e8;

const meta = read('meta.json');
const YEAR = String(meta.trade_date).slice(0, 4);
const etfs = read('etfs.json');
const poolCfg = readConfig('pool.json');
const entities = readConfig('entities.json');
const wide = read(`industry-wide-${YEAR}.json`);
const periods = read('holders-periods.json');

// ---- 交易日历与逐只序列 ---------------------------------------------------
const dates = wide.dates;
const etfName = new Map(wide.etfs.map((e) => [e.code, e.name]));
const etfMeta = new Map(etfs.map((e) => [e.code, e]));

const series = new Map();
for (const code of poolCfg.codes) {
  const s = read(`series-${code}-${YEAR}.json`);
  series.set(code, {
    price: new Map(s.prices),
    share: new Map(s.shares),
  });
}

const priceAt = (code, d) => series.get(code)?.price.get(d);
const shareAt = (code, d) => series.get(code)?.share.get(d);

// ---- L1：逐只净申购 -------------------------------------------------------
const daily = [];
let cum = 0;
for (let i = 0; i < dates.length; i++) {
  const date = dates[i];
  const prev = i > 0 ? dates[i - 1] : null;
  const perEtf = [];
  let totalShare = 0;
  let prevTotalShare = 0;
  let weightedReturnSum = 0;
  let weightSum = 0;

  for (const code of poolCfg.codes) {
    const sh = shareAt(code, date);
    const px = priceAt(code, date);
    const prevSh = prev ? shareAt(code, prev) : undefined;
    const prevPx = prev ? priceAt(code, prev) : undefined;
    if (sh == null) continue;
    totalShare += sh;
    if (prevSh != null) prevTotalShare += prevSh;
    if (prevSh != null && prevPx != null && px != null && prevPx > 0) {
      const w = prevSh;
      weightedReturnSum += w * (px / prevPx - 1);
      weightSum += w;
    }
    if (prev && prevSh != null && px != null) {
      const delta = sh - prevSh;
      perEtf.push({
        code,
        name: etfName.get(code) || code,
        deltaShare: delta,
        price: px,
        netYi: (delta * px) / YI,
      });
    }
  }

  const netYi = perEtf.reduce((a, b) => a + b.netYi, 0);
  const breadth = perEtf.filter((e) => e.netYi > 0.001).length;
  const weightedReturnPct = weightSum > 0 ? (weightedReturnSum / weightSum) * 100 : 0;
  const shareChangePct = prevTotalShare > 0 ? ((totalShare - prevTotalShare) / prevTotalShare) * 100 : 0;
  if (prev) cum += netYi;

  daily.push({
    date,
    netYi: round(netYi, 4),
    cumYi: round(cum, 4),
    totalShareYi: round(totalShare / YI, 4),
    breadth,
    weightedReturnPct: round(weightedReturnPct, 4),
    shareChangePct: round(shareChangePct, 4),
    perEtf: perEtf.map((e) => ({ ...e, deltaShare: round(e.deltaShare, 0), netYi: round(e.netYi, 4) })),
  });
}

// ---- 强度分：累计天数 / 同步性 / 分位 / 逆势 -------------------------------
// 只用能从「份额 + 收盘价」真实算出的依据，公式写在 notes 里可复现。
const windowNet = [];
for (let i = 0; i < daily.length; i++) {
  windowNet.push(daily[i].netYi);
  if (windowNet.length > 60) windowNet.shift();

  let streak = 0;
  for (let j = i; j >= 0; j--) {
    if (daily[j].netYi > 0.001) streak++;
    else break;
  }

  const v = daily[i].netYi;
  const percentile = windowNet.filter((x) => x <= v).length / windowNet.length;
  const s1 = v > 0 ? percentile * 30 : 0;
  const s2 = (daily[i].breadth / poolCfg.codes.length) * 25;
  const s3 = clamp(streak / 5, 0, 1) * 20;
  const contrarian = v > 0 && daily[i].weightedReturnPct < 0;
  const s4 = contrarian ? 15 : 0;
  const s5 = v > 0 ? clamp(daily[i].shareChangePct / 2, 0, 1) * 10 : 0;
  const score = Math.round(s1 + s2 + s3 + s4 + s5);

  daily[i].streak = streak;
  daily[i].score = score;
  daily[i].applicable = v > 0;
  daily[i].reasons = [
    { id: 'scale', label: '当日净申购位于近 60 日分位', hit: v > 0, value: `${round(percentile * 100, 0)}%`, points: round(s1, 1), detail: `当日 ${round(v, 2)} 亿元，在过去 ${windowNet.length} 个交易日中的百分位` },
    { id: 'breadth', label: '池内多只同步净申购', hit: daily[i].breadth > 0, value: `${daily[i].breadth}/${poolCfg.codes.length} 只`, points: round(s2, 1), detail: '单只异动容易是套利盘，多只同向更接近组合性操作' },
    { id: 'streak', label: '连续净申购天数', hit: streak > 0, value: `${streak} 日`, points: round(s3, 1), detail: '5 日及以上给满权重，单日脉冲不给' },
    { id: 'contrarian', label: '逆势：池内加权价格下跌但净申购为正', hit: contrarian, value: `${round(daily[i].weightedReturnPct, 2)}%`, points: round(s4, 1), detail: '以份额加权的池内当日涨跌' },
    { id: 'share', label: '全池份额单日增幅', hit: v > 0, value: `${round(daily[i].shareChangePct, 2)}%`, points: round(s5, 1), detail: '2% 及以上给满权重；份额求和只作计数比率，不换算金额' },
  ];
  daily[i].unavailable = [
    { label: '尾盘集中放量', reason: '数据源不含分钟级成交' },
    { label: '折溢价 / IOPV 偏离', reason: '数据源不含实时估值' },
    { label: '两市成交额与融资余额分位', reason: '本版未接入' },
    { label: '官方公告事件', reason: '只作背景标注，不进入打分' },
  ];
}

const latest = daily[daily.length - 1];
const topIn = [...daily].filter((d) => d.netYi > 0).sort((a, b) => b.netYi - a.netYi).slice(0, 5);
const topOut = [...daily].filter((d) => d.netYi < 0).sort((a, b) => a.netYi - b.netYi).slice(0, 5);

// ---- 主体归一（用于实名锚点，带排除规则） ---------------------------------
function classify(name) {
  const n = String(name || '');
  if (entities.globalExclude.some((k) => n.includes(k))) return null;
  for (const rule of entities.rules) {
    if (rule.exclude?.some((k) => n.includes(k))) continue;
    if (rule.any.some((k) => n.includes(k))) return { id: rule.id, name: rule.name, tier: rule.tier };
  }
  return null;
}

// ---- L3：报告期实名锚点 vs 日频序列 ---------------------------------------
const anchors = poolCfg.codes.map((code) => {
  const e = etfMeta.get(code);
  const s = series.get(code);
  const currentShare = s ? [...s.share.values()].at(-1) : null;
  const ntAmount = e?.nt_amount ?? null;
  const impliedRatio = ntAmount != null && currentShare ? (ntAmount / currentShare) * 100 : null;
  const holders = (e?.nt_holders || []).map((h) => ({
    name: h.name,
    group: h.group,
    amount: h.amount,
    ratio: h.ratio,
    normalized: classify(h.name),
  }));
  return {
    code,
    name: e?.name || etfName.get(code) || code,
    exchange: e?.exchange || null,
    reportDate: e?.report_date || meta.report_date,
    reportShare: e?.report_share ?? null,
    currentShare,
    ntAmount,
    ntRatio: e?.nt_ratio ?? null,
    ntRatioPrev: e?.nt_ratio_prev ?? null,
    impliedRatio: impliedRatio == null ? null : round(impliedRatio, 2),
    conflict: impliedRatio != null && impliedRatio > 100,
    holders,
  };
});

// L1 数据一致性：上交所官方 TOT_VOL（万份）vs Pages 序列
const sseChecks = [];
const sseFiles = fs.readdirSync(RAW).filter((f) => /^sse-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
for (const f of sseFiles) {
  const d = f.slice(4, -5);
  const j = read(f);
  const rows = Array.isArray(j) ? j : j.result || [];
  for (const row of rows) {
    const code = row.SEC_CODE;
    if (!poolCfg.codes.includes(code) || !/^(51|56|58)/.test(code)) continue;
    const official = Number(row.TOT_VOL) * 10000;
    const local = shareAt(code, d);
    if (local == null) continue;
    sseChecks.push({
      date: d,
      code,
      official,
      local: round(local, 0),
      diff: round(Math.abs(official - local), 0),
      diffPct: round((Math.abs(official - local) / official) * 100, 6),
    });
  }
}

const conflictCount = anchors.filter((a) => a.conflict).length;
const calendar = {
  reportDate: meta.report_date,
  prevReportDate: meta.prev_report_date,
  nextReportWindow: '2026 年报（预计 2027 年 3–4 月披露）',
  holderPeriods: periods.periods?.length ?? 0,
  lastHolderPeriod: periods.periods?.at(-1) ?? null,
  check: sseChecks,
  attributionGap: {
    status: 'unresolved',
    note: `实名锚点是 ${meta.report_date} 的半年度快照，日频份额是此后每个交易日的全市场匿名净额。两者之间没有可观测的持仓主体变动记录，误差无法在年报披露前闭合。`,
    conflictCount,
  },
};

// ---- 大盘指数日 K（真实 OHLC，双源交叉校验） -------------------------------
// 腾讯 fqkline: [日期, 开, 收, 高, 低, 量]；东财 kline: 日期,开,收,高,低,量,额,振幅,涨跌幅,涨跌额,换手
// 指数行情比份额日报多 1–2 个交易日，按份额交易日历 dates 对齐，多出的行情日不纳入。
const INDEX_DEFS = [
  { id: 'sh000001', code: '000001', name: '上证指数', tx: 'sh000001', em: '1.000001' },
  { id: 'sh000300', code: '000300', name: '沪深300', tx: 'sh000300', em: '1.000300' },
];

function parseTxKline(j, key) {
  if (!j || !j.data || !j.data[key]) return null;
  const obj = j.data[key];
  const arr = obj.day || obj.qfqday || obj.data;
  if (!Array.isArray(arr)) return null;
  const out = new Map();
  for (const r of arr) {
    if (!Array.isArray(r) || r.length < 5) continue;
    out.set(String(r[0]), { o: Number(r[1]), c: Number(r[2]), h: Number(r[3]), l: Number(r[4]) });
  }
  return out;
}

function parseEmKline(j) {
  if (!j || !j.data || !Array.isArray(j.data.klines)) return null;
  const out = new Map();
  for (const line of j.data.klines) {
    const p = String(line).split(',');
    if (p.length < 5) continue;
    out.set(p[0], { o: Number(p[1]), c: Number(p[2]), h: Number(p[3]), l: Number(p[4]) });
  }
  return out;
}

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : null;
}

function compareStats(rows, seriesDaily, limit) {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const use = limit ? seriesDaily.slice(-limit) : seriesDaily;
  const xs = [], ys = [];
  let down = 0, up = 0, flat = 0, contrarian = 0, downNet = 0, upNet = 0;
  for (const d of use) {
    const k = byDate.get(d.date);
    if (!k || !isFinite(k.pct)) continue;
    xs.push(k.pct); ys.push(d.netYi);
    if (k.pct < -0.0001) {
      down++; downNet += d.netYi;
      if (d.netYi > 0) contrarian++;
    } else if (k.pct > 0.0001) { up++; upNet += d.netYi; }
    else flat++;
  }
  const corr = pearson(xs, ys);
  return {
    sessions: xs.length,
    downDays: down, upDays: up, flatDays: flat,
    contrarianDays: contrarian,
    downNetYi: round(downNet, 2), upNetYi: round(upNet, 2),
    corr: corr == null ? null : round(corr, 3),
  };
}

const indices = [];
for (const def of INDEX_DEFS) {
  const tx = parseTxKline(readMaybe(`index-tx-${def.code}-${YEAR}.json`), def.tx);
  const em = parseEmKline(readMaybe(`index-em-${def.code}-${YEAR}.json`));
  const base = tx || em;
  if (!base) continue;
  const rows = [];
  let prevClose = null;
  let crossMatched = 0;
  let crossMaxDiff = 0;
  for (const d of dates) {
    const k = base.get(d);
    if (!k || ![k.o, k.c, k.h, k.l].every(isFinite)) continue;
    if (tx && em && em.has(d)) {
      const e = em.get(d);
      crossMatched++;
      for (const f of ['o', 'c', 'h', 'l']) crossMaxDiff = Math.max(crossMaxDiff, Math.abs(k[f] - e[f]));
    }
    rows.push({
      date: d,
      o: round(k.o, 2), c: round(k.c, 2), h: round(k.h, 2), l: round(k.l, 2),
      pct: prevClose ? round((k.c / prevClose - 1) * 100, 4) : 0,
    });
    prevClose = k.c;
  }
  if (!rows.length) {
    console.log(`index ${def.name} 快照与当前年份不匹配，跳过`);
    continue;
  }
  const first = rows[0], last = rows[rows.length - 1];
  indices.push({
    id: def.id, code: def.code, name: def.name,
    source: tx ? '腾讯证券 fqkline（东财 push2his 交叉校验）' : '东方财富 push2his',
    rows,
    coverage: { first: first?.date ?? null, last: last?.date ?? null, sessions: rows.length, calendar: dates.length },
    periodPct: first && last ? round((last.c / first.o - 1) * 100, 2) : null,
    lastClose: last?.c ?? null,
    crossCheck: { matched: crossMatched, maxDiff: round(crossMaxDiff, 4), unit: '指数点' },
    compare: {
      all: compareStats(rows, daily, 0),
      recent60: compareStats(rows, daily, 60),
    },
  });
}

// ---- 历史情景对照（描述性统计，不是预测） -----------------------------------
// 对每个交易日 t（其后 20 个交易日仍在序列内，保证四行样本一致），
// 计算 t+5 / t+10 / t+20 的收盘价相对第 t 日收盘的涨跌幅，按第 t 日的条件分组。
function median(xs) {
  const a = xs.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos), rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}
const dailyByDate = new Map(daily.map((d) => [d.date, d]));
for (const ix of indices) {
  const pts = [];
  for (let i = 0; i + 20 < ix.rows.length; i++) {
    const k = ix.rows[i], d = dailyByDate.get(k.date);
    if (!d) continue;
    pts.push({
      netYi: d.netYi, pct: k.pct,
      f5: (ix.rows[i + 5].c / k.c - 1) * 100,
      f10: (ix.rows[i + 10].c / k.c - 1) * 100,
      f20: (ix.rows[i + 20].c / k.c - 1) * 100,
    });
  }
  if (pts.length < 30) { ix.scenario = null; continue; }
  const sortedNet = pts.map((p) => p.netYi).sort((a, b) => a - b);
  const p80 = quantile(sortedNet, 0.8), p20 = quantile(sortedNet, 0.2);
  const defs = [
    { id: 'all', name: '全部交易日', test: () => true },
    { id: 'bigBuy', name: '大额净申购（当日 ≥ P80）', test: (p) => p.netYi >= p80 },
    { id: 'contra', name: '逆势申购（净申购 > 0 且指数收跌）', test: (p) => p.netYi > 0 && p.pct < 0 },
    { id: 'bigSell', name: '大额净赎回（当日 ≤ P20）', test: (p) => p.netYi <= p20 },
  ];
  ix.scenario = {
    samplePool: pts.length,
    thresholds: { p80: round(p80, 2), p20: round(p20, 2) },
    rows: defs.map((def) => {
      const xs = pts.filter(def.test);
      const stat = (k) => {
        const vals = xs.map((p) => p['f' + k]);
        return {
          med: round(median(vals), 2),
          win: Math.round((vals.filter((v) => v > 0).length / vals.length) * 100),
        };
      };
      return { id: def.id, name: def.name, n: xs.length, f5: stat(5), f10: stat(10), f20: stat(20) };
    }),
  };
}

// ---- 事件流：只作背景标注，不进入打分 -------------------------------------
const events = [
  { date: '2025-04-08', kind: 'announcement', title: '中央汇金公告明确自身「国家队」与类平准基金角色', source: '腾讯新闻', url: 'https://news.qq.com/rain/a/20250924A017AB00' },
  { date: '2026-07-19', kind: 'announcement', title: '中国国新、中国诚通公告合计约 600 亿元增持 A 股，其中国新相关主体超 500 亿元、诚通近百亿元', source: '东方财富 / 深圳商报', url: 'https://finance.eastmoney.com/a/202611023918794429.html' },
  { date: '2026-10-31', kind: 'press', title: '证券时报：19 个交易日股票型 ETF 资金净流入近 4000 亿元，9/28–10/23 的 15 个交易日近 3200 亿元', source: '证券时报', url: 'https://www.stcn.com/article/detail/4315831.html' },
  { date: '2026-11-02', kind: 'policy', title: '央行会同金融监管总局、证监会召开座谈会，股票回购增持再贷款由阶段性安排转为长期制度性安排，利率由 1.25% 下调至 1%', source: '新浪财经', url: 'https://finance.sina.com.cn/stock/y/2026-11-03/doc-inixmhha9937891.shtml' },
  { date: '2026-11-03', kind: 'policy', title: '开展证券、基金、保险公司互换便利（SFISF）操作，期限 1 年可展期', source: '新浪财经', url: 'https://finance.sina.com.cn/stock/y/2026-11-03/doc-inixmhha9937891.shtml' },
  { date: '2026-11-03', kind: 'press', title: '澎湃：2026Q3 汇金、证金、证金资管、外管局平台个股持仓数量全部零变动；社保现身 605 只、增持 365 只、新进 174 只', source: '澎湃新闻', url: 'https://www.thepaper.cn/newsDetail_forward_34390410' },
];

// ---- 口径说明 -------------------------------------------------------------
const notes = [
  { id: 'N1', title: '金额逐只计算', body: `net_i[t] = (share_i[t] − share_i[t−1]) × price_i[t]，单位为元；全池净申购 = Σ net_i ÷ 1e8，单位为亿元。不同 ETF 单位净值不同（510300 约 4.135、510500 约 6.67、588080 约 1.298），因此份额不能跨标的求和后乘一个价格。` },
  { id: 'N2', title: '收盘价近似净值', body: '申赎按基金单位净值成交，本页使用的 prices 是二级市场收盘价，不是官方 NAV。折溢价与净值误差未校正，金额属测算值。' },
  { id: 'N3', title: '份额 T+1', body: 'ETF 份额当日数据次日披露。序列里的日期是份额披露对应的行情日，价格对齐到同一交易日；最新一行不代表当日盘后实时数据。' },
  { id: 'N4', title: '匿名净额', body: '份额变动是全部一级市场申赎相抵后的净额，无法区分中央汇金、做市商、套利盘、机构与个人。本页把它标为「全池净申购（匿名净额）」，不标为「国家队买入」。' },
  { id: 'N5', title: '强度分公式', body: 'score = 30 × 近 60 日净申购分位 + 25 × 同步只数占比 + 20 × min(连续净申购天数 ÷ 5, 1) + 15 × 逆势命中 + 10 × min(份额单日增幅 ÷ 2%, 1)。命中依据可在页面上展开。启发式打分，不是概率，也不是身份认定。' },
  { id: 'N6', title: '未接入的依据', body: '尾盘集中放量需要分钟级成交、折溢价需要 IOPV、成交额与融资余额分位需要另接数据源，本版均不参与打分。官方公告事件只作背景标注。' },
  { id: 'N7', title: '季度校准尚未闭合', body: `实名前十大持有人只在半年报、年报披露，最新锚点是 ${meta.report_date}。日频匿名净额无法拆分主体，误差须等 2026 年报披露后才能回测。页面把冲突与误差直接列出，不隐藏。` },
  { id: 'N8', title: '两个口径不可相加', body: 'ETF 底层仍是股票。个股前十大流通股东口径与 ETF 份额口径存在重复计算，本页不含个股持仓，也不与个股口径合并。' },
  { id: 'N9', title: '标的池边界', body: poolCfg.boundary },
  { id: 'N10', title: '主体归一', body: 'config/entities.json 把定期报告里的股东名称归一到 11 类主体，并带排除规则。竞品曾把「同瑞汇金3期私募」「…ETF联接基金」误判为国家队，本页对含「汇金」「证金」字样的私募与联接基金一律排除。' },
  { id: 'N11', title: '大盘指数口径', body: '上证指数（000001）与沪深300（000300）的日 K 取自腾讯证券 fqkline，东方财富 push2his 同字段交叉校验；未复权，只用于点位与涨跌方向对照。指数行情比份额日报多 1–2 个交易日，图上按份额交易日历对齐，多出的行情日不画。指数涨跌幅按前一日收盘计算，与交易所公布的涨跌幅可能有小数级差异。' },
  { id: 'N12', title: '对比不等于归因', body: '上下两个面板共享同一交易日，用来观察「指数下跌当天是否伴随净申购」，不是因果关系。相关系数由当日指数涨跌幅与全池净申购逐日配对计算，含份额折算等跳变日，只作方向参考。「逆势日」定义为指数收跌且当日净申购为正，同样不表示买方身份。' },
  { id: 'N13', title: '历史情景对照', body: `对每个交易日 t（其后 20 个交易日仍在序列内，四行样本一致），计算 t+5、t+10、t+20 的收盘价相对第 t 日收盘的涨跌幅，按第 t 日的条件分组，给出组内中位数与正收益占比。条件为：全部交易日、大额净申购（当日净申购 ≥ 全样本 P80）、逆势申购（净申购 > 0 且指数收跌）、大额净赎回（≤ P20）。这是历史条件分布的描述，不是预测：样本只有一个完整年度，组间差异可能落在噪声内，过去的关系不保证重复。` },
];

const out = {
  meta: {
    generatedAt: new Date().toISOString(),
    tradeDate: meta.trade_date,
    reportDate: meta.report_date,
    prevReportDate: meta.prev_report_date,
    sourceGeneratedAt: meta.generated_at,
    poolSize: poolCfg.codes.length,
    sessions: daily.length,
    firstDate: dates[0],
    lastDate: dates.at(-1),
    methodVersion: '1.2.0',
    disclaimer: '本页为公开数据测算，非官方披露',
    sources: [
      { name: '上交所 ETF 份额日报', url: 'https://www.sse.com.cn/market/fund/volume/etf/index.html', role: 'L1 份额校验' },
      { name: 'H-Jett/etf-radar Pages 快照（MIT）', url: 'https://github.com/H-Jett/etf-radar', role: '日频份额与收盘价序列、实名持有人锚点' },
      { name: '腾讯证券 fqkline', url: 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get', role: '上证指数与沪深300 日 K（主源）' },
      { name: '东方财富 push2his K 线', url: 'https://push2his.eastmoney.com/api/qt/stock/kline/get', role: '指数日 K 交叉校验；push2 行情另用于 510300 份额校验' },
    ],
  },
  layers: {
    L1: { name: '实测', description: '交易所份额、收盘价、官方公告。硬数据，不加推测标签。' },
    L2: { name: '推测', description: '全池净申购强度、同步性、连续天数。必带「测算」角标，可展开依据。' },
    L3: { name: '校准', description: '半年报实名前十大持有人锚点 vs 日频累计，误差直接摆出来。' },
  },
  entities: { tiers: entities.tiers, rules: entities.rules.map(({ id, name, tier, note }) => ({ id, name, tier, note })), falsePositives: entities.knownFalsePositives },
  pool: poolCfg.codes.map((code) => {
    const e = etfMeta.get(code);
    const g = poolCfg.groups.find((x) => x.codes.includes(code));
    return { code, name: e?.name || etfName.get(code) || code, exchange: e?.exchange || null, group: g?.name || '其他', indexName: e?.index_name || null };
  }),
  daily,
  indices,
  latest,
  topIn,
  topOut,
  calibration: calendar,
  anchors,
  events,
  notes,
};

fs.writeFileSync(path.join(DATA, 'dashboard.json'), JSON.stringify(out), 'utf8');

// 同时输出一份可直接 <script> 引入的版本，供无构建场景使用
fs.writeFileSync(path.join(DATA, 'dashboard.js'), `window.__DASHBOARD__ = ${JSON.stringify(out)};\n`, 'utf8');

const maxIn = daily.reduce((a, b) => (b.netYi > a.netYi ? b : a));
const maxOut = daily.reduce((a, b) => (b.netYi < a.netYi ? b : a));
console.log(`sessions      ${daily.length}  ${dates[0]} → ${dates.at(-1)}`);
console.log(`pool          ${poolCfg.codes.length} ETFs`);
console.log(`latest        ${latest.date}  net ${latest.netYi} 亿  score ${latest.score}  breadth ${latest.breadth}/${poolCfg.codes.length}  streak ${latest.streak}`);
console.log(`max inflow    ${maxIn.date}  ${maxIn.netYi} 亿`);
console.log(`max outflow   ${maxOut.date}  ${maxOut.netYi} 亿`);
console.log(`cum since ${dates[1]}  ${latest.cumYi} 亿`);
console.log(`anchors       ${anchors.length}  conflicts ${conflictCount}  sse checks ${sseChecks.length} (max diff ${Math.max(0, ...sseChecks.map((c) => c.diffPct))}%)`);
for (const ix of indices) console.log(`index         ${ix.name}  ${ix.coverage.first} → ${ix.coverage.last}  ${ix.coverage.sessions}/${ix.coverage.calendar} 日  cross ${ix.crossCheck.matched} 日 maxDiff ${ix.crossCheck.maxDiff} 点  corr(all) ${ix.compare.all.corr}  contrarian ${ix.compare.all.contrarianDays}/${ix.compare.all.downDays}`);
for (const ix of indices) {
  if (!ix.scenario) { console.log(`scenario      ${ix.name}  样本不足，跳过`); continue; }
  const cells = ix.scenario.rows.map((r) => `${r.id} n=${r.n} med ${r.f5.med}/${r.f10.med}/${r.f20.med} win ${r.f5.win}/${r.f10.win}/${r.f20.win}`).join('  ');
  console.log(`scenario      ${ix.name}  pool ${ix.scenario.samplePool}  P80 ${ix.scenario.thresholds.p80} 亿  P20 ${ix.scenario.thresholds.p20} 亿`);
  console.log(`              ${cells}`);
}
console.log(`written       data/dashboard.json (${(fs.statSync(path.join(DATA, 'dashboard.json')).size / 1024).toFixed(0)} KB)`);

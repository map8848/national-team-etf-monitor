#!/usr/bin/env node
/**
 * 采集公开数据源的日频份额 / 价格 / 实名持有人快照，落盘到 data/raw/。
 * 只用交易所口径的公开数据，不产生任何推算数字。
 *
 * 用法： node scripts/gather.mjs
 * 依赖： 无（仅 Node 内置 https / fs）
 *
 * 日更说明：先取 meta.json，用其中的 trade_date 决定年份与校验日期，
 * 因此跨年、数据源延后一日都不会写错文件名。
 */
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data', 'raw');
fs.mkdirSync(RAW, { recursive: true });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PAGES = 'https://h-jett.github.io/etf-radar/data';

function get(url, headers = {}, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout, headers: { 'User-Agent': UA, ...headers } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('timeout', () => { req.destroy(new Error(`TIMEOUT ${url}`)); });
    req.on('error', reject);
  });
}

async function retry(url, headers, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await get(url, headers); } catch (e) { last = e; await new Promise(r => setTimeout(r, 400 * (i + 1))); }
  }
  throw last;
}

function parseJson(text) {
  const t = text.trim();
  return JSON.parse(t.startsWith('(') ? t.replace(/^\(/, '').replace(/\);?$/, '') : t);
}

function writeRaw(file, text) {
  const parsed = parseJson(text);
  fs.writeFileSync(path.join(RAW, file), JSON.stringify(parsed), 'utf8');
  return parsed;
}

// 标的池与 config/pool.json 保持一致（宽基行业 id:0 的 22 只）
const POOL = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'pool.json'), 'utf8')).codes;

// 第一步：取 meta，确定年份与最新交易日
const meta = writeRaw('meta.json', await retry(`${PAGES}/meta.json`, {}));
const YEAR = String(meta.trade_date).slice(0, 4);
const tradeDate = String(meta.trade_date);

function shiftDate(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const jobs = [
  ['universe.json', `${PAGES}/universe.json`, {}],
  ['etfs.json', `${PAGES}/etfs.json`, {}],
  ['industry-index.json', `${PAGES}/industry/index.json`, {}],
  [`industry-wide-${YEAR}.json`, `${PAGES}/industry/0/${YEAR}.json`, {}],
  [`trends-${YEAR}.json`, `${PAGES}/trends/${YEAR}.json`, {}],
  ['holders-periods.json', `${PAGES}/holders/periods.json`, {}],
];
for (const code of POOL) jobs.push([`series-${code}-${YEAR}.json`, `${PAGES}/series/${code}/${YEAR}.json`, {}]);

// 上交所官方逐日份额快照（L1 实测校验用）：最新交易日 + 前 1 / 7 / 25 个自然日
for (const off of [0, -1, -7, -25]) {
  const d = shiftDate(tradeDate, off);
  const u = `https://query.sse.com.cn/commonQuery.do?isPagination=true&pageHelp.pageSize=10000&pageHelp.pageNo=1&pageHelp.beginPage=1&pageHelp.cacheSize=1&pageHelp.endPage=1&sqlId=COMMON_SSE_ZQPZ_ETFZL_XXPL_ETFGM_SEARCH_L&STAT_DATE=${d.replace(/-/g, '')}`;
  jobs.push([`sse-${d}.json`, u, { Referer: 'https://www.sse.com.cn/' }]);
}

const results = [{ file: 'meta.json', ok: true, bytes: fs.statSync(path.join(RAW, 'meta.json')).size }];
let active = 0;
let cursor = 0;
await new Promise((resolve) => {
  const launch = () => {
    while (active < 6 && cursor < jobs.length) {
      const [file, url, headers] = jobs[cursor++];
      active++;
      retry(url, headers).then((text) => {
        try { writeRaw(file, text); } catch (e) { throw new Error(`NOT JSON ${file}: ${String(text).slice(0, 90)}`); }
        results.push({ file, ok: true, bytes: text.length });
      }).catch((e) => {
        results.push({ file, ok: false, error: String(e.message || e) });
      }).finally(() => { active--; if (cursor >= jobs.length && active === 0) resolve(); else launch(); });
    }
  };
  launch();
});

for (const r of results.sort((a, b) => a.file.localeCompare(b.file))) {
  console.log(r.ok ? `OK   ${r.file} (${r.bytes}B)` : `FAIL ${r.file} :: ${r.error}`);
}
const ok = results.filter(r => r.ok).length;
console.log(`\n${ok}/${results.length} files written to data/raw/`);
console.log(`meta.trade_date = ${tradeDate}  year = ${YEAR}  pool = ${POOL.length}`);
if (ok < results.length) process.exitCode = 1;

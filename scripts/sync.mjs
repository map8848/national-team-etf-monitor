// 同步已有远端仓库：把工作区文件按当前 main 的 head 建一个新提交推上去。
// 与 publish.mjs 的区别：publish 只用于首次建仓，sync 用于后续改动上线。
// token 只从 GITHUB_TOKEN 环境变量或 .github-pat 读取，绝不写进仓库、绝不打印。
// 用法：node scripts/sync.mjs [--dry-run] [--repo <name>]
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const repoArgIdx = process.argv.indexOf('--repo');
const REPO = (repoArgIdx > -1 && process.argv[repoArgIdx + 1]) || process.env.GITHUB_REPO || 'national-team-etf-monitor';
const PAT_FILE = path.join(ROOT, '.github-pat');

let TOKEN = (process.env.GITHUB_TOKEN || '').trim();
if (!TOKEN && fs.existsSync(PAT_FILE)) TOKEN = fs.readFileSync(PAT_FILE, 'utf8').trim();

const SKIP_DIRS = new Set(['.git', 'node_modules', '.npm-cache', 'dist', '_chrome-profile']);
const SKIP_FILES = new Set(['.DS_Store', '.github-pat', 'package-lock.json']);
const skipFile = (name) => SKIP_FILES.has(name) || /^_.*\.(cjs|mjs|txt|log|zip)$/.test(name);

function walk(rel = '') {
  const out = [];
  for (const ent of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name)) out.push(...walk(r));
    } else if (ent.isFile() && !skipFile(ent.name)) {
      out.push(r);
    }
  }
  return out.sort();
}

const files = walk();
console.log(`待同步文件 ${files.length} 个 · 仓库 ${REPO}`);
if (DRY) {
  for (const f of files) console.log('  ' + f);
  console.log('dry-run 结束，未联网');
  process.exit(0);
}
if (!TOKEN) {
  console.error('缺少 token：请设置 GITHUB_TOKEN 环境变量，或把 PAT 写入 .github-pat');
  process.exit(1);
}

function api(method, p, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = https.request({
      hostname: 'api.github.com', path: p, method, timeout: 25000,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'national-team-etf-monitor-sync',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* 非 JSON 响应 */ }
        resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, json, text: text.slice(0, 400) });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function apiRetry(method, p, body, tries = 3) {
  let last = { status: 0, ok: false, text: 'no response' };
  for (let i = 0; i < tries; i++) {
    try {
      const r = await api(method, p, body);
      if (r.ok || r.status < 500) return r;
      last = r;
    } catch (e) {
      last = { status: 0, ok: false, text: String(e.message) };
    }
    await new Promise((r) => setTimeout(r, 600 * (i + 1)));
  }
  return last;
}

function need(r, what) {
  if (!r || !r.ok) throw new Error(`${what} 失败：HTTP ${r?.status} ${r?.text || ''}`);
  return r.json;
}

async function main() {
  const me = need(await apiRetry('GET', '/user'), '验证 token');
  const owner = me.login;
  const R = `/repos/${owner}/${REPO}`;

  const repo = await apiRetry('GET', R);
  if (!repo.ok) throw new Error(`仓库不存在或不可访问：HTTP ${repo.status} ${repo.text}；首次发布请用 node scripts/publish.mjs`);
  const branch = repo.json.default_branch || 'main';
  const ref = need(await apiRetry('GET', `${R}/git/ref/heads/${branch}`), `读取远端 ${branch}`);
  const headSha = ref.object.sha;
  const head = need(await apiRetry('GET', `${R}/git/commits/${headSha}`), '读取远端最新提交');
  console.log(`账号 ${owner} · 仓库 ${owner}/${REPO}`);
  console.log(`远端 ${branch} ${headSha.slice(0, 8)} ${String(head.message || '').split('\n')[0]}`);

  const tree = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const content = fs.readFileSync(path.join(ROOT, f));
    const blob = need(await apiRetry('POST', `${R}/git/blobs`, {
      content: content.toString('base64'), encoding: 'base64',
    }), `上传 ${f}`);
    tree.push({ path: f, mode: '100644', type: 'blob', sha: blob.sha });
    if ((i + 1) % 10 === 0 || i === files.length - 1) console.log(`  已上传 ${i + 1}/${files.length}`);
  }

  const treeRes = need(await apiRetry('POST', `${R}/git/trees`, { tree }), '创建 tree');
  const commit = need(await apiRetry('POST', `${R}/git/commits`, {
    message: 'feat: add index candlestick and net-subscription comparison',
    tree: treeRes.sha,
    parents: [headSha],
  }), '创建 commit');
  need(await apiRetry('PATCH', `${R}/git/refs/heads/${branch}`, { sha: commit.sha, force: false }), `更新 ${branch}`);
  console.log(`新提交 ${commit.sha}`);

  const pages = await apiRetry('GET', `${R}/pages`);
  console.log('\n完成');
  console.log(`仓库   ${repo.json.html_url}`);
  console.log(`站点   ${pages.json?.html_url || `https://${owner}.github.io/${REPO}/`}`);
  console.log(`文件   ${files.length}`);
  console.log('Pages 会在 push 后自动重新部署，通常一两分钟生效');

  if (fs.existsSync(PAT_FILE)) {
    fs.unlinkSync(PAT_FILE);
    console.log('.github-pat 已删除');
  }
  console.log('请在 GitHub → Settings → Developer settings 撤销本次使用的 token');
}

main().catch((e) => {
  console.error(`同步中断：${e.message}`);
  process.exit(1);
});

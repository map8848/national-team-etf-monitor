// 一次性发布：建仓 → 上传仓库全部文件 → 开 Pages → 开 Actions 写权限 → 触发一次日更
// token 只从 GITHUB_TOKEN 环境变量或 .github-pat 读取，绝不写进仓库、绝不打印。
// 用法：node scripts/publish.mjs [--dry-run] [--repo <name>]
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
const skipFile = (name) => SKIP_FILES.has(name) || /^_.*\.(cjs|mjs)$/.test(name);

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
console.log(`待发布文件 ${files.length} 个 · 仓库 ${REPO}`);
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
        'User-Agent': 'national-team-etf-monitor-publisher',
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
  console.log(`账号 ${owner}`);

  const existing = await apiRetry('GET', `/repos/${owner}/${REPO}`);
  if (existing.status === 404) {
    const created = await apiRetry('POST', '/user/repos', {
      name: REPO,
      private: false,
      auto_init: false,
      description: '国家队稳市资金监测 · 日频 ETF 份额净申购观测台账（公开数据测算，非官方披露）',
      has_issues: true,
      has_projects: false,
      has_wiki: false,
    });
    if (!created.ok) {
      throw new Error(`无法自动建仓（HTTP ${created.status} ${created.text}）。多半是 fine-grained PAT 不支持 POST /user/repos；请在浏览器新建名为 ${REPO} 的空公开仓库，不要勾 README / license / .gitignore，然后重跑本脚本。`);
    }
    console.log(`仓库已创建 ${owner}/${REPO}`);
  } else if (existing.ok) {
    console.log(`仓库已存在 ${owner}/${REPO}`);
  } else {
    throw new Error(`查询仓库失败：HTTP ${existing.status} ${existing.text}`);
  }
  const R = `/repos/${owner}/${REPO}`;

  const FINAL_MARKER = 'chore: init dashboard, config and exchange share snapshots';
  const INIT_MARKER = 'chore: initialize repository for dashboard publish';
  let parentSha = null;
  let refExists = false;

  const ref = await apiRetry('GET', `${R}/git/ref/heads/main`);
  if (ref.ok) {
    refExists = true;
    const head = await apiRetry('GET', `${R}/git/commits/${ref.json.object.sha}`);
    const headMessage = head.json?.message || '';
    if (headMessage === FINAL_MARKER) throw new Error('远端 main 已完成发布，无需重复运行');
    if (headMessage !== INIT_MARKER) throw new Error('远端 main 已有提交且不是本脚本创建的，为避免覆盖历史请人工确认后再运行');
    parentSha = ref.json.object.sha;
    console.log('检测到空仓库占位提交，继续发布');
  } else if (ref.status === 404 || ref.status === 409) {
    // 空仓库的 Git Data API 会返回 409 Git Repository is empty，先用 Contents API 造初始提交
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'));
    const init = await apiRetry('PUT', `${R}/contents/README.md`, {
      message: INIT_MARKER,
      content: readme.toString('base64'),
    });
    const initSha = init.json?.commit?.sha;
    if (!init.ok || !initSha) {
      throw new Error(`空仓库初始化失败：HTTP ${init.status} ${init.text}；可在浏览器给该仓库加一个 README 后重跑`);
    }
    parentSha = initSha;
    const refAfter = await apiRetry('GET', `${R}/git/ref/heads/main`);
    refExists = refAfter.ok;
    if (refExists && refAfter.json.object.sha !== initSha) throw new Error('初始化后的 main 指向非预期提交，请人工确认');
    console.log(`空仓库已初始化 ${initSha.slice(0, 8)}`);
  } else {
    throw new Error(`查询 main 失败：HTTP ${ref.status} ${ref.text}`);
  }

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
    message: FINAL_MARKER,
    tree: treeRes.sha,
    parents: parentSha ? [parentSha] : [],
  }), '创建 commit');
  if (refExists) {
    need(await apiRetry('PATCH', `${R}/git/refs/heads/main`, { sha: commit.sha, force: false }), '更新 main');
  } else {
    need(await apiRetry('POST', `${R}/git/refs`, { ref: 'refs/heads/main', sha: commit.sha }), '创建 main');
  }
  console.log(`初始提交 ${commit.sha}`);

  await apiRetry('PATCH', R, { default_branch: 'main' });

  const perm = await apiRetry('PUT', `${R}/actions/permissions/workflow`, {
    default_workflow_permissions: 'write',
    can_approve_pull_request_reviews: true,
  });
  console.log(perm.ok
    ? 'Actions 默认写权限已开启'
    : `Actions 权限未设置（HTTP ${perm.status}），若日更推送失败请在 Settings → Actions 手动开启`);

  let pages = await apiRetry('POST', `${R}/pages`, {
    build_type: 'legacy', source: { branch: 'main', path: '/' },
  });
  if (!pages.ok && pages.status === 409) {
    pages = await apiRetry('PUT', `${R}/pages`, {
      build_type: 'legacy', source: { branch: 'main', path: '/' },
    });
  }
  const site = pages.ok ? pages.json?.html_url : null;
  if (site) {
    console.log(`Pages ${site}`);
    await apiRetry('PATCH', R, { homepage: site });
  } else {
    console.log(`Pages 创建未成功：HTTP ${pages.status} ${pages.text}`);
  }

  const dispatch = await apiRetry('POST', `${R}/actions/workflows/daily.yml/dispatches`, { ref: 'main' });
  console.log(dispatch.ok
    ? '首次日更已触发'
    : `日更触发未成功：HTTP ${dispatch.status} ${dispatch.text}，可在 Actions 页手动 Run workflow`);

  const finalRepo = await apiRetry('GET', R);
  const finalPages = await apiRetry('GET', `${R}/pages`);
  console.log('\n完成');
  console.log(`仓库   ${finalRepo.json?.html_url || `https://github.com/${owner}/${REPO}`}`);
  console.log(`站点   ${finalPages.json?.html_url || site || '未取得，稍后在 Settings → Pages 查看'}`);
  console.log(`提交   ${commit.sha}`);
  console.log(`文件   ${files.length}`);

  if (fs.existsSync(PAT_FILE)) {
    fs.unlinkSync(PAT_FILE);
    console.log('.github-pat 已删除');
  }
  console.log('请在 GitHub → Settings → Developer settings 撤销本次使用的 token');
}

main().catch((e) => {
  console.error(`发布中断：${e.message}`);
  process.exit(1);
});

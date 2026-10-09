#!/usr/bin/env node
// Web cold-start measurement for the bible web app (task 0123; see
// packages/core/docs/features/feature-modules-migration.md, "Measuring startup").
// Usage:  DATA_CHECKOUT=<checkout with data/main.db and data/modules> node apps/web/scripts/measure-startup.mjs [--n=5] [--rounds=2] [--out=results.json] <treeDir> [<treeDir> ...]
//   Each treeDir is a repo root (or worktree) with node_modules installed and apps/web/dist/client built:
//     pnpm run build:core && pnpm --filter @bible/web run build:client
//   Rounds are interleaved: tree1, tree2, tree1, tree2 ... (n cold loads each). Medians reported per round and overall.
//   Each tree is served by its own real server (tsx server/index.ts, NO_AUTH, scratch data dir, modules from
//   $DATA_CHECKOUT/data). Every load = fresh Chromium context (no cache, SW blocked, empty
//   localStorage), 1280x720, URL "/". Signals (ms from navigation start): verse = first visible .verse,
//   splash = #app-loading removed (hideAppLoading). Also JS request count/KB and URLs before verse / within 3 s after.
// Env: PW_DIR (dir containing node_modules/playwright), DATA_CHECKOUT.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';

const DATA = process.env.DATA_CHECKOUT;
if (!DATA) { console.error('Set DATA_CHECKOUT to a checkout whose data/ holds main.db and the modules.'); process.exit(2); }
const SCRATCH = process.env.MEASURE_SCRATCH || join(tmpdir(), 'bible-measure-startup');
const args = process.argv.slice(2);
const opt = (k, d) => (args.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1] ?? d;
const N = +opt('n', 5), ROUNDS = +opt('rounds', 2), OUT = opt('out', join(SCRATCH, 'results.json'));
const trees = args.filter(a => !a.startsWith('--')).map(a => resolve(a));
if (!trees.length) { console.error('usage: node measure-startup.mjs [--n=5] [--rounds=2] <treeDir>...'); process.exit(2); }

const pwDir = process.env.PW_DIR || trees[0] + '/apps/web';
const { chromium } = createRequire(join(pwDir, 'x.js'))('@playwright/test');

const freePort = () => new Promise(r => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };

async function startServer(tree) {
  const web = join(tree, 'apps/web');
  if (!existsSync(join(web, 'dist/client/index.html'))) throw new Error(`no built client in ${web}`);
  const scratch = join(SCRATCH, basename(tree));
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(join(scratch, 'data'), { recursive: true });
  copyFileSync(join(DATA, 'data/main.db'), join(scratch, 'data/main.db'));
  copyFileSync(join(web, 'e2e/fixtures/site-config.json'), join(scratch, 'data/site-config.json'));
  const tsx = join(web, 'node_modules/.bin/tsx');
  const port = await freePort();
  const p = spawn(tsx, ['server/index.ts'], { cwd: web, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), NO_AUTH: '1', DISABLE_RATE_LIMIT: '1', BIBLE_DATA_DIR: join(scratch, 'data'), BIBLE_MODULES_DIR: join(DATA, 'data') } });
  let log = ''; p.stdout.on('data', d => log += d); p.stderr.on('data', d => log += d);
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`http://localhost:${port}/api/health`)).ok) return { url: `http://localhost:${port}`, stop: () => p.kill('SIGTERM') }; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  p.kill(); throw new Error('server did not start for ' + tree + '\n' + log);
}

async function loadOnce(browser, url) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__t = { verse: null, splash: null };
    const check = () => {
      const now = performance.now();
      if (window.__t.verse == null) { const v = document.querySelector('.verse'); if (v && v.getClientRects().length) window.__t.verse = now; }
      if (window.__t.splash == null && document.getElementById('app-loading') === null && document.body && document.readyState !== 'loading' || (window.__t.splash == null && window.__seenSplash && !document.getElementById('app-loading'))) window.__t.splash = now;
      if (document.getElementById('app-loading')) window.__seenSplash = true;
    };
    new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true });
    const tick = () => { check(); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  });
  const reqs = []; // {url, kb, t}
  const t0 = Date.now();
  page.on('response', async r => {
    const u = r.url();
    if (!/\.m?js(\?|$)/.test(u)) return;
    let kb = 0; try { kb = (await r.body()).length / 1024; } catch {}
    reqs.push({ url: u.replace(url, ''), kb, t: Date.now() });
  });
  page.on('request', r => { if (/\.m?js(\?|$)/.test(r.url())) reqs.push({ url: r.url().replace(url, ''), req: true, t: Date.now() }); });
  await page.goto(url + '/', { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__t && window.__t.verse != null, null, { timeout: 30000 });
  await page.waitForTimeout(3200);
  const sig = await page.evaluate(() => ({ ...window.__t, origin: performance.timeOrigin }));
  await ctx.close();
  const bodies = reqs.filter(r => !r.req);
  const firstReq = new Map(); for (const r of reqs.filter(r => r.req)) firstReq.set(r.url, r.t);
  const o = sig.origin;
  const verse = sig.verse, splash = sig.splash;
  const before = [], after = [];
  for (const [u, t] of firstReq) ((t - o) <= verse ? before : after).push(u);
  return { verse, splash, jsCount: firstReq.size, jsKB: bodies.reduce((a, r) => a + r.kb, 0), before, after };
}

const results = {}; trees.forEach(t => results[t] = []);
const servers = {};
for (const t of trees) servers[t] = await startServer(t);
const browser = await chromium.launch();
try {
  for (const t of trees) { await loadOnce(browser, servers[t].url); } // warm-up (server JIT, sqlite page cache), discarded
  for (let r = 0; r < ROUNDS; r++) for (const t of trees) {
    const loads = [];
    for (let i = 0; i < N; i++) loads.push(await loadOnce(browser, servers[t].url));
    results[t].push(loads);
    console.error(`round ${r + 1} ${basename(t)}: verse ${med(loads.map(l => l.verse)).toFixed(0)} ms, splash ${med(loads.map(l => l.splash)).toFixed(0)} ms, js ${med(loads.map(l => l.jsCount))} / ${med(loads.map(l => l.jsKB)).toFixed(0)} KB`);
  }
} finally { await browser.close(); Object.values(servers).forEach(s => s.stop()); }

writeFileSync(OUT, JSON.stringify(results, null, 1));
console.log('\ntree | round | verse ms (med) | splash ms (med) | JS reqs | JS KB');
for (const t of trees) {
  const all = results[t].flat();
  results[t].forEach((loads, i) => console.log(`${basename(t)} | r${i + 1} | ${med(loads.map(l => l.verse)).toFixed(0)} | ${med(loads.map(l => l.splash)).toFixed(0)} | ${med(loads.map(l => l.jsCount))} | ${med(loads.map(l => l.jsKB)).toFixed(0)}`));
  console.log(`${basename(t)} | ALL | ${med(all.map(l => l.verse)).toFixed(0)} | ${med(all.map(l => l.splash)).toFixed(0)} | ${med(all.map(l => l.jsCount))} | ${med(all.map(l => l.jsKB)).toFixed(0)}`);
}
console.log(`details (per-load URL lists before verse / 3 s after): ${OUT}`);

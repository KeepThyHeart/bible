/**
 * Starts the app a manifest describes (local web server + chromium, an allowed external
 * site read-only, or Electron) and hands back the page plus a close() that cleans up.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import pw from 'playwright-core';
import type { Browser, BrowserContext, ElectronApplication, Page } from 'playwright-core';
import { expand, expandDeep, freePort, loadManifest, missingBuild, resolveManifestPath } from './manifest.ts';
import type { LaunchedApp, LaunchOptions, Manifest, ManifestCommand } from './types.ts';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function tailFile(file: string, n: number): string {
  try {
    return readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).slice(-n).join('\n');
  } catch {
    return '';
  }
}

/** Runs the prepare command; its last non-empty stdout line, if a JSON object, gives prepare.KEY vars. */
async function runPrepare(cmd: ManifestCommand, manifestDir: string, vars: Record<string, string>): Promise<Record<string, string>> {
  const x = expandDeep(cmd, vars);
  const child = spawn(x.command, x.args ?? [], {
    cwd: path.resolve(manifestDir, x.cwd ?? '.'),
    env: { ...process.env, ...x.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { err += d; });
  const timeout = x.timeout ?? 120_000;
  const code = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`prepare timed out after ${timeout / 1000}s`)); }, timeout);
    child.once('error', reject);
    child.once('close', c => { clearTimeout(timer); resolve(c); });
  });
  if (code !== 0) {
    const lines = err.split('\n').filter(l => l.trim()).slice(-10).join('\n');
    throw new Error(`prepare failed (exit ${code}):\n${lines}`);
  }
  const last = out.split('\n').map(l => l.trim()).filter(Boolean).pop();
  const result: Record<string, string> = {};
  if (last?.startsWith('{')) {
    try {
      for (const [k, v] of Object.entries(JSON.parse(last) as Record<string, unknown>)) result[`prepare.${k}`] = String(v);
    } catch { /* not JSON: no variables */ }
  }
  return result;
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** SIGTERM the server's process group, SIGKILL after 10 s if anything is left. */
async function killGroup(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (!pid || !isAlive(pid)) return;
  try { process.kill(-pid, 'SIGTERM'); } catch { /* already gone */ }
  for (let i = 0; i < 100 && isAlive(pid); i++) await sleep(100);
  if (isAlive(pid)) {
    try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}

async function waitReady(url: string, timeout: number, child: ChildProcess, logFile: string): Promise<void> {
  const deadline = Date.now() + timeout;
  let exited = false;
  child.once('exit', () => { exited = true; });
  while (Date.now() < deadline) {
    if (exited) throw new Error(`server exited before ready:\n${tailFile(logFile, 20)}`);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.status === 200) return;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error(`server not ready at ${url} after ${timeout / 1000}s:\n${tailFile(logFile, 20)}`);
}

export async function launchApp(opts: LaunchOptions): Promise<LaunchedApp> {
  const manifestFile = resolveManifestPath(opts.app, opts.repoRoot);
  const manifest = loadManifest(manifestFile);
  const manifestDir = path.dirname(manifestFile);

  const profileDir = path.join(opts.sessionDir, `profile-${Date.now()}`);
  mkdirSync(profileDir, { recursive: true });
  const keepProfile = opts.keepProfile || manifest.profile?.keep === true;
  const cleanups: Array<() => Promise<void>> = [];
  const cleanup = async () => {
    for (const fn of cleanups.reverse()) {
      try { await fn(); } catch { /* best effort */ }
    }
    if (!keepProfile) rmSync(profileDir, { recursive: true, force: true });
  };

  try {
    const base: Record<string, string> = {
      profile: profileDir,
      manifestDir,
      repoRoot: opts.repoRoot,
      tmp: os.tmpdir(),
    };
    const app = manifest.kind === 'web'
      ? await launchWeb(opts, manifest, manifestDir, base, cleanups)
      : await launchElectron(opts, manifest, manifestDir, base, cleanups);

    let closing: Promise<void> | undefined;
    return {
      ...app,
      profileDir,
      close: () => (closing ??= cleanup()),
    };
  } catch (e) {
    await cleanup();
    throw e;
  }
}

type Partial_ = Omit<LaunchedApp, 'profileDir' | 'close'>;

async function launchWeb(
  opts: LaunchOptions, manifest: Manifest, manifestDir: string,
  base: Record<string, string>, cleanups: Array<() => Promise<void>>,
): Promise<Partial_> {
  const viewport = opts.viewport ?? manifest.viewport;
  let baseUrl: string;
  let contextOpts: Parameters<Browser['newContext']>[0] = { viewport };
  const readOnly = opts.url !== undefined;

  if (readOnly) {
    const url = new URL(opts.url!);
    const allowed = manifest.external?.allow ?? [];
    if (!allowed.includes(url.origin)) throw new Error(`refusing ${opts.url}: not in external.allow`);
    baseUrl = opts.url!;
    contextOpts = { viewport, serviceWorkers: 'block' };
  } else {
    const miss = missingBuild(manifest, manifestDir);
    if (miss) throw new Error(miss);
    const server = manifest.server!;
    const port = server.port === 'auto' || server.port === undefined ? await freePort() : server.port;
    const vars: Record<string, string> = { ...base, port: String(port) };
    if (manifest.prepare) {
      const t0 = Date.now();
      Object.assign(vars, await runPrepare(manifest.prepare, manifestDir, vars));
      opts.log(`prepare done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }
    vars.url = expand(server.url, vars);
    const x = expandDeep(server, vars);
    const logFile = path.join(opts.sessionDir, 'server.log');
    const fd = openSync(logFile, 'a');
    appendFileSync(logFile, `--- server start ${new Date().toISOString()} ---\n`);
    const child = spawn(x.command, x.args ?? [], {
      cwd: path.resolve(manifestDir, x.cwd ?? '.'),
      env: { ...process.env, ...x.env },
      detached: true,
      stdio: ['ignore', fd, fd],
    });
    closeSync(fd);
    child.unref();
    cleanups.push(() => killGroup(child));
    child.once('error', e => appendFileSync(logFile, `spawn error: ${e.message}\n`));
    const t0 = Date.now();
    await waitReady(x.ready.url, x.ready.timeout ?? 300_000, child, logFile);
    opts.log(`server ready in ${((Date.now() - t0) / 1000).toFixed(1)}s at ${vars.url}`);
    baseUrl = vars.url;
  }

  const browser = await pw.chromium.launch({ headless: !opts.headed });
  cleanups.push(() => browser.close());
  const context: BrowserContext = await browser.newContext(contextOpts);
  if (readOnly) {
    await context.route('**/*', route => {
      const req = route.request();
      const method = req.method();
      if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.continue();
      opts.onBlocked?.(method, req.url());
      return route.abort('blockedbyclient');
    });
  }
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  opts.log(`launched web ${baseUrl}`);
  return {
    kind: 'web',
    baseUrl,
    readOnly,
    context,
    page,
    info: `web ${baseUrl} (${readOnly ? 'external, read-only' : 'local server, fixture data'})`,
    repro: { kind: 'web', baseUrl, viewport },
  };
}

async function launchElectron(
  opts: LaunchOptions, manifest: Manifest, manifestDir: string,
  base: Record<string, string>, cleanups: Array<() => Promise<void>>,
): Promise<Partial_> {
  const miss = missingBuild(manifest, manifestDir);
  if (miss) throw new Error(miss);
  const e = expandDeep(manifest.electron!, base);
  const main = path.resolve(manifestDir, e.main);
  const args = e.args ?? [];
  const env = e.env ?? {};
  const executablePath = createRequire(path.join(manifestDir, 'package.json'))('electron') as string;
  const timeout = e.timeout ?? 60_000;

  const electron: ElectronApplication = await pw._electron.launch({
    executablePath,
    args: [...args, main],
    env: { ...process.env, ...env } as Record<string, string>,
    cwd: manifestDir,
    timeout,
  });
  cleanups.push(async () => {
    const proc = electron.process();
    const closed = electron.close().then(() => true, () => true);
    const done = await Promise.race([closed, sleep(10_000).then(() => false)]);
    if (!done && proc.pid && isAlive(proc.pid)) proc.kill('SIGKILL');
  });
  const page: Page = await electron.firstWindow();
  if (e.readySelector) await page.waitForSelector(e.readySelector, { timeout });
  if (opts.viewport) await page.setViewportSize(opts.viewport);
  opts.log('launched electron');
  return {
    kind: 'electron',
    readOnly: false,
    context: electron.context(),
    electron,
    page,
    info: `electron ${path.relative(opts.repoRoot, main)} (throwaway profile)`,
    repro: { kind: 'electron', main, args, env, cwd: manifestDir },
  };
}

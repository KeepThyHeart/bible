/**
 * `drive clean`: removes temp dirs that the bible tests and the driver leave behind in the OS tmp dir.
 * Local command (no daemon). Pure node built-ins, so the client can import it lazily.
 *
 * Only directories (and `bud-*.sock` files) DIRECTLY in the tmp dir whose names match the allow-list
 * below are ever touched, and never through a symlink. Anything modified within the last
 * `olderThanMinutes` is skipped (a run may be using it), as is every session with a live daemon.
 */

import { lstatSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

/** Directories named exactly this (the whole directory goes). */
export const CLEAN_EXACT: readonly string[] = ['bible-e2e', 'bible-ui-driver-keyword-index'];

/** Directories whose name starts with one of these. */
export const CLEAN_PREFIXES: readonly string[] = [
  'drive-popout-',
  'drive-qaitems-',
  'drive-smoke-',
  'ui-driver-repro-',
  'bible-e2e-', // search-tabs, search-host, pack, keyword-index (the deliberate real-data cache)
  'bible-ext-asar-',
  'bible-install-e2e-',
  'bible-devmode-',
  'bible-fixture-check-',
];

/** The driver's session root. Inside it only `<session>/profile-*` (and, with allSessions, stopped session dirs). */
export const SESSIONS_DIR = 'bible-ui-driver';
/** Unix sockets of driver daemons, removed only when nobody answers on them. */
const SOCKET_RE = /^bud-.+\.sock$/;

export interface CleanOptions {
  dryRun?: boolean;
  /** Also remove the stopped sessions' own dirs (transcripts, logs), not only their profiles. */
  allSessions?: boolean;
  /** Skip anything modified more recently than this. Default 60. */
  olderThanMinutes?: number;
  /** The tmp dir to clean; tests inject a sandbox. Default os.tmpdir(). */
  tmpRoot?: string;
  now?: number;
  /** Process liveness probe; tests inject one. */
  isAlive?: (pid: number) => boolean;
}

export interface CleanResult {
  removed: Array<{ path: string; bytes: number }>;
  skipped: Array<{ path: string; reason: string }>;
  totalBytes: number;
  dryRun: boolean;
}

export function parseCleanArgs(args: string[]): CleanOptions | string {
  const o: CleanOptions = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') o.dryRun = true;
    else if (a === '--all-sessions') o.allSessions = true;
    else if (a === '--older-than' || a.startsWith('--older-than=')) {
      const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : args[++i];
      const n = Number(v);
      if (v === undefined || v === '' || !Number.isFinite(n) || n < 0) return `error: --older-than needs minutes (got ${v ?? 'nothing'})`;
      o.olderThanMinutes = n;
    } else return `error: unknown option for clean: ${a}\nusage: clean [--dry-run] [--all-sessions] [--older-than MINUTES]`;
  }
  return o;
}

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Size of the tree in bytes, never following symlinks. */
function treeBytes(p: string): number {
  let st;
  try { st = lstatSync(p); } catch { return 0; }
  if (!st.isDirectory()) return st.size;
  let n = 0;
  let names: string[] = [];
  try { names = readdirSync(p); } catch { /* unreadable */ }
  for (const name of names) n += treeBytes(path.join(p, name));
  return n;
}

/** True when a daemon answers on the socket. */
function socketAlive(sock: string): Promise<boolean> {
  return new Promise((resolve) => {
    const c = net.connect(sock);
    const done = (v: boolean) => { c.destroy(); resolve(v); };
    c.setTimeout(500, () => done(true)); // slow to answer: assume it is alive
    c.once('connect', () => done(true));
    c.once('error', (e: NodeJS.ErrnoException) => done(e.code === 'EACCES' || e.code === 'EPERM'));
  });
}

function matchesName(name: string): boolean {
  return CLEAN_EXACT.includes(name) || CLEAN_PREFIXES.some((p) => name.startsWith(p));
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export async function cleanTemp(opts: CleanOptions = {}): Promise<CleanResult> {
  const realTmp = realpathSync(opts.tmpRoot ?? os.tmpdir());
  if (realTmp === path.parse(realTmp).root) throw new Error(`refusing to clean the filesystem root (${realTmp})`);
  const now = opts.now ?? Date.now();
  const minAgeMs = (opts.olderThanMinutes ?? 60) * 60_000;
  const alive = opts.isAlive ?? defaultIsAlive;
  const result: CleanResult = { removed: [], skipped: [], totalBytes: 0, dryRun: !!opts.dryRun };

  /** Directly in `parent` (a real dir), not a symlink, old enough? Returns lstat or undefined (skip recorded). */
  const eligible = (parent: string, name: string, kind: 'dir' | 'socket'): ReturnType<typeof lstatSync> | undefined => {
    const p = path.join(parent, name);
    let st;
    try { st = lstatSync(p); } catch { return undefined; }
    if (st.isSymbolicLink()) { result.skipped.push({ path: p, reason: 'symlink' }); return undefined; }
    if (kind === 'dir' ? !st.isDirectory() : !st.isSocket()) { result.skipped.push({ path: p, reason: 'not a ' + kind }); return undefined; }
    let real: string;
    try { real = realpathSync(p); } catch { return undefined; }
    if (path.dirname(real) !== parent) { result.skipped.push({ path: p, reason: 'resolves outside its parent' }); return undefined; }
    if (now - st.mtimeMs < minAgeMs) { result.skipped.push({ path: p, reason: 'modified recently' }); return undefined; }
    return st;
  };

  const remove = (p: string): void => {
    const bytes = treeBytes(p);
    if (!opts.dryRun) rmSync(p, { recursive: true, force: true });
    result.removed.push({ path: p, bytes });
    result.totalBytes += bytes;
  };

  for (const name of readdirSync(realTmp).sort()) {
    const full = path.join(realTmp, name);
    if (name === SESSIONS_DIR) {
      if (!eligibleRoot(full, realTmp)) continue;
      for (const session of readdirSync(full).sort()) {
        const dir = path.join(full, session);
        let st;
        try { st = lstatSync(dir); } catch { continue; }
        if (st.isSymbolicLink() || !st.isDirectory()) { result.skipped.push({ path: dir, reason: st.isSymbolicLink() ? 'symlink' : 'not a dir' }); continue; }
        if (livePid(dir, alive)) { result.skipped.push({ path: dir, reason: 'live session' }); continue; }
        if (opts.allSessions && now - st.mtimeMs >= minAgeMs) { remove(dir); continue; }
        for (const child of readdirSync(dir).sort()) {
          if (child.startsWith('profile-') && eligible(dir, child, 'dir')) remove(path.join(dir, child));
        }
      }
    } else if (SOCKET_RE.test(name)) {
      if (!eligible(realTmp, name, 'socket')) continue;
      if (await socketAlive(full)) { result.skipped.push({ path: full, reason: 'live daemon' }); continue; }
      remove(full);
    } else if (matchesName(name)) {
      if (eligible(realTmp, name, 'dir')) remove(full);
    }
  }
  return result;

  function eligibleRoot(p: string, parent: string): boolean {
    let st;
    try { st = lstatSync(p); } catch { return false; }
    if (st.isSymbolicLink() || !st.isDirectory()) { result.skipped.push({ path: p, reason: 'symlink or not a dir' }); return false; }
    return path.dirname(realpathSync(p)) === parent;
  }
}

/** True when `<sessionDir>/drive.pid` names a live process. */
function livePid(sessionDir: string, alive: (pid: number) => boolean): boolean {
  try {
    const pid = Number(readFileSync(path.join(sessionDir, 'drive.pid'), 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 && alive(pid);
  } catch {
    return false;
  }
}

export function formatClean(r: CleanResult): string {
  const lines = r.removed.map((x) => `${r.dryRun ? 'would remove' : 'removed'} ${x.path} (${formatBytes(x.bytes)})`);
  const live = r.skipped.filter((s) => s.reason === 'live session' || s.reason === 'live daemon').length;
  const recent = r.skipped.filter((s) => s.reason === 'modified recently').length;
  const extra = [live ? `${live} live` : '', recent ? `${recent} too recent` : ''].filter(Boolean).join(', ');
  lines.push(`${r.dryRun ? 'would remove' : 'removed'} ${r.removed.length} item(s), ${formatBytes(r.totalBytes)}${extra ? ` (skipped: ${extra})` : ''}`);
  return lines.join('\n');
}

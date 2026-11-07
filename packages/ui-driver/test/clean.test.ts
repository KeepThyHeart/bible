import { mkdirSync, mkdtempSync, existsSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLEAN_PREFIXES, cleanTemp, formatClean, parseCleanArgs } from '../src/clean.ts';

// Every test cleans a sandbox passed as tmpRoot; the real tmp dir is never touched.
let root: string;
let outside: string;
const OLD = 3 * 3600 * 1000; // 3 h ago

function age(p: string, ms = OLD): void {
  const t = new Date(Date.now() - ms);
  utimesSync(p, t, t);
}
function dir(name: string, old = true): string {
  const p = path.join(root, name);
  mkdirSync(p, { recursive: true });
  writeFileSync(path.join(p, 'f.txt'), 'x'.repeat(100));
  if (old) age(p);
  return p;
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'clean-test-root-'));
  outside = mkdtempSync(path.join(os.tmpdir(), 'clean-test-outside-'));
  writeFileSync(path.join(outside, 'keep.txt'), 'keep');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('cleanTemp', () => {
  it('removes only allow-listed entries', async () => {
    const gone = [dir('bible-devmode-abc'), dir('drive-smoke-web-1'), dir('bible-e2e'), dir('bible-e2e-search-9'), dir('bible-ui-driver-keyword-index')];
    const kept = [dir('bible-other'), dir('bible-devmode'), dir('my-bible-e2e-x'), dir('unrelated')];
    const r = await cleanTemp({ tmpRoot: root });
    expect(r.removed.map((x) => path.basename(x.path)).sort()).toEqual(gone.map((g) => path.basename(g)).sort());
    for (const g of gone) expect(existsSync(g)).toBe(false);
    for (const k of kept) expect(existsSync(k)).toBe(true);
    expect(r.totalBytes).toBeGreaterThanOrEqual(500);
  });

  it('never follows a symlink named like an allowed dir', async () => {
    symlinkSync(outside, path.join(root, 'bible-e2e-link'));
    const r = await cleanTemp({ tmpRoot: root, olderThanMinutes: 0 });
    expect(r.removed).toEqual([]);
    expect(r.skipped).toContainEqual({ path: path.join(root, 'bible-e2e-link'), reason: 'symlink' });
    expect(existsSync(path.join(outside, 'keep.txt'))).toBe(true);
  });

  it('does not follow a symlink inside a removed dir', async () => {
    const d = dir('bible-e2e-x');
    symlinkSync(outside, path.join(d, 'link'));
    age(d);
    await cleanTemp({ tmpRoot: root });
    expect(existsSync(d)).toBe(false);
    expect(existsSync(path.join(outside, 'keep.txt'))).toBe(true);
  });

  it('--dry-run reports and removes nothing', async () => {
    const d = dir('bible-devmode-1');
    const r = await cleanTemp({ tmpRoot: root, dryRun: true });
    expect(r.removed).toHaveLength(1);
    expect(existsSync(d)).toBe(true);
    expect(formatClean(r)).toMatch(/^would remove .*bible-devmode-1 \(\d+ B\)\nwould remove 1 item/);
  });

  it('skips entries newer than --older-than', async () => {
    const fresh = dir('bible-devmode-new', false);
    const old = dir('bible-devmode-old');
    const r = await cleanTemp({ tmpRoot: root, olderThanMinutes: 60 });
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(old)).toBe(false);
    expect(r.skipped).toContainEqual({ path: fresh, reason: 'modified recently' });
    await cleanTemp({ tmpRoot: root, olderThanMinutes: 0 });
    expect(existsSync(fresh)).toBe(false);
  });

  it('driver sessions: removes profiles of stopped sessions, skips live ones, keeps session dirs by default', async () => {
    const stopped = path.join(root, 'bible-ui-driver', 'stopped');
    const live = path.join(root, 'bible-ui-driver', 'live');
    for (const s of [stopped, live]) {
      mkdirSync(path.join(s, 'profile-1'), { recursive: true });
      writeFileSync(path.join(s, 'transcript.jsonl'), '{}');
      age(path.join(s, 'profile-1'));
      age(s);
    }
    writeFileSync(path.join(live, 'drive.pid'), '4242');
    writeFileSync(path.join(stopped, 'drive.pid'), '4343');
    age(live);
    age(stopped);
    const isAlive = (pid: number) => pid === 4242;
    const r = await cleanTemp({ tmpRoot: root, isAlive });
    expect(existsSync(path.join(stopped, 'profile-1'))).toBe(false);
    expect(existsSync(path.join(stopped, 'transcript.jsonl'))).toBe(true);
    expect(existsSync(path.join(live, 'profile-1'))).toBe(true);
    expect(r.skipped).toContainEqual({ path: live, reason: 'live session' });

    age(stopped);
    await cleanTemp({ tmpRoot: root, isAlive, allSessions: true });
    expect(existsSync(stopped)).toBe(false);
    expect(existsSync(live)).toBe(true);
  });

  it('removes a stale bud socket but not one with a live daemon', async () => {
    const liveSock = path.join(root, 'bud-live.sock');
    const staleSock = path.join(root, 'bud-stale.sock');
    const server = net.createServer();
    await new Promise<void>((r) => server.listen(liveSock, r));
    // A daemon that was SIGKILLed leaves its socket file behind with nobody listening.
    const child = spawn(process.execPath, ['-e', `require('net').createServer().listen(${JSON.stringify(staleSock)},()=>console.log('up'))`], { stdio: ['ignore', 'pipe', 'ignore'] });
    await new Promise<void>((r) => child.stdout.once('data', () => r()));
    child.kill('SIGKILL');
    await new Promise<void>((r) => child.once('exit', () => r()));
    expect(existsSync(staleSock)).toBe(true);
    age(liveSock);
    age(staleSock);
    const r = await cleanTemp({ tmpRoot: root });
    expect(existsSync(liveSock)).toBe(true);
    expect(existsSync(staleSock)).toBe(false);
    expect(r.skipped).toContainEqual({ path: liveSock, reason: 'live daemon' });
    await new Promise<void>((res) => server.close(() => res()));
  });

  it('refuses the filesystem root', async () => {
    await expect(cleanTemp({ tmpRoot: '/' })).rejects.toThrow(/root/);
  });

  it('allow-list holds no bare or broad prefix', () => {
    for (const p of CLEAN_PREFIXES) expect(p.length).toBeGreaterThanOrEqual(10);
  });
});

describe('parseCleanArgs', () => {
  it('parses flags', () => {
    expect(parseCleanArgs(['--dry-run', '--all-sessions', '--older-than=5'])).toEqual({ dryRun: true, allSessions: true, olderThanMinutes: 5 });
    expect(parseCleanArgs(['--older-than', '0'])).toEqual({ olderThanMinutes: 0 });
  });
  it('rejects bad input', () => {
    expect(parseCleanArgs(['--older-than', 'x'])).toMatch(/^error/);
    expect(parseCleanArgs(['--wat'])).toMatch(/unknown option/);
  });
});

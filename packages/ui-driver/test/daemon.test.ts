import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HELP } from '../src/commands.ts';
import { runDaemon, runStdio } from '../src/daemon.ts';
import { encode, socketPath } from '../src/protocol.ts';
import type { Command, Executor, Reply } from '../src/types.ts';

class Fake implements Executor {
  log: string[] = [];
  shutdowns = 0;
  slowMs = 0;
  async exec(cmd: Command): Promise<Reply> {
    this.log.push('start:' + cmd.name);
    if (cmd.name === 'snapshot') await new Promise((r) => setTimeout(r, this.slowMs));
    if (cmd.name === 'diff') throw new Error('boom\nsecond line');
    this.log.push('end:' + cmd.name);
    return { ok: true, text: 'did ' + cmd.name };
  }
  async shutdown(): Promise<void> {
    this.shutdowns++;
  }
}

function send(dir: string, argv: string[]): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const c = net.connect(socketPath(dir));
    let buf = '';
    c.on('data', (d) => (buf += d));
    c.on('end', () => resolve(JSON.parse(buf)));
    c.on('error', reject);
    c.write(encode({ argv }));
  });
}

let dir: string;
let fake: Fake;
let done: Promise<void>;

async function waitSocket(): Promise<void> {
  for (let i = 0; i < 100 && !existsSync(socketPath(dir)); i++) await new Promise((r) => setTimeout(r, 20));
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'drv-'));
  fake = new Fake();
  done = runDaemon({ dir, executor: fake });
  await waitSocket();
});
afterEach(async () => {
  await send(dir, ['stop']).catch(() => {});
  await done;
  rmSync(dir, { recursive: true, force: true });
});

describe('daemon', () => {
  it('round-trips a command', async () => {
    expect(await send(dir, ['status'])).toEqual({ ok: true, text: 'did status' });
    expect(existsSync(join(dir, 'drive.pid'))).toBe(true);
  });
  it('replies to parse errors without calling the executor', async () => {
    const r = await send(dir, ['click']);
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/^usage: click/);
    expect(fake.log).toEqual([]);
  });
  it('turns executor exceptions into one-line errors', async () => {
    expect(await send(dir, ['diff'])).toEqual({ ok: false, text: 'error: boom' });
  });
  it('answers help itself', async () => {
    expect(await send(dir, ['help'])).toEqual({ ok: true, text: HELP });
    expect((await send(dir, ['help', 'click'])).text).toMatch(/^click rN/);
    expect(fake.log).toEqual([]);
  });
  it('runs commands strictly one at a time', async () => {
    fake.slowMs = 150;
    const a = send(dir, ['snapshot']);
    await new Promise((r) => setTimeout(r, 30));
    const b = send(dir, ['status']);
    await Promise.all([a, b]);
    expect(fake.log).toEqual(['start:snapshot', 'end:snapshot', 'start:status', 'end:status']);
  });
  it('stop shuts down, removes the socket and resolves', async () => {
    const r = await send(dir, ['stop']);
    expect(r.ok).toBe(true);
    await done;
    expect(fake.shutdowns).toBe(1);
    expect(existsSync(socketPath(dir))).toBe(false);
    expect(existsSync(join(dir, 'drive.pid'))).toBe(false);
  });
});

describe('idle timeout', () => {
  it('shuts down after idleMs', async () => {
    const d = mkdtempSync(join(tmpdir(), 'drv-'));
    const f = new Fake();
    const p = runDaemon({ dir: d, executor: f, idleMs: 100 });
    await p;
    expect(f.shutdowns).toBe(1);
    rmSync(d, { recursive: true, force: true });
  });
});

describe('runStdio', () => {
  it('handles lines serially, skips blanks, stops on stop', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const f = new Fake();
    const p = runStdio(f, input, output);
    input.write('status\n\n["nope"]\nstop\n');
    await p;
    output.end();
    const lines = (await new Promise<string>((r) => {
      let s = '';
      output.on('data', (d) => (s += d));
      output.on('end', () => r(s));
    }))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Reply);
    expect(lines.map((l) => l.ok)).toEqual([true, false, true]);
    expect(lines[1].text).toMatch(/unknown command/);
    expect(f.shutdowns).toBe(1);
  });
  it('shuts down on EOF', async () => {
    const input = new PassThrough();
    const f = new Fake();
    const p = runStdio(f, input, new PassThrough());
    input.end('status\n');
    await p;
    expect(f.shutdowns).toBe(1);
  });
});

describe('bin/drive.ts', () => {
  const bin = join(import.meta.dirname, '..', 'bin', 'drive.ts');
  it('prints HELP locally for help', () => {
    const r = spawnSync(process.execPath, [bin, 'help'], { encoding: 'utf8', env: { ...process.env, DRIVE_DIR: join(tmpdir(), 'drv-none-' + process.pid) } });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(HELP + '\n');
  });
  it('reports not running', () => {
    const env = { ...process.env, DRIVE_DIR: join(tmpdir(), 'drv-none-' + process.pid) };
    const st = spawnSync(process.execPath, [bin, 'status'], { encoding: 'utf8', env });
    expect([st.status, st.stdout]).toEqual([0, 'not running\n']);
    const sn = spawnSync(process.execPath, [bin, 'snapshot'], { encoding: 'utf8', env });
    expect([sn.status, sn.stdout]).toEqual([2, 'not running: drive start <app> first\n']);
  });
  it('talks to a daemon', async () => {
    const out = await new Promise<{ code: number | null; stdout: string }>((resolve) => {
      const p = spawn(process.execPath, [bin, 'status'], { env: { ...process.env, DRIVE_DIR: dir } });
      let stdout = '';
      p.stdout.on('data', (d) => (stdout += d));
      p.on('close', (code) => resolve({ code, stdout }));
    });
    expect(out).toEqual({ code: 0, stdout: 'did status\n' });
  });
});

#!/usr/bin/env node
/**
 * Thin client: forwards argv to the session daemon over a unix socket and prints
 * the reply. Imports only node built-ins and protocol.ts so it starts fast.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { encode, lineReader, sessionDir, socketPath } from '../src/protocol.ts';

const daemonMain = join(import.meta.dirname, '..', 'src', 'daemon-main.ts');

// `drive snapshot | head`: the reader went away; exit quietly instead of an EPIPE stack trace.
process.stdout.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EPIPE') process.exit(0);
  throw e;
});

/** Resolves a connected socket, or the error code (ENOENT, ECONNREFUSED...) when it cannot connect. */
function connect(sock: string): Promise<net.Socket | string> {
  return new Promise((resolve) => {
    const c = net.connect(sock);
    c.once('connect', () => resolve(c));
    c.once('error', (e: NodeJS.ErrnoException) => resolve(e.code ?? 'ERR'));
  });
}

function print(text: string): void {
  process.stdout.write(text.replace(/\n+$/, '') + '\n');
}

function request(c: net.Socket, argv: string[]): Promise<{ ok: boolean; text: string }> {
  return new Promise((resolve) => {
    let got = false;
    c.on(
      'data',
      lineReader((line) => {
        got = true;
        resolve(JSON.parse(line));
      }),
    );
    c.on('close', () => {
      if (!got) resolve({ ok: false, text: 'error: daemon closed the connection without a reply' });
    });
    c.write(encode({ argv }));
  });
}

async function startDaemon(dir: string, sock: string, session: string | undefined): Promise<net.Socket | undefined> {
  mkdirSync(dir, { recursive: true });
  const logPath = join(dir, 'daemon.log');
  const log = openSync(logPath, 'a');
  const child = spawn(process.execPath, [daemonMain, '--dir', dir], {
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, DRIVE_DIR: dir, ...(session ? { DRIVE_SESSION: session } : {}) },
  });
  child.unref();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    const c = await connect(sock);
    if (typeof c !== 'string') return c;
  }
  const lines = existsSync(logPath) ? readFileSync(logPath, 'utf8').trimEnd().split('\n').slice(-10) : [];
  print(`daemon did not start within 10s\n${lines.join('\n')}`);
  return undefined;
}

async function main(): Promise<number> {
  let argv = process.argv.slice(2);
  let session: string | undefined;
  if (argv[0] === '--session' && argv[1]) {
    session = argv[1];
    argv = argv.slice(2);
  }
  const dir = sessionDir(session);
  const sock = socketPath(dir);

  if (argv[0] === 'serve' && argv.includes('--stdio')) {
    const { runStdio } = await import('../src/daemon.ts');
    const { Session } = await import('../src/session.ts');
    const { resolve } = await import('node:path');
    await runStdio(new Session({ sessionDir: dir, repoRoot: resolve(import.meta.dirname, '..', '..', '..'), name: session ?? process.env.DRIVE_SESSION }));
    return 0;
  }

  const localHelp = async (): Promise<number> => {
    const { HELP, helpFor } = await import('../src/commands.ts');
    print(argv[0] === 'help' && argv[1] ? helpFor(argv[1]) : HELP);
    return 0;
  };
  if (argv.length === 0) return localHelp();

  if (argv[0] === 'clean') {
    // Local: removes leaked temp dirs; needs no daemon.
    const { cleanTemp, formatClean, parseCleanArgs } = await import('../src/clean.ts');
    const opts = parseCleanArgs(argv.slice(1));
    if (typeof opts === 'string') {
      print(opts);
      return 2;
    }
    print(formatClean(await cleanTemp(opts)));
    return 0;
  }

  let c = await connect(sock);
  if (typeof c === 'string') {
    if (c !== 'ENOENT' && c !== 'ECONNREFUSED') {
      print(`error: cannot connect to ${sock}: ${c}`);
      return 2;
    }
    rmSync(sock, { force: true });
    const cmd = argv[0];
    if (cmd === 'start') {
      const started = await startDaemon(dir, sock, session ?? process.env.DRIVE_SESSION);
      if (!started) return 2;
      c = started;
    } else if (cmd === 'stop' || cmd === 'status') {
      print('not running');
      return 0;
    } else if (cmd === 'help') {
      return localHelp();
    } else {
      print('not running: drive start <app> first');
      return 2;
    }
  }
  const reply = await request(c, argv);
  print(reply.text);
  return reply.ok ? 0 : 1;
}

process.exitCode = await main();

/**
 * The daemon: one unix-socket server that runs commands strictly one at a time
 * against an Executor, so a browser session survives across agent turns. Also the
 * stdio variant (same loop over stdin/stdout) for tools that keep one process.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { HELP, helpFor, parseArgv } from './commands.ts';
import { encode, lineReader, parseLine, socketPath } from './protocol.ts';
import type { Executor, Reply } from './types.ts';

const DEFAULT_IDLE_MS = 30 * 60 * 1000;

/** Parses and runs one argv; never throws. `stop` is flagged so callers can shut down after replying. */
async function handle(argv: string[], executor: Executor): Promise<{ reply: Reply; stop: boolean }> {
  const parsed = parseArgv(argv);
  if (!parsed.ok) return { reply: { ok: false, text: parsed.error }, stop: false };
  const cmd = parsed.cmd;
  if (cmd.name === 'help') return { reply: { ok: true, text: cmd.topic ? helpFor(cmd.topic) : HELP }, stop: false };
  try {
    return { reply: await executor.exec(cmd), stop: cmd.name === 'stop' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { reply: { ok: false, text: 'error: ' + msg.split('\n')[0] }, stop: cmd.name === 'stop' };
  }
}

export async function runDaemon(opts: { dir: string; executor: Executor; idleMs?: number }): Promise<void> {
  const { dir, executor } = opts;
  const idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
  mkdirSync(dir, { recursive: true });
  const sock = socketPath(dir);
  const pidFile = join(dir, 'drive.pid');
  rmSync(sock, { force: true });

  let queue: Promise<unknown> = Promise.resolve();
  let idleTimer: NodeJS.Timeout | undefined;
  let finish!: () => void;
  const done = new Promise<void>((r) => (finish = r));
  let closing = false;

  const server = net.createServer();

  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    clearTimeout(idleTimer);
    process.off('SIGTERM', shutdown);
    process.off('SIGINT', shutdown);
    try {
      await executor.shutdown();
    } catch {
      // shutting down anyway
    }
    server.close();
    rmSync(sock, { force: true });
    rmSync(pidFile, { force: true });
    finish();
  };

  const resetIdle = (): void => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => void shutdown(), idleMs);
    idleTimer.unref();
  };

  server.on('connection', (conn) => {
    conn.on('error', () => {});
    conn.on(
      'data',
      lineReader((line) => {
        // Serialise: each request waits for every earlier one, across connections.
        queue = queue.then(async () => {
          if (closing) return void conn.destroy();
          resetIdle();
          let out: { reply: Reply; stop: boolean };
          try {
            out = await handle(parseLine(line), executor);
          } catch (e) {
            out = { reply: { ok: false, text: 'error: ' + (e instanceof Error ? e.message : String(e)) }, stop: false };
          }
          await new Promise<void>((r) => conn.end(encode(out.reply), () => r()));
          if (out.stop) await shutdown();
          resetIdle();
        });
      }),
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(sock, () => resolve());
  });
  writeFileSync(pidFile, String(process.pid));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  resetIdle();
  await done;
}

export async function runStdio(
  executor: Executor,
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<void> {
  let queue: Promise<unknown> = Promise.resolve();
  let stopped = false;
  await new Promise<void>((resolve) => {
    const onLine = (line: string): void => {
      if (!line.trim()) return;
      queue = queue.then(async () => {
        if (stopped) return;
        let out: { reply: Reply; stop: boolean };
        try {
          out = await handle(parseLine(line), executor);
        } catch (e) {
          out = { reply: { ok: false, text: 'error: ' + (e instanceof Error ? e.message : String(e)) }, stop: false };
        }
        output.write(encode(out.reply));
        if (out.stop) {
          stopped = true;
          resolve();
        }
      });
    };
    input.on('data', lineReader(onLine));
    input.on('end', () => {
      void queue.then(() => resolve());
    });
  });
  await executor.shutdown();
}

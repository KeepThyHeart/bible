// Runs the web server and tees its stdout/stderr into a file, so a spec can read what the console mailer
// printed (verification links). Usage: node e2e/serverWithLog.mjs <logfile>   (cwd = apps/web, env as for the server)
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const logFile = process.argv[2];
mkdirSync(dirname(logFile), { recursive: true });
writeFileSync(logFile, '');
const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], { stdio: ['ignore', 'pipe', 'pipe'] });
for (const [stream, out] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
  stream.on('data', (chunk) => {
    try { appendFileSync(logFile, chunk); } catch { /* log dir removed under a reused server: keep serving */ }
    out.write(chunk);
  });
}
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
// Playwright may signal the whole group: forward once only, so the server's graceful close is not cut short (R3 L-8).
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { if (!child.killed) child.kill(sig); });

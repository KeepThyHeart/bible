/**
 * Entry the client spawns: `node src/daemon-main.ts --dir DIR` (daemon) or
 * `--stdio` (one command per stdin line). Stderr goes to DIR/daemon.log.
 */

import { resolve } from 'node:path';
import { runDaemon, runStdio } from './daemon.ts';
import { sessionDir } from './protocol.ts';
import { Session } from './session.ts';

// Log and keep serving: one stray Playwright event error must not kill the session.
process.on('uncaughtException', (e) => console.error('uncaught:', e));
process.on('unhandledRejection', (e) => console.error('unhandled rejection:', e));

const args = process.argv.slice(2);
const i = args.indexOf('--dir');
const dir = i >= 0 && args[i + 1] ? args[i + 1] : sessionDir();
// packages/ui-driver/src -> repo root
const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
const session = new Session({ sessionDir: dir, repoRoot });

if (args.includes('--stdio')) await runStdio(session);
else await runDaemon({ dir, executor: session });
process.exit(0);

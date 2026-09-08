/**
 * Extension worker entry point - realm supervisor.
 *
 * This is the script Electron's `utilityProcess.fork()` boots inside each
 * extension worker. It deliberately runs no extension code at all: importing
 * `manifest.main` straight into this Node process would put `require('fs')`,
 * `process.env` and the network one call away from an extension. Instead it:
 *
 *   1. creates a QuickJS realm (`host/QuickJSRealm.ts`) and loads the bundled
 *      guest runtime into it;
 *   2. resolves and reads `manifest.main` - the one privileged operation it
 *      performs, and the reason `resolveEntry.ts`'s containment check matters;
 *   3. shuttles RPC envelopes between `parentPort` and the realm.
 *
 * Nothing on the host side of `parentPort` - `ExtensionWorkerProcess`, the
 * heartbeat, `ExtensionRpcRouter`, every `api-impl` - needs to know the realm
 * exists, because the protocol on the wire is the same either way. That is the
 * whole design: the sandbox is an inner ring, not a separate architecture.
 *
 * The process itself is the outer ring. It is forked per extension,
 * hard-killable, and the thing that contains a hypothetical bug in QuickJS or
 * in WASM itself. What the realm adds is containment of extension code that is
 * working exactly as written.
 */

import { readFileSync } from 'fs';
import { basename, join } from 'path';

import type { Extensions } from '@bible/core';

type RpcEnvelope = Extensions.RpcEnvelope;
type ExtensionInitPayload = Extensions.ExtensionInitPayload;

import { QuickJSRealm, type EntryBundle } from './host/QuickJSRealm';
import { resolveExtensionEntryTarget } from './resolveEntry';

interface ParentPortLike {
  postMessage(msg: unknown): void;
  on(event: 'message', handler: (msg: { data?: unknown } | unknown) => void): void;
}

/**
 * The guest runtime bundle, emitted next to this script by the esbuild step in
 * `electron.vite.config.ts`. It is a separate artifact rather than an inlined
 * string because it must be built for a *different target* than everything
 * else here - no Node, no CommonJS, ES2020 - and because keeping it a real
 * file makes what actually runs inside the realm inspectable.
 */
const GUEST_BUNDLE_FILENAME = 'guest.js';

/** Cap on one forwarded `console.*` line. See `onLog`. */
const MAX_LOG_LINE_CHARS = 4_000;

export interface SupervisorOpts {
  /** Overrides the on-disk guest bundle. Tests pass source directly. */
  guestBundleSource?: string;
  /** Overrides realm construction. Tests inject a pre-built WASM module. */
  realmFactory?: typeof QuickJSRealm.create;
  /** Called instead of `process.exit` when activation fails unrecoverably. */
  onFatal?: (message: string) => void;
}

/**
 * Decode a `data:` entry URL into source. Supported because it is the only
 * `manifest.main` form that needs no filesystem, which makes it the natural
 * fixture format for packaged-build tests.
 */
function decodeDataUrl(url: string): string {
  const comma = url.indexOf(',');
  if (comma < 0) throw new Error('malformed data: URL in manifest.main');
  const meta = url.slice(0, comma);
  const body = url.slice(comma + 1);
  return /;base64$/i.test(meta)
    ? Buffer.from(body, 'base64').toString('utf8')
    : decodeURIComponent(body);
}

/**
 * Resolve and read the extension's entry bundle.
 *
 * `resolveExtensionEntryTarget` is what stops a `manifest.main` of
 * `../../../../evil.js` from being read: the containment check runs on the
 * *resolved* path, here, at the point of use. It matters even though the
 * result is only handed to `readFileSync` - this process has a filesystem even
 * though the realm does not.
 */
export function readEntryBundle(payload: ExtensionInitPayload): EntryBundle {
  const main = payload.manifest.main;
  if (!main) {
    throw new Error(`Extension ${payload.manifest.id} has no manifest.main entry point`);
  }
  const target = resolveExtensionEntryTarget(payload.installPath, main);
  if (target.kind === 'data') {
    return { source: decodeDataUrl(target.url), filename: `${payload.manifest.id}/inline.js` };
  }
  return {
    source: readFileSync(target.path, 'utf8'),
    filename: `${payload.manifest.id}/${basename(target.path)}`,
  };
}

/**
 * Start the supervisor against a parent port. Exported so tests can drive it
 * with an in-memory port instead of forking a real utilityProcess.
 */
export function startSupervisor(
  parentPort: ParentPortLike,
  opts: SupervisorOpts = {},
): { ready: Promise<QuickJSRealm>; dispose: () => void } {
  // Envelopes that arrive before the realm finishes loading. The WASM module
  // takes ~13 ms on the first extension in a process and nothing after that,
  // but the host may well have posted `runtime.init` already.
  const pending: RpcEnvelope[] = [];
  let realm: QuickJSRealm | undefined;
  let initPayload: ExtensionInitPayload | undefined;
  let disposed = false;

  const post = (msg: unknown): void => {
    try {
      parentPort.postMessage(msg);
    } catch {
      /* host transport gone; the process is on its way out */
    }
  };

  const reportRuntimeError = (source: string, message: string): void => {
    post({ kind: 'event', channel: '__runtime.error', payload: { source, message } });
  };

  const guestBundleSource =
    opts.guestBundleSource ?? readFileSync(join(__dirname, GUEST_BUNDLE_FILENAME), 'utf8');

  const create = opts.realmFactory ?? QuickJSRealm.create;

  const ready = create({
    extensionId: process.argv[2] ?? 'unknown',
    guestBundleSource,
    loadEntryBundle: () => {
      if (!initPayload) {
        throw new Error('extension requested its entry bundle before runtime.init');
      }
      return readEntryBundle(initPayload);
    },
    onSend: (envelope) => post(envelope),
    onLog: (level, args) => {
      const line = args.map((a) => (typeof a === 'string' ? a : safeStringify(a))).join(' ');
      // Extension `console.*` goes to the host as a reserved runtime event so it
      // lands in that extension's own `extension.log` and is readable through
      // `extensions:getLog`. Only stderr is captured from the worker's stdio,
      // and only on crash, so writing to stdout alone meant extension authors
      // had no working `console.log` at all.
      //
      // Truncated because the payload is attacker-controlled: an extension that
      // logs megabytes per call should cost itself its message, not the host's
      // disk.
      post({
        kind: 'event',
        channel: '__runtime.log',
        payload: { level, message: line.slice(0, MAX_LOG_LINE_CHARS) },
      });
      // Still echoed to stdout, which is where it shows up under `npm run dev`.
      process.stdout.write(`[${level}] ${line}\n`);
    },
    onFatal: (message) => {
      if (opts.onFatal) {
        opts.onFatal(message);
        return;
      }
      // `bootstrap` has already posted the structured failure response; give
      // the host a tick to receive it before the process goes away.
      setTimeout(() => process.exit(1), 50);
    },
    onResourceViolation: (kind, detail) => {
      reportRuntimeError(`resource:${kind}`, detail);
    },
  })
    .then((created) => {
      realm = created;
      if (disposed) {
        created.dispose();
        return created;
      }
      while (pending.length) created.deliver(pending.shift()!);
      return created;
    })
    .catch((err: unknown) => {
      reportRuntimeError('realm-init', err instanceof Error ? err.message : String(err));
      throw err;
    });

  parentPort.on('message', (raw) => {
    const env = unwrap(raw) as RpcEnvelope;
    if (!env || typeof env !== 'object') return;

    // Capture the init payload before forwarding: the guest will call back
    // into `loadEntryBundle` while handling this very envelope.
    if (env.kind === 'request' && env.method === 'runtime.init') {
      initPayload = env.args[0] as ExtensionInitPayload;
    }

    if (!realm) {
      pending.push(env);
      return;
    }
    realm.deliver(env);
  });

  return {
    ready,
    dispose: () => {
      disposed = true;
      if (realm) {
        realm.requestGuestDispose();
        realm.dispose();
        realm = undefined;
      }
    },
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function unwrap(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && 'data' in (raw as Record<string, unknown>)) {
    return (raw as { data: unknown }).data;
  }
  return raw;
}

// In production the entry self-starts against `process.parentPort`. Vitest
// imports this file but has no parentPort, so we guard.
const maybeParent = (process as unknown as { parentPort?: ParentPortLike }).parentPort;
if (maybeParent) {
  const supervisor = startSupervisor(maybeParent);
  supervisor.ready.catch(() => {
    // The realm could not be built at all - there is no sandbox, so there is
    // no safe way to run this extension. Exit and let the host report it.
    setTimeout(() => process.exit(1), 50);
  });
  process.on('exit', () => supervisor.dispose());
}

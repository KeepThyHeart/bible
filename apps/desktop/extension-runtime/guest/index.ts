/**
 * Guest realm entry point.
 *
 * This file is bundled by esbuild into one self-contained IIFE and evaluated
 * inside a fresh QuickJS realm - see `host/QuickJSRealm.ts`. It is the *only*
 * code that runs in the realm besides the extension's own bundle.
 *
 * It is deliberately thin. The protocol logic (`bootstrap.ts`), the API proxy
 * (`apiProxy.ts`), the event emitter and the runtime are all reused verbatim
 * from the Node worker they were written for; nothing about the RPC contract
 * changed when the execution environment did, which is the property that lets
 * an extension written before the engine swap keep working after it. All this
 * file does is supply the three things the realm cannot provide for itself:
 *
 *   1. the globals QuickJS omits (`console`, timers) - `guestGlobals.ts`;
 *   2. a `PortLike` whose `postMessage` is a host function call rather than
 *      an Electron `parentPort` write;
 *   3. a module loader that returns source the *host* read and evaluated,
 *      because the guest has no filesystem to read it from.
 *
 * The globals it exposes back to the host (`__guest_*`) are the realm's entire
 * inbound surface. The host calls them; nothing else can.
 */

import type { Extensions } from '@bible/core';

type RpcEnvelope = Extensions.RpcEnvelope;
type ExtensionEntryPointModule = Extensions.ExtensionEntryPointModule;

import { bootstrap, type PortLike } from '../bootstrap';
import { decodeEnvelope, encodeEnvelope } from '../binaryCodec';
import { installGuestGlobals } from './guestGlobals';

/** Host functions this entry uses beyond the ones `guestGlobals` needs. */
interface EntryHostBridge {
  __host_send(json: string): void;
  /**
   * Read, wrap and evaluate the extension's entry bundle, returning its
   * `module.exports`. Throws inside the realm if `manifest.main` escapes the
   * install directory, the file is missing, or the bundle does not parse.
   */
  __host_loadEntryModule(): unknown;
  /** Report an unrecoverable activation failure. */
  __host_fatal(json: string): void;
}

function bridge(): EntryHostBridge {
  return globalThis as unknown as EntryHostBridge;
}

// --- Inbound surface --------------------------------------------------------

const listeners: ((msg: unknown) => void)[] = [];

const port: PortLike = {
  postMessage(msg: unknown): void {
    // A string is the whole transport - `__host_send` takes nothing else. The
    // codec is what keeps that from being lossy: `ArrayBuffer`/`Uint8Array`
    // arguments (`storage.writeFile`, `ui.saveFile`, `network.fetch` bodies)
    // would otherwise reach the host as `{"0":72,"1":73,...}`. A throw here is
    // caught by `apiProxy.makeRequest` and rejects the extension's promise.
    bridge().__host_send(encodeEnvelope(msg));
  },
  on(_event: 'message', handler: (msg: unknown) => void): void {
    listeners.push(handler);
  },
};

/**
 * A throw here would propagate into the host's `deliver()` call and look like
 * a realm fault. Envelope handling failures are the extension's problem, not
 * the transport's, so they are reported and swallowed.
 */
function deliverToListeners(env: RpcEnvelope): void {
  for (const listener of listeners) {
    try {
      listener(env);
    } catch (err) {
      reportRuntimeError('dispatch', err);
    }
  }
}

function reportRuntimeError(source: string, err: unknown): void {
  const payload = {
    source,
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  };
  try {
    bridge().__host_send(
      JSON.stringify({ kind: 'event', channel: '__runtime.error', payload }),
    );
  } catch {
    /* transport gone */
  }
}

const globals = installGuestGlobals((err) => reportRuntimeError('timer', err));

const runtime = bootstrap(port, {
  // The host has already resolved `manifest.main` against `installPath` and
  // evaluated the bundle in this realm; all that is left is to hand back the
  // exports. The payload is unused precisely *because* resolution happened
  // host-side, where the filesystem and the containment check live.
  moduleLoader: (): Promise<ExtensionEntryPointModule> => {
    const exports = bridge().__host_loadEntryModule();
    if (!exports || typeof exports !== 'object') {
      throw new Error('Extension entry bundle did not export an object');
    }
    return Promise.resolve(exports as ExtensionEntryPointModule);
  },
  // No `process` in the realm - see `errorBoundary.ts`.
  boundaryProcess: null,
  onFatal: (err) => {
    try {
      bridge().__host_fatal(
        JSON.stringify({ message: err instanceof Error ? err.message : String(err) }),
      );
    } catch {
      /* nothing further we can do from in here */
    }
  },
});

// --- Globals the host calls into --------------------------------------------

const guestApi = {
  /** Deliver one encoded envelope from the host. */
  __guest_receive(json: string): void {
    let env: RpcEnvelope;
    try {
      env = decodeEnvelope(json) as RpcEnvelope;
    } catch (err) {
      reportRuntimeError('envelope-parse', err);
      return;
    }
    deliverToListeners(env);
  },
  /** A timer the host was holding has come due. */
  __guest_fireTimer(id: number): void {
    globals.fireTimer(id);
  },
  /** Live timer count, so the host can enforce its cap. */
  __guest_pendingTimers(): number {
    return globals.pendingTimerCount();
  },
  /**
   * Run the extension's `deactivate()` and drop every subscription and timer.
   * The host still disposes the whole realm afterwards; this exists so a
   * well-behaved extension gets its documented teardown callback first.
   */
  __guest_dispose(): void {
    globals.clearAllTimers();
    void runtime.dispose().catch((err: unknown) => reportRuntimeError('dispose', err));
  },
};

Object.assign(globalThis, guestApi);

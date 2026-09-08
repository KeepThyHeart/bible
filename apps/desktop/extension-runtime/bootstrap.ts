/**
 * Protocol bootstrap.
 *
 * This is the piece that speaks the host protocol on the extension's side of
 * the wire. Because the extension's code runs inside a QuickJS realm, this
 * file is bundled as *guest* code and talks to whatever `PortLike` it is
 * handed - `parentPort` for the plain Node path, a host-function bridge for
 * the realm - rather than reaching for Electron's `parentPort` directly.
 *
 *   1. Wait for the host's `init` envelope. The init payload is a single
 *      `RpcRequest` with method `runtime.init`.
 *
 *      Traffic that arrives before init RESOLVES is split two ways, because
 *      `activate()` runs *during* init and an extension calling a host API
 *      from `activate()` is the normal case, not an edge case:
 *
 *        - `response` and `heartbeat` envelopes dispatch IMMEDIATELY. A
 *          response is the reply to a request the extension itself just
 *          issued; buffering it strands the promise the extension is awaiting
 *          and `activate()` deadlocks until the 5 s timeout kills it. A
 *          heartbeat must be echoed promptly or the host's worker wrapper
 *          declares the worker hung mid-activation.
 *        - `event` and `request` envelopes are QUEUED and replayed once init
 *          resolves. Both target things the extension registers *inside*
 *          `activate()` - event handlers and reverse-RPC handlers - so
 *          delivering them early would drop them (no subscriber yet) or
 *          answer them with `Unknown reverse RPC method`.
 *
 *      The split trades strict FIFO ordering between the two groups for
 *      liveness: a response issued after a queued event is delivered before
 *      it. That is safe - responses are point-to-point correlated by id and
 *      carry no ordering relationship to broadcast events - and the strict
 *      alternative is precisely the deadlock described above.
 *   2. Construct an `ExtensionRuntime` over a tiny channel adapter and call
 *      `runtime.init(payload)`. If activate() throws or times out, reply with
 *      a structured error response and signal the fatal via `onFatal`.
 *   3. Otherwise reply with a success response, then forward every subsequent
 *      envelope to `runtime.dispatch`.
 *
 * Stays small on purpose - every byte counts against the 50 KB gzipped
 * runtime budget, and in the realm it is also parse cost on every activation.
 */

import type { Extensions } from '@bible/core';

type RpcEnvelope = Extensions.RpcEnvelope;
type RpcResponse = Extensions.RpcResponse;
type ExtensionInitPayload = Extensions.ExtensionInitPayload;

import { ExtensionRuntime, type ExtensionModuleLoader } from './runtime';
import type { ErrorBoundaryProcessLike } from './errorBoundary';
import type { IRpcChannel } from './apiProxy';

/**
 * The transport bootstrap needs. Electron's `parentPort` satisfies it
 * directly; the guest realm supplies an adapter over its host bridge.
 */
export interface PortLike {
  postMessage(msg: unknown): void;
  on(event: 'message', handler: (msg: { data?: unknown } | unknown) => void): void;
}

export interface BootstrapOpts {
  /**
   * Loads the extension's entry module. Required - see the note on
   * `ExtensionRuntimeOpts.moduleLoader` for why there is no default.
   */
  moduleLoader: ExtensionModuleLoader;
  /** Override the activate() timeout. */
  activateTimeoutMs?: number;
  /**
   * Called after the failure response has been posted when init fails
   * unrecoverably. The Node worker exits non-zero; the realm supervisor tears
   * the realm down. Bootstrap itself does no process control - it cannot,
   * inside the realm.
   */
  onFatal?: (err: unknown) => void;
  /** Passed through to the error boundary; `null` in the guest realm. */
  boundaryProcess?: ErrorBoundaryProcessLike | null;
}

/**
 * Bootstrap the runtime against the given port. Exported so tests can drive
 * it with an in-memory port without spawning a real worker or realm.
 */
export function bootstrap(port: PortLike, opts: BootstrapOpts): ExtensionRuntime {
  let runtime: ExtensionRuntime | null = null;
  const queue: RpcEnvelope[] = [];
  // Per-bootstrap, not module-level: two bootstraps in the same process (only
  // ever happens in tests) must not share initialization state.
  let isInitialized = false;

  const channel: IRpcChannel = {
    send(envelope: RpcEnvelope) {
      port.postMessage(envelope);
    },
    onMessage(_handler) {
      // The runtime drives dispatch via `runtime.dispatch()` rather than
      // subscribing to the channel directly - bootstrap is the only thing
      // reading the port.
    },
  };

  runtime = new ExtensionRuntime({
    channel,
    moduleLoader: opts.moduleLoader,
    ...(opts.activateTimeoutMs !== undefined
      ? { activateTimeoutMs: opts.activateTimeoutMs }
      : {}),
    ...(opts.boundaryProcess !== undefined ? { boundaryProcess: opts.boundaryProcess } : {}),
  });

  port.on('message', (raw) => {
    // Electron's MessagePortMain delivers `MessageEvent`-like objects with
    // a `.data` property; raw Node IPC and the realm bridge deliver the value
    // directly.
    const env = unwrap(raw) as RpcEnvelope;
    if (!env || typeof env !== 'object') return;

    // Init handshake: the host wraps the init payload in a normal request.
    if (env.kind === 'request' && env.method === 'runtime.init') {
      const initPayload = env.args[0] as ExtensionInitPayload;
      void handleInit(runtime!, initPayload, env.id, port, queue, opts.onFatal, () => {
        isInitialized = true;
      });
      return;
    }

    // Pre-init traffic is split: liveness-critical envelopes go straight
    // through, everything else waits for the extension to finish activating.
    // See the header for why.
    if (!isInitialized && !isLivenessCritical(env)) {
      queue.push(env);
      return;
    }
    void runtime!.dispatch(env);
  });

  return runtime;
}

/**
 * True for envelopes that must be dispatched even while `activate()` is still
 * running: RPC responses (the extension is awaiting them) and heartbeats (the
 * host kills a worker that stops echoing them).
 */
function isLivenessCritical(env: RpcEnvelope): boolean {
  return env.kind === 'response' || env.kind === 'heartbeat';
}

async function handleInit(
  runtime: ExtensionRuntime,
  payload: ExtensionInitPayload,
  requestId: string,
  port: PortLike,
  queue: RpcEnvelope[],
  onFatal: ((err: unknown) => void) | undefined,
  markInitialized: () => void,
): Promise<void> {
  try {
    await runtime.init(payload);
    markInitialized();
    const ack: RpcResponse = { kind: 'response', id: requestId, result: { ok: true } };
    port.postMessage(ack);
    while (queue.length) {
      const env = queue.shift()!;
      void runtime.dispatch(env);
    }
  } catch (err) {
    const ack: RpcResponse = {
      kind: 'response',
      id: requestId,
      error: {
        code: 'Error',
        message: err instanceof Error ? err.message : String(err),
      },
    };
    try {
      port.postMessage(ack);
    } catch {
      /* ignore */
    }
    onFatal?.(err);
  }
}

function unwrap(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && 'data' in (raw as Record<string, unknown>)) {
    return (raw as { data: unknown }).data;
  }
  return raw;
}

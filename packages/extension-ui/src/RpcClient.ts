/**
 * Lightweight RPC client that runs inside an extension iframe and
 * communicates with the host (renderer) via `window.parent.postMessage`.
 *
 * Speaks the same `RpcEnvelope` protocol used by the host ↔ worker channel
 * (see `@bible/core` `RpcEnvelope.ts`). The types are inlined here to keep
 * the SDK dependency-free — extensions should not need `@bible/core` at
 * runtime just to use the UI SDK.
 */

// ── Inlined RPC envelope types (must stay in sync with @bible/core) ──────

export type RpcRequestId = string;

export interface RpcRequest {
  kind: 'request';
  id: RpcRequestId;
  method: string;
  args: unknown[];
}

export interface RpcResponse {
  kind: 'response';
  id: RpcRequestId;
  result?: unknown;
  error?: RpcErrorPayload;
}

export interface RpcErrorPayload {
  code: string;
  message: string;
  data?: unknown;
}

export interface RpcEvent {
  kind: 'event';
  channel: string;
  payload: unknown;
}

export type RpcEnvelope = RpcRequest | RpcResponse | RpcEvent;

/** Disposable subscription handle. */
export interface Disposable {
  dispose(): void;
}

// ── Client ───────────────────────────────────────────────────────────────

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface RpcClientOptions {
  /** Default timeout for RPC requests in ms. Default 10 000. */
  timeoutMs?: number;
}

let idCounter = 0;
function nextId(): string {
  return `ext-ui-${Date.now()}-${++idCounter}`;
}

function isRpcResponse(v: unknown): v is RpcResponse {
  return typeof v === 'object' && v !== null && (v as { kind?: string }).kind === 'response';
}

function isRpcEvent(v: unknown): v is RpcEvent {
  return typeof v === 'object' && v !== null && (v as { kind?: string }).kind === 'event';
}

export class RpcClient {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly eventListeners = new Map<string, Set<(payload: unknown) => void>>();
  private readonly timeoutMs: number;
  private disposed = false;

  constructor(opts?: RpcClientOptions) {
    this.timeoutMs = opts?.timeoutMs ?? 10_000;
    window.addEventListener('message', this.onMessage);
  }

  /**
   * Send an RPC request to the host and wait for a response.
   */
  request<T = unknown>(method: string, args: unknown[] = []): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('RpcClient disposed'));

    return new Promise<T>((resolve, reject) => {
      const id = nextId();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method} (${this.timeoutMs}ms)`));
      }, this.timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });

      const envelope: RpcRequest = { kind: 'request', id, method, args };
      window.parent.postMessage(envelope, '*');
    });
  }

  /**
   * Subscribe to events from the host on a given channel.
   */
  on(channel: string, callback: (payload: unknown) => void): Disposable {
    let listeners = this.eventListeners.get(channel);
    if (!listeners) {
      listeners = new Set();
      this.eventListeners.set(channel, listeners);
    }
    listeners.add(callback);
    return {
      dispose: () => {
        listeners!.delete(callback);
        if (listeners!.size === 0) this.eventListeners.delete(channel);
      },
    };
  }

  /**
   * Tear down the client. Rejects all pending requests and removes the
   * message listener.
   */
  dispose(): void {
    this.disposed = true;
    window.removeEventListener('message', this.onMessage);
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('RpcClient disposed'));
    }
    this.pending.clear();
    this.eventListeners.clear();
  }

  // ── Private ──────────────────────────────────────────────────────────

  private readonly onMessage = (event: MessageEvent): void => {
    const data: unknown = event.data;

    if (isRpcResponse(data)) {
      const p = this.pending.get(data.id);
      if (!p) return; // stale or unknown response — ignore
      this.pending.delete(data.id);
      clearTimeout(p.timer);
      if (data.error) {
        const err = new Error(data.error.message);
        err.name = data.error.code;
        p.reject(err);
      } else {
        p.resolve(data.result);
      }
      return;
    }

    if (isRpcEvent(data)) {
      const listeners = this.eventListeners.get(data.channel);
      if (listeners) {
        for (const cb of listeners) {
          try {
            cb(data.payload);
          } catch {
            // Don't let one bad listener break others.
          }
        }
      }
    }
  };
}

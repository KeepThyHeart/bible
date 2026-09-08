/**
 * Tiny main<->renderer RPC helper used by the production extension bridges
 * (UI / Workspace / Command / Context / L10n).
 *
 * The Electron contract is asymmetric: `ipcRenderer.invoke()` gives renderer ->
 * main request/response for free, but main -> renderer requires us to roll
 * our own. This helper does the bare minimum:
 *
 *   - `request(op, args)`     : main -> renderer round-trip
 *   - `notify(op, args)`      : main -> renderer fire-and-forget
 *   - `attachResponseHandler` : main listens for the renderer's reply
 *   - `attachInboundHandler`  : main listens for renderer-initiated calls
 *
 * One channel pair per bridge keeps the protocol legible (`ext-bridge:ui`,
 * `ext-bridge:workspace`, ...) and lets each bridge own its own naming.
 *
 * The renderer side of this protocol lives in
 * `src/ui/extensions/extensionRendererBridge.ts`.
 */

import { ipcMain, type BrowserWindow } from 'electron';

let nextRequestId = 1;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
}

export interface BridgeRpcOptions {
  /** Channel name for main -> renderer dispatch (e.g. 'ext-bridge:ui'). */
  outboundChannel: string;
  /** Channel name for renderer -> main responses (e.g. 'ext-bridge:ui:response'). */
  responseChannel: string;
  /** Optional channel for renderer-initiated calls (e.g. 'ext-bridge:command:invoke'). */
  inboundChannel?: string;
  /** Resolve the focused / active main window. */
  getWindow: () => BrowserWindow | null;
  /** Per-request timeout. Defaults to 10 s. */
  timeoutMs?: number;
}

export class BridgeRpc {
  private readonly opts: BridgeRpcOptions;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(opts: BridgeRpcOptions) {
    this.opts = opts;

    ipcMain.on(opts.responseChannel, (_event, payload: { requestId: number; ok: boolean; result?: unknown; error?: string }) => {
      const entry = this.pending.get(payload.requestId);
      if (!entry) return;
      this.pending.delete(payload.requestId);
      clearTimeout(entry.timeout);
      if (payload.ok) {
        entry.resolve(payload.result);
      } else {
        entry.reject(new Error(payload.error ?? 'Bridge call failed'));
      }
    });
  }

  /** Main -> renderer round-trip. Resolves with the renderer-supplied result. */
  request<T = unknown>(op: string, args: unknown[] = []): Promise<T> {
    const win = this.opts.getWindow();
    if (!win || win.isDestroyed()) {
      return Promise.reject(new Error(`Bridge ${this.opts.outboundChannel}: no main window`));
    }
    const requestId = nextRequestId++;
    const timeoutMs = this.opts.timeoutMs ?? 10_000;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pending.delete(requestId)) {
          reject(new Error(`Bridge ${this.opts.outboundChannel} ${op}: timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      this.pending.set(requestId, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timeout,
      });
      try {
        win.webContents.send(this.opts.outboundChannel, { requestId, op, args });
      } catch (err) {
        clearTimeout(timeout);
        this.pending.delete(requestId);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** Main -> renderer fire-and-forget. */
  notify(op: string, args: unknown[] = []): void {
    const win = this.opts.getWindow();
    if (!win || win.isDestroyed()) return;
    try {
      win.webContents.send(this.opts.outboundChannel, { requestId: 0, op, args });
    } catch {
      /* swallow - best-effort notify */
    }
  }

  /**
   * Subscribe to renderer-initiated calls (e.g. command-execute callback from
   * the menu). The handler resolves with whatever should be returned to the
   * renderer; thrown errors are surfaced as IPC `invoke` rejections.
   */
  attachInboundHandler(handler: (op: string, args: unknown[]) => Promise<unknown>): void {
    if (!this.opts.inboundChannel) return;
    ipcMain.handle(this.opts.inboundChannel, async (_event, payload: { op: string; args: unknown[] }) => {
      return handler(payload.op, payload.args ?? []);
    });
  }

  /** Reject every outstanding request - used by host shutdown. */
  dispose(): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timeout);
      p.reject(new Error('Bridge disposed'));
      this.pending.delete(id);
    }
  }
}

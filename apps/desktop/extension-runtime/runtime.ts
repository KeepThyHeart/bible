/**
 * Worker-side runtime, implementing `IExtensionRuntime`.
 *
 * Owns the worker's side of the protocol:
 *
 *   1. `init(payload)` is called once by the entry script (`index.ts`) after
 *      it's pulled the init payload off `parentPort`. The runtime stashes
 *      the granted permissions, builds the API proxy, and dynamically
 *      imports the extension's `manifest.main` - resolved against
 *      `payload.installPath` by `resolveEntry.ts`. Then it calls
 *      `module.activate(api)` and waits up to 5 seconds for it to resolve.
 *   2. `dispatch(envelope)` routes incoming envelopes - the entry script
 *      hands every parentPort message to it. Responses go to the API proxy;
 *      events go to the emitter; reverse RPC requests go to the registered
 *      reverse handlers (`commands.execute` etc).
 *   3. `dispose()` runs the extension's `deactivate()` (if present), tears
 *      down the proxy / emitter / boundary, and resolves so the entry script
 *      can let the worker exit cleanly.
 *
 * The runtime is intentionally tiny - the 50 KB gzipped budget is
 * tight, and every dependency that lands here ships in every worker.
 */

// Deep value import, barrel for types only - see the note in `apiProxy.ts`.
import { isRpcEnvelope } from '@bible/core/Extensions/RpcEnvelope';
import type { Extensions } from '@bible/core';

type BibleExtensionAPI = Extensions.BibleExtensionAPI;
type RpcEnvelope = Extensions.RpcEnvelope;
type RpcRequest = Extensions.RpcRequest;
type RpcResponse = Extensions.RpcResponse;
type ExtensionInitPayload = Extensions.ExtensionInitPayload;
type ExtensionEntryPointModule = Extensions.ExtensionEntryPointModule;
type IExtensionRuntime = Extensions.IExtensionRuntime;

import { createApiProxy, type IRpcChannel } from './apiProxy';
import { ExtensionEventEmitter } from './eventEmitter';
import { ExtensionErrorBoundary, type ErrorBoundaryProcessLike } from './errorBoundary';

/**
 * Loads the extension's entry module.
 *
 * Takes the whole init payload rather than a resolved specifier because
 * *where the code comes from* is no longer the runtime's business. Inside the
 * QuickJS realm the runtime has no filesystem and no path module, so the
 * supervisor resolves `manifest.main` against `installPath` (containment check
 * included - see `resolveEntry.ts`), reads it, and evaluates it in the realm;
 * the guest's loader just hands back what the supervisor produced.
 */
export type ExtensionModuleLoader = (
  payload: ExtensionInitPayload,
) => Promise<ExtensionEntryPointModule>;

export interface ExtensionRuntimeOpts {
  channel: IRpcChannel;
  /**
   * Loads the extension's entry module.
   *
   * REQUIRED, and deliberately so: this file is bundled into the QuickJS
   * guest realm, where a dynamic `import()` is not merely unavailable but a
   * *parse* error - QuickJS only accepts `import()` in module context, so a
   * default of `(p) => import(p)` would take the entire guest bundle down at
   * load time, not at call time. Each caller supplies the loader appropriate
   * to where it runs: the guest gets one backed by host-supplied source, and
   * tests get a stub.
   */
  moduleLoader: ExtensionModuleLoader;
  /** Override the activate timeout. Defaults to 5000 ms. */
  activateTimeoutMs?: number;
  /**
   * Where the boundary should look for `uncaughtException` /
   * `unhandledRejection`. Omit under Node to use the real `process`; pass
   * `null` in the guest realm, which has none.
   */
  boundaryProcess?: ErrorBoundaryProcessLike | null;
}

/** Reverse-RPC handler - used to register `commands.execute` etc. */
export type ReverseRpcHandler = (args: unknown[]) => unknown | Promise<unknown>;

const DEFAULT_ACTIVATE_TIMEOUT_MS = 5_000;

export class ExtensionRuntime implements IExtensionRuntime {
  private readonly channel: IRpcChannel;
  private readonly emitter: ExtensionEventEmitter;
  private readonly errorBoundary: ExtensionErrorBoundary;
  private readonly proxy: ReturnType<typeof createApiProxy>;
  private readonly reverseHandlers = new Map<string, ReverseRpcHandler>();
  private readonly moduleLoader: ExtensionModuleLoader;
  private readonly activateTimeoutMs: number;

  private entryModule: ExtensionEntryPointModule | null = null;
  private initPayload: ExtensionInitPayload | null = null;
  private disposed = false;

  constructor(opts: ExtensionRuntimeOpts) {
    this.channel = opts.channel;
    this.errorBoundary = new ExtensionErrorBoundary({
      channel: opts.channel,
      ...(opts.boundaryProcess !== undefined ? { process: opts.boundaryProcess } : {}),
    });
    this.emitter = new ExtensionEventEmitter(opts.channel, (channelName, err) => {
      this.errorBoundary.report(`event-handler:${channelName}`, err);
    });
    this.proxy = createApiProxy({ channel: opts.channel, emitter: this.emitter });
    this.moduleLoader = opts.moduleLoader;
    this.activateTimeoutMs = opts.activateTimeoutMs ?? DEFAULT_ACTIVATE_TIMEOUT_MS;
    this.errorBoundary.install();
  }

  /**
   * Register a reverse-RPC handler the host may call (`commands.execute`,
   * `provider.fetch`, etc). These are wired from `api.commands.register`
   * and friends; the runtime ships the plumbing only.
   */
  registerReverseHandler(method: string, handler: ReverseRpcHandler): void {
    this.reverseHandlers.set(method, handler);
  }

  unregisterReverseHandler(method: string): void {
    this.reverseHandlers.delete(method);
  }

  // --- IExtensionRuntime --------------------------------------------------

  async init(payload: ExtensionInitPayload): Promise<void> {
    if (this.initPayload) {
      throw new Error('ExtensionRuntime.init called twice');
    }
    this.initPayload = payload;

    if (!payload.manifest.main) {
      const err = new Error(
        `Extension ${payload.manifest.id} has no manifest.main entry point`,
      );
      this.errorBoundary.report('module-load', err);
      throw err;
    }
    // The loader owns resolution and reading - see `ExtensionModuleLoader`.
    // Whatever it throws (a containment violation, a missing file, a syntax
    // error in the bundle) surfaces to the host as one `module-load` report.
    let entryModule: ExtensionEntryPointModule;
    try {
      entryModule = await this.moduleLoader(payload);
    } catch (err) {
      this.errorBoundary.report('module-load', err);
      throw err;
    }
    this.entryModule = entryModule;

    if (typeof entryModule.activate !== 'function') {
      const err = new Error(
        `Extension ${payload.manifest.id} has no exported activate(api) function`,
      );
      this.errorBoundary.report('activate-missing', err);
      throw err;
    }

    // Race activate() against the timeout. If activate() throws or times
    // out, we report it via the error boundary so the host gets the same
    // structured event it sees for any other crash, then re-throw so the
    // entry script knows to exit non-zero.
    try {
      await raceTimeout(
        Promise.resolve(entryModule.activate(this.proxy.api)),
        this.activateTimeoutMs,
        `activate() timed out after ${this.activateTimeoutMs}ms`,
      );
    } catch (err) {
      this.errorBoundary.report('activate', err);
      throw err;
    }
  }

  async dispatch(envelope: RpcEnvelope): Promise<void> {
    if (this.disposed) return;
    if (!isRpcEnvelope(envelope)) return;
    switch (envelope.kind) {
      case 'response':
        this.proxy.handleResponse(envelope);
        return;
      case 'event':
        this.emitter.dispatch(envelope);
        return;
      case 'request':
        await this.handleReverseRequest(envelope);
        return;
      case 'heartbeat':
        // Echo to satisfy the wrapper. The host's wrapper drops these
        // before they ever reach the router on the other side.
        this.channel.send(envelope);
        return;
      case 'subscribe':
      case 'unsubscribe':
        // Subscription envelopes only flow worker->host in v1.
        return;
    }
  }

  getApi(): BibleExtensionAPI {
    return this.proxy.api;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    try {
      if (this.entryModule?.deactivate) {
        await Promise.resolve(this.entryModule.deactivate());
      }
    } catch (err) {
      this.errorBoundary.report('deactivate', err);
    }
    this.emitter.clear();
    this.errorBoundary.uninstall();
    this.reverseHandlers.clear();
  }

  // --- Private ------------------------------------------------------------

  private async handleReverseRequest(req: RpcRequest): Promise<void> {
    const handler = this.reverseHandlers.get(req.method);
    if (!handler) {
      const res: RpcResponse = {
        kind: 'response',
        id: req.id,
        error: {
          code: 'RpcProtocolError',
          message: `Unknown reverse RPC method: ${req.method}`,
        },
      };
      this.channel.send(res);
      return;
    }
    try {
      const result = await handler(req.args);
      this.channel.send({ kind: 'response', id: req.id, result });
    } catch (err) {
      const res: RpcResponse = {
        kind: 'response',
        id: req.id,
        error: {
          code: 'Error',
          message: err instanceof Error ? err.message : String(err),
        },
      };
      this.channel.send(res);
    }
  }
}

function raceTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  if (ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

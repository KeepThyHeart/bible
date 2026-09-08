/**
 * Worker-side error boundary.
 *
 * Backs crash detection / auto-disable: catches unhandled
 * errors and rejections inside the extension worker and reports them to the
 * host as a structured `RpcEvent` on the `__runtime.error` channel.
 *
 * The host's per-extension log writer subscribes implicitly to this channel
 * (via the router) and tail-truncates `extension.log` accordingly. Crashes
 * that escape the boundary still hit `process.on('exit')` in the wrapper,
 * which writes a `crash.log` record with the buffered stderr tail.
 *
 * The boundary deliberately swallows errors after reporting them - letting
 * an unhandled rejection take down the worker would defeat the host's
 * 3-strikes auto-disable rule.
 *
 * -- Running inside the QuickJS realm ----------------------------------------
 * The guest realm has no `process`, so the process-level hooks simply do not
 * install there and `report()` becomes the whole boundary. That is a real
 * narrowing: QuickJS's host promise-rejection tracker is not exposed by
 * `quickjs-emscripten`, so a rejected promise nobody handles is silent inside
 * the realm. Everything the runtime itself drives - activate(), deactivate(),
 * module load, event handlers, reverse-RPC handlers - is reported explicitly
 * by its caller instead, which is why `ExtensionEventEmitter` now takes an
 * `onHandlerError` hook rather than swallowing.
 */

import type { IRpcChannel } from './apiProxy';
import type { Extensions } from '@bible/core';

type RpcEvent = Extensions.RpcEvent;

const RUNTIME_ERROR_CHANNEL = '__runtime.error';

/**
 * The slice of `process` the boundary uses. Declared structurally so the guest
 * realm - which has no `process` at all - can simply omit it.
 */
export interface ErrorBoundaryProcessLike {
  on(event: 'uncaughtException' | 'unhandledRejection', handler: (arg: never) => void): unknown;
  off(event: 'uncaughtException' | 'unhandledRejection', handler: (arg: never) => void): unknown;
}

export interface ErrorBoundaryOpts {
  channel: IRpcChannel;
  /**
   * Process to hook. Defaults to the worker's `process` global when one
   * exists. Pass `null` to opt out explicitly (the guest realm does).
   */
  process?: ErrorBoundaryProcessLike | null;
}

export class ExtensionErrorBoundary {
  private readonly channel: IRpcChannel;
  private readonly proc: ErrorBoundaryProcessLike | null;
  private installed = false;
  private uncaughtHandler?: (err: never) => void;
  private rejectionHandler?: (reason: never) => void;

  constructor(opts: ErrorBoundaryOpts) {
    this.channel = opts.channel;
    this.proc =
      opts.process !== undefined
        ? opts.process
        : ((globalThis as unknown as { process?: ErrorBoundaryProcessLike }).process ?? null);
  }

  /**
   * Wire up `uncaughtException` + `unhandledRejection` handlers. Idempotent,
   * and a no-op when there is no host process (the guest realm).
   */
  install(): void {
    if (this.installed) return;
    this.installed = true;
    const proc = this.proc;
    if (!proc) return;

    this.uncaughtHandler = ((err: unknown) => {
      this.report('uncaughtException', err);
    }) as (err: never) => void;
    this.rejectionHandler = ((reason: unknown) => {
      this.report('unhandledRejection', reason);
    }) as (reason: never) => void;
    proc.on('uncaughtException', this.uncaughtHandler);
    proc.on('unhandledRejection', this.rejectionHandler);
  }

  /** Tear down the handlers. Called from `runtime.dispose()`. */
  uninstall(): void {
    if (!this.installed) return;
    this.installed = false;
    const proc = this.proc;
    if (proc) {
      if (this.uncaughtHandler) proc.off('uncaughtException', this.uncaughtHandler);
      if (this.rejectionHandler) proc.off('unhandledRejection', this.rejectionHandler);
    }
    this.uncaughtHandler = undefined;
    this.rejectionHandler = undefined;
  }

  /** Surface an arbitrary error to the host. Useful for activate() failures. */
  report(source: string, err: unknown): void {
    const payload = {
      source,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    };
    const env: RpcEvent = { kind: 'event', channel: RUNTIME_ERROR_CHANNEL, payload };
    try {
      this.channel.send(env);
    } catch {
      /* host transport gone - nothing useful to do */
    }
  }
}

export { RUNTIME_ERROR_CHANNEL };

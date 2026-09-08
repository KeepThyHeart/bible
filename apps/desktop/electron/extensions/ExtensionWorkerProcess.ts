/**
 * ExtensionWorkerProcess.
 *
 * Wraps one Electron `utilityProcess` per active extension. Owns the
 * lifecycle:
 *
 *   spawn -> init RPC -> activate -> heartbeat loop -> SIGTERM -> SIGKILL -> exit
 *
 * The wrapper does NOT know about the API surface - it just owns the
 * transport, the heartbeat clock, and the exit/crash handling. The
 * `ExtensionRpcRouter` (constructed externally and given a transport from
 * here via `getTransport()`) does the actual method dispatch.
 *
 * Process spawning is abstracted behind `IUtilityProcessFactory` so unit
 * tests can substitute an in-memory fake. Production code passes
 * `electronUtilityProcessFactory` which calls `electron.utilityProcess.fork`.
 */

import { Extensions } from '@bible/core';

type RpcEnvelope = Extensions.RpcEnvelope;

import type { IRpcTransport } from './ExtensionRpcRouter';

export type WorkerExitInfo = {
  /** OS exit code or null if killed without one. */
  code: number | null;
  /** True if the host killed the worker (vs. it exited on its own). */
  killed: boolean;
  /** True if heartbeat detection considered the worker hung. */
  hung: boolean;
  /** Buffered stderr (capped at `STDERR_BUFFER_LINES` lines). */
  stderrTail: string;
};

export interface WorkerSpawnOpts {
  /** Stable identifier - used as the utilityProcess `serviceName`. */
  extensionId: string;
  /** Absolute path to the worker entry script (the bundled extension-runtime/index.js). */
  scriptPath: string;
  /** Arguments forwarded as `process.argv.slice(2)`. */
  args?: string[];
  /** Per-process Node arguments - defaults to `--max-old-space-size=256`. */
  execArgv?: string[];
  /** Heartbeat interval. Default 10 s. Pass 0 to disable (tests). */
  heartbeatIntervalMs?: number;
  /** Number of consecutive missed heartbeats before SIGKILL. Default 3. */
  heartbeatMaxMissed?: number;
  /** Called when the worker exits for any reason. */
  onExit: (info: WorkerExitInfo) => void;
}

/**
 * Events the worker handle emits. Single signature so the type can be
 * implemented by a uniform `on` method without TS overload-resolution
 * headaches. The wrapper validates payload shape per event itself.
 */
export type WorkerEventName = 'message' | 'exit' | 'spawn';
export type WorkerEventListener = (payload: unknown) => void;

/** Abstract handle the wrapper holds. Implemented by Electron's `UtilityProcess` and by tests. */
export interface IUtilityProcessHandle {
  postMessage(msg: unknown): void;
  kill(): boolean;
  pid?: number;
  on(event: WorkerEventName, handler: WorkerEventListener): void;
  /** Optional stderr observer - production wires this from the underlying stream. */
  onStderr?(handler: (chunk: string) => void): void;
}

export interface IUtilityProcessFactory {
  fork(opts: {
    scriptPath: string;
    args: string[];
    execArgv: string[];
    serviceName: string;
  }): IUtilityProcessHandle;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;
const DEFAULT_HEARTBEAT_MAX_MISSED = 3;
const SIGTERM_GRACE_MS = 2_000;
const STDERR_BUFFER_LINES = 200;

/**
 * One worker. Construct, await `spawn()`, then read the transport via
 * `getTransport()` and hand it to an `ExtensionRpcRouter`.
 */
export class ExtensionWorkerProcess {
  private handle: IUtilityProcessHandle | null = null;
  private readonly opts: WorkerSpawnOpts;
  private readonly factory: IUtilityProcessFactory;
  private readonly transportListeners: ((env: unknown) => void)[] = [];
  private readonly stderrLines: string[] = [];
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private missedHeartbeats = 0;
  private exited = false;
  private exitInfo: WorkerExitInfo | null = null;
  private hung = false;
  private killTimer: ReturnType<typeof setTimeout> | null = null;
  private spawnPromise: Promise<void> | null = null;

  constructor(factory: IUtilityProcessFactory, opts: WorkerSpawnOpts) {
    this.factory = factory;
    this.opts = opts;
  }

  /** Fork the underlying process and wait for the OS-level spawn signal. */
  spawn(): Promise<void> {
    if (this.spawnPromise) return this.spawnPromise;
    this.spawnPromise = new Promise<void>((resolve, reject) => {
      let handle: IUtilityProcessHandle;
      try {
        handle = this.factory.fork({
          scriptPath: this.opts.scriptPath,
          args: this.opts.args ?? [],
          execArgv: this.opts.execArgv ?? ['--max-old-space-size=256'],
          serviceName: this.opts.extensionId,
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      this.handle = handle;

      handle.on('message', (msg) => {
        // Heartbeat replies are accounted for here so the wrapper owns the
        // entire heartbeat protocol - the router never sees them.
        if (Extensions.isRpcEnvelope(msg) && msg.kind === 'heartbeat') {
          this.missedHeartbeats = 0;
          return;
        }
        for (const listener of this.transportListeners) {
          try {
            listener(msg);
          } catch {
            /* listener errors are caller's problem */
          }
        }
      });

      handle.on('exit', (code) => {
        this.handleExit(typeof code === 'number' ? code : null);
      });

      handle.on('spawn', () => {
        this.startHeartbeat();
        resolve();
      });

      handle.onStderr?.((chunk) => {
        for (const line of chunk.split(/\r?\n/)) {
          if (!line) continue;
          this.stderrLines.push(line);
          while (this.stderrLines.length > STDERR_BUFFER_LINES) {
            this.stderrLines.shift();
          }
        }
      });
    });
    return this.spawnPromise;
  }

  /** Get an `IRpcTransport` view of the worker. Safe to call after `spawn()` resolves. */
  getTransport(): IRpcTransport {
    return {
      send: (envelope: RpcEnvelope) => {
        if (this.exited || !this.handle) return;
        this.handle.postMessage(envelope);
      },
      onMessage: (handler: (envelope: unknown) => void) => {
        this.transportListeners.push(handler);
      },
      close: () => {
        // Closing the transport doesn't kill the worker - that's `terminate()`'s
        // job. The router calls this on its own teardown so we just stop
        // routing messages to its listeners.
        this.transportListeners.length = 0;
      },
    };
  }

  /** True iff the worker has exited (cleanly or otherwise). */
  isExited(): boolean {
    return this.exited;
  }

  /** True iff the wrapper killed the worker because it stopped responding to heartbeats. */
  wasHung(): boolean {
    return this.hung;
  }

  /** Most recent exit info (populated only after `exit`). */
  getExitInfo(): WorkerExitInfo | null {
    return this.exitInfo;
  }

  /** Snapshot of the buffered stderr tail. */
  getStderrTail(): string {
    return this.stderrLines.join('\n');
  }

  /**
   * Politely terminate the worker. Sends SIGTERM, waits up to
   * `SIGTERM_GRACE_MS`, then SIGKILL. Resolves once `exit` has fired.
   */
  terminate(): Promise<void> {
    return new Promise((resolve) => {
      if (this.exited || !this.handle) {
        resolve();
        return;
      }
      // Subscribe to exit so we resolve once the OS confirms the kill.
      const original = this.opts.onExit;
      this.opts.onExit = (info) => {
        try {
          original(info);
        } finally {
          resolve();
        }
      };

      try {
        this.handle.kill();
      } catch {
        /* ignore */
      }
      this.killTimer = setTimeout(() => {
        if (!this.exited && this.handle) {
          try {
            this.handle.kill();
          } catch {
            /* ignore */
          }
        }
      }, SIGTERM_GRACE_MS);
    });
  }

  // --- Private ------------------------------------------------------------

  private startHeartbeat(): void {
    const interval = this.opts.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    if (interval <= 0) return;
    const max = this.opts.heartbeatMaxMissed ?? DEFAULT_HEARTBEAT_MAX_MISSED;

    this.heartbeatTimer = setInterval(() => {
      if (this.exited || !this.handle) return;
      this.missedHeartbeats += 1;
      if (this.missedHeartbeats > max) {
        this.hung = true;
        try {
          this.handle.kill();
        } catch {
          /* ignore */
        }
        return;
      }
      try {
        this.handle.postMessage({ kind: 'heartbeat', ts: Date.now() });
      } catch {
        /* worker is dying - exit handler will fire shortly */
      }
    }, interval);
    if (typeof (this.heartbeatTimer as { unref?: () => void }).unref === 'function') {
      (this.heartbeatTimer as { unref: () => void }).unref();
    }
  }

  private handleExit(code: number | null): void {
    if (this.exited) return;
    this.exited = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.killTimer) {
      clearTimeout(this.killTimer);
      this.killTimer = null;
    }
    const info: WorkerExitInfo = {
      code,
      killed: this.hung || code === null,
      hung: this.hung,
      stderrTail: this.getStderrTail(),
    };
    this.exitInfo = info;
    this.handle = null;
    try {
      this.opts.onExit(info);
    } catch {
      /* swallow - wrapper has already done its job */
    }
  }
}

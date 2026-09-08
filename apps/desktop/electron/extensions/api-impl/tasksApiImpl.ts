/**
 * Host-side implementation of `ITasksApi` for one extension worker.
 *
 * Long-running task surface:
 *
 *   - `tasks.run(descriptor)` invokes the worker's `descriptor.workEndpoint`
 *     via reverse-RPC and tracks the task on a per-extension registry. The
 *     worker handler is responsible for periodically calling
 *     `tasks.isCancellationRequested(handle)` and bailing out early when the
 *     user cancels.
 *
 *   - `tasks.cancel(taskId)` flips the task's state to `cancelling`. The
 *     worker observes this on its next `isCancellationRequested` poll and
 *     resolves (or throws) - at which point the task transitions to
 *     `cancelled` (clean exit) or `failed` (rejected).
 *
 *   - `tasks.reportProgress(handle, update)` and `tasks.list()` are read /
 *     write surfaces over the in-memory registry.
 *
 *   - On extension deactivate, `dispose()` cancels every owned task and
 *     waits up to `disposeDrainMs` (default 2 s) for them to
 *     settle before resolving - the host's `deactivate` then tears down the
 *     worker. Tasks that don't observe cancellation in the budget are
 *     orphaned at the api-impl level; the worker termination that follows
 *     reaps them at the process level.
 *
 * Singleton + concurrency rules:
 *
 *   - `singleton: true, concurrency: 'reject'` (the default) - a second
 *     `run()` for the same id while the first is still in flight throws
 *     `RpcProtocolError`.
 *   - `singleton: true, concurrency: 'join'` - a second `run()` returns the
 *     same promise as the first. Useful for "ensure cache is warm" patterns
 *     where multiple call sites want to dedupe onto a single execution.
 *   - Singleton `false` rejects an id collision because the registry is
 *     keyed by id and the spec doesn't define how to disambiguate two live
 *     handles for the same descriptor id. Extensions that want to run many
 *     concurrent fan-out tasks should use unique ids.
 *
 * The status-bar / notification surfaces are *observers*, not coupling
 * points: `IExtensionTaskStatusBridge` lets the desktop process forward
 * task snapshots into a built-in status-bar widget without the api-impl
 * having to know about the renderer, and `TaskNotifier` lets it raise an
 * extension notification on completion without taking a hard dependency
 * on the UI bridge. Both are optional - tests omit them, production wires
 * them in `main.ts`.
 *
 * Test surface: `TasksApi.test.ts` exercises the api-impl through a
 * paired-router transport so the tests cover the wire format too.
 */

import { Extensions } from '@bible/core';

import type { ExtensionRpcRouter } from '../ExtensionRpcRouter';
import {
  type ExtensionPermissionGrant,
  requirePermission,
} from '../ExtensionPermissionGuard';

const {
  ExtensionNotActiveError,
  RpcProtocolError,
} = Extensions;

type BackgroundTaskDescriptor = Extensions.BackgroundTaskDescriptor;
type BackgroundTaskInfo = Extensions.BackgroundTaskInfo;
type LocalizedString = Extensions.LocalizedString;
type TaskProgressUpdate = Extensions.TaskProgressUpdate;

/**
 * On deactivate the host calls `cancel` on every owned task and waits up to
 * 2 seconds for them to settle before tearing down the worker.
 */
export const TASK_DISPOSE_DRAIN_MS = 2_000;

/**
 * Built-in status-bar bridge. Production wires this to the renderer's task
 * widget; the in-memory implementation stores the latest snapshot per
 * extension so tests can assert update fan-out without standing up an
 * Electron window.
 *
 * Distinct from the T2 `ui.registerStatusBarItem` API - this bridge backs a
 * built-in widget that always shows active extension tasks, regardless of
 * whether any extension has registered a status bar item of its own.
 */
export interface IExtensionTaskStatusBridge {
  /** Latest snapshot of every active task owned by the given extension. */
  onTaskUpdate?(extensionId: string, snapshot: BackgroundTaskInfo[]): void;
  /** Drop every snapshot for `extensionId` (called on dispose). */
  clearTasksForExtension?(extensionId: string): void;
}

/** Per-task notifier for `notifyOnComplete`. */
export type TaskNotifier = (
  extensionId: string,
  message: LocalizedString,
) => void | Promise<void>;

export interface TasksApiImplOptions {
  extensionId: string;
  router: ExtensionRpcRouter;
  grant: ExtensionPermissionGrant;
  /** Optional built-in status-bar observer. */
  statusBridge?: IExtensionTaskStatusBridge;
  /** Optional completion notifier (wired to the UI bridge in production). */
  notifier?: TaskNotifier;
  /** Override the dispose drain budget. Defaults to {@link TASK_DISPOSE_DRAIN_MS}. */
  disposeDrainMs?: number;
  /** Inject a clock for tests. Defaults to `Date.now`. */
  clock?: () => number;
}

interface RunningTask {
  id: string;
  /** Reverse-RPC handle the worker uses to identify the task. v1: same as id. */
  handle: string;
  descriptor: BackgroundTaskDescriptor;
  startedAt: number;
  state: BackgroundTaskInfo['state'];
  progress?: { current: number; total?: number; message?: string };
  /** Resolved with the worker's return value (or rejected). */
  resultPromise: Promise<unknown>;
}

/**
 * One instance per active worker. Owns the running-task registry for that
 * extension so dispose() can cancel everything in a single shot.
 */
export class TasksApiImpl {
  private readonly extensionId: string;
  private readonly router: ExtensionRpcRouter;
  private readonly grant: ExtensionPermissionGrant;
  private readonly statusBridge: IExtensionTaskStatusBridge | undefined;
  private readonly notifier: TaskNotifier | undefined;
  private readonly disposeDrainMs: number;
  private readonly clock: () => number;

  private readonly tasks = new Map<string, RunningTask>();
  private disposed = false;

  constructor(opts: TasksApiImplOptions) {
    this.extensionId = opts.extensionId;
    this.router = opts.router;
    this.grant = opts.grant;
    this.statusBridge = opts.statusBridge;
    this.notifier = opts.notifier;
    this.disposeDrainMs = opts.disposeDrainMs ?? TASK_DISPOSE_DRAIN_MS;
    this.clock = opts.clock ?? Date.now;
  }

  attach(): void {
    this.router.registerNamespace('tasks', {
      run: (args) => this.handleRun(args),
      cancel: (args) => this.handleCancel(args),
      reportProgress: (args) => this.handleReportProgress(args),
      isCancellationRequested: (args) => this.handleIsCancellationRequested(args),
      list: () => this.handleList(),
    });
  }

  /**
   * Cancel every running task, wait up to `disposeDrainMs` for them to
   * settle, then mark the api-impl disposed. Idempotent.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    const inFlight: Promise<unknown>[] = [];
    for (const task of this.tasks.values()) {
      if (task.state === 'running') {
        task.state = 'cancelling';
      }
      // Swallow errors here - we just want to wait for settlement.
      inFlight.push(task.resultPromise.catch(() => undefined));
    }
    this.notifyStatus();

    if (inFlight.length > 0) {
      await Promise.race([
        Promise.allSettled(inFlight),
        new Promise<void>((resolve) => setTimeout(resolve, this.disposeDrainMs)),
      ]);
    }

    this.tasks.clear();
    try {
      this.statusBridge?.clearTasksForExtension?.(this.extensionId);
    } catch {
      /* swallow */
    }
  }

  // --- Handlers ---------------------------------------------------------

  private async handleRun(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'tasks');

    const desc = args[0];
    if (!isBackgroundTaskDescriptor(desc)) {
      throw new RpcProtocolError(
        'tasks.run: expected BackgroundTaskDescriptor as first argument',
      );
    }
    if (!desc.id.startsWith(`ext.${this.extensionId}.`)) {
      throw new RpcProtocolError(
        `tasks.run: id '${desc.id}' must start with 'ext.${this.extensionId}.'`,
      );
    }

    // Singleton handling: an existing live record either rejects or joins.
    const existing = this.tasks.get(desc.id);
    if (existing) {
      if (desc.singleton) {
        const concurrency = desc.concurrency ?? 'reject';
        if (concurrency === 'reject') {
          throw new RpcProtocolError(
            `tasks.run: singleton task '${desc.id}' is already running`,
          );
        }
        // 'join' - share the original task's promise.
        return existing.resultPromise;
      }
      throw new RpcProtocolError(
        `tasks.run: task id '${desc.id}' is already in flight (set singleton:true with concurrency:'join' to dedupe)`,
      );
    }

    const handle = desc.id;
    const task: RunningTask = {
      id: desc.id,
      handle,
      descriptor: desc,
      startedAt: this.clock(),
      state: 'running',
      // Placeholder until we wire the real promise below - the field is
      // overwritten before any await yields control.
      resultPromise: Promise.resolve(),
    };

    // Reverse-RPC into the worker. Tasks are inherently long-running, so we
    // pass `timeoutMs: 0` to disable the router's per-call timer - the only
    // stop signal for a task is cancellation (or the worker exiting).
    const work = this.router.request(desc.workEndpoint, [handle], { timeoutMs: 0 });

    const tracked = work.then(
      (result) => {
        if (task.state === 'cancelling') {
          task.state = 'cancelled';
        } else {
          task.state = 'completed';
        }
        this.tasks.delete(task.id);
        this.notifyStatus();
        if (
          task.state === 'completed' &&
          desc.notifyOnComplete &&
          this.notifier
        ) {
          try {
            void this.notifier(this.extensionId, desc.title);
          } catch {
            /* swallow */
          }
        }
        return result;
      },
      (err) => {
        task.state = task.state === 'cancelling' ? 'cancelled' : 'failed';
        this.tasks.delete(task.id);
        this.notifyStatus();
        throw err;
      },
    );
    task.resultPromise = tracked;

    this.tasks.set(task.id, task);
    this.notifyStatus();

    return tracked;
  }

  private async handleCancel(args: unknown[]): Promise<void> {
    this.assertActive();
    requirePermission(this.grant, 'tasks');
    const taskId = args[0];
    if (typeof taskId !== 'string' || taskId.length === 0) {
      throw new RpcProtocolError('tasks.cancel: taskId must be a non-empty string');
    }
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (task.descriptor.cancellable === false) {
      throw new RpcProtocolError(
        `tasks.cancel: task '${taskId}' is not cancellable`,
      );
    }
    if (task.state === 'running') {
      task.state = 'cancelling';
      this.notifyStatus();
    }
  }

  private async handleReportProgress(args: unknown[]): Promise<void> {
    this.assertActive();
    requirePermission(this.grant, 'tasks');
    const handle = args[0];
    if (typeof handle !== 'string' || handle.length === 0) {
      throw new RpcProtocolError(
        'tasks.reportProgress: taskHandle must be a non-empty string',
      );
    }
    const update = args[1];
    if (typeof update !== 'object' || update === null) {
      throw new RpcProtocolError(
        'tasks.reportProgress: update must be an object',
      );
    }
    const task = this.tasks.get(handle);
    if (!task) return; // task already settled - swallow late update
    const u = update as TaskProgressUpdate;
    if (u.increment !== undefined && typeof u.increment !== 'number') {
      throw new RpcProtocolError(
        'tasks.reportProgress: increment must be a number',
      );
    }
    if (u.total !== undefined && typeof u.total !== 'number') {
      throw new RpcProtocolError(
        'tasks.reportProgress: total must be a number',
      );
    }
    if (!task.progress) task.progress = { current: 0 };
    if (typeof u.total === 'number') task.progress.total = u.total;
    if (typeof u.increment === 'number') {
      task.progress.current += u.increment;
    }
    if (u.message !== undefined) {
      task.progress.message =
        typeof u.message === 'string' ? u.message : JSON.stringify(u.message);
    }
    this.notifyStatus();
  }

  private async handleIsCancellationRequested(args: unknown[]): Promise<boolean> {
    this.assertActive();
    requirePermission(this.grant, 'tasks');
    const handle = args[0];
    if (typeof handle !== 'string' || handle.length === 0) {
      throw new RpcProtocolError(
        'tasks.isCancellationRequested: taskHandle must be a non-empty string',
      );
    }
    const task = this.tasks.get(handle);
    return task?.state === 'cancelling';
  }

  private async handleList(): Promise<BackgroundTaskInfo[]> {
    this.assertActive();
    requirePermission(this.grant, 'tasks');
    return this.snapshot();
  }

  // --- Helpers ----------------------------------------------------------

  /** Test seam - number of tasks currently tracked by the api-impl. */
  get activeCount(): number {
    return this.tasks.size;
  }

  private snapshot(): BackgroundTaskInfo[] {
    const out: BackgroundTaskInfo[] = [];
    for (const t of this.tasks.values()) {
      const info: BackgroundTaskInfo = {
        id: t.id,
        title: t.descriptor.title,
        startedAt: t.startedAt,
        state: t.state,
      };
      if (t.progress) info.progress = { ...t.progress };
      out.push(info);
    }
    return out;
  }

  private notifyStatus(): void {
    if (!this.statusBridge?.onTaskUpdate) return;
    try {
      this.statusBridge.onTaskUpdate(this.extensionId, this.snapshot());
    } catch {
      /* swallow - observer errors must not break the task */
    }
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new ExtensionNotActiveError(
        `tasksApiImpl for ${this.extensionId} is disposed`,
      );
    }
  }
}

// --- Validators ------------------------------------------------------------

function isBackgroundTaskDescriptor(value: unknown): value is BackgroundTaskDescriptor {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.workEndpoint !== 'string' || v.workEndpoint.length === 0) return false;
  if (typeof v.title !== 'string' && (typeof v.title !== 'object' || v.title === null)) {
    return false;
  }
  if (v.singleton !== undefined && typeof v.singleton !== 'boolean') return false;
  if (
    v.concurrency !== undefined &&
    v.concurrency !== 'reject' &&
    v.concurrency !== 'join'
  ) {
    return false;
  }
  if (v.cancellable !== undefined && typeof v.cancellable !== 'boolean') return false;
  if (v.notifyOnComplete !== undefined && typeof v.notifyOnComplete !== 'boolean') {
    return false;
  }
  return true;
}

// --- In-memory bridge for tests --------------------------------------------

/**
 * Records every snapshot fan-out the api-impl emits. Tests use this to
 * assert that progress + state transitions reach the status bar.
 */
export class InMemoryTaskStatusBridge implements IExtensionTaskStatusBridge {
  readonly snapshots: { extensionId: string; snapshot: BackgroundTaskInfo[] }[] = [];
  readonly cleared: string[] = [];

  onTaskUpdate(extensionId: string, snapshot: BackgroundTaskInfo[]): void {
    this.snapshots.push({ extensionId, snapshot });
  }

  clearTasksForExtension(extensionId: string): void {
    this.cleared.push(extensionId);
  }

  /** Most-recent snapshot recorded for an extension, or `undefined`. */
  latest(extensionId: string): BackgroundTaskInfo[] | undefined {
    for (let i = this.snapshots.length - 1; i >= 0; i--) {
      if (this.snapshots[i]!.extensionId === extensionId) {
        return this.snapshots[i]!.snapshot;
      }
    }
    return undefined;
  }
}

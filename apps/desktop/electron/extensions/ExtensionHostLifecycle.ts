/**
 * Worker lifecycle + activation/deactivation + crash handling + extension
 * point dispatch for `ExtensionHost`.
 *
 * Covers:
 *   - `activate` (spawn worker, delegate api-impl wiring to
 *     `ExtensionHostRpc.attachApiImpls`, run the init handshake, roll back
 *     on failure).
 *   - `deactivate` (tear the worker down + notify onDidDeactivate observers).
 *   - `fireActivationEvent` (activation-event fan-out).
 *   - `handleWorkerExit` (crash accounting + auto-disable).
 *   - `dispatchExtensionPoint` (fan-out to active workers).
 *
 * RPC namespace wiring lives in `ExtensionHostRpc.ts`.
 */

import log from 'electron-log';

import { Extensions } from '@bible/core';

import { ExtensionWorkerProcess, type WorkerExitInfo } from './ExtensionWorkerProcess';
import { ExtensionRpcRouter, RUNTIME_ERROR_CHANNEL, RUNTIME_LOG_CHANNEL } from './ExtensionRpcRouter';
import { satisfies as semverSatisfies } from './semverRange';
import {
  MethodNotImplementedYet,
  type ActiveWorker,
  type ExtensionHostContext,
} from './ExtensionHostTypes';
import { attachApiImpls, disposeApiImpls } from './ExtensionHostRpc';

type ExtensionPointId = Extensions.ExtensionPointId;

export async function activate(
  ctx: ExtensionHostContext,
  extensionId: string,
): Promise<void> {
  const entry = ctx.registry.getEntry(extensionId);
  if (!entry) throw new Error(`Extension not installed: ${extensionId}`);
  if (!entry.enabled) throw new Error(`Extension is disabled: ${extensionId}`);
  if (entry.status === 'auto-disabled') {
    throw new Error(`Extension is auto-disabled (crash loop): ${extensionId}`);
  }
  if (ctx.activeWorkers.has(extensionId)) return; // already active
  if (!ctx.workerFactory) {
    throw new MethodNotImplementedYet('IExtensionHost.activate (no worker factory wired)');
  }

  // Kill-switch. Checked before the worker is spawned, so a blocked
  // extension never gets a process, a realm, or a single RPC.
  //
  // This refuses to *run* the extension; it does not uninstall it or touch its
  // data. The user keeps whatever they installed and can read why it will not
  // start - see `ExtensionBlocklistService` for why "refuse" rather than
  // VS Code's auto-uninstall.
  if (ctx.blocklist) {
    const blocked = ctx.blocklist.check(extensionId, entry.manifest.version);
    if (blocked) {
      const message = `Blocked: ${blocked.reason}${blocked.url ? ` (${blocked.url})` : ''}`;
      ctx.registry.setStatus(extensionId, 'failed', message);
      ctx.logger.appendLog(extensionId, { ts: Date.now(), level: 'error', message });
      throw new Error(
        `Extension ${extensionId}@${entry.manifest.version} is blocked and will not be started. ${blocked.reason}`,
      );
    }
  }

  // API versioning: reject any extension whose
  // `engines.bibleApp` range does not include the host's current
  // EXTENSION_API_VERSION before we spend a worker on it.
  const requiredRange = entry.manifest.engines?.bibleApp;
  if (!requiredRange || !semverSatisfies(Extensions.EXTENSION_API_VERSION, requiredRange)) {
    const message =
      `Extension ${extensionId} requires bibleApp ${requiredRange ?? '<missing>'} but host is ${Extensions.EXTENSION_API_VERSION}`;
    ctx.registry.setStatus(extensionId, 'failed', message);
    ctx.logger.appendLog(extensionId, {
      ts: Date.now(),
      level: 'error',
      message,
    });
    throw new Extensions.IncompatibleApiVersionError(message, {
      required: requiredRange,
      actual: Extensions.EXTENSION_API_VERSION,
    });
  }

  ctx.registry.setStatus(extensionId, 'loading');

  // Per-extension configurable memory cap. Read the manifest's
  // `runtime.maxMemoryMB` and clamp to [256, 1024].
  const DEFAULT_MAX_MEMORY_MB = 256;
  const MIN_MAX_MEMORY_MB = 256;
  const MAX_MAX_MEMORY_MB = 1024;
  const rawMemory = entry.manifest.runtime?.maxMemoryMB;
  const maxMemoryMB = rawMemory !== undefined
    ? Math.min(MAX_MAX_MEMORY_MB, Math.max(MIN_MAX_MEMORY_MB, rawMemory))
    : DEFAULT_MAX_MEMORY_MB;

  const worker = new ExtensionWorkerProcess(ctx.workerFactory, {
    extensionId,
    scriptPath: ctx.workerScriptPath,
    execArgv: [`--max-old-space-size=${maxMemoryMB}`],
    ...(ctx.workerHeartbeatIntervalMs !== undefined
      ? { heartbeatIntervalMs: ctx.workerHeartbeatIntervalMs }
      : {}),
    onExit: (info) => handleWorkerExit(ctx, extensionId, info),
  });

  let active: ActiveWorker | undefined;
  try {
    await worker.spawn();
    const router = new ExtensionRpcRouter(worker.getTransport(), {
      onRequestDispatch: (method) => {
        const a = ctx.activeWorkers.get(extensionId);
        if (a) a.lastRpcMethod = method;
      },
      onProtocolViolation: (v) => {
        ctx.logger.appendLog(extensionId, {
          ts: Date.now(),
          level: 'warn',
          message: `RPC protocol violation: ${v.reason}`,
          fields: { detail: v.detail },
        });
      },
      onResponseReceived: () => {
        const a = ctx.activeWorkers.get(extensionId);
        if (a) a.consecutiveTimeouts = 0;
      },
      // Uncaught errors + unhandled rejections reported by the worker's
      // `ExtensionErrorBoundary` on `__runtime.error`. The router must forward
      // these, or nothing an extension throws asynchronously reaches
      // `extension.log`.
      onRuntimeEvent: (channel, payload) => {
        // `__runtime.log` carries the extension's own `console.*` calls,
        // forwarded out of the QuickJS realm by the supervisor. Inside the realm
        // there is no stdio to write to, and the worker's stdout was never
        // captured anyway, so this is what makes `console.log` work for
        // extension authors at all.
        if (channel === RUNTIME_LOG_CHANNEL) {
          const entry = payload as { level?: string; message?: string } | undefined;
          const message = entry?.message ?? String(payload);
          ctx.logger.appendLog(extensionId, {
            ts: Date.now(),
            level: entry?.level === 'error' || entry?.level === 'warn' ? entry.level : 'info',
            message,
          });
          return;
        }
        if (channel !== RUNTIME_ERROR_CHANNEL) return;
        const detail = payload as
          | { source?: string; message?: string; stack?: string }
          | undefined;
        const source = detail?.source ?? 'unknown';
        const message = detail?.message ?? String(payload);
        ctx.logger.appendLog(extensionId, {
          ts: Date.now(),
          level: 'error',
          message: `Uncaught ${source}: ${message}`,
          fields: {
            source,
            ...(detail?.stack ? { stack: detail.stack } : {}),
          },
        });
        log.warn(`[ExtensionHost] ${extensionId} runtime error (${source}): ${message}`);
      },
      onTimeout: (method, timeoutMs) => {
        ctx.logger.appendLog(extensionId, {
          ts: Date.now(),
          level: 'warn',
          message: `Reverse RPC timeout: ${method} after ${timeoutMs}ms`,
        });
        const a = ctx.activeWorkers.get(extensionId);
        if (a) {
          a.consecutiveTimeouts++;
          if (a.consecutiveTimeouts >= ctx.crashThreshold) {
            log.warn(
              `[ExtensionHost] ${extensionId} hit ${a.consecutiveTimeouts} consecutive RPC timeouts — recording as crash`,
            );
            ctx.registry.recordCrash(extensionId);
          }
        }
      },
    });
    active = { worker, router, consecutiveTimeouts: 0 };

    attachApiImpls(ctx, extensionId, entry, router, active);

    ctx.activeWorkers.set(extensionId, active);

    // Send the init handshake. Mirrors the entry script's expected
    // `runtime.init` reverse RPC.
    const initPayload: Extensions.ExtensionInitPayload = {
      manifest: entry.manifest,
      // The worker resolves `manifest.main` against this - without it the
      // relative entry point resolves against the runtime bundle instead and
      // no on-disk extension can load. The worker also containment-checks the
      // result, so a hostile `main` cannot escape this directory.
      installPath: entry.installPath,
      grantedPermissions: entry.grantedPermissions,
      hostApiVersion: Extensions.EXTENSION_API_VERSION,
      hostMinSupportedApiVersion: '1.0.0',
      locale: 'en',
      hostFeatures: [] as string[],
    };
    await router.request('runtime.init', [initPayload], { timeoutMs: 10_000 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`[ExtensionHost] activate failed for ${extensionId}: ${message}`);
    ctx.registry.setStatus(extensionId, 'failed', message);
    ctx.logger.appendLog(extensionId, {
      ts: Date.now(),
      level: 'error',
      message: `Activate failed: ${message}`,
    });
    // Clean up any partial state.
    const partial = ctx.activeWorkers.get(extensionId);
    if (partial) {
      await disposeApiImpls(partial);
      partial.router.close();
      await partial.worker.terminate();
      ctx.activeWorkers.delete(extensionId);
    } else {
      // The api impls were attached to `active` but not yet stored in
      // `activeWorkers` if init failed before that line. They share the
      // router we're about to close, so cleanup them too.
      if (active) await disposeApiImpls(active);
      await worker.terminate();
    }
    throw err;
  }

  ctx.registry.setStatus(extensionId, 'active');
  ctx.logger.appendLog(extensionId, {
    ts: Date.now(),
    level: 'info',
    message: 'Activated',
  });

  // Notify all other active workers that this extension activated, so `extensions.onDidActivate` events fire.
  for (const [id, w] of ctx.activeWorkers) {
    if (id === extensionId) continue;
    w.extensionsApi?.emitDidActivate(extensionId);
  }
}

export async function deactivate(
  ctx: ExtensionHostContext,
  extensionId: string,
): Promise<void> {
  const active = ctx.activeWorkers.get(extensionId);
  if (!active) return;
  // Drop the L10n catalog before tearing down the worker so the renderer-side I18nService stops echoing it.
  try {
    ctx.l10nBridge?.dropExtensionCatalog?.(extensionId);
  } catch (err) {
    log.warn(`[ExtensionHost] dropExtensionCatalog(${extensionId}) failed:`, err);
  }
  // Clean up contribution registry entries for this extension before
  // disposing api-impls, so the registry is already
  // consistent when deactivation events fire.
  ctx.contributionRegistry.removeAllByExtension(extensionId);
  ctx.singleActiveProviderRegistry.removeAllByExtension(extensionId);

  // Drop renderer-side contributions before closing the router so the renderer
  // never sees a registration outlive its owning worker.
  await disposeApiImpls(active);
  active.router.close();
  await active.worker.terminate();
  ctx.activeWorkers.delete(extensionId);
  if (ctx.registry.has(extensionId)) {
    const entry = ctx.registry.getEntry(extensionId)!;
    ctx.registry.setStatus(extensionId, entry.enabled ? 'installed' : 'disabled');
  }
  ctx.logger.appendLog(extensionId, {
    ts: Date.now(),
    level: 'info',
    message: 'Deactivated',
  });

  // Notify remaining active workers that this extension deactivated, so `extensions.onDidDeactivate` events fire.
  for (const w of ctx.activeWorkers.values()) {
    w.extensionsApi?.emitDidDeactivate(extensionId);
  }
}

export async function fireActivationEvent(
  ctx: ExtensionHostContext,
  eventId: string,
): Promise<void> {
  // Walk every installed extension and activate the ones that subscribed to this event. Errors from one
  // extension never block the rest; they're logged and surfaced via the
  // registry status.
  for (const { id, entry } of ctx.registry.listEntries()) {
    if (!entry.enabled) continue;
    if (entry.status === 'auto-disabled') continue;
    if (ctx.activeWorkers.has(id)) continue;
    const events = entry.manifest.activationEvents ?? [];
    if (!events.includes(eventId)) continue;
    try {
      await ctx.activate(id);
    } catch (err) {
      log.warn(
        `[ExtensionHost] activate(${id}) failed for event ${eventId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

export async function dispatchExtensionPoint<TPayload, TReturn>(
  ctx: ExtensionHostContext,
  pointId: ExtensionPointId,
  payload: TPayload,
): Promise<TReturn> {
  // Event-kind hooks: fan out to every active worker that subscribed via
  // `api.events.subscribe(pointId, ...)`. The router only emits if there
  // is at least one subscription on the channel, so this stays cheap when
  // no one cares. Filter / provider hooks (T2/T3) will land their own
  // request/response shapes here in follow-up chunks.
  for (const active of ctx.activeWorkers.values()) {
    try {
      active.router.emitEvent(pointId, payload);
    } catch (err) {
      log.warn(
        `[ExtensionHost] dispatchExtensionPoint(${pointId}) failed for one worker:`,
        err,
      );
    }
  }
  return undefined as unknown as TReturn;
}

export function handleWorkerExit(
  ctx: ExtensionHostContext,
  extensionId: string,
  info: WorkerExitInfo,
): void {
  const active = ctx.activeWorkers.get(extensionId);
  const lastRpcMethod = active?.lastRpcMethod;
  if (active) {
    // Crash path - fire-and-forget the dispose. The router is already
    // dead from the worker exit, so the task drain has nothing to wait
    // on; we just want best-effort observer cleanup.
    void disposeApiImpls(active);
    active.router.close();
    ctx.activeWorkers.delete(extensionId);
  }

  // A clean exit (code === 0, not killed) is just deactivation - no crash.
  const isCrash = info.code !== 0 || info.hung;
  if (!isCrash) {
    if (ctx.registry.has(extensionId)) {
      const entry = ctx.registry.getEntry(extensionId)!;
      // Don't clobber a worker-owned status (failed/auto-disabled) that
      // was set in the activate() catch block before the worker had a
      // chance to exit cleanly.
      if (entry.status !== 'failed' && entry.status !== 'auto-disabled') {
        ctx.registry.setStatus(extensionId, entry.enabled ? 'installed' : 'disabled');
      }
    }
    return;
  }

  // Record the crash.
  ctx.logger.appendCrash(extensionId, {
    ts: Date.now(),
    exitCode: info.code,
    stderrTail: info.stderrTail,
    ...(lastRpcMethod ? { lastRpcMethod } : {}),
  });

  const count = ctx.registry.recordCrash(extensionId);
  log.warn(
    `[ExtensionHost] worker for ${extensionId} exited (code=${info.code}, hung=${info.hung}) — crash #${count}`,
  );

  if (count >= ctx.crashThreshold) {
    ctx.registry.setStatus(extensionId, 'auto-disabled', `crash-loop (${count} crashes)`);
    ctx.logger.appendLog(extensionId, {
      ts: Date.now(),
      level: 'error',
      message: `Auto-disabled after ${count} crashes`,
    });
  } else {
    ctx.registry.setStatus(extensionId, 'failed', `crashed (exit=${info.code})`);
    ctx.logger.appendLog(extensionId, {
      ts: Date.now(),
      level: 'error',
      message: `Crashed (exit=${info.code}, hung=${info.hung})`,
    });
  }
}

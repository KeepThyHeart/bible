/**
 * Worker lifecycle + activation/deactivation + crash handling for
 * `ExtensionHost`.
 *
 * Covers:
 *   - `activate` (spawn worker, install replay hooks, delegate api-impl
 *     wiring to `ExtensionHostRpc.attachApiImpls`, run the init handshake,
 *     roll back on failure).
 *   - `deactivate` (tear the worker down + notify `extension.deactivated`
 *     subscribers).
 *   - `fireActivationEvent` (activation-event fan-out).
 *   - `handleWorkerExit` (crash accounting + auto-disable).
 *
 * RPC namespace wiring lives in `ExtensionHostRpc.ts`. The extension-point
 * dispatcher itself (`dispatchExtensionPoint`, covering all three channel
 * kinds), the bridge-sourced wiring that calls it, and the replay-hook
 * installer used below all live in `ExtensionPointWiring.ts` - re-exported
 * from here so `ExtensionHost.dispatchExtensionPoint` (the public method
 * other host subsystems and tests call) does not need to know it moved.
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
import { installReplayHooks } from './ExtensionPointWiring';

export { dispatchExtensionPoint } from './ExtensionPointWiring';

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

    // Install the replay-on-subscribe hooks for this worker's router before
    // any api-impl attaches - `EXTENSION_POINT_REPLAY` channels (currently
    // just `verse.activeChanged`) must be able to answer the very first
    // subscribe this worker sends, including one sent during `activate()`.
    installReplayHooks(ctx, router);

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
      // No dual-support window exists yet (see EXTENSION_API_VERSION's doc
      // comment - retrograded to 0.1.0, pre-release) - the host supports
      // exactly the one version it serves.
      hostMinSupportedApiVersion: Extensions.EXTENSION_API_VERSION,
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

  // Notify all other active workers that this extension activated, so
  // `extension.activated` (`api.events.subscribe`) subscribers fire. Fired
  // directly here rather than through the generic `dispatchExtensionPoint`
  // fan-out below: the newly-activated worker is deliberately excluded (its
  // own activation is not news to it, and its replay hooks/subscriptions may
  // not exist yet at this exact tick), which the generic dispatcher's
  // `subscribers()` has no way to express.
  for (const [id, w] of ctx.activeWorkers) {
    if (id === extensionId) continue;
    try {
      w.router.emitEvent('extension.activated', { extensionId });
    } catch (err) {
      log.warn(`[ExtensionHost] extension.activated notify failed for ${id}:`, err);
    }
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

  // Notify remaining active workers that this extension deactivated, so
  // `extension.deactivated` (`api.events.subscribe`) subscribers fire.
  for (const [id, w] of ctx.activeWorkers) {
    try {
      w.router.emitEvent('extension.deactivated', { extensionId });
    } catch (err) {
      log.warn(`[ExtensionHost] extension.deactivated notify failed for ${id}:`, err);
    }
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

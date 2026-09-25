/**
 * Extension-point dispatch and bridge-sourced wiring.
 *
 * Task 0024 round 3 (P0.3) replaced the old `onDid*` properties and the
 * dead `ExtensionPointId` vocabulary with one dispatcher, `dispatchExtensionPoint`,
 * covering all three channel kinds (event/filter/provider - see
 * `EXTENSION_POINT_KINDS` in `ExtensionPointTypes.ts`), and moved every
 * bridge subscription that used to live one-per-worker inside an api-impl's
 * `attach()` into this single host-level module, which subscribes to each
 * bridge **once** and fans a change out to every active worker.
 *
 * Three things live here:
 *
 *   - `dispatchExtensionPoint(ctx, pointId, payload)` - the dispatcher
 *     itself. Called by `ExtensionPointWiring`'s own bridge subscriptions
 *     below, by the three IPC call sites (`notesHandlers.ts`,
 *     `crossReferenceHandlers.ts`, `searchHandlers.ts`), and re-exported
 *     from `ExtensionHostLifecycle.ts` for `ExtensionHost.dispatchExtensionPoint`
 *     (the public method other host subsystems and tests call).
 *   - `wireExtensionPoints(ctx)` - call once, when the host is constructed.
 *     Subscribes to every bridge that backs a host-emitted channel
 *     (bible, notes, highlights, l10n, workspace). A bridge that was never
 *     supplied (e.g. `notesBridge`/`highlightsBridge` are not wired in
 *     production today - see `main.ts`) simply means that channel never
 *     fires, which the dispatcher's zero-subscriber rules already handle
 *     correctly.
 *   - `installReplayHooks(ctx, router)` - call once per worker, right after
 *     its `ExtensionRpcRouter` is constructed (see
 *     `ExtensionHostLifecycle.activate`). Registers a `router.onSubscribe`
 *     hook for every `EXTENSION_POINT_REPLAY` channel, so a subscriber -
 *     including one that subscribes during its own `activate()` - is
 *     replayed the current value immediately rather than waiting for the
 *     next change.
 *
 * Not wired here: `settings.changed` (deliberately - see
 * `storageApiImpl.ts`'s `notifySettingsChanged`, which fires it only to the
 * *owning* worker, not through this module's host-wide fan-out - settings
 * are private to the extension that owns them, and this dispatcher has no
 * per-worker targeting) and `extension.activated`/`extension.deactivated`
 * (fired directly from `ExtensionHostLifecycle.activate`/`deactivate`,
 * which need to exclude the extension the event is *about*, which this
 * dispatcher's all-active-workers fan-out cannot express).
 */

import log from 'electron-log';

import { Extensions } from '@bible/core';

import type { ExtensionHostContext } from './ExtensionHostTypes';
import type { ExtensionRpcRouter } from './ExtensionRpcRouter';

type ExtensionPointId = Extensions.ExtensionPointId;
type ExtensionPointKind = Extensions.ExtensionPointKind;

// --- Dispatch ---------------------------------------------------------

interface DispatchSubscriber {
  extensionId: string;
  router: ExtensionRpcRouter;
  order: number;
}

/**
 * Every active worker subscribed to `pointId`, permission-filtered and
 * sorted by `(order, extensionId)` - the order the filter waterfall and
 * provider collection both consume. A worker whose grant lacks the
 * channel's `EXTENSION_POINT_PERMISSIONS` entry (if any) is skipped
 * entirely: gating here, at dispatch time, rather than at `subscribe` time,
 * means a grant that changes later takes effect immediately and a subscribe
 * call never itself fails on a missing permission.
 */
function subscribers(ctx: ExtensionHostContext, pointId: ExtensionPointId): DispatchSubscriber[] {
  const requiredPermission = Extensions.EXTENSION_POINT_PERMISSIONS[pointId];
  const out: DispatchSubscriber[] = [];
  for (const [extensionId, active] of ctx.activeWorkers) {
    if (!active.router.hasSubscription(pointId)) continue;
    if (requiredPermission) {
      const granted = ctx.registry.getEntry(extensionId)?.grantedPermissions ?? [];
      if (!granted.includes(requiredPermission)) continue;
    }
    const order = active.router.getSubscriptionOrder(pointId) ?? Extensions.ORDER_DEFAULT;
    out.push({ extensionId, router: active.router, order });
  }
  out.sort(
    (a, b) => a.order - b.order || (a.extensionId < b.extensionId ? -1 : a.extensionId > b.extensionId ? 1 : 0),
  );
  return out;
}

function timeoutFor(pointId: ExtensionPointId, fallback: number): number {
  return Extensions.EXTENSION_POINT_TIMEOUT_MS_OVERRIDE[pointId] ?? fallback;
}

/**
 * Dispatch one host-emitted extension point to every subscribed, permitted
 * active worker, per `EXTENSION_POINT_KINDS[pointId]`:
 *
 *   - **event** - fire-and-forget, parallel (the host does not await), a
 *     throw is logged and skipped.
 *   - **filter** - sequential waterfall over `subscribers()`, time-boxed per
 *     subscriber and in total; `EXTENSION_POINT_CANCELABLE` channels
 *     short-circuit on the first `'cancel'`, others thread a transformed
 *     payload through. A throw or timeout is skipped, never treated as
 *     `'cancel'` - hooks fail open.
 *   - **provider** - parallel, each individually time-boxed, results
 *     concatenated in subscriber order up to `PROVIDER_MAX_ITEMS`.
 *
 * The zero-subscriber cases fall out of the same code paths (an empty
 * `subscribers()` array), so no call site needs a "were there any
 * extensions?" branch: event returns `undefined`, a cancelable filter
 * returns `'continue'`, a transform filter returns the payload unchanged,
 * and a provider returns `[]`.
 */
export async function dispatchExtensionPoint<K extends ExtensionPointId>(
  ctx: ExtensionHostContext,
  pointId: K,
  payload: Extensions.ExtensionPointPayloadMap[K],
): Promise<Extensions.ExtensionPointReturnMap[K]> {
  const kind: ExtensionPointKind = Extensions.EXTENSION_POINT_KINDS[pointId];
  const subs = subscribers(ctx, pointId);

  if (kind === 'event') {
    for (const s of subs) {
      try {
        s.router.emitEvent(pointId, payload);
      } catch (err) {
        log.warn(`[ExtensionHost] dispatchExtensionPoint(${pointId}) failed for ${s.extensionId}:`, err);
      }
    }
    return undefined as Extensions.ExtensionPointReturnMap[K];
  }

  if (kind === 'filter') {
    const cancelable = Extensions.EXTENSION_POINT_CANCELABLE.has(pointId);
    const perSubscriberTimeoutMs = timeoutFor(pointId, Extensions.FILTER_PER_SUBSCRIBER_TIMEOUT_MS);
    const deadline = Date.now() + Extensions.FILTER_TOTAL_BUDGET_MS;
    let current: unknown = payload;
    for (const s of subs) {
      if (Date.now() >= deadline) {
        log.warn(`[ExtensionHost] dispatchExtensionPoint(${pointId}): filter budget exhausted, skipping remaining subscribers`);
        break;
      }
      let result: unknown;
      try {
        result = await s.router.request(`hook:${pointId}`, [current], { timeoutMs: perSubscriberTimeoutMs });
      } catch (err) {
        // Fail open: a throwing or timed-out subscriber is skipped, never
        // treated as 'cancel' - see EXTENSION_POINT_CANCELABLE's doc comment.
        log.warn(`[ExtensionHost] dispatchExtensionPoint(${pointId}) subscriber ${s.extensionId} failed:`, err);
        continue;
      }
      if (cancelable) {
        if (result === 'cancel') {
          return 'cancel' as Extensions.ExtensionPointReturnMap[K];
        }
        continue;
      }
      if (result !== undefined && result !== null) current = result;
    }
    return (cancelable ? 'continue' : current) as Extensions.ExtensionPointReturnMap[K];
  }

  // provider
  const perSubscriberTimeoutMs = timeoutFor(pointId, Extensions.PROVIDER_PER_SUBSCRIBER_TIMEOUT_MS);
  const settled = await Promise.allSettled(
    subs.map((s) => s.router.request(`hook:${pointId}`, [payload], { timeoutMs: perSubscriberTimeoutMs })),
  );
  const out: unknown[] = [];
  outer: for (let i = 0; i < settled.length; i++) {
    const result = settled[i]!;
    const s = subs[i]!;
    if (result.status === 'rejected') {
      log.warn(`[ExtensionHost] dispatchExtensionPoint(${pointId}) subscriber ${s.extensionId} failed:`, result.reason);
      continue;
    }
    if (!Array.isArray(result.value)) {
      log.warn(`[ExtensionHost] dispatchExtensionPoint(${pointId}) subscriber ${s.extensionId} returned a non-array; contribution dropped`);
      continue;
    }
    for (const item of result.value) {
      out.push(item);
      if (out.length >= Extensions.PROVIDER_MAX_ITEMS) {
        log.warn(`[ExtensionHost] dispatchExtensionPoint(${pointId}): PROVIDER_MAX_ITEMS exceeded, truncating`);
        break outer;
      }
    }
  }
  return out as Extensions.ExtensionPointReturnMap[K];
}

// --- Bridge-sourced wiring ----------------------------------------------

/**
 * How to read a replay channel's "current value" synchronously. One entry
 * per `EXTENSION_POINT_REPLAY` member - `installReplayHooks` throws at
 * worker-activation time if a replay channel has no registered source here,
 * rather than silently replaying nothing.
 */
const REPLAY_SOURCES: Partial<Record<ExtensionPointId, (ctx: ExtensionHostContext) => unknown>> = {
  'verse.activeChanged': (ctx) => ctx.bibleBridge?.getActiveVerse?.() ?? null,
};

function safeDispatch<K extends ExtensionPointId>(
  ctx: ExtensionHostContext,
  pointId: K,
  payload: Extensions.ExtensionPointPayloadMap[K],
): void {
  void dispatchExtensionPoint(ctx, pointId, payload).catch((err: unknown) => {
    log.warn(`[ExtensionPointWiring] dispatchExtensionPoint(${pointId}) failed:`, err);
  });
}

/**
 * Subscribe every bridge-sourced extension point once, for the lifetime of
 * the host. Returns a disposer that unsubscribes everything - call it when
 * the host is torn down.
 */
export function wireExtensionPoints(ctx: ExtensionHostContext): () => void {
  const disposers: Array<() => void> = [];

  const bible = ctx.bibleBridge;
  if (bible) {
    disposers.push(
      bible.subscribeActiveVerse((payload) => {
        safeDispatch(ctx, 'verse.activeChanged', payload);
      }),
    );
    disposers.push(
      bible.subscribeWordSelection((payload) => {
        safeDispatch(ctx, 'verse.wordSelected', payload);
      }),
    );
  }

  const notes = ctx.notesBridge;
  if (notes) {
    disposers.push(
      notes.subscribeChange((payload) => {
        safeDispatch(ctx, 'notes.changed', payload);
      }),
    );
  }

  const highlights = ctx.highlightsBridge;
  if (highlights) {
    disposers.push(
      highlights.subscribeChange((payload) => {
        safeDispatch(ctx, 'highlights.afterChange', payload);
      }),
    );
  }

  const l10n = ctx.l10nBridge;
  if (l10n) {
    disposers.push(
      l10n.subscribeLocaleChange((locale) => {
        safeDispatch(ctx, 'locale.changed', { locale });
      }),
    );
  }

  const workspace = ctx.workspaceBridge;
  if (workspace) {
    disposers.push(
      workspace.subscribeOpenPanel((panel) => {
        safeDispatch(ctx, 'panel.opened', panel);
      }),
    );
    disposers.push(
      workspace.subscribeClosePanel((info) => {
        safeDispatch(ctx, 'panel.closed', info);
      }),
    );
    disposers.push(
      workspace.subscribeActivePanel((panel) => {
        safeDispatch(ctx, 'panel.focused', panel);
      }),
    );
  }

  return () => {
    for (const d of disposers) {
      try {
        d();
      } catch {
        /* best-effort */
      }
    }
  };
}

/**
 * Install the replay-on-subscribe hooks for one worker's freshly-constructed
 * router. Call once per activation, before any api-impl attaches (so a
 * subscribe sent during the extension's own `activate()` is already
 * answerable).
 */
export function installReplayHooks(ctx: ExtensionHostContext, router: ExtensionRpcRouter): void {
  for (const channel of Extensions.EXTENSION_POINT_REPLAY) {
    const source = REPLAY_SOURCES[channel];
    if (!source) {
      // A channel in EXTENSION_POINT_REPLAY with no registered source here
      // is exactly the drift `ApiSurfaceContract.test.ts` exists to catch
      // before it ships - fail loudly rather than replay nothing.
      throw new Error(
        `ExtensionPointWiring: '${channel}' is in EXTENSION_POINT_REPLAY but has no registered replay source`,
      );
    }
    router.onSubscribe(channel, () => {
      const current = source(ctx);
      if (current !== null && current !== undefined) {
        router.emitEvent(channel, current);
      }
    });
  }
}

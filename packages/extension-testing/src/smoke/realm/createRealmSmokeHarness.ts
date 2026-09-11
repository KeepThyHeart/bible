/**
 * Realm-mode smoke harness (Phase 3.2).
 *
 * Produces the same `SmokeHarness` interface as `createSmokeHarness`, so
 * `runSmokeSuite`, the corpora, the interceptors and the reporters all work
 * against it unchanged. The difference is where the extension's code runs:
 * in-process mode calls `activate(api)` in Node with the mock API passed
 * directly, this runs the extension's *bundle* inside a QuickJS realm and
 * speaks the real RPC protocol to it.
 *
 * ── Why both modes exist ────────────────────────────────────────────────────
 * The mock path is fast and is the right default for unit tests: no bundling,
 * no engine, and the extension's `activate` is an ordinary function call.
 * But it also gives the extension a Node realm — `require`, `process`,
 * `Buffer` and the filesystem all work — so an extension that depends on any
 * of them passes in-process and fails once installed. Realm mode is where
 * that discrepancy surfaces, along with everything else the boundary changes:
 * argument serialization, error revival, and permission denials arriving as
 * RPC error payloads rather than thrown objects.
 *
 * ── How the mock is reused across the boundary ──────────────────────────────
 * Guest→host `request` envelopes are routed back onto the same mock API
 * object the in-process harness would have handed over (see `apiDispatch`),
 * which is what lets `createRecordingApi` capture registrations and
 * `installPermissionAndNetworkInterceptors` enforce permissions in both
 * modes from one implementation.
 *
 * Event subscriptions are the exception: in the realm the extension does not
 * call `api.bible.onDidChangeActiveVerse.subscribe(...)` on the mock at all —
 * it sends a `subscribe` envelope. The harness registers a synthetic
 * subscriber for that channel so hook enumeration and invocation see the same
 * shape they see in-process.
 */

import { readFileSync } from 'node:fs';
import { resolve as resolvePath, basename } from 'node:path';

import type { Extensions } from '@bible/core';

import type { MockApiOverrides } from '../../createMockApi';
import { createRecordingApi } from '../recordingApi';
import { enumerateHooks } from '../enumerateHooks';
import { loadManifest } from '../loadManifest';
import { InProcessHookInvoker, type InvokeOptions } from '../hookInvoker';
import type {
  CapturedRegistrations,
  HookDescriptor,
  HookInvocationResult,
} from '../types';
import type { SmokeHarness } from '../createSmokeHarness';
import { dispatchToApi } from './apiDispatch';
import { RealmHookInvoker, type RealmEndpointOutcome } from './RealmHookInvoker';
import type { RealmFactory, RealmRuntimeError, RealmSession } from './types';

type BibleExtensionAPI = Extensions.BibleExtensionAPI;
type ExtensionManifest = Extensions.ExtensionManifest;
type ExtensionPermission = Extensions.ExtensionPermission;
type RpcEnvelope = Extensions.RpcEnvelope;
type RpcRequest = Extensions.RpcRequest;
type RpcResponse = Extensions.RpcResponse;
type RpcEvent = Extensions.RpcEvent;
type RpcSubscribe = Extensions.RpcSubscribe;
type RpcUnsubscribe = Extensions.RpcUnsubscribe;

/** Channel prefix the guest runtime uses for its own out-of-band reports. */
const RUNTIME_CHANNEL_PREFIX = '__runtime.';
const RUNTIME_ERROR_CHANNEL = '__runtime.error';

const INIT_REQUEST_ID = 'smoke-realm-init';
/** Prefix for the host→guest reverse-RPC requests this harness issues. */
const ENDPOINT_REQUEST_PREFIX = 'smoke-endpoint-';
/**
 * The error `ExtensionRuntime.handleReverseRequest` answers with when its
 * reverse-handler table has no entry for the requested method. Matching on it
 * is what lets the harness tell "your handler failed" apart from "you never
 * bound a handler", which are opposite verdicts in the smoke report.
 */
const UNKNOWN_REVERSE_METHOD = 'Unknown reverse RPC method';
const DEFAULT_ACTIVATE_TIMEOUT_MS = 15_000;
const DEFAULT_DRAIN_TIMEOUT_MS = 10_000;

/**
 * Consecutive idle macrotask ticks that count as "the guest has stopped
 * talking". One is not enough: a guest handler that awaits a host call
 * produces a gap while the host's promise settles, and stopping there would
 * cut the turn short.
 */
const IDLE_TICKS_TO_SETTLE = 2;

export interface RealmSmokeHarnessOptions {
  /** Absolute path to the extension package root. Required unless `manifest` + `entrySource` are given. */
  extensionRoot?: string;
  /** Pre-loaded manifest, for callers that do not want disk I/O. */
  manifest?: ExtensionManifest;
  /** Bundle source to run. Defaults to reading `manifest.main` under `extensionRoot`. */
  entrySource?: string;
  /** Filename shown in guest stack traces. Defaults to the basename of `manifest.main`. */
  entryFilename?: string;
  /** Supplies the realm. See `RealmFactory` for why this is injected. */
  realmFactory: RealmFactory;
  /** Override specific API methods on top of the recording mock. */
  apiOverrides?: MockApiOverrides;
  /** Outer bound on the whole activation round trip. Default 15000 ms. */
  activateTimeoutMs?: number;
  /**
   * Permissions to grant in the init payload. Defaults to everything the
   * manifest declares, which is what a user who approved the install would
   * have granted. Pass a narrower set to smoke-test partial approval.
   */
  grantedPermissions?: readonly ExtensionPermission[];
  /** Locale handed to the extension. Default `'en'`. */
  locale?: string;
  /** Host capability flags. Default none. */
  hostFeatures?: readonly string[];
  /** Host API version reported to the extension. Defaults to the manifest's `apiVersion`, else `'1.0.0'`. */
  hostApiVersion?: string;
}

/** A realm-backed harness, plus the realm-only observations worth asserting on. */
export interface RealmSmokeHarness extends SmokeHarness {
  /** Everything the guest reported on `__runtime.error`, in order. */
  runtimeErrors(): readonly RealmRuntimeError[];
  /** Every `console.*` call made inside the realm. */
  logs(): readonly { level: string; args: unknown[] }[];
  /** Channels the guest subscribed to, in subscription order. */
  subscribedChannels(): readonly string[];
  /** Every envelope the guest sent, for tests that need the raw protocol. */
  sentEnvelopes(): readonly RpcEnvelope[];
}

export function createRealmSmokeHarness(
  opts: RealmSmokeHarnessOptions,
): RealmSmokeHarness {
  const resolved = resolveEntry(opts);
  const { api, captured } = createRecordingApi(opts.apiOverrides);
  // No endpoint table is handed to the in-process invoker on purpose: in realm
  // mode the extension's `runtime.expose` calls never reach the host-side
  // mock, they bind inside the guest. Endpoint hooks go over the wire instead,
  // through `callEndpoint` below.
  const eventInvoker = new InProcessHookInvoker(captured);
  const invoker = new RealmHookInvoker(eventInvoker, (endpoint, args, timeoutMs) =>
    callEndpoint(endpoint, args, timeoutMs),
  );
  const activateTimeoutMs = opts.activateTimeoutMs ?? DEFAULT_ACTIVATE_TIMEOUT_MS;

  const inbox: RpcEnvelope[] = [];
  const sent: RpcEnvelope[] = [];
  const runtimeErrors: RealmRuntimeError[] = [];
  const logs: { level: string; args: unknown[] }[] = [];
  const subscribedChannels: string[] = [];
  /** `subscribe` id → channel, so `unsubscribe` can find what to remove. */
  const subscriptions = new Map<string, string>();
  let fatal: string | undefined;

  let realm: RealmSession | undefined;
  let active = false;
  let hooks: HookDescriptor[] | null = null;

  function requireRealm(): RealmSession {
    if (!realm) throw new Error('RealmSmokeHarness: realm is not running');
    return realm;
  }

  // ── Envelope handling ─────────────────────────────────────────────────────

  async function handleEnvelope(env: RpcEnvelope): Promise<void> {
    switch (env.kind) {
      case 'request':
        await handleRequest(env);
        return;
      case 'subscribe':
        handleSubscribe(env);
        return;
      case 'unsubscribe':
        handleUnsubscribe(env);
        return;
      case 'event':
        handleEvent(env);
        return;
      case 'heartbeat':
        // Echo it. The guest's bootstrap treats a silent host as a hung host.
        requireRealm().deliver({ kind: 'heartbeat', ts: env.ts });
        return;
      case 'response':
        // Replies to host→guest requests: the init handshake and the
        // reverse-RPC endpoint calls `callEndpoint` issues. Nothing to do
        // here — every envelope the guest sends is already appended to
        // `sent`, and both waiters poll that by request id.
        return;
      default:
        return;
    }
  }

  async function handleRequest(req: RpcRequest): Promise<void> {
    const outcome = await dispatchToApi(api, req.method, req.args);
    const res: RpcResponse = {
      kind: 'response',
      id: req.id,
      ...(outcome.error !== undefined
        ? { error: outcome.error }
        : { result: outcome.result }),
    };
    if (realm) realm.deliver(res);
  }

  function handleSubscribe(sub: RpcSubscribe): void {
    subscriptions.set(sub.id, sub.channel);
    subscribedChannels.push(sub.channel);
    registerSyntheticSubscriber(sub.channel);
  }

  function handleUnsubscribe(unsub: RpcUnsubscribe): void {
    const channel = subscriptions.get(unsub.id);
    if (channel === undefined) return;
    subscriptions.delete(unsub.id);
    if (![...subscriptions.values()].includes(channel)) {
      captured.eventSubscribers.delete(channel);
    }
  }

  function handleEvent(env: RpcEvent): void {
    if (!env.channel.startsWith(RUNTIME_CHANNEL_PREFIX)) return;
    if (env.channel !== RUNTIME_ERROR_CHANNEL) return;
    const payload = env.payload as Partial<RealmRuntimeError> | null | undefined;
    runtimeErrors.push({
      source: typeof payload?.source === 'string' ? payload.source : 'unknown',
      message: typeof payload?.message === 'string' ? payload.message : String(env.payload),
      ...(typeof payload?.stack === 'string' ? { stack: payload.stack } : {}),
    });
  }

  /**
   * Give the channel a subscriber that pushes an event into the realm and
   * waits for the guest to go quiet.
   *
   * The guest never reports what its handler returned — event dispatch is
   * one-way — so a handler that throws is invisible except on the
   * `__runtime.error` channel. Any new entry that appears while this
   * invocation is in flight is attributed to it and rethrown, which is what
   * lets `runSmokeSuite` classify it as `threw` exactly as it would
   * in-process.
   */
  function registerSyntheticSubscriber(channel: string): void {
    if (captured.eventSubscribers.has(channel)) return;
    const handler = async (payload: unknown): Promise<void> => {
      const before = runtimeErrors.length;
      requireRealm().deliver({ kind: 'event', channel, payload });
      await drain(DEFAULT_DRAIN_TIMEOUT_MS);
      const raised = runtimeErrors.slice(before);
      const first = raised[0];
      if (first) {
        throw new Error(`${first.source}: ${first.message}`);
      }
    };
    captured.eventSubscribers.set(channel, [handler]);
  }

  // ── Pumping ───────────────────────────────────────────────────────────────

  /**
   * Process guest traffic until it stops, or until `until` is satisfied.
   *
   * `realm.deliver` runs guest code synchronously and drains the realm's own
   * microtasks, but answering a guest request is asynchronous on this side —
   * the mock returns a promise — and the guest may arm host-backed timers.
   * So the loop alternates between emptying the inbox and yielding a real
   * macrotask, and only concludes after several consecutive idle ticks.
   */
  async function drain(timeoutMs: number, until?: () => boolean): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let idleTicks = 0;
    for (;;) {
      if (fatal !== undefined) throw new Error(`realm reported a fatal error: ${fatal}`);
      let processed = false;
      while (inbox.length > 0) {
        const env = inbox.shift() as RpcEnvelope;
        processed = true;
        await handleEnvelope(env);
      }
      if (until?.() === true) return;
      idleTicks = processed ? 0 : idleTicks + 1;
      if (until === undefined && idleTicks >= IDLE_TICKS_TO_SETTLE) return;
      if (Date.now() > deadline) {
        throw new Error(
          until === undefined
            ? `realm did not go quiet within ${timeoutMs}ms`
            : `realm did not reach the expected state within ${timeoutMs}ms`,
        );
      }
      await tick();
    }
  }

  function initAcknowledged(): RpcResponse | undefined {
    return sent.find(
      (e): e is RpcResponse => e.kind === 'response' && e.id === INIT_REQUEST_ID,
    );
  }

  // ── Reverse RPC ───────────────────────────────────────────────────────────

  let nextEndpointRequest = 1;

  function responseFor(id: string): RpcResponse | undefined {
    return sent.find((e): e is RpcResponse => e.kind === 'response' && e.id === id);
  }

  /**
   * Call one of the extension's `api.runtime.expose(...)` endpoints, as the
   * host does when the user picks a command.
   *
   * This is a host→guest request, the mirror image of the guest→host traffic
   * `handleRequest` serves. The pump is the same `drain` loop, held open until
   * the guest's `response` for this id appears in `sent` — the guest may make
   * host calls of its own while its handler runs, and those have to be
   * answered before it can reply.
   *
   * The outcome is returned rather than thrown so `RealmHookInvoker` can keep
   * the three verdicts distinct: a handler that failed, an endpoint nothing
   * bound, and a realm that never answered are three different bugs.
   */
  async function callEndpoint(
    endpoint: string,
    args: readonly unknown[],
    timeoutMs: number,
  ): Promise<RealmEndpointOutcome> {
    if (!realm) {
      return { outcome: 'error', message: 'RealmSmokeHarness: realm is not running' };
    }
    const id = `${ENDPOINT_REQUEST_PREFIX}${nextEndpointRequest++}`;
    realm.deliver({ kind: 'request', id, method: endpoint, args: [...args] });
    try {
      await drain(timeoutMs, () => responseFor(id) !== undefined);
    } catch (err) {
      return {
        outcome: 'timeout',
        message: `endpoint "${endpoint}" did not answer within ${timeoutMs}ms: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
    const res = responseFor(id);
    if (!res) {
      return { outcome: 'timeout', message: `endpoint "${endpoint}" produced no response` };
    }
    if (res.error) {
      if (res.error.message.includes(UNKNOWN_REVERSE_METHOD)) {
        return { outcome: 'unbound', message: res.error.message };
      }
      return { outcome: 'error', message: `${res.error.code}: ${res.error.message}` };
    }
    return { outcome: 'result', value: res.result };
  }

  // ── SmokeHarness implementation ───────────────────────────────────────────

  return {
    async activate(): Promise<void> {
      if (active) {
        throw new Error('RealmSmokeHarness: activate() called while already active');
      }
      realm = await opts.realmFactory({
        extensionId: resolved.manifest.id,
        entrySource: resolved.entrySource,
        entryFilename: resolved.entryFilename,
        onSend: (envelope) => {
          const env = envelope as RpcEnvelope;
          if (!env || typeof env !== 'object') return;
          sent.push(env);
          inbox.push(env);
        },
        onLog: (level, args) => {
          logs.push({ level, args });
        },
        onFatal: (message) => {
          fatal = message;
        },
      });

      const payload: Extensions.ExtensionInitPayload = {
        manifest: resolved.manifest,
        installPath: resolved.installPath,
        grantedPermissions: [
          ...(opts.grantedPermissions ?? resolved.manifest.permissions ?? []),
        ] as ExtensionPermission[],
        hostApiVersion: opts.hostApiVersion ?? '1.0.0',
        hostMinSupportedApiVersion: '1.0.0',
        locale: opts.locale ?? 'en',
        hostFeatures: [...(opts.hostFeatures ?? [])],
      };

      requireRealm().deliver({
        kind: 'request',
        id: INIT_REQUEST_ID,
        method: 'runtime.init',
        args: [payload],
      });

      await drain(activateTimeoutMs, () => initAcknowledged() !== undefined);

      const ack = initAcknowledged();
      if (ack?.error) {
        throw new Error(`extension failed to activate in the realm: ${ack.error.message}`);
      }
      // Registrations issued during activate() are answered inside the loop
      // above, but a handler that fires afterwards still has traffic pending.
      await drain(DEFAULT_DRAIN_TIMEOUT_MS);

      active = true;
      hooks = enumerateHooks({ manifest: resolved.manifest, captured });
    },

    async deactivate(): Promise<void> {
      if (!active) return;
      active = false;
      const session = realm;
      if (session?.requestGuestDispose) {
        // Best effort, mirroring the realm's own contract: the extension's
        // `deactivate()` may issue unsubscribes or a final host call, but a
        // guest that misbehaves on the way out must not leave the realm alive.
        // The failure is recorded rather than swallowed, so a teardown bug is
        // still visible to whoever is reading the smoke report.
        try {
          session.requestGuestDispose();
          await drain(DEFAULT_DRAIN_TIMEOUT_MS);
        } catch (err) {
          runtimeErrors.push({
            source: 'deactivate',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
      session?.dispose();
      realm = undefined;
    },

    enumerate(): HookDescriptor[] {
      return hooks ?? enumerateHooks({ manifest: resolved.manifest });
    },

    async invokeHook(
      hookId: string,
      input: unknown,
      invokeOpts?: InvokeOptions,
    ): Promise<HookInvocationResult> {
      const list = hooks ?? enumerateHooks({ manifest: resolved.manifest, captured });
      const hook = list.find((h) => h.hookId === hookId);
      if (!hook) {
        throw new Error(`RealmSmokeHarness: no hook with id "${hookId}"`);
      }
      return invoker.invoke(hook, input, invokeOpts);
    },

    getApi(): BibleExtensionAPI {
      return api;
    },

    getCaptured(): CapturedRegistrations {
      return captured;
    },

    getManifest(): ExtensionManifest {
      return resolved.manifest;
    },

    isActive(): boolean {
      return active;
    },

    runtimeErrors: () => runtimeErrors,
    logs: () => logs,
    subscribedChannels: () => subscribedChannels,
    sentEnvelopes: () => sent,
  };
}

// ── Entry resolution ────────────────────────────────────────────────────────

interface ResolvedEntry {
  manifest: ExtensionManifest;
  entrySource: string;
  entryFilename: string;
  installPath: string;
}

function resolveEntry(opts: RealmSmokeHarnessOptions): ResolvedEntry {
  if (opts.extensionRoot !== undefined) {
    const loaded = loadManifest(opts.extensionRoot);
    const manifest = loaded.manifest;
    if (opts.entrySource !== undefined) {
      return {
        manifest,
        entrySource: opts.entrySource,
        entryFilename: opts.entryFilename ?? `${manifest.id}/main.js`,
        installPath: loaded.extensionRoot,
      };
    }
    if (!manifest.main) {
      throw new Error(
        `Extension "${manifest.id}" has no manifest.main; supply opts.entrySource to run it.`,
      );
    }
    const entryPath = resolvePath(loaded.extensionRoot, manifest.main);
    return {
      manifest,
      entrySource: readFileSync(entryPath, 'utf8'),
      entryFilename: opts.entryFilename ?? basename(entryPath),
      installPath: loaded.extensionRoot,
    };
  }
  if (!opts.manifest || opts.entrySource === undefined) {
    throw new Error(
      'createRealmSmokeHarness: supply either `extensionRoot` or both `manifest` and `entrySource`.',
    );
  }
  return {
    manifest: opts.manifest,
    entrySource: opts.entrySource,
    entryFilename: opts.entryFilename ?? `${opts.manifest.id}/main.js`,
    installPath: opts.manifest.id,
  };
}

function tick(): Promise<void> {
  return new Promise((resolve) => {
    const handle = setTimeout(resolve, 0);
    (handle as unknown as { unref?: () => void }).unref?.();
  });
}

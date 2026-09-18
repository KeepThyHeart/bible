/**
 * Routes an `RpcRequest` from inside the realm to the harness's mock API.
 *
 * In-process mode hands the extension the mock API object directly, so a call
 * to `api.bible.getVerse(id)` *is* a call on the mock. Across the realm
 * boundary the same call arrives as `{ method: 'bible.getVerse', args: [id] }`
 * and something has to turn that string back into an invocation. That is this
 * file, and it is the whole reason realm mode can reuse the existing mock,
 * interceptors, recording layer and assertion engine unchanged.
 *
 * Two behaviours are copied from the real host on purpose, because a harness
 * that is more permissive than production teaches authors the wrong thing:
 *
 *   - An unresolvable method answers with `RpcProtocolError`, not a crash.
 *   - Registrations answer with `{ disposalId }` rather than the mock's
 *     in-process `DisposableHandle`, since a function cannot cross the wire.
 */

import { Extensions } from '@bible/core';

type BibleExtensionAPI = Extensions.BibleExtensionAPI;
type RpcErrorPayload = Extensions.RpcErrorPayload;

/**
 * Namespaces the API proxy will ever address. Dispatch is a lookup driven by
 * a string that came out of untrusted extension code, so the root is an
 * allowlist rather than a bare property read — otherwise `constructor.name`
 * and friends are reachable through the same path.
 */
const NAMESPACES: ReadonlySet<string> = new Set([
  'bible',
  'commentary',
  'book',
  'dictionary',
  'notes',
  'highlights',
  'bookmarks',
  'collections',
  'commands',
  'ui',
  'workspace',
  'context',
  'storage',
  'l10n',
  'events',
  'network',
  'auth',
  'tasks',
  'extensions',
  'ai',
]);

/** Property names that must never be traversed, whatever the allowlist says. */
const FORBIDDEN_SEGMENTS: ReadonlySet<string> = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

export interface DispatchResult {
  result?: unknown;
  error?: RpcErrorPayload;
}

/**
 * Resolve and call `method` on `api`.
 *
 * `api` is read fresh on every call rather than captured, because
 * `installPermissionAndNetworkInterceptors` swaps methods on the object
 * in place. Caching a bound function here would route around the very
 * enforcement realm mode exists to exercise.
 */
export async function dispatchToApi(
  api: BibleExtensionAPI,
  method: string,
  args: readonly unknown[],
): Promise<DispatchResult> {
  const target = resolveMethod(api, method);
  if (!target) {
    return {
      error: {
        code: 'RpcProtocolError',
        message: `Unknown RPC method: ${method}`,
      },
    };
  }
  try {
    const value: unknown = await target.fn.apply(target.self, args as unknown[]);
    return { result: toWireResult(value) };
  } catch (err) {
    return { error: toErrorPayload(err) };
  }
}

interface ResolvedMethod {
  self: unknown;
  fn: (...args: unknown[]) => unknown;
}

function resolveMethod(api: BibleExtensionAPI, method: string): ResolvedMethod | undefined {
  const segments = method.split('.');
  // `storage.db.query` is three deep; nothing in the API is deeper, and a
  // single segment is never a method (it would address a namespace object).
  if (segments.length < 2 || segments.length > 3) return undefined;
  const [root] = segments;
  if (root === undefined || !NAMESPACES.has(root)) return undefined;

  let self: unknown = api as unknown as Record<string, unknown>;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i] as string;
    if (FORBIDDEN_SEGMENTS.has(segment)) return undefined;
    if (self === null || typeof self !== 'object') return undefined;
    self = (self as Record<string, unknown>)[segment];
  }
  const last = segments[segments.length - 1] as string;
  if (FORBIDDEN_SEGMENTS.has(last)) return undefined;
  if (self === null || typeof self !== 'object') return undefined;
  const fn = (self as Record<string, unknown>)[last];
  if (typeof fn !== 'function') return undefined;
  return { self, fn: fn as (...a: unknown[]) => unknown };
}

/**
 * The mock resolves registrations with an in-process `DisposableHandle`
 * (`{ dispose() }`). The real host cannot send a function, so it answers with
 * `{ disposalId }` and keeps the disposer on its own side — see
 * `uiApiImpl.handleRegisterPanelType`. Mirror that, so an extension that
 * mishandles the registration result fails here the way it would in the app
 * rather than passing the smoke run and breaking once installed.
 */
let nextDisposalId = 1;

function toWireResult(value: unknown): unknown {
  if (isDisposableHandle(value)) {
    return { disposalId: `smoke-${nextDisposalId++}` };
  }
  return value;
}

function isDisposableHandle(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { dispose?: unknown }).dispose === 'function'
  );
}

function toErrorPayload(err: unknown): RpcErrorPayload {
  if (err instanceof Extensions.ExtensionApiError) {
    return {
      code: err.code,
      message: err.message,
      ...(err.data !== undefined ? { data: err.data } : {}),
    };
  }
  if (err instanceof Error) {
    return { code: err.name || 'Error', message: err.message };
  }
  return { code: 'Error', message: String(err) };
}

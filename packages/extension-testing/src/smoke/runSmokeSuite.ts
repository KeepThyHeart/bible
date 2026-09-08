/**
 * Assertion engine for Work Item 3.
 *
 * Runs an activated `SmokeHarness` against a `SmokeCorpus` and produces a
 * `SmokeSuiteResult`. For every hook × every input it asserts:
 *
 *   1. No uncaught throw (`threw`).
 *   2. Hook returns inside the per-hook timeout (`timeout`).
 *   3. Return value matches the hook's declared DTO shape where one exists
 *      (`invalid-return`). Item 8 can wire a real per-hook validator; the
 *      default enforces "event subscribers return undefined" and delegates
 *      everything else to a caller-supplied `returnValidators` map.
 *   4. No permission violation surfaces (`permission-violation`). The host's
 *      `PermissionDeniedError` is re-thrown by `permissionGuardProxy()` when
 *      an extension touches a namespace whose declared permission is absent
 *      from `manifest.permissions`.
 *   5. No unexpected network call (`unexpected-network`). Every `network.fetch`
 *      URL is tallied and cross-referenced against
 *      `manifest.network.allowedHosts` and the `network` permission.
 *
 * `not-invokable` hook results are classified as `skip`, not `fail`. Reporter
 * (item 4) consumes the returned structure verbatim.
 */

import { Extensions } from '@bible/core';
import type { SmokeHarness } from './createSmokeHarness';
import { DEFAULT_CORPUS, getCorpusForShape, type SmokeCorpus } from './corpora';
import type {
  HookDescriptor,
  HookInvocationResult,
  HookKind,
} from './types';
import {
  installPermissionAndNetworkInterceptors,
  type InterceptorState,
} from './interceptors';

type ExtensionManifest = Extensions.ExtensionManifest;
type ExtensionPermission = Extensions.ExtensionPermission;

// ── Result shape ────────────────────────────────────────────────────────────

export type SmokeFailureReason =
  | 'threw'
  | 'timeout'
  | 'invalid-return'
  | 'permission-violation'
  | 'unexpected-network';

export type SmokeRecordStatus = 'pass' | 'fail' | 'skip';

export interface SmokeRecord {
  hookId: string;
  kind: HookKind;
  /** Stringified input for display. Original value preserved in `inputValue`. */
  input: string;
  inputValue: unknown;
  status: SmokeRecordStatus;
  /** Only set when `status === 'fail'`. */
  failureReason?: SmokeFailureReason;
  /** Human-readable explanation attached to a failure or skip. */
  message?: string;
  /** Wall-clock ms the invocation took. 0 for `skip`. */
  durationMs: number;
  /** The value the hook returned, when the invocation ran. */
  returnValue?: unknown;
}

export interface SmokeHookSummary {
  hookId: string;
  kind: HookKind;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  avgDurationMs: number;
  /** First failing record, for the reporter's "first failing input" echo. */
  firstFailure?: SmokeRecord;
}

export interface SmokeSuiteTotals {
  passed: number;
  failed: number;
  skipped: number;
  hooks: number;
  invocations: number;
  durationMs: number;
}

export interface SmokeSuiteResult {
  extensionId: string;
  extensionVersion: string;
  records: SmokeRecord[];
  perHook: SmokeHookSummary[];
  totals: SmokeSuiteTotals;
}

// ── Options ─────────────────────────────────────────────────────────────────

export type ReturnValidator = (
  value: unknown,
  hook: HookDescriptor,
) => true | string;

export interface RunSmokeSuiteOptions {
  harness: SmokeHarness;
  /** Corpus to feed. Defaults to `DEFAULT_CORPUS`. */
  corpus?: SmokeCorpus;
  /** Default per-invocation timeout. Defaults to 2000 ms. */
  timeoutMs?: number;
  /** Per-hook timeout overrides keyed by `hookId`. */
  hookTimeouts?: Readonly<Record<string, number>>;
  /**
   * Optional per-hook-kind DTO validators. Return `true` if the value is
   * acceptable, or a string describing what's wrong. The codebase does not
   * ship runtime DTO schemas today (everything is hand-written TS validation
   * — see `ExtensionManifestValidator.ts`), so callers wire their own.
   */
  returnValidators?: Partial<Record<HookKind, ReturnValidator>>;
  /**
   * Maximum inputs per hook. Guards against extremely large user corpora
   * blowing up CI wall time. Unset = unlimited.
   */
  maxInputsPerHook?: number;
}

const DEFAULT_TIMEOUT_MS = 2_000;

// ── Entry point ─────────────────────────────────────────────────────────────

export async function runSmokeSuite(
  opts: RunSmokeSuiteOptions,
): Promise<SmokeSuiteResult> {
  const { harness } = opts;
  if (!harness.isActive()) {
    throw new Error('runSmokeSuite: harness must be activated before running the suite.');
  }
  const manifest = harness.getManifest();
  const corpus = opts.corpus ?? DEFAULT_CORPUS;
  const defaultTimeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const hookTimeouts = opts.hookTimeouts ?? {};
  const validators = opts.returnValidators ?? {};

  const interceptor = installPermissionAndNetworkInterceptors(
    harness.getApi(),
    manifest,
  );

  const startedAt = Date.now();
  const records: SmokeRecord[] = [];
  const hooks = harness.enumerate();

  for (const hook of hooks) {
    const inputs = pickInputs(hook, corpus, opts.maxInputsPerHook);
    const timeoutMs = hookTimeouts[hook.hookId] ?? defaultTimeout;
    for (const input of inputs) {
      const before = interceptor.snapshot();
      const result = await harness.invokeHook(hook.hookId, input, { timeoutMs });
      const after = interceptor.snapshot();
      records.push(
        classify({
          hook,
          input,
          result,
          validator: validators[hook.kind],
          manifest,
          delta: interceptor.delta(before, after),
        }),
      );
    }
  }

  interceptor.restore();

  const perHook = summarizePerHook(hooks, records);
  const totals: SmokeSuiteTotals = {
    passed: records.filter((r) => r.status === 'pass').length,
    failed: records.filter((r) => r.status === 'fail').length,
    skipped: records.filter((r) => r.status === 'skip').length,
    hooks: hooks.length,
    invocations: records.length,
    durationMs: Date.now() - startedAt,
  };

  return {
    extensionId: manifest.id,
    extensionVersion: manifest.version,
    records,
    perHook,
    totals,
  };
}

// ── Input selection ─────────────────────────────────────────────────────────

function pickInputs(
  hook: HookDescriptor,
  corpus: SmokeCorpus,
  cap: number | undefined,
): readonly unknown[] {
  const pool = getCorpusForShape(hook.inputShape, corpus);
  if (cap !== undefined && pool.length > cap) return pool.slice(0, cap);
  return pool;
}

// ── Classification ──────────────────────────────────────────────────────────

interface ClassifyArgs {
  hook: HookDescriptor;
  input: unknown;
  result: HookInvocationResult;
  validator: ReturnValidator | undefined;
  manifest: ExtensionManifest;
  delta: { permissionDenials: string[]; unexpectedFetches: string[] };
}

function classify(args: ClassifyArgs): SmokeRecord {
  const { hook, input, result, validator, delta } = args;
  const base: Omit<SmokeRecord, 'status'> = {
    hookId: hook.hookId,
    kind: hook.kind,
    input: stringifyInput(input),
    inputValue: input,
    durationMs: result.durationMs,
    returnValue: result.value,
  };

  if (result.status === 'not-invokable') {
    return {
      ...base,
      status: 'skip',
      message: result.reason ?? 'Hook not invokable in current harness mode.',
    };
  }

  if (result.status === 'threw') {
    const msg = result.error?.message ?? 'unknown error';
    if (isPermissionDeniedMessage(msg) || delta.permissionDenials.length > 0) {
      return {
        ...base,
        status: 'fail',
        failureReason: 'permission-violation',
        message: delta.permissionDenials[0] ?? msg,
      };
    }
    if (isNetworkBlockedMessage(msg)) {
      return {
        ...base,
        status: 'fail',
        failureReason: 'unexpected-network',
        message: msg,
      };
    }
    return {
      ...base,
      status: 'fail',
      failureReason: 'threw',
      message: msg,
    };
  }

  if (result.status === 'timeout') {
    return {
      ...base,
      status: 'fail',
      failureReason: 'timeout',
      message: result.error?.message ?? 'hook exceeded timeout',
    };
  }

  // result.status === 'ok'
  if (delta.permissionDenials.length > 0) {
    return {
      ...base,
      status: 'fail',
      failureReason: 'permission-violation',
      message: delta.permissionDenials[0] as string,
    };
  }
  if (delta.unexpectedFetches.length > 0) {
    return {
      ...base,
      status: 'fail',
      failureReason: 'unexpected-network',
      message: `Unexpected network.fetch to ${delta.unexpectedFetches[0] as string}`,
    };
  }

  const shape = validateReturn(hook, result.value, validator);
  if (shape !== true) {
    return {
      ...base,
      status: 'fail',
      failureReason: 'invalid-return',
      message: shape,
    };
  }

  return { ...base, status: 'pass' };
}

function validateReturn(
  hook: HookDescriptor,
  value: unknown,
  validator: ReturnValidator | undefined,
): true | string {
  // Event subscribers must resolve with undefined; the invoker awaits their
  // handlers and discards return values, so anything else is a bug in the
  // harness rather than the extension. Still worth asserting so item 4 can
  // surface it cleanly.
  if (hook.kind === 'event') {
    return value === undefined ? true : 'event subscribers must not return a value';
  }
  if (!validator) return true;
  return validator(value, hook);
}

function isPermissionDeniedMessage(msg: string): boolean {
  return msg.includes('PermissionDeniedError') || /missing required permission/i.test(msg);
}

function isNetworkBlockedMessage(msg: string): boolean {
  return (
    msg.includes('NetworkHostNotAllowedError') ||
    /network host .* not allowed/i.test(msg)
  );
}

// ── Per-hook summary ────────────────────────────────────────────────────────

function summarizePerHook(
  hooks: readonly HookDescriptor[],
  records: readonly SmokeRecord[],
): SmokeHookSummary[] {
  return hooks.map((hook) => {
    const rows = records.filter((r) => r.hookId === hook.hookId);
    const passed = rows.filter((r) => r.status === 'pass').length;
    const failed = rows.filter((r) => r.status === 'fail').length;
    const skipped = rows.filter((r) => r.status === 'skip').length;
    const avg = rows.length > 0
      ? rows.reduce((sum, r) => sum + r.durationMs, 0) / rows.length
      : 0;
    const firstFailure = rows.find((r) => r.status === 'fail');
    return {
      hookId: hook.hookId,
      kind: hook.kind,
      total: rows.length,
      passed,
      failed,
      skipped,
      avgDurationMs: Math.round(avg * 100) / 100,
      ...(firstFailure ? { firstFailure } : {}),
    };
  });
}

function stringifyInput(input: unknown): string {
  if (input === undefined) return 'undefined';
  try {
    const s = JSON.stringify(input);
    return s.length > 120 ? `${s.slice(0, 117)}...` : s;
  } catch {
    return String(input);
  }
}

// Re-export the taxonomy helpers so consumers (reporter) don't need to dig
// into the internal interceptor module.
export type { InterceptorState };

// Manifest helper used by interceptors — exported for tests.
export function declaredPermissions(
  manifest: ExtensionManifest,
): ReadonlySet<ExtensionPermission> {
  return new Set((manifest.permissions ?? []) as ExtensionPermission[]);
}

/**
 * JSON reporter for `SmokeSuiteResult`.
 *
 * Emits a stable, versioned envelope. Consumers (CI, dashboards) should
 * pin on `schemaVersion` and treat unknown top-level fields as additive.
 *
 * Shape committed to (schemaVersion `1`):
 *
 *   {
 *     schemaVersion: 1,
 *     extensionId: string,
 *     extensionVersion: string,
 *     totals: SmokeSuiteTotals,
 *     perHook: SmokeHookSummary[],      // with firstFailure when present
 *     records: SmokeRecord[],           // flat, hook-major then input-minor
 *   }
 *
 * Deliberately omitted by default:
 *   - `record.inputValue` and `record.returnValue` can contain arbitrary
 *     non-JSON-safe data (functions, cycles, bigints). We strip them unless
 *     the caller opts in via `includeValues: true`, in which case we run
 *     them through a safe cloner that replaces unserializable values with
 *     `"[unserializable: <type>]"` sentinels.
 *   - `firstFailure.inputValue` / `firstFailure.returnValue` follow the
 *     same rule.
 */

import type {
  SmokeHookSummary,
  SmokeRecord,
  SmokeSuiteResult,
} from '../runSmokeSuite';

export const SMOKE_JSON_SCHEMA_VERSION = 1 as const;

export interface FormatJsonOptions {
  /** Pretty-print with this indent. Default 2. Pass 0 for compact. */
  indent?: number;
  /**
   * Include `inputValue` and `returnValue` on every record. Off by default
   * because these can carry arbitrary extension-defined payloads that may
   * not round-trip through JSON. When on, unserializable values are
   * replaced with a `"[unserializable: <type>]"` string sentinel.
   */
  includeValues?: boolean;
}

export interface SmokeJsonEnvelopeV1 {
  schemaVersion: typeof SMOKE_JSON_SCHEMA_VERSION;
  extensionId: string;
  extensionVersion: string;
  totals: SmokeSuiteResult['totals'];
  perHook: SmokeHookSummary[];
  records: SmokeRecord[];
}

export function formatJson(
  result: SmokeSuiteResult,
  opts: FormatJsonOptions = {},
): string {
  const indent = opts.indent ?? 2;
  const includeValues = opts.includeValues ?? false;

  const records = result.records.map((r) => sanitizeRecord(r, includeValues));
  const perHook = result.perHook.map((h) =>
    h.firstFailure
      ? { ...h, firstFailure: sanitizeRecord(h.firstFailure, includeValues) }
      : h,
  );

  const envelope: SmokeJsonEnvelopeV1 = {
    schemaVersion: SMOKE_JSON_SCHEMA_VERSION,
    extensionId: result.extensionId,
    extensionVersion: result.extensionVersion,
    totals: result.totals,
    perHook,
    records,
  };
  return JSON.stringify(envelope, null, indent);
}

function sanitizeRecord(record: SmokeRecord, includeValues: boolean): SmokeRecord {
  const base: SmokeRecord = {
    hookId: record.hookId,
    kind: record.kind,
    input: record.input,
    inputValue: undefined,
    status: record.status,
    durationMs: record.durationMs,
  };
  if (record.failureReason !== undefined) base.failureReason = record.failureReason;
  if (record.message !== undefined) base.message = record.message;
  if (includeValues) {
    base.inputValue = safeClone(record.inputValue);
    if (record.returnValue !== undefined) {
      base.returnValue = safeClone(record.returnValue);
    }
  } else {
    // Strip both so the output is guaranteed JSON-round-trippable.
    delete (base as Partial<SmokeRecord>).inputValue;
  }
  return base;
}

function safeClone(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null) return null;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
  if (t === 'undefined') return undefined;
  if (t === 'bigint') return `[unserializable: bigint]`;
  if (t === 'function' || t === 'symbol') return `[unserializable: ${t}]`;
  if (t === 'object') {
    const obj = value as object;
    if (seen.has(obj)) return '[unserializable: cycle]';
    seen.add(obj);
    if (Array.isArray(obj)) {
      return obj.map((v) => safeClone(v, seen));
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = safeClone(v, seen);
    }
    return out;
  }
  return `[unserializable: ${t}]`;
}

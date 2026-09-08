import { describe, it, expect } from 'vitest';
import {
  formatJson,
  SMOKE_JSON_SCHEMA_VERSION,
  type SmokeJsonEnvelopeV1,
} from '../formatJson';
import type {
  SmokeHookSummary,
  SmokeRecord,
  SmokeSuiteResult,
} from '../../runSmokeSuite';

function baseSuite(overrides: Partial<SmokeSuiteResult> = {}): SmokeSuiteResult {
  const pass: SmokeRecord = {
    hookId: 'event:x',
    kind: 'event',
    input: '1',
    inputValue: 1,
    status: 'pass',
    durationMs: 1,
  };
  const fail: SmokeRecord = {
    hookId: 'event:x',
    kind: 'event',
    input: '2',
    inputValue: 2,
    status: 'fail',
    failureReason: 'threw',
    message: 'boom',
    durationMs: 2,
  };
  const summary: SmokeHookSummary = {
    hookId: 'event:x',
    kind: 'event',
    total: 2,
    passed: 1,
    failed: 1,
    skipped: 0,
    avgDurationMs: 1.5,
    firstFailure: fail,
  };
  return {
    extensionId: 'ext.demo',
    extensionVersion: '0.0.1',
    records: [pass, fail],
    perHook: [summary],
    totals: {
      passed: 1,
      failed: 1,
      skipped: 0,
      hooks: 1,
      invocations: 2,
      durationMs: 5,
    },
    ...overrides,
  };
}

describe('formatJson', () => {
  it('emits a versioned envelope with totals, perHook, and records', () => {
    const parsed = JSON.parse(formatJson(baseSuite())) as SmokeJsonEnvelopeV1;
    expect(parsed.schemaVersion).toBe(SMOKE_JSON_SCHEMA_VERSION);
    expect(parsed.extensionId).toBe('ext.demo');
    expect(parsed.extensionVersion).toBe('0.0.1');
    expect(parsed.totals.passed).toBe(1);
    expect(parsed.perHook).toHaveLength(1);
    expect(parsed.records).toHaveLength(2);
  });

  it('strips inputValue/returnValue by default and round-trips the remaining shape', () => {
    const suite = baseSuite();
    const parsed = JSON.parse(formatJson(suite)) as SmokeJsonEnvelopeV1;
    for (const r of parsed.records) {
      expect(Object.prototype.hasOwnProperty.call(r, 'inputValue')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(r, 'returnValue')).toBe(false);
    }
    const ff = parsed.perHook[0]?.firstFailure;
    expect(ff?.hookId).toBe('event:x');
    expect(ff?.failureReason).toBe('threw');
    expect(ff?.message).toBe('boom');
  });

  it('includeValues: true preserves values and sanitizes unserializable ones', () => {
    const circ: Record<string, unknown> = { a: 1 };
    circ.self = circ;
    const suite = baseSuite({
      records: [
        {
          hookId: 'command:x',
          kind: 'command',
          input: '...',
          inputValue: {
            fn: () => 1,
            big: BigInt(7),
            cyc: circ,
            ok: 'yes',
          },
          status: 'pass',
          durationMs: 1,
          returnValue: { sym: Symbol('s') },
        },
      ],
    });
    const parsed = JSON.parse(
      formatJson(suite, { includeValues: true }),
    ) as SmokeJsonEnvelopeV1;
    const r = parsed.records[0];
    const iv = r?.inputValue as Record<string, unknown>;
    expect(iv.fn).toBe('[unserializable: function]');
    expect(iv.big).toBe('[unserializable: bigint]');
    expect((iv.cyc as Record<string, unknown>).self).toBe('[unserializable: cycle]');
    expect(iv.ok).toBe('yes');
    expect((r?.returnValue as Record<string, unknown>).sym).toBe(
      '[unserializable: symbol]',
    );
  });

  it('renders an all-pass suite and an empty-hooks suite', () => {
    const empty = JSON.parse(
      formatJson({
        extensionId: 'e',
        extensionVersion: '1',
        records: [],
        perHook: [],
        totals: {
          passed: 0,
          failed: 0,
          skipped: 0,
          hooks: 0,
          invocations: 0,
          durationMs: 0,
        },
      }),
    ) as SmokeJsonEnvelopeV1;
    expect(empty.records).toEqual([]);
    expect(empty.perHook).toEqual([]);
    expect(empty.totals.hooks).toBe(0);
  });

  it('honors indent: 0 for compact output', () => {
    const out = formatJson(baseSuite(), { indent: 0 });
    expect(out.startsWith('{')).toBe(true);
    expect(out).not.toContain('\n');
  });
});

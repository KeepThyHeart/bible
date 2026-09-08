import { describe, it, expect } from 'vitest';
import { formatPretty } from '../formatPretty';
import type {
  SmokeHookSummary,
  SmokeRecord,
  SmokeSuiteResult,
} from '../../runSmokeSuite';

function record(overrides: Partial<SmokeRecord> = {}): SmokeRecord {
  return {
    hookId: 'event:bible.onDidChangeActiveVerse',
    kind: 'event',
    input: '43003016',
    inputValue: 43003016,
    status: 'pass',
    durationMs: 2,
    returnValue: undefined,
    ...overrides,
  };
}

function hookSummary(overrides: Partial<SmokeHookSummary> = {}): SmokeHookSummary {
  return {
    hookId: 'event:bible.onDidChangeActiveVerse',
    kind: 'event',
    total: 10,
    passed: 10,
    failed: 0,
    skipped: 0,
    avgDurationMs: 3,
    ...overrides,
  };
}

function suite(overrides: Partial<SmokeSuiteResult> = {}): SmokeSuiteResult {
  return {
    extensionId: 'ext.test',
    extensionVersion: '0.1.0',
    records: [],
    perHook: [],
    totals: {
      passed: 0,
      failed: 0,
      skipped: 0,
      hooks: 0,
      invocations: 0,
      durationMs: 100,
    },
    ...overrides,
  };
}

describe('formatPretty', () => {
  it('renders an all-pass suite', () => {
    const out = formatPretty(
      suite({
        perHook: [hookSummary()],
        records: Array.from({ length: 10 }, () => record()),
        totals: {
          passed: 10,
          failed: 0,
          skipped: 0,
          hooks: 1,
          invocations: 10,
          durationMs: 42,
        },
      }),
    );
    expect(out).toContain('ext.test v0.1.0');
    expect(out).toContain('event:bible.onDidChangeActiveVerse');
    expect(out).toContain('10/10');
    expect(out).toContain('10 passed, 0 failed, 0 skipped');
    expect(out).toContain('42ms');
  });

  it('renders a mixed suite with each failure reason and echoes first failure', () => {
    const reasons = [
      'threw',
      'timeout',
      'invalid-return',
      'permission-violation',
      'unexpected-network',
    ] as const;
    const perHook: SmokeHookSummary[] = reasons.map((reason, i) => ({
      ...hookSummary({
        hookId: `command:cmd.${reason}`,
        kind: 'command',
        total: 3,
        passed: 2,
        failed: 1,
        avgDurationMs: i + 1,
        firstFailure: record({
          hookId: `command:cmd.${reason}`,
          kind: 'command',
          status: 'fail',
          failureReason: reason,
          message: `boom-${reason}`,
          input: `"input-${reason}"`,
        }),
      }),
    }));
    const out = formatPretty(
      suite({
        perHook,
        totals: {
          passed: 10,
          failed: 5,
          skipped: 0,
          hooks: 5,
          invocations: 15,
          durationMs: 1500,
        },
      }),
    );
    for (const r of reasons) {
      expect(out).toContain(`command:cmd.${r}`);
      expect(out).toContain(`${r}: boom-${r}`);
      expect(out).toContain(`"input-${r}"`);
    }
    expect(out).toContain('10 passed, 5 failed, 0 skipped');
    expect(out).toContain('1.50s');
  });

  it('renders an all-skip suite without marking it failed', () => {
    const out = formatPretty(
      suite({
        perHook: [
          hookSummary({
            hookId: 'hover:verseToken',
            kind: 'hover',
            total: 5,
            passed: 0,
            failed: 0,
            skipped: 5,
            avgDurationMs: 0,
          }),
        ],
        totals: {
          passed: 0,
          failed: 0,
          skipped: 5,
          hooks: 1,
          invocations: 5,
          durationMs: 3,
        },
      }),
    );
    expect(out).toContain('5/5 skipped');
    expect(out).not.toContain('failed:');
    expect(out).toContain('0 failed');
  });

  it('handles an empty-hooks suite', () => {
    const out = formatPretty(suite());
    expect(out).toContain('(no hooks enumerated)');
    expect(out).toContain('0 passed, 0 failed, 0 skipped');
  });

  it('honors the ascii option', () => {
    const out = formatPretty(
      suite({
        perHook: [hookSummary()],
        totals: {
          passed: 10,
          failed: 0,
          skipped: 0,
          hooks: 1,
          invocations: 10,
          durationMs: 1,
        },
      }),
      { ascii: true },
    );
    expect(out).not.toContain('✓');
    expect(out).toMatch(/^\s*P\s/m);
  });
});

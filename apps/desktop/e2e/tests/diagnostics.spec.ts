/**
 * Diagnostics & Issue Reporting E2E
 *
 * Scope: smoke-test the IPC wiring of the diagnostics subsystem in a real
 * Electron context. Unit tests in `electron/services/__tests__/` cover the
 * business logic; this file verifies that the handlers are registered, the
 * preload bridge exposes them, and a submit->list->delete round-trip works
 * end-to-end.
 *
 * We drive everything through `window.electron.diagnostics.*` rather than
 * clicking through the Help menu. Native menu interaction is fragile in
 * Playwright+Electron (menus are out-of-process on some platforms), and the
 * IPC path is the same code path the menu would hit anyway.
 */

import { test, expect } from '../fixtures/electron.fixture';

/**
 * The renderer returns IPC results wrapped in a Result<T> envelope from
 * `handler-helper.ts`: `{ ok: true, value } | { ok: false, error }`.
 */
interface OkResult<T> { ok: true; value: T }
interface ErrResult { ok: false; error: { code: string; message: string } }
type Result<T> = OkResult<T> | ErrResult;

/**
 * What the two submit channels resolve to. `willUpload` reports whether the
 * background uploader would actually collect this file - diagnostics enabled
 * *and* an endpoint set - which is what lets the Report an Issue dialog say
 * "sent" only when that is true.
 */
interface SubmitReceipt {
  reportId: string;
  willUpload: boolean;
}

interface QueueEntry {
  id: string;
  type: 'crash' | 'manual' | 'feedback';
  ts: string;
}

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`IPC error: ${r.error.code} ${r.error.message}`);
  return r.value;
}

test.describe('Diagnostics & Issue Reporting', () => {
  test('submit feedback via IPC, inspect queue, and clear it', async ({ window }) => {
    // Ensure the preload exposed the diagnostics bridge.
    const bridgeAvailable = await window.evaluate(
      () => !!globalThis.electron?.diagnostics?.getQueue
    );
    expect(bridgeAvailable).toBe(true);

    // Start from a clean queue so a previous run (or an auto-captured
    // renderer error during boot) doesn't pollute the assertions below.
    await window.evaluate(async () => {
      const r = await globalThis.electron!.diagnostics!.deleteAll();
      return r;
    });

    // Submit a feedback-only report. Feedback payloads (section 2.3) are the
    // tightest privacy contract: app version + description only, no state,
    // no os/arch/electron_version. We assert the `state` key is absent.
    const submitResult = (await window.evaluate(async () => {
      return (await globalThis.electron!.diagnostics!.submitFeedback({
        description: 'E2E smoke: bigger commentary font please',
      })) as Result<SubmitReceipt>;
    })) as Result<SubmitReceipt>;
    expect(submitResult.ok).toBe(true);

    // List the queue; exactly one entry, of type 'feedback'.
    const listRaw = (await window.evaluate(async () => {
      return (await globalThis.electron!.diagnostics!.getQueue()) as Result<
        QueueEntry[]
      >;
    })) as Result<QueueEntry[]>;
    const entries = unwrap(listRaw);
    expect(entries.length).toBe(1);
    expect(entries[0]?.type).toBe('feedback');

    // Read the report contents directly by round-tripping the queue file
    // through `getReport` (exposed via the preload bridge). Assert shape:
    // feedback payloads have NO `state` field.
    const reportRaw = (await window.evaluate(async (id: string) => {
      // The bridge doesn't expose `getReport` by name in the minimal typed
      // surface above; reach into the untyped object since we've already
      // confirmed the bridge is available.
      const diag = (window as unknown as {
        electron: { diagnostics: Record<string, unknown> };
      }).electron.diagnostics;
      const fn = diag['getReport'] as (id: string) => Promise<unknown>;
      return fn(id);
    }, entries[0]!.id)) as Result<Record<string, unknown>>;
    const report = unwrap(reportRaw);
    expect(report.type).toBe('feedback');
    expect(report.user_description).toBe(
      'E2E smoke: bigger commentary font please'
    );
    // Privacy contract: feedback never carries state or environment fields.
    expect(Object.prototype.hasOwnProperty.call(report, 'state')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(report, 'os')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(report, 'arch')).toBe(false);

    // Clear and verify the queue is empty.
    const deleted = (await window.evaluate(async () => {
      return (await globalThis.electron!.diagnostics!.deleteAll()) as Result<number>;
    })) as Result<number>;
    expect(unwrap(deleted)).toBeGreaterThanOrEqual(1);

    const afterDelete = (await window.evaluate(async () => {
      return (await globalThis.electron!.diagnostics!.getQueue()) as Result<
        QueueEntry[]
      >;
    })) as Result<QueueEntry[]>;
    expect(unwrap(afterDelete)).toEqual([]);
  });

  test('manual report with includeDiagnostics=false omits state', async ({ window }) => {
    // Clean slate.
    await window.evaluate(() => globalThis.electron!.diagnostics!.deleteAll());

    const submitted = (await window.evaluate(async () => {
      return (await globalThis.electron!.diagnostics!.submitManualReport({
        description: 'the xref link did nothing',
        includeDiagnostics: false,
      })) as Result<SubmitReceipt>;
    })) as Result<SubmitReceipt>;
    expect(submitted.ok).toBe(true);

    const listRaw = (await window.evaluate(async () => {
      return (await globalThis.electron!.diagnostics!.getQueue()) as Result<
        QueueEntry[]
      >;
    })) as Result<QueueEntry[]>;
    const entries = unwrap(listRaw);
    const manual = entries.find((e) => e.type === 'manual');
    expect(manual).toBeDefined();

    const reportRaw = (await window.evaluate(async (id: string) => {
      const diag = (window as unknown as {
        electron: { diagnostics: Record<string, unknown> };
      }).electron.diagnostics;
      const fn = diag['getReport'] as (id: string) => Promise<unknown>;
      return fn(id);
    }, manual!.id)) as Result<Record<string, unknown>>;
    const report = unwrap(reportRaw);
    expect(report.type).toBe('manual');
    expect(Object.prototype.hasOwnProperty.call(report, 'state')).toBe(false);

    // Tidy up for the next run.
    await window.evaluate(() => globalThis.electron!.diagnostics!.deleteAll());
  });
});

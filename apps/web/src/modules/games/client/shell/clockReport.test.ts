/**
 * The clock measurement travels beside a buzz and nothing else.
 *
 * A buzz is stamped with the phone's own clock and corrected on the server by
 * the offset posted with it. Both halves of that are pinned here: which
 * intents carry the measurement, and that it reaches the wire beside the
 * intent rather than inside it, where the server would never look for it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Intent } from '../../shared/protocol.js';
import type { ClockReport } from '../clock/index.js';
import { sendIntent } from './api.js';
import { clockReportFor } from './clockPort.js';
import type { ClockPort } from './clockPort.js';

const REPORT: ClockReport = { offsetMs: 1_500, rttMs: 80, spreadMs: 12 };

const BUZZ: Intent = { kind: 'buzz', round: 3, charsSeen: 0, tClient: 1_700_000_000_000 };

function clockWith(report: ClockReport | null): ClockPort {
  return {
    serverNow: () => 0,
    msUntil: () => 0,
    showAt: () => () => undefined,
    report: () => report,
    onChange: () => () => undefined,
  };
}

describe('which intents carry the clock', () => {
  it('sends the measurement with a buzz', () => {
    expect(clockReportFor(BUZZ, clockWith(REPORT))).toEqual(REPORT);
  });

  it('sends nothing with an intent whose timing decides nothing', () => {
    const found: Intent = { kind: 'answer', round: 3, value: { type: 'found' } };

    expect(clockReportFor(found, clockWith(REPORT))).toBeNull();
    expect(clockReportFor({ kind: 'leave' }, clockWith(REPORT))).toBeNull();
  });

  it('sends nothing before the first measurement, rather than a guess', () => {
    expect(clockReportFor(BUZZ, clockWith(null))).toBeNull();
  });
});

describe('posting an intent', () => {
  let bodies: unknown[];

  function captureFetch(): void {
    bodies = [];
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('puts the measurement beside the intent, not inside it', async () => {
    captureFetch();
    await sendIntent('QK7P', 'token-1', BUZZ, REPORT);

    expect(bodies).toEqual([{ token: 'token-1', intent: BUZZ, clock: REPORT }]);
  });

  it('leaves the field off when there is nothing to report', async () => {
    captureFetch();
    await sendIntent('QK7P', 'token-1', BUZZ);

    expect(bodies).toEqual([{ token: 'token-1', intent: BUZZ }]);
  });
});

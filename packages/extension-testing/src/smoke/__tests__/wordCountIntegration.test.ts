import path from 'node:path';
import { describe, it, expect } from 'vitest';

import { createSmokeHarness } from '../createSmokeHarness';
import { runSmokeSuite } from '../runSmokeSuite';

const WORD_COUNT_ROOT = path.resolve(
  __dirname,
  '../../../../../examples/extensions/word-count',
);

describe('smoke pipeline — word-count reference extension', () => {
  it('loads, activates, and records zero fail results end-to-end', async () => {
    const harness = createSmokeHarness({ extensionRoot: WORD_COUNT_ROOT });
    await harness.activate();
    const result = await runSmokeSuite({ harness });
    await harness.deactivate();

    expect(result.extensionId).toBe('ext.bible-app.word-count');
    expect(result.totals.failed).toBe(0);
    expect(result.totals.invocations).toBeGreaterThan(0);

    const eventHook = result.perHook.find(
      (h) => h.hookId === 'event:bible.onDidChangeActiveVerse',
    );
    expect(eventHook).toBeDefined();
    expect(eventHook?.passed).toBeGreaterThan(0);
    expect(eventHook?.failed).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import type { Extensions } from '@bible/core';

import { createSmokeHarness } from '../createSmokeHarness';
import { runSmokeSuite, type ReturnValidator } from '../runSmokeSuite';

function manifest(
  overrides: Partial<Extensions.ExtensionManifest> = {},
): Extensions.ExtensionManifest {
  return {
    id: 'ext.test.suite',
    name: { key: 'ext.test.suite' },
    version: '1.0.0',
    publisher: 'test',
    engines: { bibleApp: '^1.0.0' },
    ...overrides,
  };
}

describe('runSmokeSuite', () => {
  it('passes a clean extension with one well-behaved event subscriber', async () => {
    const harness = createSmokeHarness({
      manifest: manifest(),
      activate: async (api) => {
        await api.bible.onDidChangeActiveVerse.subscribe(() => {});
      },
    });
    await harness.activate();
    const result = await runSmokeSuite({ harness });
    await harness.deactivate();

    expect(result.totals.failed).toBe(0);
    expect(result.totals.passed).toBeGreaterThan(0);
    expect(result.perHook[0]?.hookId).toBe('event:bible.onDidChangeActiveVerse');
    expect(result.perHook[0]?.failed).toBe(0);
  });

  it('records `threw` when a subscriber throws on a specific input', async () => {
    const harness = createSmokeHarness({
      manifest: manifest(),
      activate: async (api) => {
        await api.bible.onDidChangeActiveVerse.subscribe((p) => {
          if (p === 43003016) throw new Error('only-john-breaks');
        });
      },
    });
    await harness.activate();
    const result = await runSmokeSuite({
      harness,
      corpus: {
        verseIds: [],
        verseRanges: [],
        referenceStrings: [],
        dictionaryKeys: [],
        sectionIds: [],
        commandArgs: [],
        eventPayloads: [1001001, 43003016, 66022021],
        storage: [],
        network: [],
        none: [undefined],
      },
    });
    await harness.deactivate();

    const failed = result.records.filter((r) => r.status === 'fail');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.failureReason).toBe('threw');
    expect(failed[0]?.message).toContain('only-john-breaks');
  });

  it('records `timeout` when a subscriber hangs past the per-hook budget', async () => {
    const harness = createSmokeHarness({
      manifest: manifest(),
      activate: async (api) => {
        await api.bible.onDidChangeActiveVerse.subscribe(
          () => new Promise(() => {}),
        );
      },
    });
    await harness.activate();
    const result = await runSmokeSuite({
      harness,
      timeoutMs: 20,
      corpus: {
        verseIds: [],
        verseRanges: [],
        referenceStrings: [],
        dictionaryKeys: [],
        sectionIds: [],
        commandArgs: [],
        eventPayloads: [1],
        storage: [],
        network: [],
        none: [undefined],
      },
    });
    await harness.deactivate();

    expect(result.records.every((r) => r.failureReason === 'timeout')).toBe(true);
    expect(result.totals.failed).toBe(1);
  });

  it('records `invalid-return` when a caller validator rejects an endpoint return', async () => {
    // Item 1's InProcessHookInvoker classifies endpoint hooks as not-invokable,
    // so to exercise the invalid-return taxonomy we swap in a tiny fake invoker
    // that simulates a real --full worker returning a concrete value.
    const harness = createSmokeHarness({
      manifest: manifest(),
      activate: async (api) => {
        await api.ui.registerVerseHover({
          id: 'hover-bad',
          hoverEndpoint: 'onHover',
        });
      },
      invoker: {
        invoke: async (hook) => ({
          hookId: hook.hookId,
          status: 'ok',
          durationMs: 1,
          value: { wrong: 'shape' },
        }),
      },
    });
    await harness.activate();
    const rejectAll: ReturnValidator = (v) =>
      typeof v === 'object' && v !== null && 'verseId' in v
        ? true
        : 'hover return must carry verseId';
    const result = await runSmokeSuite({
      harness,
      returnValidators: { hover: rejectAll },
      corpus: {
        verseIds: [43003016],
        verseRanges: [],
        referenceStrings: [],
        dictionaryKeys: [],
        sectionIds: [],
        commandArgs: [],
        eventPayloads: [],
        storage: [],
        network: [],
        none: [undefined],
      },
    });
    await harness.deactivate();

    const bad = result.records.filter((r) => r.hookId === 'hover:hover-bad');
    expect(bad).toHaveLength(1);
    expect(bad[0]?.status).toBe('fail');
    expect(bad[0]?.failureReason).toBe('invalid-return');
    expect(bad[0]?.message).toContain('verseId');
  });

  it('records `permission-violation` when activate() touches an undeclared namespace', async () => {
    const harness = createSmokeHarness({
      // No `notes:write` declared — create() must surface PermissionDenied.
      manifest: manifest(),
      activate: async (api) => {
        await api.bible.onDidChangeActiveVerse.subscribe(async () => {
          await api.notes.create({ content: 'x' } as never);
        });
      },
    });
    await harness.activate();
    const result = await runSmokeSuite({
      harness,
      corpus: {
        verseIds: [],
        verseRanges: [],
        referenceStrings: [],
        dictionaryKeys: [],
        sectionIds: [],
        commandArgs: [],
        eventPayloads: [1],
        storage: [],
        network: [],
        none: [undefined],
      },
    });
    await harness.deactivate();

    expect(result.totals.failed).toBe(1);
    expect(result.records[0]?.failureReason).toBe('permission-violation');
    expect(result.records[0]?.message).toContain('notes:write');
  });

  it('records `unexpected-network` when fetch hits an undeclared host', async () => {
    const harness = createSmokeHarness({
      manifest: manifest({
        permissions: ['network'],
        network: { allowedHosts: [{ host: 'api.example.com', purpose: 'test' }] },
      }),
      activate: async (api) => {
        await api.bible.onDidChangeActiveVerse.subscribe(async () => {
          await api.network.fetch('https://evil.tracker.com/beacon');
        });
      },
    });
    await harness.activate();
    const result = await runSmokeSuite({
      harness,
      corpus: {
        verseIds: [],
        verseRanges: [],
        referenceStrings: [],
        dictionaryKeys: [],
        sectionIds: [],
        commandArgs: [],
        eventPayloads: [1],
        storage: [],
        network: [],
        none: [undefined],
      },
    });
    await harness.deactivate();

    expect(result.totals.failed).toBe(1);
    expect(result.records[0]?.failureReason).toBe('unexpected-network');
    expect(result.records[0]?.message).toContain('evil.tracker.com');
  });

  it('classifies not-invokable hooks as skip, not fail', async () => {
    const harness = createSmokeHarness({
      manifest: manifest(),
      activate: async (api) => {
        await api.ui.registerVerseHover({
          id: 'hover-skip',
          hoverEndpoint: 'onHover',
        });
      },
    });
    await harness.activate();
    const result = await runSmokeSuite({ harness });
    await harness.deactivate();

    const hoverRecords = result.records.filter((r) => r.hookId === 'hover:hover-skip');
    expect(hoverRecords.length).toBeGreaterThan(0);
    expect(hoverRecords.every((r) => r.status === 'skip')).toBe(true);
    expect(result.totals.failed).toBe(0);
    expect(result.totals.skipped).toBeGreaterThan(0);
  });
});

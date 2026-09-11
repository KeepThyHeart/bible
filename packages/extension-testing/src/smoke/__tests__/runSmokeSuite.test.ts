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

  it('classifies a declarative contribution as skip, not fail', async () => {
    // A panel type is the real skip case: the host mounts an iframe, and
    // there is no extension code behind it for the corpus to call.
    const harness = createSmokeHarness({
      manifest: manifest(),
      activate: async (api) => {
        await api.ui.registerPanelType({
          id: 'panel',
          title: { key: 'Panel' },
          uiEntry: 'ui/index.html',
        });
      },
    });
    await harness.activate();
    const result = await runSmokeSuite({ harness });
    await harness.deactivate();

    const panelRecords = result.records.filter((r) => r.kind === 'panelType');
    expect(panelRecords.length).toBeGreaterThan(0);
    expect(panelRecords.every((r) => r.status === 'skip')).toBe(true);
    expect(panelRecords[0]?.message).toMatch(/declarative/);
    expect(result.totals.failed).toBe(0);
    expect(result.totals.skipped).toBeGreaterThan(0);
  });

  it('classifies a declared-but-unbound endpoint as fail, not skip', async () => {
    const harness = createSmokeHarness({
      manifest: manifest(),
      activate: async (api) => {
        await api.ui.registerVerseHover({
          id: 'hover-dead',
          hoverEndpoint: 'onHover',
        });
      },
    });
    await harness.activate();
    const result = await runSmokeSuite({ harness });
    await harness.deactivate();

    const hoverRecords = result.records.filter((r) => r.hookId === 'hover:hover-dead');
    // Recorded once, not once per corpus entry: the outcome cannot vary with
    // the input, so thirteen identical rows would say nothing extra.
    expect(hoverRecords).toHaveLength(1);
    expect(hoverRecords[0]?.status).toBe('fail');
    expect(hoverRecords[0]?.failureReason).toBe('unbound-endpoint');
    expect(result.totals.failed).toBe(1);
  });

  it('passes an endpoint hook the extension bound and exercises every corpus input', async () => {
    const seen: unknown[] = [];
    const harness = createSmokeHarness({
      manifest: manifest(),
      activate: async (api) => {
        await api.runtime.expose('onHover', (verseId: unknown) => {
          seen.push(verseId);
          return null;
        });
        await api.ui.registerVerseHover({ id: 'hover-live', hoverEndpoint: 'onHover' });
      },
    });
    await harness.activate();
    const result = await runSmokeSuite({ harness });
    await harness.deactivate();

    const hoverRecords = result.records.filter((r) => r.hookId === 'hover:hover-live');
    expect(hoverRecords.length).toBeGreaterThan(1);
    expect(hoverRecords.every((r) => r.status === 'pass')).toBe(true);
    expect(seen).toHaveLength(hoverRecords.length);
    expect(result.totals.failed).toBe(0);
  });

  it('fails a command whose handler throws on one corpus input', async () => {
    const harness = createSmokeHarness({
      manifest: manifest({
        contributes: {
          commands: [
            { id: 'ext.test.suite.go', title: { key: 'go' }, handlerEndpoint: 'go' },
          ],
        },
      }),
      activate: async (api) => {
        await api.runtime.expose('go', (args: unknown) => {
          if (args === null) throw new Error('null args exploded');
        });
      },
    });
    await harness.activate();
    const result = await runSmokeSuite({ harness });
    await harness.deactivate();

    const failed = result.records.filter((r) => r.status === 'fail');
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.every((r) => r.failureReason === 'threw')).toBe(true);
    expect(failed[0]?.message).toContain('null args exploded');
    // The other inputs still ran and passed — a throw on one input does not
    // abandon the rest of the corpus.
    expect(result.totals.passed).toBeGreaterThan(0);
  });
});

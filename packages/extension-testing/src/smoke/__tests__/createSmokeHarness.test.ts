import { describe, it, expect } from 'vitest';
import type { Extensions } from '@bible/core';

import { createSmokeHarness } from '../createSmokeHarness';

function minimalManifest(
  overrides: Partial<Extensions.ExtensionManifest> = {},
): Extensions.ExtensionManifest {
  return {
    id: 'ext.test.harness',
    name: { key: 'ext.test.harness' },
    version: '1.0.0',
    publisher: 'test',
    engines: { bibleApp: '^1.0.0' },
    ...overrides,
  };
}

describe('createSmokeHarness', () => {
  it('enumerates static contributions from the manifest', async () => {
    const harness = createSmokeHarness({
      manifest: minimalManifest({
        contributes: {
          commands: [
            {
              id: 'ext.test.harness.hello',
              title: { key: 'hello' },
              handlerEndpoint: 'sayHello',
            },
          ],
          commentaryProviders: [
            {
              id: 'matthew-henry',
              name: { key: 'Matthew Henry' },
              abbreviation: 'MH',
              capabilities: ['lookup'],
              fetchEndpoint: 'fetchMH',
            },
          ],
        },
      }),
      activate: () => {},
    });
    await harness.activate();
    const hooks = harness.enumerate();
    expect(hooks.find((h) => h.hookId === 'command:ext.test.harness.hello')).toBeDefined();
    expect(hooks.find((h) => h.hookId === 'commentaryProvider:matthew-henry')?.endpoint).toBe(
      'fetchMH',
    );
    await harness.deactivate();
  });

  it('captures dynamic registrations made during activate()', async () => {
    const harness = createSmokeHarness({
      manifest: minimalManifest(),
      activate: async (api) => {
        await api.ui.registerStatusBarItem({
          id: 'sb-1',
          text: 'hi',
        });
        await api.ui.registerVerseHover({
          id: 'hover-1',
          hoverEndpoint: 'onHover',
        });
        await api.bible.onDidChangeActiveVerse.subscribe(() => {});
      },
    });
    await harness.activate();
    const hooks = harness.enumerate();
    expect(hooks.some((h) => h.hookId === 'statusBar:sb-1')).toBe(true);
    expect(hooks.find((h) => h.hookId === 'hover:hover-1')?.endpoint).toBe('onHover');
    expect(hooks.some((h) => h.hookId === 'event:bible.onDidChangeActiveVerse')).toBe(true);
  });

  it('invokes an event hook by firing captured subscribers', async () => {
    let received: unknown = null;
    const harness = createSmokeHarness({
      manifest: minimalManifest(),
      activate: async (api) => {
        await api.bible.onDidChangeActiveVerse.subscribe((payload) => {
          received = payload;
        });
      },
    });
    await harness.activate();
    const result = await harness.invokeHook(
      'event:bible.onDidChangeActiveVerse',
      { verseId: 43003016, module: 'kjv' },
    );
    expect(result.status).toBe('ok');
    expect(received).toEqual({ verseId: 43003016, module: 'kjv' });
  });

  it('reports timeout when an event subscriber hangs', async () => {
    const harness = createSmokeHarness({
      manifest: minimalManifest(),
      activate: async (api) => {
        await api.bible.onDidChangeActiveVerse.subscribe(
          () => new Promise(() => {}),
        );
      },
    });
    await harness.activate();
    const result = await harness.invokeHook(
      'event:bible.onDidChangeActiveVerse',
      null,
      { timeoutMs: 25 },
    );
    expect(result.status).toBe('timeout');
  });

  it('reports threw when an event subscriber throws', async () => {
    const harness = createSmokeHarness({
      manifest: minimalManifest(),
      activate: async (api) => {
        await api.bible.onDidChangeActiveVerse.subscribe(() => {
          throw new Error('boom');
        });
      },
    });
    await harness.activate();
    const result = await harness.invokeHook(
      'event:bible.onDidChangeActiveVerse',
      null,
    );
    expect(result.status).toBe('threw');
    expect(result.error?.message).toBe('boom');
  });

  it('returns not-invokable for endpoint-based hooks in Work Item 1', async () => {
    const harness = createSmokeHarness({
      manifest: minimalManifest(),
      activate: async (api) => {
        await api.ui.registerVerseHover({
          id: 'hover-x',
          hoverEndpoint: 'onHover',
        });
      },
    });
    await harness.activate();
    const result = await harness.invokeHook('hover:hover-x', 43003016);
    expect(result.status).toBe('not-invokable');
    expect(result.reason).toMatch(/--full worker mode/);
  });
});

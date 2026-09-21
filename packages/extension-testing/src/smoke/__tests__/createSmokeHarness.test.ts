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
    // The id is reported qualified even though the manifest was handed over
    // unvalidated: `enumerateHooks` applies the same `ext.<publisher>.<name>.`
    // prefix the manifest validator would have, so a hand-built manifest and
    // one loaded from disk enumerate under identical ids.
    expect(
      hooks.find((h) => h.hookId === 'commentaryProvider:ext.test.harness.matthew-henry')
        ?.endpoint,
    ).toBe('fetchMH');
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

  it('calls an endpoint-based hook through the endpoint the extension exposed', async () => {
    const seen: unknown[] = [];
    const harness = createSmokeHarness({
      manifest: minimalManifest(),
      activate: async (api) => {
        await api.runtime.expose('onHover', (verseId: unknown) => {
          seen.push(verseId);
          return { markdown: 'hello' };
        });
        await api.ui.registerVerseHover({ id: 'hover-x', hoverEndpoint: 'onHover' });
      },
    });
    await harness.activate();
    const result = await harness.invokeHook('hover:hover-x', 43003016);
    expect(result.status).toBe('ok');
    expect(result.value).toEqual({ markdown: 'hello' });
    expect(seen).toEqual([43003016]);
  });

  it('reports a declared hook whose endpoint nothing bound as unbound, not skipped', async () => {
    const harness = createSmokeHarness({
      manifest: minimalManifest(),
      activate: async (api) => {
        // Registers the hover but never exposes `onHover` — in the app the
        // host would call an address nobody is listening on.
        await api.ui.registerVerseHover({ id: 'hover-x', hoverEndpoint: 'onHover' });
      },
    });
    await harness.activate();
    const result = await harness.invokeHook('hover:hover-x', 43003016);
    expect(result.status).toBe('unbound-endpoint');
    expect(result.reason).toMatch(/onHover/);
    expect(result.reason).toMatch(/api\.runtime\.expose/);
  });

  it('propagates a throw from an endpoint handler as threw', async () => {
    const harness = createSmokeHarness({
      manifest: minimalManifest(),
      activate: async (api) => {
        await api.runtime.expose('onHover', () => {
          throw new Error('hover exploded');
        });
        await api.ui.registerVerseHover({ id: 'hover-x', hoverEndpoint: 'onHover' });
      },
    });
    await harness.activate();
    const result = await harness.invokeHook('hover:hover-x', 43003016);
    expect(result.status).toBe('threw');
    expect(result.error?.message).toBe('hover exploded');
  });

  it('reaches a command handler through a context-menu item that names it', async () => {
    let calls = 0;
    const harness = createSmokeHarness({
      manifest: minimalManifest({
        contributes: {
          commands: [
            {
              id: 'ext.test.harness.add',
              title: { key: 'add' },
              handlerEndpoint: 'addIt',
            },
          ],
        },
      }),
      activate: async (api) => {
        await api.runtime.expose('addIt', () => {
          calls += 1;
        });
        await api.ui.registerContextMenu('verse', {
          id: 'addToPlan',
          label: { key: 'add' },
          command: 'ext.test.harness.add',
        });
      },
    });
    await harness.activate();
    const result = await harness.invokeHook('contextMenu:verse:addToPlan', undefined);
    expect(result.status).toBe('ok');
    expect(calls).toBe(1);
  });

  it('reports a context-menu item pointing at a command that does not exist', async () => {
    const harness = createSmokeHarness({
      manifest: minimalManifest(),
      activate: async (api) => {
        await api.ui.registerContextMenu('verse', {
          id: 'addToPlan',
          label: { key: 'add' },
          command: 'ext.test.harness.typo',
        });
      },
    });
    await harness.activate();
    const result = await harness.invokeHook('contextMenu:verse:addToPlan', undefined);
    expect(result.status).toBe('unbound-endpoint');
    expect(result.reason).toMatch(/ext\.test\.harness\.typo/);
  });

  it('merges a manifest panel type with the imperative registration of the same panel', async () => {
    // The manifest validator qualifies `panel` to `ext.test.harness.panel`
    // while `registerPanelType` records the short id, so the same panel used
    // to be reported twice — as though the author had registered two.
    const harness = createSmokeHarness({
      manifest: minimalManifest({
        contributes: {
          panelTypes: [
            {
              id: 'ext.test.harness.panel',
              title: { key: 'Panel' },
              uiEntry: 'ui/index.html',
            },
          ],
        },
      }),
      activate: async (api) => {
        await api.ui.registerPanelType({
          id: 'panel',
          title: { key: 'Panel' },
          uiEntry: 'ui/index.html',
        });
      },
    });
    await harness.activate();
    const panels = harness.enumerate().filter((h) => h.kind === 'panelType');
    expect(panels).toHaveLength(1);
    expect(panels[0]?.hookId).toBe('panelType:ext.test.harness.panel');
    // Runtime wins the merge: it carries the descriptor the extension built.
    expect(panels[0]?.source).toBe('runtime');
  });
});

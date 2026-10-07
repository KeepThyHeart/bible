import path from 'node:path';
import { Extensions } from '@bible/core';
import { describe, it, expect, vi } from 'vitest';

import { createMockApi, getMockRuntimeEndpoints } from '../../createMockApi';
import { loadManifest } from '../loadManifest';
import { createSmokeHarness } from '../createSmokeHarness';
import { runSmokeSuite } from '../runSmokeSuite';

const WORD_COUNT_ROOT = path.resolve(
  __dirname,
  '../../../../word-count-example',
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
      (h) => h.hookId === 'event:verse.activeChanged',
    );
    expect(eventHook).toBeDefined();
    expect(eventHook?.passed).toBeGreaterThan(0);
    expect(eventHook?.failed).toBe(0);
  });
});

describe('word-count reference extension - app', () => {
  const ext = require(path.join(WORD_COUNT_ROOT, 'src/main.js')) as {
    activate(api: unknown): Promise<void>;
    deactivate(): Promise<void>;
  };

  it('has a manifest that validates with the apps contribution and command', () => {
    const { manifest } = loadManifest(WORD_COUNT_ROOT);
    expect(manifest.permissions).toContain('ui:contribute-app');
    expect(manifest.activationEvents).toContain('onApp:counts');
    const apps = manifest.contributes?.apps ?? [];
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({
      id: 'ext.bible-app.word-count.counts',
      uiEntry: 'ui/app.html',
      icon: 'media/counts.svg',
    });
    expect(manifest.contributes?.commands?.[0]?.id).toBe('ext.bible-app.word-count.open');
    expect(Extensions.EXTENSION_API_VERSION).toBeDefined();
  });

  it('activate() binds the command, sets no badge before a verse is known, and the command opens the app', async () => {
    const setBadge = vi.fn().mockResolvedValue(undefined);
    const open = vi.fn().mockResolvedValue(true);
    const api = createMockApi({ apps: { setBadge, open } });
    await ext.activate(api);
    expect(setBadge).not.toHaveBeenCalled();
    expect(getMockRuntimeEndpoints(api).list()).toContain('openApp');
    await getMockRuntimeEndpoints(api).invoke('openApp');
    expect(open).toHaveBeenCalledWith('counts');
    await ext.deactivate();
  });
});

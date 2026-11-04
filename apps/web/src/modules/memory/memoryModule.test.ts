import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => localStorage.clear());

describe('Scripture Memory on the web', () => {
  it('is registered but off for this platform, contributing nothing', async () => {
    vi.resetModules();
    const { registerBuiltinModules } = await import('../builtinModules');
    const { featureModules, modulePoints } = await import('../moduleHost');
    const { appRegistry, verseActions } = await import('../../host/appHost');
    registerBuiltinModules();
    expect(featureModules.list().find((m) => m.id === 'memory')).toMatchObject({ enabled: false, offReason: 'platform' });
    expect(appRegistry.list().map((a) => a.id)).not.toContain('memory');
    expect(verseActions.list().map((a) => a.id)).not.toContain('memory.memorize');
    expect(modulePoints).toBeTruthy();
  }, 60_000);
});

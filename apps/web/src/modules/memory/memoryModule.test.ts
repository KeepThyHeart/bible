import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => localStorage.clear());

describe('Scripture Memory on the web', () => {
  // Main's 1.0 rule (web stores no personal content) holds by default: Memory on the web is behind the
  // `localUserDb` flag (task 0150), off by default. `__tests__/memoryModule.test.ts` covers the flag on.
  it('is registered but off by default (flag localUserDb), contributing nothing', async () => {
    vi.resetModules();
    const { registerBuiltinModules } = await import('../builtinModules');
    const { featureModules, modulePoints } = await import('../moduleHost');
    const { appRegistry, verseActions } = await import('../../host/appHost');
    registerBuiltinModules();
    expect(featureModules.list().find((m) => m.id === 'memory')).toMatchObject({ enabled: false, offReason: 'flag' });
    expect(appRegistry.list().map((a) => a.id)).not.toContain('memory');
    expect(verseActions.list().map((a) => a.id)).not.toContain('memory.memorize');
    expect(modulePoints).toBeTruthy();
  }, 60_000);
});

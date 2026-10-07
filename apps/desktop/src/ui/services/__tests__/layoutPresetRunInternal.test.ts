import { describe, it, expect } from 'vitest';
import { LayoutPresetService } from '../LayoutPresetService';

describe('LayoutPresetService.runInternal', () => {
  it('returns the callback result and ignores manual-change notifications while it runs and until the microtask', async () => {
    const svc = new LayoutPresetService();
    (svc as unknown as { _currentPresetId: string | null })._currentPresetId = 'reading';
    const out = svc.runInternal(() => {
      svc.notifyManualLayoutChange();
      return 42;
    });
    expect(out).toBe(42);
    svc.notifyManualLayoutChange(); // same tick: layout events fired by the call itself
    expect(svc.currentPresetId).toBe('reading');
    await Promise.resolve();
    svc.notifyManualLayoutChange(); // a real user change afterwards clears it
    expect(svc.currentPresetId).toBeNull();
  });

  it('clears the guard even when the callback throws', async () => {
    const svc = new LayoutPresetService();
    (svc as unknown as { _currentPresetId: string | null })._currentPresetId = 'reading';
    expect(() => svc.runInternal(() => { throw new Error('x'); })).toThrow('x');
    await Promise.resolve();
    svc.notifyManualLayoutChange();
    expect(svc.currentPresetId).toBeNull();
  });
});

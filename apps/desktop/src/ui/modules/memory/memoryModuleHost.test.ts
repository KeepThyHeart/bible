/**
 * Memory through the real app host and module host (no mocks of either): it registers with the
 * module, follows it off and on at runtime, and a Memory link reaches the card request.
 * Only the IPC client is replaced.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  on: vi.fn(() => () => undefined),
  getStatus: vi.fn().mockResolvedValue({ due: 2, waiting: 0 }),
  takeNotices: vi.fn().mockResolvedValue([]),
  addVerses: vi.fn(),
}));
vi.mock('./memoryClient', () => ({ memoryClient: client }));
vi.mock('./MemoryAppView', () => ({ MemoryAppView: () => null }));
vi.mock('../notifications/notificationsAPI', () => ({
  notificationsClient: { on: vi.fn(() => () => undefined), takeOpenTarget: vi.fn() },
}));

import { appRegistry, openAppLink, verseActions } from '../../apps/appHost';
import { addDesktopModule, featureModules, reconcileModules } from '../moduleHost';
import { memoryModule, onMemoryCardsRequest } from './memoryModule';

const setOverride = (value: string): void => {
  localStorage.setItem('kth.modules', value);
  reconcileModules();
};

beforeAll(() => addDesktopModule(memoryModule));
beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('Memory through the real hosts', () => {
  it('registers its app and verse action, and drops them when switched off, without a reload', () => {
    reconcileModules();
    expect(appRegistry.get('memory')).toBeTruthy();
    expect(verseActions.list().map((a) => a.id)).toContain('memory.memorize');
    setOverride('-memory');
    expect(appRegistry.get('memory')).toBeUndefined();
    expect(verseActions.list().map((a) => a.id)).not.toContain('memory.memorize');
    setOverride('');
    expect(appRegistry.get('memory')).toBeTruthy();
  });

  it('activates on startup, sets the badge, and clears it when switched off', async () => {
    vi.useFakeTimers();
    try {
      reconcileModules();
      await featureModules.fire('onStartupFinished');
      expect(featureModules.isActive('memory')).toBe(true);
      await vi.advanceTimersByTimeAsync(3000);
      expect(appRegistry.getBadge('memory')).toMatchObject({ kind: 'count', value: 2 });
      setOverride('-memory');
      expect(featureModules.isActive('memory')).toBe(false);
      expect(appRegistry.getBadge('memory')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a Memory link opens the app and asks for the card stack', async () => {
    reconcileModules();
    await featureModules.fire('onStartupFinished');
    const listener = vi.fn();
    const off = onMemoryCardsRequest(listener);
    openAppLink('memory', 'cards');
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    off();
  });
});

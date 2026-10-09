import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ manager: null as unknown, refresh: vi.fn(async () => {}) }));
vi.mock('../../assets/webAssets', () => ({
  getReadyAssetManager: async () => state.manager,
  refreshAssetCatalog: () => state.refresh(),
}));

import { similarAvailability } from './similarAvailability';

function manager(o: { installed?: boolean; offered?: boolean; offeredAfterRefresh?: boolean }) {
  let offered = !!o.offered;
  state.refresh = vi.fn(async () => { offered = offered || !!o.offeredAfterRefresh; });
  state.manager = {
    installed: () => (o.installed ? {} : undefined),
    getSnapshot: () => ({ entries: offered ? [{ id: 'similar-neighbours' }] : [{ id: 'other' }] }),
  };
}

describe('similarAvailability', () => {
  beforeEach(() => similarAvailability.resetForTests());

  it('is false until probed, and stays false when the server does not offer the table', async () => {
    manager({});
    expect(similarAvailability.available).toBe(false);
    await similarAvailability.probe();
    expect(similarAvailability.available).toBe(false);
    expect(state.refresh).toHaveBeenCalled();
  });

  it('is true when the catalog offers the table after a refresh', async () => {
    manager({ offeredAfterRefresh: true });
    await similarAvailability.probe();
    expect(similarAvailability.available).toBe(true);
  });

  it('is true when already installed, without refreshing', async () => {
    manager({ installed: true });
    await similarAvailability.probe();
    expect(similarAvailability.available).toBe(true);
    expect(state.refresh).not.toHaveBeenCalled();
  });

  it('is false when the probe throws', async () => {
    state.manager = { installed: () => { throw new Error('x'); }, getSnapshot: () => ({ entries: [] }) };
    await similarAvailability.probe();
    expect(similarAvailability.available).toBe(false);
  });
});

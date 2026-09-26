import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useNetworkStore } from './useNetworkStore';

/**
 * `useNetworkStore` is the one source of truth every UI surface reads the
 * master switch from, so what matters is: it starts fail-closed, `load()`
 * never throws even with no bridge, and `requestAllow()` always stores and
 * returns the RESULT of main's round trip - never the request - so a
 * cancelled confirmation dialog is never mistaken for success.
 */

function setBridge(bridge: unknown): void {
  (window as unknown as { electron?: unknown }).electron = bridge ? { network: bridge } : undefined;
}

beforeEach(() => {
  useNetworkStore.setState({ allowWebRequests: false, loaded: false });
});

describe('useNetworkStore', () => {
  it('starts offline and unloaded', () => {
    expect(useNetworkStore.getState().allowWebRequests).toBe(false);
    expect(useNetworkStore.getState().loaded).toBe(false);
  });

  it('load() adopts the persisted value from main', async () => {
    setBridge({ getAllowWebRequests: vi.fn().mockResolvedValue({ ok: true, value: true }) });
    await useNetworkStore.getState().load();
    expect(useNetworkStore.getState()).toMatchObject({ allowWebRequests: true, loaded: true });
  });

  it('load() is a safe no-op with no bridge at all', async () => {
    setBridge(undefined);
    await expect(useNetworkStore.getState().load()).resolves.toBeUndefined();
    expect(useNetworkStore.getState()).toMatchObject({ allowWebRequests: false, loaded: false });
  });

  it('load() leaves the safe default when the bridge rejects', async () => {
    setBridge({ getAllowWebRequests: vi.fn().mockRejectedValue(new Error('no ipc')) });
    await useNetworkStore.getState().load();
    expect(useNetworkStore.getState()).toMatchObject({ allowWebRequests: false, loaded: false });
  });

  it('requestAllow(true) resolves to the confirmed value and stores it', async () => {
    const setAllowWebRequests = vi.fn().mockResolvedValue({ ok: true, value: true });
    setBridge({ setAllowWebRequests });
    const result = await useNetworkStore.getState().requestAllow(true);
    expect(setAllowWebRequests).toHaveBeenCalledWith(true);
    expect(result).toBe(true);
    expect(useNetworkStore.getState().allowWebRequests).toBe(true);
  });

  it('requestAllow(true) resolves to false when the user cancels the dialog', async () => {
    setBridge({ setAllowWebRequests: vi.fn().mockResolvedValue({ ok: true, value: false }) });
    const result = await useNetworkStore.getState().requestAllow(true);
    expect(result).toBe(false);
    expect(useNetworkStore.getState().allowWebRequests).toBe(false);
  });

  it('requestAllow() never assumes the request took effect on a malformed reply', async () => {
    setBridge({ setAllowWebRequests: vi.fn().mockResolvedValue({ ok: false, error: { code: 'internal', message: 'boom' } }) });
    const result = await useNetworkStore.getState().requestAllow(true);
    expect(result).toBe(false);
  });

  it('requestAllow() fails closed with no bridge', async () => {
    setBridge(undefined);
    const result = await useNetworkStore.getState().requestAllow(true);
    expect(result).toBe(false);
  });

  it('picks up a change broadcast from another window after load() subscribes', async () => {
    const handlers: Array<(allow: boolean) => void> = [];
    setBridge({
      getAllowWebRequests: vi.fn().mockResolvedValue({ ok: true, value: false }),
      onChanged: vi.fn((cb: (allow: boolean) => void) => {
        handlers.push(cb);
        return () => {};
      }),
    });
    await useNetworkStore.getState().load();
    expect(handlers).toHaveLength(1);

    handlers[0](true);
    expect(useNetworkStore.getState()).toMatchObject({ allowWebRequests: true, loaded: true });
  });
});

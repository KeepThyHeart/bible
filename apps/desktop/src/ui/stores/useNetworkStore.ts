/**
 * Renderer-wide mirror of the master "Allow web requests" switch.
 *
 * Single source of truth for every UI surface that reads or flips the
 * switch - the native menu checkbox (`main.tsx`), the Preferences → Privacy
 * toggle, first run's network step, and the Module Manager's offline banner -
 * so none of them can disagree about the current state. Before this store
 * existed `main.tsx` kept its own module-level `allowWebRequests` variable
 * purely to paint the menu; every other consumer had no way to read it.
 *
 * `allowWebRequests` starts `false` and `loaded` starts `false` until
 * `load()` resolves. A consumer that needs to know "is the switch off, for
 * sure" (not just "assume offline until proven otherwise") should check
 * `loaded` too - see `LanguageFirstRun.tsx`, which only inserts its network
 * step once `loaded` is true, rather than guessing from the safe default.
 *
 * The actual on/off decision never happens here: `requestAllow(true)` always
 * round-trips through the main-process `network:set-allow-web-requests`
 * handler, which raises the native confirmation dialog (`confirmEnable()` in
 * `electron/ipc/networkHandlers.ts`). This store only ever stores and returns
 * the RESULT of that round trip, never the request - a cancelled dialog comes
 * back `false` and callers must render from that, exactly as
 * `main.tsx`'s menu toggle always has.
 */

import { create } from 'zustand';

export interface NetworkState {
  /** False until proven otherwise - the same fail-closed default as `NetworkConfig`. */
  allowWebRequests: boolean;
  /** True once a real answer has been read from main at least once. */
  loaded: boolean;
  /** Read the persisted switch from main. Safe to call more than once. */
  load(): Promise<void>;
  /**
   * Ask main to change the switch. Turning it off is immediate; turning it on
   * raises the native confirmation dialog and this resolves to whatever the
   * user decided - `false` on cancel, never assume the request took effect.
   */
  requestAllow(allow: boolean): Promise<boolean>;
}

interface NetworkBridge {
  getAllowWebRequests: () => Promise<{ ok: boolean; value?: boolean }>;
  setAllowWebRequests: (allow: boolean) => Promise<{ ok: boolean; value?: boolean }>;
  onChanged?: (cb: (allow: boolean) => void) => () => void;
}

/** Re-read each call rather than cached at module scope, so tests that set
 * `window.electron` after this module has already been imported still work -
 * same reasoning as `requireElectronAPI()`, but tolerant of a missing bridge
 * (a store with nothing to ask must fail closed, not throw). */
function getBridge(): NetworkBridge | undefined {
  return (window as unknown as { electron?: { network?: NetworkBridge } }).electron?.network;
}

// Other windows' toggles (or this window's own menu/Preferences/first-run
// interleaved with a detached pane) broadcast `network:changed`; subscribed
// lazily on first `load()` so it only fires once even if `load()` is called
// from several mounted components, and so tests can install `window.electron`
// before anything subscribes.
let subscribedToChanges = false;
function ensureSubscribed(): void {
  if (subscribedToChanges) return;
  const bridge = getBridge();
  if (!bridge?.onChanged) return;
  subscribedToChanges = true;
  bridge.onChanged((allow) => {
    useNetworkStore.setState({ allowWebRequests: allow, loaded: true });
  });
}

export const useNetworkStore = create<NetworkState>((set) => ({
  allowWebRequests: false,
  loaded: false,

  load: async () => {
    ensureSubscribed();
    const bridge = getBridge();
    if (!bridge) return; // No bridge (tests, or a host with no network IPC) - stay unloaded.
    try {
      const res = await bridge.getAllowWebRequests();
      if (res.ok && typeof res.value === 'boolean') {
        set({ allowWebRequests: res.value, loaded: true });
      }
    } catch {
      // Leave the safe default; a later call can still ask again.
    }
  },

  requestAllow: async (allow) => {
    const bridge = getBridge();
    if (!bridge) return false;
    try {
      const res = await bridge.setAllowWebRequests(allow);
      const next = res.ok && typeof res.value === 'boolean' ? res.value : false;
      set({ allowWebRequests: next, loaded: true });
      return next;
    } catch {
      return false;
    }
  },
}));

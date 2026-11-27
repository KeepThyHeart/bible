import { create } from 'zustand';
import { lookUpAll, normalizeLookUpText } from '@bible/core/browser';
import type { LookUpGroup, LookUpQuery } from '@bible/core/browser';
import { lookUpRegistry } from '../lookUp/lookUpRegistry';

interface LookUpState {
  /** What is being (or was last) looked up; null when the results are dismissed. */
  query: LookUpQuery | null;
  groups: LookUpGroup[];
  loading: boolean;
  /** Bumps per request so a slow earlier answer cannot overwrite a newer one. */
  seq: number;
  /**
   * The Dictionary pane a "Look up" from the Bible pane is for, and a counter bumped per request. The
   * pane shows its Overview (where the results are) when it sees a request for itself - read from the
   * store rather than an event, so a pane that is only just being opened for the look-up cannot miss it.
   */
  showRequest: { panelId: string; id: number } | null;
  requestShow: (panelId: string) => void;
  run: (query: LookUpQuery) => Promise<void>;
  clear: () => void;
}

export const useLookUpStore = create<LookUpState>((set, get) => ({
  query: null,
  groups: [],
  loading: false,
  seq: 0,
  showRequest: null,

  requestShow: (panelId) => set({ showRequest: { panelId, id: (get().showRequest?.id ?? 0) + 1 } }),

  run: async (raw) => {
    const query: LookUpQuery = { text: normalizeLookUpText(raw.text), strongs: raw.strongs };
    if (!query.text) return;
    const seq = get().seq + 1;
    set({ query, groups: [], loading: true, seq });
    let groups: LookUpGroup[] = [];
    try {
      groups = await lookUpAll(lookUpRegistry, query);
    } catch (error) {
      console.error('[LookUp] failed:', error);
    }
    if (get().seq === seq) set({ groups, loading: false });
  },

  clear: () => set({ query: null, groups: [], loading: false, seq: get().seq + 1 }),
}));

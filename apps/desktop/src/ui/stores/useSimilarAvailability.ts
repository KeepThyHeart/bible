import { create } from 'zustand';
import { similarAPI } from '../services/electronAPI';
import { whenContextService } from '../services/WhenContextService';

/**
 * Feature detection for similar passages (task 0070). The feature is offered only when the main
 * process has data for it: the semantic pack is installed (live scan) or a neighbour table is
 * loaded, downloading or offered by the asset catalog. Otherwise the command and the verse menu
 * entry stay hidden. Not persisted; refreshed at startup and whenever the verse menu opens.
 */
interface SimilarAvailabilityState {
  available: boolean;
  refresh: () => Promise<void>;
}

export const useSimilarAvailability = create<SimilarAvailabilityState>((set, get) => ({
  available: false,
  refresh: async () => {
    let available = false;
    try {
      const s = await similarAPI.status();
      available = s.live || s.table !== 'missing';
    } catch {
      available = false;
    }
    if (available !== get().available) set({ available });
    whenContextService.set('similarAvailable', available);
  },
}));

/**
 * Feature detection for similar passages (task 0070): the feature exists only when the server's asset
 * catalog offers the `similar-neighbours` table (or it is already installed). Until the probe answers,
 * and when it fails, the feature stays hidden.
 */

import { Store } from '../stores/Store';
import { getReadyAssetManager, refreshAssetCatalog } from '../assets/webAssets';
import { SIMILAR_ASSET_ID } from './similarTable';

class SimilarAvailability extends Store {
  available = false;
  private probing: Promise<void> | null = null;

  /** Starts the probe once; later calls return the same promise. Never throws. */
  probe(): Promise<void> {
    if (!this.probing) {
      this.probing = (async () => {
        try {
          const m = await getReadyAssetManager();
          const has = () => !!m.installed(SIMILAR_ASSET_ID) || m.getSnapshot().entries.some((e) => e.id === SIMILAR_ASSET_ID);
          if (!has()) await refreshAssetCatalog();
          this.set(has());
        } catch {
          this.set(false);
        }
      })();
    }
    return this.probing;
  }

  private set(v: boolean): void {
    if (v === this.available) return;
    this.available = v;
    this.notify();
  }

  resetForTests(): void {
    this.available = false;
    this.probing = null;
  }
}

export const similarAvailability = new SimilarAvailability();

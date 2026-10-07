/**
 * The translation the user is "on", without importing any Study store.
 *
 * Study registers its `bibleStore` as the source once it has booted
 * (`preferredBible.setSource(bibleStore)`). Until then (a cold Presenter boot)
 * the answer is the active tab of the saved reader session, else the default
 * Bible. Imports only `Store` and `settingsStore`, so the Presenter and the
 * shell can use it without dragging Study into their chunk.
 */
import { Store } from '../stores/Store';
import { settingsStore } from '../stores/settingsStore';

export interface PreferredBibleSource {
  getActiveModule(): string;
  subscribe(fn: () => void): () => void;
}

function savedSessionModule(): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem('bible-reader-session') || 'null');
    const tab = saved && saved.tabs && saved.tabs[saved.activeTabIndex || 0];
    return tab && typeof tab.moduleAbbr === 'string' && tab.moduleAbbr ? tab.moduleAbbr : null;
  } catch {
    return null;
  }
}

export class PreferredBible extends Store {
  private source: PreferredBibleSource | null = null;
  private unsubscribe: (() => void) | null = null;

  get module(): string {
    if (this.source) return this.source.getActiveModule();
    return savedSessionModule() ?? settingsStore.getDefaultBible();
  }

  setSource(src: PreferredBibleSource | null): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.source = src;
    if (src) this.unsubscribe = src.subscribe(() => this.notify());
    this.notify();
  }
}

export const preferredBible = new PreferredBible();

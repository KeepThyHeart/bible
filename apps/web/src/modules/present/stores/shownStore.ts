import { Store } from '../../../stores/Store';
import type { PresentItem } from '../lib/protocol';
import { describeItem } from '../study/usePresenter';

/**
 * Items put on the screen from somewhere other than the notes or plan (the
 * command box, a picker, a search result), newest first, so one can be shown
 * again or added to the notes. Memory only; capped; de-duplicated by item.
 */
export interface ShownEntry { id: string; item: PresentItem; label: string }

const CAP = 20;

function itemKey(item: PresentItem): string {
  return JSON.stringify(item);
}

function defaultLabel(item: PresentItem): string {
  const index = item.kind === 'passage' ? item.verseStart ?? 0 : 0;
  return describeItem(item, index) || (item.kind === 'quote' ? 'Quote' : item.kind);
}

class ShownStore extends Store {
  items: ShownEntry[] = [];

  record(item: PresentItem, label?: string): void {
    const id = itemKey(item);
    const entry: ShownEntry = { id, item, label: label || defaultLabel(item) };
    this.items = [entry, ...this.items.filter((e) => e.id !== id)].slice(0, CAP);
    this.notify();
  }

  remove(id: string): void {
    if (!this.items.some((e) => e.id === id)) return;
    this.items = this.items.filter((e) => e.id !== id);
    this.notify();
  }

  clear(): void {
    if (this.items.length === 0) return;
    this.items = [];
    this.notify();
  }
}

export const shownStore = new ShownStore();

/**
 * The link between `CommandBox` (which owns the query) and
 * `CommandSearchResults` (which the host places wherever it likes: the Control
 * pane, a page-wide banner). A tiny store, not props, because the two
 * components live in different parts of the layout.
 *
 * The box drives selection with Up/Down/Enter while it keeps focus; the results
 * component registers what "show" and "add to notes" mean (it knows the sink),
 * so the box never needs to know how a result becomes an intent.
 */

import { Store } from '../../../../stores/Store';
import type { HymnSummary } from '../hymns';

export type SearchItem =
  | { kind: 'verse'; key: string; verseId: number; module: string; reference: string; text: string }
  | { kind: 'hymn'; key: string; hymn: HymnSummary };

export interface SearchActions {
  show(item: SearchItem): void;
  addToNotes?(item: SearchItem): void;
}

class CommandSearchStore extends Store {
  /** The search being shown, or null when closed. */
  query: string | null = null;
  items: SearchItem[] = [];
  selected = 0;
  private actions: SearchActions | null = null;

  open(query: string): void {
    this.query = query;
    this.items = [];
    this.selected = 0;
    this.notify();
  }

  close(): void {
    if (this.query === null) return;
    this.query = null;
    this.items = [];
    this.selected = 0;
    this.notify();
  }

  setItems(items: SearchItem[]): void {
    this.items = items;
    this.selected = 0;
    this.notify();
  }

  select(index: number): void {
    if (this.items.length === 0) return;
    this.selected = Math.min(Math.max(index, 0), this.items.length - 1);
    this.notify();
  }

  move(delta: number): void {
    if (this.items.length === 0) return;
    this.select((this.selected + delta + this.items.length) % this.items.length);
  }

  registerActions(actions: SearchActions | null): void {
    this.actions = actions;
  }

  /** Run the selected result. Returns false when nothing could be done. */
  activate(mode: 'show' | 'notes' = 'show', index = this.selected): boolean {
    const item = this.items[index];
    if (!item || !this.actions) return false;
    if (mode === 'notes') {
      if (!this.actions.addToNotes) return false;
      this.actions.addToNotes(item);
    } else {
      this.actions.show(item);
    }
    return true;
  }
}

export const commandSearch = new CommandSearchStore();

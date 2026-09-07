/**
 * Typed event bus for decoupling components and stores.
 *
 * Events are strongly typed via the EventMap interface. Plugins and core
 * code share the same bus — plugins subscribe via ClientPluginContext.eventBus.
 */

import type { VerseFootnote } from '../types';

// ---------------------------------------------------------------------------
// Event Map — every event name maps to its payload type
// ---------------------------------------------------------------------------

export interface EventMap {
  /** Highlighted verse changed in Bible pane */
  'bible:verse-selected': {
    verseId: number;
    book: number;
    chapter: number;
    verse: number;
    footnotes?: VerseFootnote[];
  };

  /** Request to switch visible right pane */
  'pane:show': { paneId: string };

  /** Request to un-collapse right pane area */
  'pane:expand': void;

  /** Open a Strong's entry in Dictionary */
  'strongs:open': { strongsNumber: string };

  /** Load commentary for a chapter */
  'commentary:load-chapter': { book: number; chapter: number };

  /** Load study data for a specific verse */
  'study:load-verse': {
    verseId: number;
    book: number;
    chapter: number;
    verse: number;
    footnotes?: VerseFootnote[];
  };
}

// ---------------------------------------------------------------------------
// Event Bus implementation
// ---------------------------------------------------------------------------

type Handler<T> = (payload: T) => void;

class EventBus {
  private handlers = new Map<string, Set<Handler<unknown>>>();
  private debugEnabled = false;

  constructor() {
    // Enable debug mode via localStorage (browser) or env (Node)
    if (typeof localStorage !== 'undefined') {
      this.debugEnabled = localStorage.getItem('debug-events') === 'true';
    }
  }

  /**
   * Subscribe to an event. Returns an unsubscribe function.
   */
  on<K extends keyof EventMap>(
    event: K,
    handler: Handler<EventMap[K]>,
  ): () => void {
    const key = event as string;
    if (!this.handlers.has(key)) {
      this.handlers.set(key, new Set());
    }
    const set = this.handlers.get(key)!;
    set.add(handler as Handler<unknown>);
    return () => {
      set.delete(handler as Handler<unknown>);
      if (set.size === 0) this.handlers.delete(key);
    };
  }

  /**
   * Emit an event to all subscribers.
   */
  emit<K extends keyof EventMap>(
    event: K,
    ...args: EventMap[K] extends void ? [] : [payload: EventMap[K]]
  ): void {
    if (this.debugEnabled) {
      console.debug(`[EventBus] ${String(event)}`, args[0] ?? '');
    }
    const set = this.handlers.get(event as string);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(args[0] as unknown);
      } catch (err) {
        console.error(`[EventBus] Error in handler for "${String(event)}":`, err);
      }
    }
  }

  /**
   * Remove all subscribers (useful for testing / cleanup).
   */
  clear(): void {
    this.handlers.clear();
  }
}

/** Singleton event bus instance */
export const eventBus = new EventBus();

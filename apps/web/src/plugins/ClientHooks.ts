/**
 * Client-side hook type definitions.
 *
 * These typed maps define all available filter and action hooks on the client.
 */

import type { HookRegistry } from '@bible/core/browser';
import type { VerseData } from '../types';

// ---------------------------------------------------------------------------
// Filter hooks — transform data in the client pipeline
// ---------------------------------------------------------------------------

export interface ClientFilterMap {
  /** Transform structured verse data after fetch, before store update.
   *  Good for adding metadata, _pluginData fields. Type-safe. */
  'verse:data': {
    verses: VerseData[];
    module: string;
    book: number;
    chapter: number;
  };

  /** Transform rendered verse HTML before display.
   *  Maximum flexibility for visual-only enhancements (badges, icons).
   *  Use with care — XSS risk if not sanitized. */
  'verse:html': {
    html: string;
    verseId: number;
    module: string;
  };

  /** Transform chapter data after fetch, before display */
  'chapter:fetched': {
    verses: VerseData[];
    module: string;
    book: number;
    chapter: number;
  };

  /** Transform context menu items before display.
   *  Add/remove/reorder items. */
  'contextMenu:items': {
    items: Array<{
      id: string;
      label: string;
      icon?: string;
      order: number;
      action: string;
    }>;
    verseId: number;
  };

  /** Transform study pane data after loading */
  'study:data': {
    verseId: number;
    data: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// Action hooks — side-effect notifications
// ---------------------------------------------------------------------------

export interface ClientActionMap {
  /** User navigated to a new chapter */
  'navigate:chapter': {
    module: string;
    book: number;
    chapter: number;
  };

  /** User selected/highlighted a verse */
  'verse:selected': {
    verseId: number;
    book: number;
    chapter: number;
    verse: number;
  };

  /** A Bible tab was opened, closed, or switched */
  'tab:changed': {
    action: 'open' | 'close' | 'switch';
    tabId: string;
    module: string;
  };

  /** User settings changed */
  'settings:changed': {
    key: string;
    value: unknown;
  };
}

// ---------------------------------------------------------------------------
// Typed client hook registry
// ---------------------------------------------------------------------------

export type ClientHookRegistry = HookRegistry<ClientFilterMap, ClientActionMap>;

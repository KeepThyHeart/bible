/**
 * Server-side hook type definitions.
 *
 * These typed maps define all available filter and action hooks on the server.
 * The HookRegistry is instantiated with these maps to provide type-safe
 * hook registration and invocation.
 */

import type { HookRegistry } from '@bible/core';

// ---------------------------------------------------------------------------
// Filter hooks — transform data before sending to client
// ---------------------------------------------------------------------------

export interface ServerFilterMap {
  /** Transform verse data after loading from repository.
   *  Use case: inject annotations, add plugin metadata to verses */
  'verse:loaded': {
    verses: unknown[];
    module: string;
    book: number;
    chapter: number;
  };

  /** Transform search results before sending to client.
   *  Use case: boost/demote results, inject plugin-specific results */
  'search:results': {
    results: unknown[];
    query: string;
  };

  /** Transform commentary data before sending to client.
   *  Use case: add cross-references, inject supplementary commentary */
  'commentary:loaded': {
    entries: unknown[];
    module: string;
    book: number;
    chapter: number;
  };

  /** Transform dictionary data before sending to client.
   *  Use case: add etymology, usage examples, related entries */
  'dictionary:loaded': {
    entries: unknown[];
    module: string;
    key: string;
  };
}

// ---------------------------------------------------------------------------
// Action hooks — side-effect notifications (fire-and-forget)
// ---------------------------------------------------------------------------

export interface ServerActionMap {
  /** A chapter was requested by a user */
  'chapter:viewed': {
    module: string;
    book: number;
    chapter: number;
  };

  /** A search was performed */
  'search:performed': {
    query: string;
    resultCount: number;
  };

  /** A module database was opened for the first time */
  'module:opened': {
    abbreviation: string;
    moduleType: string;
  };

  /** Server is shutting down — plugins should clean up */
  'server:shutdown': void;
}

// ---------------------------------------------------------------------------
// Typed server hook registry
// ---------------------------------------------------------------------------

export type ServerHookRegistry = HookRegistry<ServerFilterMap, ServerActionMap>;

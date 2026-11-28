/**
 * Which screen is showing, and how we got there.
 *
 * There is no router and no history. A panel is a docked pane inside another
 * application; pushing entries onto the iframe's history would put a Back
 * gesture in a place the user has no reason to expect one, and popping it
 * would fight the host's own navigation. So view state is an ordinary value
 * and this module is an ordinary reducer over it - which has the pleasant side
 * effect that "where does leaving an activity return to?" is a pure function
 * with a unit test rather than a variable someone forgot to reset.
 *
 * DOM-free on purpose; see the note at the top of `format.ts`.
 */

import type { Rung } from '../core/types';

export type Tab = 'home' | 'practice' | 'verses' | 'settings';
/** My verses List filter: all lists, or one list's id. */
export type VersesFilter = 'all' | number;

/**
 * The screens. Home, the practice queue, My verses and Settings are the tab roots; the verse page,
 * the starter-set browser, the reminder cards, practice and recite are opened from them and show
 * under the tab they were opened from (the tab bar never goes away).
 *
 * Practice carries the session id rather than the session: the worker owns the
 * session, and a copy stored here would go stale on the first step.
 */
export type View =
  | { name: 'home' }
  | { name: 'queue' }
  | { name: 'verses'; list: VersesFilter; highlight?: number }
  | { name: 'settings'; listId: number | null }
  | { name: 'verse'; passageId: number }
  | { name: 'starters'; key: string | null }
  | { name: 'card' }
  | { name: 'practice'; sessionId: string }
  | { name: 'recite'; reciteId: string; mode: 'tap' | 'handsfree' };

/**
 * What the user pressed to get into practice. Flows are immutable values: every
 * skip or visit creates a new one.
 *
 * `list` on `today` / `anyway` keeps the whole run inside one list (Home's per-list Practice)
 * without touching the saved Practice focus; absent, the flow follows the focus. See
 * `flows.ts#flowScope`.
 */
export type Flow =
  | { kind: 'today'; skipped: readonly number[]; startTotal?: number; list?: number }
  | { kind: 'anyway'; visited: readonly number[]; startTotal?: number; list?: number }
  | { kind: 'mixed'; visited: readonly number[]; startTotal?: number }
  | { kind: 'activity'; rung: Rung; visited: readonly number[]; startTotal?: number }
  | { kind: 'verse'; passageId: number };

export interface NavState {
  view: View;
  /** Where leaving practice, recite, a verse page, the starter sets or the cards goes back to. */
  returnTo: View;
  /** The flow of the current (or most recent) session; only practice reads it. */
  flow: Flow | null;
  /** The My verses filter last used, so leaving and returning keeps it. */
  versesList: VersesFilter;
  /** The list selected in Settings' Lists section; session only. */
  listsSelected: number | null;
  /**
   * The selected tab. A tab root sets it; an opened screen (verse page, starter sets, practice,
   * recite) shows under the tab that was selected when it opened.
   */
  tab: Tab;
}

export type NavAction =
  | { type: 'goTab'; tab: Tab }
  /** Settings, optionally with a list selected in its Lists section (undefined keeps the selection). */
  | { type: 'goSettings'; listId?: number | null }
  /** Alias of goSettings with a list: the Lists section of Settings. */
  | { type: 'goLists'; listId?: number | null }
  | { type: 'goCard' }
  | { type: 'goVerses'; list?: VersesFilter; highlight?: number }
  | { type: 'goVerse'; passageId: number }
  /** The verse page's close: back to wherever the verse was opened from. */
  | { type: 'leaveVerse' }
  /** The starter-set browser, with one set's preview open (null: none). */
  | { type: 'goStarters'; key?: string | null }
  | { type: 'leaveStarters' }
  | { type: 'sessionStarted'; sessionId: string; passageId: number; rung: Rung; flow: Flow }
  | { type: 'sessionEnded' }
  /** A5 "Stop for today". */
  | { type: 'stopForToday' }
  | { type: 'reciteStarted'; reciteId: string; mode: 'tap' | 'handsfree' }
  | { type: 'reciteEnded' }
  /** The verse a view is about has gone away (removed here or in another window). */
  | { type: 'passageRemoved'; passageId: number };

export const INITIAL_NAV: NavState = {
  view: { name: 'home' },
  returnTo: { name: 'home' },
  flow: null,
  versesList: 'all',
  listsSelected: null,
  tab: 'home',
};

/** The tab a tab-root view belongs to (null for an opened screen). */
export function rootTab(view: View): Tab | null {
  switch (view.name) {
    case 'home':
    case 'card':
      return 'home';
    case 'queue':
      return 'practice';
    case 'verses':
      return 'verses';
    case 'settings':
      return 'settings';
    default:
      return null;
  }
}

/** True for the screens drawn at the root of a tab. */
export function isTabRoot(view: View): boolean {
  return view.name === 'home' || view.name === 'queue' || view.name === 'verses' || view.name === 'settings';
}

/**
 * Where a screen opened from `state` returns to. Tab roots are screens to come back to
 * (My verses without its one-off highlight); a screen opened from another opened screen keeps
 * the first one's origin; practice, recite and the cards are transient and fall back to My verses.
 */
function originOf(state: NavState): View {
  const v = state.view;
  switch (v.name) {
    case 'home':
    case 'queue':
    case 'settings':
      return v;
    case 'verses':
      return { name: 'verses', list: v.list };
    case 'verse':
    case 'starters':
      return state.returnTo;
    default:
      return { name: 'verses', list: state.versesList };
  }
}

/** The returnTo a screen gets when it is arrived at by going back to it. */
function returnToFor(view: View): View {
  return view.name === 'card' ? { name: 'home' } : view;
}

function tabView(tab: Tab, versesList: VersesFilter, listsSelected: number | null): View {
  switch (tab) {
    case 'home':
      return { name: 'home' };
    case 'practice':
      return { name: 'queue' };
    case 'verses':
      return { name: 'verses', list: versesList };
    default:
      return { name: 'settings', listId: listsSelected };
  }
}

export function navReduce(state: NavState, action: NavAction): NavState {
  const next = reduceView(state, action);
  if (next === state) return state;
  const tab = rootTab(next.view) ?? state.tab;
  return next.tab === tab ? next : { ...next, tab };
}

function reduceView(state: NavState, action: NavAction): NavState {
  const keep = { flow: state.flow, versesList: state.versesList, listsSelected: state.listsSelected, tab: state.tab };
  switch (action.type) {
    case 'goTab': {
      const view = tabView(action.tab, state.versesList, state.listsSelected);
      return { ...keep, view, returnTo: view };
    }

    case 'goVerses': {
      const list = action.list ?? state.versesList;
      const view: View = { name: 'verses', list, highlight: action.highlight };
      return { ...keep, versesList: list, view, returnTo: { name: 'verses', list } };
    }

    case 'goSettings':
    case 'goLists': {
      const listId = action.listId === undefined ? state.listsSelected : action.listId;
      const view: View = { name: 'settings', listId };
      return { ...keep, listsSelected: listId, view, returnTo: view };
    }

    case 'goCard':
      return { ...keep, view: { name: 'card' }, returnTo: { name: 'home' } };

    case 'goVerse':
      return { ...keep, view: { name: 'verse', passageId: action.passageId }, returnTo: originOf(state) };

    case 'leaveVerse': {
      if (state.view.name !== 'verse') return state;
      // Back on a verse page after practice or recite started from it, returnTo
      // is that same page and its own origin is gone: fall back to My verses.
      const to: View = state.returnTo.name === 'verse' ? { name: 'verses', list: state.versesList } : state.returnTo;
      return { ...keep, view: to, returnTo: returnToFor(to) };
    }

    case 'goStarters': {
      const key = action.key === undefined ? (state.view.name === 'starters' ? state.view.key : null) : action.key;
      const view: View = { name: 'starters', key };
      return { ...keep, view, returnTo: state.view.name === 'starters' ? state.returnTo : originOf(state) };
    }

    case 'leaveStarters': {
      if (state.view.name !== 'starters') return state;
      const to = state.returnTo;
      return { ...keep, view: to, returnTo: returnToFor(to) };
    }

    case 'sessionStarted': {
      const view: View = { name: 'practice', sessionId: action.sessionId };
      // Another session started without ending the first (Again, Continue), or one started from
      // recite: returnTo already names where the chain began and is left alone.
      if (state.view.name === 'practice' || state.view.name === 'recite') return { ...keep, flow: action.flow, view, returnTo: state.returnTo };
      return { ...keep, flow: action.flow, view, returnTo: state.view.name === 'card' ? { name: 'home' } : state.view };
    }

    case 'sessionEnded':
    case 'stopForToday':
      if (state.view.name !== 'practice') return state;
      return { ...keep, view: state.returnTo, returnTo: returnToFor(state.returnTo) };

    case 'reciteStarted': {
      const v = state.view.name;
      const returnTo: View =
        v === 'practice' || v === 'recite' ? state.returnTo : v === 'card' ? { name: 'home' } : state.view;
      return { ...keep, view: { name: 'recite', reciteId: action.reciteId, mode: action.mode }, returnTo };
    }

    case 'reciteEnded':
      if (state.view.name !== 'recite') return state;
      return { ...keep, view: state.returnTo, returnTo: returnToFor(state.returnTo) };

    case 'passageRemoved': {
      const on = (v: View) => v.name === 'verse' && v.passageId === action.passageId;
      if (!on(state.view) && !on(state.returnTo)) return state;
      const verses: View = { name: 'verses', list: state.versesList };
      // A practice session on a removed verse is left alone (the worker ends it);
      // only the destination is repaired.
      // The same goes for a recite run.
      if (state.view.name === 'practice' || state.view.name === 'recite') return { ...keep, view: state.view, returnTo: verses };
      // On the removed verse's own page: back to where it was opened from.
      if (on(state.view) && !on(state.returnTo)) {
        return { ...keep, view: state.returnTo, returnTo: returnToFor(state.returnTo) };
      }
      return { ...keep, view: verses, returnTo: verses };
    }

    default:
      return state;
  }
}

/** True when the two views would render the same screen. */
export function sameView(a: View, b: View): boolean {
  if (a.name !== b.name) return false;
  if (a.name === 'verses' && b.name === 'verses') return a.list === b.list;
  if (a.name === 'settings' && b.name === 'settings') return a.listId === b.listId;
  if (a.name === 'starters' && b.name === 'starters') return a.key === b.key;
  if (a.name === 'verse' && b.name === 'verse') return a.passageId === b.passageId;
  if (a.name === 'practice' && b.name === 'practice') return a.sessionId === b.sessionId;
  if (a.name === 'recite' && b.name === 'recite') return a.reciteId === b.reciteId;
  return true;
}

/**
 * True when going from `a` to `b` stays on the same screen (a refresh, or a starter-set preview opened or
 * closed): mount keeps the scroll position and the focus instead of starting at the top.
 */
export function sameScreen(a: View, b: View): boolean {
  return (a.name === 'starters' && b.name === 'starters') || sameView(a, b);
}

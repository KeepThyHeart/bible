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

export type Tab = 'today' | 'verses' | 'progress';
/** My verses filter: 'focus' follows the persisted focus (the plan's scope), else an explicit chip. */
export type VersesFilter = 'focus' | 'all' | number;

/**
 * The screens. Today, My verses and Progress are tabs; settings, the verse page,
 * the reminder cards, practice and recite are focused screens.
 *
 * Practice carries the session id rather than the session: the worker owns the
 * session, and a copy stored here would go stale on the first step.
 */
export type View =
  | { name: 'today' }
  | { name: 'verses'; list: VersesFilter; highlight?: number }
  | { name: 'verse'; passageId: number }
  | { name: 'progress' }
  | { name: 'settings' }
  | { name: 'card' }
  | { name: 'practice'; sessionId: string }
  | { name: 'recite'; reciteId: string; mode: 'tap' | 'handsfree' };

/**
 * What the user pressed to get into practice. Flows are immutable values: every
 * skip or visit creates a new one.
 */
export type Flow =
  | { kind: 'today'; skipped: readonly number[] }
  | { kind: 'anyway'; visited: readonly number[] }
  | { kind: 'mixed'; visited: readonly number[] }
  | { kind: 'activity'; rung: Rung; visited: readonly number[] }
  | { kind: 'verse'; passageId: number };

export interface NavState {
  view: View;
  /** Where leaving practice, a verse page, settings or the cards goes back to. */
  returnTo: View;
  /** The flow of the current (or most recent) session; only practice reads it. */
  flow: Flow | null;
  /** The My verses filter last used, so leaving and returning keeps it. */
  versesList: VersesFilter;
}

export type NavAction =
  | { type: 'goTab'; tab: Tab }
  | { type: 'goSettings' }
  | { type: 'goCard' }
  | { type: 'goVerses'; list?: VersesFilter; highlight?: number }
  | { type: 'goVerse'; passageId: number }
  /** The verse page's close: back to wherever the verse was opened from. */
  | { type: 'leaveVerse' }
  | { type: 'sessionStarted'; sessionId: string; passageId: number; rung: Rung; flow: Flow }
  | { type: 'sessionEnded' }
  /** A5 "Stop for today". */
  | { type: 'stopForToday' }
  | { type: 'reciteStarted'; reciteId: string; mode: 'tap' | 'handsfree' }
  | { type: 'reciteEnded' }
  /** The verse a view is about has gone away (removed here or in another window). */
  | { type: 'passageRemoved'; passageId: number };

export const INITIAL_NAV: NavState = {
  view: { name: 'today' },
  returnTo: { name: 'today' },
  flow: null,
  versesList: 'focus',
};

/**
 * Where a verse page opened from `state` returns to. Tabs and settings are
 * screens to come back to (My verses without its one-off highlight); a verse
 * opened from another verse page keeps the first one's origin; anything else
 * (practice, recite, the cards) is transient and falls back to My verses.
 */
function verseOrigin(state: NavState): View {
  const v = state.view;
  switch (v.name) {
    case 'today':
    case 'progress':
    case 'settings':
      return v;
    case 'verses':
      return { name: 'verses', list: v.list };
    case 'verse':
      return state.returnTo;
    default:
      return { name: 'verses', list: state.versesList };
  }
}

/** The returnTo a screen gets when it is arrived at by going back to it. */
function returnToFor(view: View): View {
  return view.name === 'settings' || view.name === 'card' ? { name: 'today' } : view;
}

function tabView(tab: Tab, versesList: VersesFilter): View {
  return tab === 'today'
    ? { name: 'today' }
    : tab === 'verses'
      ? { name: 'verses', list: versesList }
      : { name: 'progress' };
}

export function navReduce(state: NavState, action: NavAction): NavState {
  const keep = { flow: state.flow, versesList: state.versesList };
  switch (action.type) {
    case 'goTab': {
      const view = tabView(action.tab, state.versesList);
      return { ...keep, view, returnTo: view };
    }

    case 'goVerses': {
      const list = action.list ?? state.versesList;
      const view: View = { name: 'verses', list, highlight: action.highlight };
      return { ...keep, versesList: list, view, returnTo: { name: 'verses', list } };
    }

    case 'goSettings':
    case 'goCard': {
      const view: View = { name: action.type === 'goSettings' ? 'settings' : 'card' };
      return { ...keep, view, returnTo: { name: 'today' } };
    }

    case 'goVerse':
      return {
        ...keep,
        view: { name: 'verse', passageId: action.passageId },
        returnTo: verseOrigin(state),
      };

    case 'leaveVerse': {
      if (state.view.name !== 'verse') return state;
      // Back on a verse page after practice or recite started from it, returnTo
      // is that same page and its own origin is gone: fall back to My verses.
      const to: View = state.returnTo.name === 'verse' ? { name: 'verses', list: state.versesList } : state.returnTo;
      return { ...keep, view: to, returnTo: returnToFor(to) };
    }

    case 'sessionStarted': {
      const view: View = { name: 'practice', sessionId: action.sessionId };
      // Another session started without ending the first (Again, Continue):
      // returnTo already names where the chain began and is left alone.
      if (state.view.name === 'practice') return { ...keep, flow: action.flow, view, returnTo: state.returnTo };
      return { ...keep, flow: action.flow, view, returnTo: state.view };
    }

    case 'sessionEnded':
      if (state.view.name !== 'practice') return state;
      return { ...keep, view: state.returnTo, returnTo: state.returnTo };

    case 'stopForToday':
      if (state.view.name !== 'practice') return state;
      return { ...keep, view: { name: 'today' }, returnTo: { name: 'today' } };

    case 'reciteStarted': {
      const v = state.view.name;
      const returnTo: View =
        v === 'today' || v === 'verses' || v === 'verse'
          ? state.view
          : v === 'recite'
            ? state.returnTo
            : { name: 'today' };
      return { ...keep, view: { name: 'recite', reciteId: action.reciteId, mode: action.mode }, returnTo };
    }

    case 'reciteEnded':
      if (state.view.name !== 'recite') return state;
      return { ...keep, view: state.returnTo, returnTo: state.returnTo };

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
  if (a.name === 'verse' && b.name === 'verse') return a.passageId === b.passageId;
  if (a.name === 'practice' && b.name === 'practice') return a.sessionId === b.sessionId;
  if (a.name === 'recite' && b.name === 'recite') return a.reciteId === b.reciteId;
  return true;
}

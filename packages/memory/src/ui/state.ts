/**
 * Which of the five screens is showing, and how we got there.
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

/**
 * The five screens.
 *
 * Practice carries the session id rather than the session: the worker owns the
 * session, and a copy of it stored here would be a second source of truth that
 * goes stale the moment a step is submitted.
 *
 * The passage screen's `rung` is which activity tab is showing - `null` means
 * "suggested" (resolved by `suggestedRungFor` at render time, not here; see
 * `goPassage`/`sessionStarted` below), not "no tab".
 */
export type View =
  | { name: 'plan' }
  | { name: 'passage'; passageId: number; rung: Rung | null }
  | { name: 'analytics' }
  | { name: 'settings' }
  | { name: 'card' }
  | { name: 'managePassages' }
  | { name: 'practice'; sessionId: string }
  | { name: 'recite'; reciteId: string; mode: 'tap' | 'handsfree' };

/**
 * A panel-side flow: what the user pressed to get into practice.
 *
 * `variety` and `activity` name a *rule* for picking the next passage
 * (`suggest.ts#pickFlowTarget`), not one specific passage - they are what a
 * tile press starts. `passage` is the opposite: a session reached from
 * one specific passage's own screen or tab strip, or from a bare "Practice"/
 * "Resume"/"Restart" button, where there is no rule to fall back to, only the
 * one passage the user was already looking at.
 *
 * Carried on `NavState` (N6, Decision 4) so `practiceView.ts` can tell, while
 * a session is showing, whether pressing "Next" has anywhere to skip to:
 * `variety`/`activity` do (there is a rule to re-run, excluding the passage
 * just left); `passage` does not, and the button is omitted.
 */
export type Flow =
  | { kind: 'variety' }
  | { kind: 'activity'; rung: Rung }
  | { kind: 'passage'; passageId: number };

export interface NavState {
  view: View;
  /**
   * Where leaving an activity (Back, or finishing it) goes back to.
   *
   * A session started from the plan should return to the plan; one started
   * from a passage screen should return to that passage screen, because the
   * user was in the middle of working through one passage and dumping them
   * back at the top level loses their place. This is the entire reason the
   * reducer exists rather than a bare `view` variable.
   */
  returnTo: View;
  /**
   * The flow the *current* (or most recently ended) session belongs to -
   * `null` before any session has ever started this panel load.
   *
   * Only meaningful while `view.name === 'practice'`; `practiceView.ts` is
   * the only reader. Every action below carries it forward unchanged rather
   * than resetting it on `goPlan`/`goPassage`/etc., deliberately: nothing
   * outside practice ever reads a stale `flow`, so there is nothing for a
   * reset to protect against, and carrying it forward keeps every other case
   * of this reducer exactly as it was before N6 - one line added, not a new
   * rule to keep in sync with each of them.
   */
  flow: Flow | null;
}

export type NavAction =
  | { type: 'goPlan' }
  | { type: 'goAnalytics' }
  | { type: 'goSettings' }
  /** The push-card stack (task 0072). A leaf like Settings; leaving it returns to the plan. */
  | { type: 'goCard' }
  | { type: 'goManagePassages' }
  | { type: 'goPassage'; passageId: number; rung?: Rung | null }
  | { type: 'sessionStarted'; sessionId: string; passageId: number; rung: Rung; flow: Flow }
  | { type: 'sessionEnded' }
  /** A recite run (tap or hands-free) started, or was resumed on panel open. */
  | { type: 'reciteStarted'; reciteId: string; mode: 'tap' | 'handsfree' }
  | { type: 'reciteEnded' }
  /**
   * The passage the current view is about has gone away - removed here, or
   * removed in another panel and announced by a `planChanged` push. Any view
   * pinned to it has to be abandoned rather than left rendering a stale
   * reference that no longer resolves to anything.
   */
  | { type: 'passageRemoved'; passageId: number };

export const INITIAL_NAV: NavState = {
  view: { name: 'plan' },
  returnTo: { name: 'plan' },
  flow: null,
};

export function navReduce(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case 'goPlan':
      return { view: { name: 'plan' }, returnTo: { name: 'plan' }, flow: state.flow };

    case 'goAnalytics':
      // Analytics is a leaf: it starts no sessions, so it is never a return
      // target. Leaving `returnTo` alone would strand a later session there.
      return { view: { name: 'analytics' }, returnTo: { name: 'plan' }, flow: state.flow };

    case 'goSettings':
      return { view: { name: 'settings' }, returnTo: { name: 'plan' }, flow: state.flow };

    case 'goCard':
      return { view: { name: 'card' }, returnTo: { name: 'plan' }, flow: state.flow };

    case 'goManagePassages':
      // Manage is a leaf too: it starts no sessions, so it is never a return
      // target, exactly like Analytics and Settings above.
      return { view: { name: 'managePassages' }, returnTo: { name: 'plan' }, flow: state.flow };

    case 'goPassage': {
      // `rung` omitted means "suggested" - `null`, resolved by
      // `suggestedRungFor` at render time (N4), not here.
      const rung = action.rung ?? null;
      return {
        view: { name: 'passage', passageId: action.passageId, rung },
        returnTo: { name: 'passage', passageId: action.passageId, rung },
        flow: state.flow,
      };
    }

    case 'sessionStarted': {
      if (state.view.name === 'practice') {
        // Another session started without ending the first - "Practice
        // again" or "Next due" from the summary screen. `returnTo` already
        // points at wherever the *first* session in this chain was launched
        // from and is deliberately left alone: practice must not become its
        // own return target, or leaving it would land back in a
        // just-finished session.
        return {
          view: { name: 'practice', sessionId: action.sessionId },
          returnTo: state.returnTo,
          flow: action.flow,
        };
      }
      // Otherwise the view the user launched from becomes the return target,
      // as before - except a passage screen now remembers which rung/tab
      // this session actually practices, so `sessionEnded` reopens that tab
      // rather than re-deriving "Practice Passage" or the suggested activity.
      const returnTo: View =
        state.view.name === 'passage'
          ? { name: 'passage', passageId: action.passageId, rung: action.rung }
          : state.view;
      return { view: { name: 'practice', sessionId: action.sessionId }, returnTo, flow: action.flow };
    }

    case 'sessionEnded':
      if (state.view.name !== 'practice') return state;
      return { view: state.returnTo, returnTo: state.returnTo, flow: state.flow };

    case 'reciteStarted': {
      const returnTo: View =
        state.view.name === 'plan' || state.view.name === 'passage'
          ? state.view
          : state.view.name === 'recite'
            ? state.returnTo
            : { name: 'plan' };
      return { view: { name: 'recite', reciteId: action.reciteId, mode: action.mode }, returnTo, flow: state.flow };
    }

    case 'reciteEnded':
      if (state.view.name !== 'recite') return state;
      return { view: state.returnTo, returnTo: state.returnTo, flow: state.flow };

    case 'passageRemoved': {
      const stranded =
        (state.view.name === 'passage' && state.view.passageId === action.passageId) ||
        (state.returnTo.name === 'passage' && state.returnTo.passageId === action.passageId);
      if (!stranded) return state;
      // A practice session on a removed passage is left alone deliberately:
      // the worker still owns it and will end it, and yanking the screen out
      // from under someone mid-answer is worse than one stale header. Only the
      // destination is repaired.
      if (state.view.name === 'practice') {
        return { view: state.view, returnTo: { name: 'plan' }, flow: state.flow };
      }
      return { view: { name: 'plan' }, returnTo: { name: 'plan' }, flow: state.flow };
    }

    default:
      return state;
  }
}

/** True when the two views would render the same screen. */
export function sameView(a: View, b: View): boolean {
  if (a.name !== b.name) return false;
  // `rung` is compared too: it picks which tab the passage screen shows, so
  // two passage views that differ only in `rung` are not the same screen.
  if (a.name === 'passage' && b.name === 'passage') {
    return a.passageId === b.passageId && a.rung === b.rung;
  }
  if (a.name === 'practice' && b.name === 'practice') return a.sessionId === b.sessionId;
  if (a.name === 'recite' && b.name === 'recite') return a.reciteId === b.reciteId;
  return true;
}

/**
 * What a view is allowed to ask of the panel.
 *
 * The four screens do not talk to the SDK, the clock or each other. They are
 * handed this, and it is the entire surface they get. That is worth the extra
 * indirection for two reasons: the views stay renderable in a test harness
 * with a stub host, and - more practically - it keeps the number of places
 * that can start a session, mutate navigation or read `Date.now()` down to one
 * file, `panel.ts`, instead of four.
 *
 * `now()` is on the interface rather than being called directly for the same
 * reason `format.ts` takes a `now` argument: a screen that reads the clock
 * itself cannot be shown a fixed moment.
 */

import type { PanelReply, PanelRequest, RequestMap, Rung } from '../core/types';
import type { Flow, NavAction } from './state';
import type { WordMeasurer } from './measure';

export interface PanelHost {
  /** Current wall-clock time in epoch ms. */
  now(): number;

  /** Typed request/reply to the worker. Never rejects; see `rpc.ts`. */
  request<R extends PanelRequest>(request: R): Promise<PanelReply<RequestMap[R['type']]>>;

  /** Change screens. */
  go(action: NavAction): void;

  /** Re-fetch the current screen's data and redraw it. */
  reload(): void;

  /** Shared off-screen text measurer for the blanks exercise. */
  readonly measurer: WordMeasurer;

  /**
   * The host app's current verse, as last pushed by the worker.
   *
   * Used to prefill the add-passage field: someone who has just read a verse
   * in the main window and reached for this panel almost certainly wants that
   * verse, and typing the reference again is work the app can do for them.
   * `null` until the first push arrives - a panel opened before the user has
   * navigated anywhere has nothing to offer.
   */
  readonly activeReference: string | null;

  /**
   * Starts a session and switches to the practice screen.
   *
   * Lives on the host rather than in each view because more than one screen
   * can start one, and because a failure to start has to be reported
   * somewhere that survives the view being replaced. `restart` clears any
   * paused position on that activity first - the passage screen's "Restart"
   * button, as opposed to "Resume" or an ordinary "Practice". `tier` picks a
   * specific difficulty tier of `rung`; omitted, the worker auto-selects one
   * (see `PanelRequest`'s `startSession` variant in `types.ts`).
   *
   * `flow` is the panel-side flow (`state.ts#Flow`) this session belongs to.
   * Omitted, the panel defaults it to `{ kind: 'passage', passageId }` (no
   * Next button). Only `startFlow`, and the practice screen's Next button
   * via it, pass one. The panel records it, with the session's real
   * passage and rung, on `NavState.flow` through `sessionStarted`.
   */
  startSession(
    passageId: number,
    rung?: Rung,
    restart?: boolean,
    tier?: number,
    flow?: Flow,
  ): Promise<void>;

  /**
   * Starts whichever passage `flow`'s rule currently names (an activity tile
   * press, or the practice screen's Next/skip) and switches to practice.
   *
   * Fetches `getPlan`, runs `suggest.ts#pickFlowTarget` with `Math.random`,
   * then `startSession(target.passageId, target.rung, undefined, undefined,
   * flow)`. `exclude` holds passage ids that must not be picked (Next passes
   * the passage it just left). When nothing qualifies it announces
   * "Nothing else to practice right now." and starts nothing.
   */
  startFlow(flow: Flow, exclude?: ReadonlySet<number>): Promise<void>;

  /** Asks the main app to move its Bible pane to a verse. */
  openInBible(verseId: number): void;

  /**
   * Where modal overlays are attached. Inside the mounted `.sm-app` root, so the
   * scoped stylesheet applies to them; stubs may omit it (falls back to `document.body`).
   */
  readonly overlayRoot?: HTMLElement;

  /** Shows a transient message in the panel's status line. */
  announce(message: string): void;
}

/**
 * The presenter wire protocol: everything both ends of a presentation session
 * agree on.
 *
 * A session has one writer (the controller) and many readers (the projection
 * viewer on the TV, plus any follow-along devices). Readers hold an SSE stream
 * and receive the whole `PresentState` on every change; the writer POSTs
 * `PresentIntent`s. Nothing else crosses the wire.
 *
 * Two rules shape everything here:
 *
 *  1. **Intents, never positions.** No scroll offset, pixel size or DOM
 *     coordinate appears in any type below. The controller says "next verse" or
 *     "font bigger"; each viewer decides what that means for the screen it is
 *     actually attached to. A phone following along and a 55" TV are running
 *     the same state and must not be forced to the same layout.
 *  2. **Whole state, never deltas.** `PresentState` is a few hundred bytes.
 *     Broadcasting all of it makes reconnection trivial (there is no history to
 *     replay) and makes a dropped frame unable to desynchronise anyone.
 *
 * This file is imported by the server with a `.js` suffix and by client code as
 * a type-only, extensionless import. Keep it free of any runtime dependency so
 * that either side can pull it in without dragging Node or Express along.
 */

// ---------------------------------------------------------------------------
// Items: what can be put on the wall
// ---------------------------------------------------------------------------

/**
 * A passage of Scripture. `verseStart`/`verseEnd` narrow the chapter to a
 * selection; omitting both means the whole chapter.
 */
export interface PresentPassageItem {
  kind: 'passage';
  module: string;
  book: number;
  chapter: number;
  verseStart?: number;
  verseEnd?: number;
}

/**
 * A hymn from the public-domain library, by id.
 *
 * Declared now, rejected by `validateItem` until the library exists. The shape
 * is the part that matters: retrofitting a second item kind later is exactly
 * what forces a protocol version bump, and this costs nothing to reserve.
 */
export interface PresentHymnItem {
  kind: 'hymn';
  hymnId: string;
  /** Verse/refrain order, e.g. ['1', 'R', '2', 'R']. Defaults to the hymn's own. */
  verseOrder?: string[];
}

/**
 * A free-text slide: a creed, a catechism answer, an announcement, or lyrics
 * the presenter supplies under their own licence.
 *
 * This is what keeps the copyright story clean. Anything we cannot ship, the
 * presenter can still put on the wall themselves.
 */
export interface PresentTextItem {
  kind: 'text';
  title?: string;
  body: string;
  attribution?: string;
}

export type PresentItem = PresentPassageItem | PresentHymnItem | PresentTextItem;

export type PresentItemKind = PresentItem['kind'];

// ---------------------------------------------------------------------------
// Highlighting
// ---------------------------------------------------------------------------

/**
 * A word-range highlight, in the project-wide convention: 0-based inclusive
 * word indices within a verse (see `UserTextMarkup` in core).
 *
 * Only indices travel. The controller and the viewer each tokenize the same
 * verse text from the same API and therefore agree on what word 7 is; sending
 * the phrase itself would make every viewer re-solve a matching problem that
 * has already been solved once.
 */
export interface HighlightRange {
  verseIdStart: number;
  textStart: number;
  /** Omitted for a single-verse highlight. */
  verseIdEnd?: number;
  textEnd?: number;
  style?: 'highlight' | 'underline';
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type PresentTheme = 'light' | 'dark';

export const MIN_FONT_STEP = 1;
export const MAX_FONT_STEP = 10;
export const DEFAULT_FONT_STEP = 5;

export interface PresentPosition {
  /**
   * Anchor within `live`: the verse number for a passage, the slide index for a
   * hymn or text item. Meaningless when `live` is null.
   */
  index: number;
  highlight: HighlightRange | null;
}

export interface PresentDisplay {
  /**
   * 1-10. A *step*, not a size: the viewer derives pixels from its own
   * viewport, so one setting reads correctly on a TV across a hall and on a
   * phone in a pew.
   */
  fontStep: number;
  /** Fade the wall to black without losing what is on it. */
  blanked: boolean;
  theme: PresentTheme;
}

export interface PresentSessionInfo {
  id: string;
  joinCode: string;
  joinsLocked: boolean;
  /**
   * Live SSE subscribers. Derived at broadcast time from the connection
   * registry, never persisted -- a server restart must not resurrect a count
   * of viewers who are no longer there.
   */
  viewerCount: number;
}

/** The complete object every viewer receives on every change. */
export interface PresentState {
  /**
   * Increments on every accepted intent. Viewers ignore anything not greater
   * than what they already hold, which makes out-of-order or duplicated
   * delivery harmless.
   */
  version: number;
  live: PresentItem | null;
  position: PresentPosition;
  display: PresentDisplay;
  session: PresentSessionInfo;
}

/**
 * What is persisted: everything except the parts derived from live connections.
 *
 * Splitting this out is what stops `viewerCount` from being written to disk and
 * read back as truth after a restart.
 */
export type StoredPresentState = Omit<PresentState, 'session'> & {
  session: Omit<PresentSessionInfo, 'viewerCount'>;
};

// ---------------------------------------------------------------------------
// The plan (saved verse list)
// ---------------------------------------------------------------------------

/**
 * One entry in the presenter's running order.
 *
 * The plan is stored as a single JSON array on the session row and replaced
 * wholesale by `PUT /plan`. That is deliberate: with a cap of a couple of
 * hundred entries the whole thing is smaller than one chapter of text, and
 * replacing the array makes reordering free instead of a position-renumbering
 * problem with its own bug family.
 */
export interface PresentPlanEntry {
  id: string;
  item: PresentItem;
  /** The presenter's own note. Shown on the controller only, never on the wall. */
  note?: string;
}

// ---------------------------------------------------------------------------
// Intents: the only things a controller may send
// ---------------------------------------------------------------------------

export type PresentIntent =
  | { type: 'show'; item: PresentItem; index?: number }
  | { type: 'goTo'; index: number }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'setHighlight'; highlight: HighlightRange }
  | { type: 'clearHighlight' }
  | { type: 'setFontStep'; fontStep: number }
  | { type: 'setTheme'; theme: PresentTheme }
  | { type: 'blank' }
  | { type: 'unblank' }
  | { type: 'lockJoins'; locked: boolean }
  | { type: 'end' };

export type PresentIntentType = PresentIntent['type'];

// ---------------------------------------------------------------------------
// HTTP payloads
// ---------------------------------------------------------------------------

/**
 * The one and only time the control token is ever returned. It is not stored in
 * recoverable form, so a caller that loses this response has lost control of
 * the session and must create a new one.
 */
export interface CreateSessionResponse {
  sessionId: string;
  joinCode: string;
  controlToken: string;
  expiresAt: string;
}

export interface PresentStateResponse {
  state: PresentState;
}

export interface PresentPlanResponse {
  plan: PresentPlanEntry[];
}

// ---------------------------------------------------------------------------
// SSE framing
// ---------------------------------------------------------------------------

/**
 * `state` carries a `PresentState`. `closed` carries `{ reason }` and is the
 * only thing that may change what a viewer displays other than new state --
 * a dropped connection must leave the wall exactly as it was.
 */
export type PresentServerEvent = 'state' | 'closed';

export interface PresentClosedPayload {
  /**
   * `locked` and `full` are refusals, not endings: the session is fine, this
   * device just cannot watch it. They are distinct so the viewer can say which,
   * rather than showing "session ended" to someone who arrived one seat late.
   */
  reason: 'ended' | 'expired' | 'locked' | 'full';
}

/** Comment heartbeat interval. Long enough to be free, short enough to beat idle proxies. */
export const SSE_HEARTBEAT_MS = 20_000;

/** Reconnection delay advertised to `EventSource` via the `retry:` field. */
export const SSE_RETRY_MS = 3_000;

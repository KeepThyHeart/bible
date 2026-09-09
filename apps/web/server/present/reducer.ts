/**
 * Validation and state transitions for presentation sessions.
 *
 * Deliberately pure: no database, no Express, no clock. Everything the reducer
 * needs from the outside arrives through `IntentContext`, which is what lets the
 * whole state machine be tested without a module database or a running server.
 *
 * The server owns what "next" means, rather than accepting a computed index
 * from the controller. Two reasons: the meaning differs per item kind (a verse
 * for a passage, a slide for a hymn), and a controller working from a stale
 * index cannot walk the wall somewhere nobody asked for.
 */

import {
  DEFAULT_FONT_STEP,
  MAX_FONT_STEP,
  MIN_FONT_STEP,
  type HighlightRange,
  type PresentIntent,
  type PresentItem,
  type PresentPlanEntry,
  type StoredPresentState,
} from '../../src/present/protocol.js';

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

/**
 * These bound what a presenter can put in a shared database, and they give a
 * specific 400 rather than the generic parser error that `express.json`'s
 * 100 KB transport limit would produce.
 */
export const LIMITS = {
  /** Enough for the Apostles' Creed with room to spare; not enough to be storage. */
  textBody: 8_192,
  textTitle: 200,
  textAttribution: 300,
  /** A running order, not a database. */
  planEntries: 200,
  planNote: 500,
  /** Longest verse in the KJV is 90 words; this leaves generous headroom. */
  verseWords: 500,
  moduleName: 100,
  hymnId: 100,
  hymnVerseOrder: 60,
} as const;

/**
 * Upper bound on a verse number when the real chapter length is unavailable.
 *
 * Matches `validateVerse` in `utils/validation.ts`. Psalm 119 has 176 verses,
 * so this has to sit above that.
 */
const MAX_VERSE_FALLBACK = 200;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedInt(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

/**
 * Module names reach the filesystem elsewhere in this server, so the same
 * restriction applies here even though nothing in the presenter resolves a path
 * from one. A value that cannot be a module name should be rejected at the
 * point it enters the system, not at the point it becomes dangerous.
 */
function isModuleName(value: unknown): value is string {
  return isBoundedString(value, LIMITS.moduleName)
    && !/[^a-zA-Z0-9_-]/.test(value)
    && !value.includes('..');
}

/**
 * Validate a highlight range.
 *
 * Word indices are 0-based and inclusive, matching `UserTextMarkup` in core and
 * the desktop selection code. A range that ends before it starts within a
 * single verse is rejected outright rather than silently normalised: it means
 * the caller computed something wrong, and quietly swapping the ends would hide
 * that.
 */
export function validateHighlight(value: unknown): HighlightRange | null {
  if (!isPlainObject(value)) return null;

  const { verseIdStart, textStart, verseIdEnd, textEnd, style } = value;
  if (!isBoundedInt(verseIdStart, 1_001_001, 66_999_999)) return null;
  if (!isBoundedInt(textStart, 0, LIMITS.verseWords)) return null;

  const out: HighlightRange = { verseIdStart, textStart };

  if (verseIdEnd !== undefined) {
    if (!isBoundedInt(verseIdEnd, 1_001_001, 66_999_999)) return null;
    if (verseIdEnd < verseIdStart) return null;
    out.verseIdEnd = verseIdEnd;
  }

  if (textEnd !== undefined) {
    if (!isBoundedInt(textEnd, 0, LIMITS.verseWords)) return null;
    // Only meaningful to compare within one verse; across verses the end index
    // belongs to a different token run entirely.
    const sameVerse = (out.verseIdEnd ?? verseIdStart) === verseIdStart;
    if (sameVerse && textEnd < textStart) return null;
    out.textEnd = textEnd;
  }

  if (style !== undefined) {
    if (style !== 'highlight' && style !== 'underline') return null;
    out.style = style;
  }

  return out;
}

/**
 * Validate an item.
 *
 * Unknown keys are dropped rather than preserved: the item is echoed back to
 * every viewer on every state broadcast, so anything not in the contract is
 * either a client bug or an attempt to use the session as a message bus.
 */
export function validateItem(value: unknown): PresentItem | null {
  if (!isPlainObject(value)) return null;

  switch (value.kind) {
    case 'passage': {
      const { module, book, chapter, verseStart, verseEnd } = value;
      if (!isModuleName(module)) return null;
      if (!isBoundedInt(book, 1, 66)) return null;
      if (!isBoundedInt(chapter, 1, 999)) return null;

      const item: PresentItem = { kind: 'passage', module, book, chapter };
      if (verseStart !== undefined) {
        if (!isBoundedInt(verseStart, 1, MAX_VERSE_FALLBACK)) return null;
        item.verseStart = verseStart;
      }
      if (verseEnd !== undefined) {
        if (!isBoundedInt(verseEnd, 1, MAX_VERSE_FALLBACK)) return null;
        if (item.verseStart !== undefined && verseEnd < item.verseStart) return null;
        item.verseEnd = verseEnd;
      }
      return item;
    }

    case 'text': {
      const { title, body, attribution } = value;
      if (typeof body !== 'string') return null;
      const trimmed = body.trim();
      if (trimmed.length === 0 || trimmed.length > LIMITS.textBody) return null;

      const item: PresentItem = { kind: 'text', body: trimmed };
      if (title !== undefined) {
        if (!isBoundedString(title, LIMITS.textTitle)) return null;
        item.title = title;
      }
      if (attribution !== undefined) {
        if (!isBoundedString(attribution, LIMITS.textAttribution)) return null;
        item.attribution = attribution;
      }
      return item;
    }

    case 'hymn': {
      const { hymnId, verseOrder } = value;
      if (!isBoundedString(hymnId, LIMITS.hymnId)) return null;
      // Ids are slugs and are what saved service plans reference; anything else
      // did not come from the library.
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(hymnId)) return null;

      const item: PresentItem = { kind: 'hymn', hymnId };
      if (verseOrder !== undefined) {
        if (!Array.isArray(verseOrder)) return null;
        if (verseOrder.length === 0 || verseOrder.length > LIMITS.hymnVerseOrder) return null;
        // Section tokens: a stanza number, or R / B / C / I. Validating the
        // shape here means the library only ever has to answer whether such a
        // section exists, not whether the string is safe to look up.
        if (!verseOrder.every(token => typeof token === 'string' && /^(\d{1,3}|[RBCI])$/.test(token))) {
          return null;
        }
        item.verseOrder = verseOrder;
      }
      return item;
    }

    default:
      return null;
  }
}

/** Validate one plan entry. `id` is assigned by the server, so it is not read here. */
function validatePlanEntry(value: unknown, id: string): PresentPlanEntry | null {
  if (!isPlainObject(value)) return null;
  const item = validateItem(value.item);
  if (!item) return null;

  const entry: PresentPlanEntry = { id, item };
  if (value.note !== undefined) {
    if (!isBoundedString(value.note, LIMITS.planNote)) return null;
    entry.note = value.note;
  }
  return entry;
}

/** What a client-supplied entry id may look like: a UUID, and nothing else. */
const ENTRY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Validate a whole plan, keeping ids the client already knows and minting the
 * rest.
 *
 * The plan is replaced wholesale on every edit, so the naive rule -- mint every
 * id, every time -- is tempting and wrong: reordering a list would rename every
 * entry in it, which throws away the identity the controller's list is keyed on
 * and makes a drag re-key mid-gesture.
 *
 * So an id is kept when it is a well-formed UUID that has not already been used
 * in this same plan, and replaced otherwise. That preserves the property worth
 * having -- the server guarantees the ids are unique, rather than trusting a
 * client not to collide them -- while letting an entry keep its name for as
 * long as it exists. A new entry simply arrives without one.
 */
export function validatePlan(value: unknown, makeId: () => string): PresentPlanEntry[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > LIMITS.planEntries) return null;

  const seen = new Set<string>();
  const out: PresentPlanEntry[] = [];
  for (const raw of value) {
    const supplied = isPlainObject(raw) && typeof raw.id === 'string' ? raw.id : '';
    const id = ENTRY_ID.test(supplied) && !seen.has(supplied) ? supplied : makeId();
    seen.add(id);

    const entry = validatePlanEntry(raw, id);
    if (!entry) return null;
    out.push(entry);
  }
  return out;
}

/** Validate an intent posted by a controller. */
export function validateIntent(value: unknown): PresentIntent | null {
  if (!isPlainObject(value)) return null;

  switch (value.type) {
    case 'show': {
      const item = validateItem(value.item);
      if (!item) return null;
      if (value.index === undefined) return { type: 'show', item };
      if (!isBoundedInt(value.index, 0, MAX_VERSE_FALLBACK)) return null;
      return { type: 'show', item, index: value.index };
    }
    case 'goTo':
      if (!isBoundedInt(value.index, 0, MAX_VERSE_FALLBACK)) return null;
      return { type: 'goTo', index: value.index };
    case 'next':
      return { type: 'next' };
    case 'previous':
      return { type: 'previous' };
    case 'setHighlight': {
      const highlight = validateHighlight(value.highlight);
      if (!highlight) return null;
      return { type: 'setHighlight', highlight };
    }
    case 'clearHighlight':
      return { type: 'clearHighlight' };
    case 'setFontStep':
      if (!isBoundedInt(value.fontStep, MIN_FONT_STEP, MAX_FONT_STEP)) return null;
      return { type: 'setFontStep', fontStep: value.fontStep };
    case 'setTheme':
      if (value.theme !== 'light' && value.theme !== 'dark') return null;
      return { type: 'setTheme', theme: value.theme };
    case 'blank':
      return { type: 'blank' };
    case 'unblank':
      return { type: 'unblank' };
    case 'lockJoins':
      if (typeof value.locked !== 'boolean') return null;
      return { type: 'lockJoins', locked: value.locked };
    case 'end':
      return { type: 'end' };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export interface IntentContext {
  /**
   * How many verses the given chapter has, or null when that cannot be
   * determined (a module that is not installed, say).
   *
   * Injected rather than looked up so the reducer stays testable without module
   * databases. When it returns null, `next` still advances but is capped at
   * `MAX_VERSE_FALLBACK`; refusing to move would be a worse failure on a wall
   * than overshooting the end of a chapter.
   */
  chapterLength(module: string, book: number, chapter: number): number | null;

  /**
   * How many slides a hymn makes in the given order, or null when the hymn is
   * not in the library.
   *
   * Slides are packed by the server, not the viewer, for exactly this reason:
   * `next` has to know where the end is. A viewer that packed its own slides
   * would disagree with the server about how many there are the moment two
   * viewers were configured differently.
   */
  slideCount(hymnId: string, verseOrder?: string[]): number | null;
}

/** The state a brand-new session starts in: nothing on the wall, sensible defaults. */
export function initialState(sessionId: string, joinCode: string): StoredPresentState {
  return {
    version: 0,
    live: null,
    position: { index: 0, highlight: null },
    display: { fontStep: DEFAULT_FONT_STEP, blanked: false, theme: 'dark' },
    session: { id: sessionId, joinCode, joinsLocked: false },
  };
}

/** The verse range a passage item can be positioned within. */
function passageBounds(
  item: PresentItem,
  ctx: IntentContext,
): { first: number; last: number } {
  if (item.kind !== 'passage') return { first: 0, last: 0 };
  const first = item.verseStart ?? 1;
  const last = item.verseEnd
    ?? ctx.chapterLength(item.module, item.book, item.chapter)
    ?? MAX_VERSE_FALLBACK;
  return { first, last: Math.max(first, last) };
}

function clampIndex(item: PresentItem | null, index: number, ctx: IntentContext): number {
  if (!item) return 0;
  if (item.kind === 'passage') {
    const { first, last } = passageBounds(item, ctx);
    return Math.min(Math.max(index, first), last);
  }
  if (item.kind === 'hymn') {
    // Slides are 0-based, unlike verse numbers. An unknown hymn is bounded at
    // its first slide rather than left to wander: the viewer will show nothing
    // for it either way, and a runaway index would survive into a saved plan.
    const count = ctx.slideCount(item.hymnId, item.verseOrder);
    return Math.min(Math.max(index, 0), count === null ? 0 : Math.max(count - 1, 0));
  }
  return 0;
}

/**
 * Apply an intent, returning the next state or null when nothing changed.
 *
 * Returning null rather than an equal-but-new object is what stops a held-down
 * arrow key at the end of a chapter from bumping the version and broadcasting
 * to every viewer several times a second.
 *
 * `end` is absent here on purpose: ending a session is a lifecycle change, not
 * a state change, and belongs to the caller that owns the session row.
 */
export function applyIntent(
  state: StoredPresentState,
  intent: PresentIntent,
  ctx: IntentContext,
): StoredPresentState | null {
  switch (intent.type) {
    case 'show': {
      // A new item always clears the highlight: word indices are meaningless
      // against a passage they were not computed for, and leaving one in place
      // would paint an arbitrary run of words on the next thing shown.
      // Where an item starts when the controller does not say: verse 1 for a
      // passage, but slide 0 for anything paged, because slides are 0-based and
      // verse numbers are not. Defaulting to 1 for a hymn would open it on its
      // second slide.
      const start = intent.item.kind === 'passage' ? 1 : 0;
      const index = clampIndex(intent.item, intent.index ?? start, ctx);
      return {
        ...state,
        live: intent.item,
        position: { index, highlight: null },
      };
    }

    case 'goTo': {
      const index = clampIndex(state.live, intent.index, ctx);
      if (index === state.position.index) return null;
      return { ...state, position: { ...state.position, index } };
    }

    case 'next':
    case 'previous': {
      if (!state.live) return null;
      const delta = intent.type === 'next' ? 1 : -1;
      const index = clampIndex(state.live, state.position.index + delta, ctx);
      if (index === state.position.index) return null;
      return { ...state, position: { ...state.position, index } };
    }

    case 'setHighlight':
      return { ...state, position: { ...state.position, highlight: intent.highlight } };

    case 'clearHighlight':
      if (state.position.highlight === null) return null;
      return { ...state, position: { ...state.position, highlight: null } };

    case 'setFontStep':
      if (state.display.fontStep === intent.fontStep) return null;
      return { ...state, display: { ...state.display, fontStep: intent.fontStep } };

    case 'setTheme':
      if (state.display.theme === intent.theme) return null;
      return { ...state, display: { ...state.display, theme: intent.theme } };

    case 'blank':
    case 'unblank': {
      const blanked = intent.type === 'blank';
      if (state.display.blanked === blanked) return null;
      return { ...state, display: { ...state.display, blanked } };
    }

    case 'lockJoins':
      if (state.session.joinsLocked === intent.locked) return null;
      return { ...state, session: { ...state.session, joinsLocked: intent.locked } };

    case 'end':
      return null;
  }
}

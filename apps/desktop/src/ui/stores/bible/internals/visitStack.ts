/**
 * The Back button's stack of chapters actually visited.
 *
 * This is a *separate* feature from the navigation history in
 * `navigationHistory.ts`, and deliberately so. The history is a curated jump
 * list: it dedupes by (book, chapter), sequential chapter paging replaces the
 * current entry instead of appending, and it is capped at 10 so the dropdown
 * stays readable. Those three rules are exactly right for a "recent passages"
 * menu and exactly wrong for a Back button:
 *
 *  - deduping destroys temporal order, so Back could not tell you where you
 *    were, only which chapters you had ever seen;
 *  - `replace: true` on paging meant Back skipped over every chapter the
 *    reader had paged through;
 *  - appending truncates forward history, so after jumping backwards from the
 *    history menu there was no way back to where you had been.
 *
 * Back should mean "undo my last view change". So this module records a plain
 * temporal stack: every chapter change pushes, whatever caused it - a typed
 * reference, next/previous chapter, a search result, a cross-reference, a
 * topic, **and a pick from the history dropdown** (jumping back via the menu
 * is itself a visit, so Back afterwards returns you to where you were even
 * though that is "forward" in the menu's list).
 *
 * The two features only interact at one point: after Back navigates, the
 * caller re-points the history cursor at the chapter now on screen so the
 * dropdown's "you are here" marker stays truthful. See `navigationSlice`.
 *
 * Everything here is pure - it takes a stack and returns a new one.
 */

/**
 * One chapter view. Distinct visits to the same chapter are distinct entries:
 * repeated visits are separate events, which is the whole point of the stack.
 */
export interface ChapterVisit {
  bookNumber: number;
  chapter: number;
  bookName: string;
  /** Verse to land on when this visit is returned to. */
  verseId: number;
  /**
   * Translation the visit was made in. Recorded for provenance (and so a
   * persisted stack is self-describing); Back does not switch translations,
   * because changing version is not a chapter navigation.
   */
  abbreviation?: string;
  /** Scroll offset within the chapter, captured when the reader navigates away. */
  scrollTop?: number;
}

/**
 * Much deeper than the history dropdown's 10, because every chapter paged
 * through now counts as its own entry - reading a book straight through would
 * exhaust a 10-deep stack in a single sitting. Oldest entries drop first.
 */
export const DEFAULT_MAX_VISIT_STACK_SIZE = 50;

function isSameChapter(a: ChapterVisit, b: ChapterVisit): boolean {
  return a.bookNumber === b.bookNumber && a.chapter === b.chapter;
}

/** The chapter currently on screen, i.e. the top of the stack. */
export function currentVisit(stack: readonly ChapterVisit[]): ChapterVisit | null {
  return stack.length > 0 ? stack[stack.length - 1] ?? null : null;
}

/** True when there is somewhere to go back *to* - the top itself is where we are. */
export function canGoBackVisit(stack: readonly ChapterVisit[]): boolean {
  return stack.length > 1;
}

/**
 * Record a chapter view.
 *
 * Consecutive duplicates are not stacked: navigating within the chapter that
 * is already on top is not a view change, so the top is *refreshed* rather
 * than duplicated. Refreshing (rather than ignoring) means a later Back
 * returns the reader to the verse they were actually on, not the verse they
 * happened to arrive at. Non-adjacent repeats are kept - leaving a chapter and
 * coming back to it later really is two visits.
 */
export function pushVisit(
  stack: readonly ChapterVisit[],
  visit: ChapterVisit,
  maxSize: number = DEFAULT_MAX_VISIT_STACK_SIZE,
): ChapterVisit[] {
  const top = currentVisit(stack);
  if (top && isSameChapter(top, visit)) {
    const refreshed = stack.slice();
    refreshed[refreshed.length - 1] = { ...top, ...visit };
    return refreshed;
  }

  const next = [...stack, visit];
  // Drop from the oldest end so the most recent `maxSize` visits survive.
  return next.length > maxSize ? next.slice(next.length - maxSize) : next;
}

/**
 * Pop the current view off and report where Back should land: the entry
 * underneath it. Returns null when there is nothing behind the current view.
 */
export function popVisit(
  stack: readonly ChapterVisit[],
): { stack: ChapterVisit[]; target: ChapterVisit } | null {
  if (!canGoBackVisit(stack)) return null;
  const next = stack.slice(0, -1);
  const target = next[next.length - 1];
  if (!target) return null;
  return { stack: next, target };
}

/**
 * Remember where the reader had scrolled to in the chapter they are leaving,
 * so returning to it lands at the same offset rather than at the top.
 */
export function saveVisitScrollTop(
  stack: readonly ChapterVisit[],
  scrollTop: number,
): ChapterVisit[] {
  const top = currentVisit(stack);
  if (!top) return stack.slice();
  const next = stack.slice();
  next[next.length - 1] = { ...top, scrollTop };
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Sanitize a persisted stack. A session written by another build (or a
 * corrupted one) must degrade to "no visits" rather than crashing the restore,
 * so anything that is not a well-formed visit is dropped entry by entry.
 */
export function normalizeVisitStack(
  raw: unknown,
  maxSize: number = DEFAULT_MAX_VISIT_STACK_SIZE,
): ChapterVisit[] {
  if (!Array.isArray(raw)) return [];
  const visits: ChapterVisit[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    if (typeof entry.bookNumber !== 'number' || typeof entry.chapter !== 'number') continue;
    if (typeof entry.verseId !== 'number') continue;
    visits.push({
      bookNumber: entry.bookNumber,
      chapter: entry.chapter,
      bookName: typeof entry.bookName === 'string' ? entry.bookName : '',
      verseId: entry.verseId,
      ...(typeof entry.abbreviation === 'string' ? { abbreviation: entry.abbreviation } : {}),
      ...(typeof entry.scrollTop === 'number' ? { scrollTop: entry.scrollTop } : {}),
    });
  }
  return visits.length > maxSize ? visits.slice(visits.length - maxSize) : visits;
}

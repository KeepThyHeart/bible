/**
 * Bookmarks — the `b` screen.
 *
 * A flat, named, user-ordered list, persisted in the CLI's own `~/.bible/state.db`.
 * Unlike the desktop and web apps, which keep bookmarks in the shared user
 * database, the CLI cannot assume the desktop app exists on the machine, so it
 * keeps its own copy.
 *
 * Pure and untyped-key, on the same split as {@link "./history"}: no rendering,
 * no keys, so every rule here — adding, renaming, re-pointing, reordering,
 * deleting — is testable without a screen or a terminal. `screens/Main.ts` turns
 * the list into rows and owns every key.
 *
 * ## Identity, not position
 *
 * Every operation but {@link addBookmark} takes an `id` rather than a row
 * number, because a row number is what is *typed*, and typed numbers refer to
 * whatever is on screen *this frame* — reordering the list changes every row
 * number below the move without changing which bookmark anything refers to. The
 * screen resolves a typed number to an id via {@link bookmarkAt} once, at the
 * moment the key is pressed, and passes the id to the mutation.
 *
 * `id` is assigned here, once, by {@link addBookmark} — never by the caller and
 * never re-used after a delete, so a stale reference to a removed bookmark
 * reliably finds nothing rather than accidentally finding whatever moved into
 * its old spot.
 */

export interface Bookmark {
  readonly id: number;
  readonly name: string;
  /** The verse it points at — a full verse id, so it means the same thing in
   * every translation: a bookmark is a place, not a passage in one particular
   * translation. */
  readonly verseId: number;
}

/**
 * A process-lifetime high-water mark, so a removed id is never handed out
 * again even after the bookmark that held it is gone.
 *
 * One more than the highest id *in the list* would look right and is not:
 * delete the newest bookmark and add another, and "one more than the
 * highest remaining id" hands the new one the id the deleted one just gave
 * up, which is exactly the collision {@link Bookmark}'s docs warn a stale
 * reference against. Widening the comparison to include this module's own
 * running total closes that gap without asking every caller to carry a
 * counter alongside the list.
 */
let idWatermark = 0;

function nextId(list: readonly Bookmark[]): number {
  const highest = list.reduce((max, b) => Math.max(max, b.id), 0);
  idWatermark = Math.max(idWatermark, highest) + 1;
  return idWatermark;
}

/** Appends a new bookmark, last in the user's order — where `a` puts it. */
export function addBookmark(
  list: readonly Bookmark[],
  name: string,
  verseId: number,
): readonly Bookmark[] {
  return [...list, { id: nextId(list), name, verseId }];
}

/** Gives a bookmark a new name. A missing id leaves the list unchanged. */
export function renameBookmark(
  list: readonly Bookmark[],
  id: number,
  name: string,
): readonly Bookmark[] {
  return list.map((b) => (b.id === id ? { ...b, name } : b));
}

/** Moves a bookmark to point at a different verse, keeping its name and place. */
export function rePointBookmark(
  list: readonly Bookmark[],
  id: number,
  verseId: number,
): readonly Bookmark[] {
  return list.map((b) => (b.id === id ? { ...b, verseId } : b));
}

export function removeBookmark(list: readonly Bookmark[], id: number): readonly Bookmark[] {
  return list.filter((b) => b.id !== id);
}

/**
 * Swaps a bookmark with its neighbour in the given direction. Moving past
 * either end of the list, or an id that is not there, leaves the list
 * unchanged rather than wrapping — reordering has a top and a bottom.
 */
export function moveBookmark(
  list: readonly Bookmark[],
  id: number,
  direction: 'up' | 'down',
): readonly Bookmark[] {
  const index = list.findIndex((b) => b.id === id);
  if (index === -1) return list;
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= list.length) return list;

  const copy = [...list];
  const moved = copy[index]!;
  copy[index] = copy[target]!;
  copy[target] = moved;
  return copy;
}

/** The bookmark a typed row number names — 1-based, top to bottom, as shown. */
export function bookmarkAt(list: readonly Bookmark[], number: number): Bookmark | undefined {
  return list[number - 1];
}

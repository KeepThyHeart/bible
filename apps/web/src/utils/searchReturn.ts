/**
 * Phone Back after tapping a search result: go back to the results, not to the chapter read
 * before the search (B-182). The tap remembers where it landed; the first Back press while the
 * reader is still on that chapter, with the search still open, returns to the results. Moving on
 * to another chapter makes the remembered place stale, so Back then steps through the reader's
 * own history as before.
 */
export interface ReaderPlace { book: number | null; chapter: number | null }

export function createSearchReturn() {
  let landed: ReaderPlace | null = null;
  return {
    /** A search result was just opened at `place`. */
    mark(place: ReaderPlace | null | undefined): void {
      landed = place ? { book: place.book, chapter: place.chapter } : null;
    },
    forget(): void {
      landed = null;
    },
    /** True once (and clears itself) when Back should show the results again. */
    take(current: ReaderPlace | null | undefined, searchOpen: boolean): boolean {
      const ok = !!landed && searchOpen && !!current && current.book === landed.book && current.chapter === landed.chapter;
      landed = null;
      return ok;
    },
  };
}

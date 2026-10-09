/**
 * Edit distance: the one number a fuzzy answer match is built out of.
 *
 * Two rows rather than a full matrix. The recurrence only ever looks one row
 * back, and this runs on a phone on every keystroke of a typed answer, so
 * allocating an n×m grid to throw all but the last row of it away is waste
 * that shows up as jank on the cheapest device in the room.
 */

/**
 * Levenshtein distance: insertions, deletions and substitutions, one each.
 *
 * Comparison is by UTF-16 code unit rather than by code point. Everything this
 * module judges has already been through `normalise`, which leaves nothing but
 * letters, digits and spaces, so the distinction cannot arise here and code
 * units are the cheaper of the two.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // The surviving row is indexed by one of the two strings, so that string
  // being the shorter one is what keeps the allocation small.
  const row = a.length <= b.length ? a : b;
  const column = a.length <= b.length ? b : a;

  let cells: number[] = Array.from({ length: row.length + 1 }, (_, index) => index);
  let last = 0;

  for (let i = 1; i <= column.length; i++) {
    const columnCode = column.charCodeAt(i - 1);
    // `left` is the cell just written and `diagonal` the one above and to its
    // left. Carrying those two as scalars is what removes the second row: the
    // array being mapped supplies the cell directly above.
    let left = i;
    let diagonal = i - 1;
    cells = cells.map((above, j) => {
      if (j === 0) return i;
      const cost = columnCode === row.charCodeAt(j - 1) ? 0 : 1;
      const cell = Math.min(left + 1, above + 1, diagonal + cost);
      diagonal = above;
      left = cell;
      return cell;
    });
    // The last cell written in a row is its rightmost, so the final row's is
    // the answer — read from a scalar rather than off the end of the array.
    last = left;
  }

  return last;
}

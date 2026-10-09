/**
 * A reference as it should be read aloud:
 *   "John 3:16"        -> "John chapter 3, verse 16"
 *   "John 3:16-18"     -> "John chapter 3, verses 16 to 18"
 *   "John 3:16-4:2"    -> "John chapter 3 verse 16 to chapter 4 verse 2"
 *   "John 3"           -> "John chapter 3"
 * "1 John" is read "First John" so the voice does not say "one John".
 */

const ORDINAL: Record<string, string> = { '1': 'First', '2': 'Second', '3': 'Third' };

const REF_RE = /^(?:(.*?)\s+)?(\d+)(?::(\d+))?(?:\s*[-–—]\s*(?:(\d+):)?(\d+))?$/;

function spokenBook(book: string): string {
  const m = /^([123])\s+(.+)$/.exec(book);
  return m ? `${ORDINAL[m[1]]} ${m[2]}` : book;
}

export function spokenReference(
  passage: { reference: string },
  bookNames: ReadonlyArray<string> = [],
): string {
  const ref = passage.reference.trim();
  let book = '';
  let rest = ref;
  // A known book name wins, so "Song of Solomon 2:1" and "1 John 3:1" split correctly.
  let best = '';
  for (const name of bookNames) {
    if (name.length > best.length && ref.startsWith(name + ' ')) best = name;
  }
  if (best !== '') {
    book = best;
    rest = ref.slice(best.length).trim();
  }
  const m = REF_RE.exec(rest);
  if (!m) return ref;
  const [, parsedBook, c1, v1, c2, n2] = m;
  if (best === '' && parsedBook) book = parsedBook;
  const head = book ? `${spokenBook(book)} ` : '';
  if (v1 === undefined) {
    // Whole chapter, or a chapter range "3-4".
    return n2 !== undefined && c2 === undefined
      ? `${head}chapters ${c1} to ${n2}`
      : `${head}chapter ${c1}`;
  }
  if (n2 === undefined) return `${head}chapter ${c1}, verse ${v1}`;
  if (c2 !== undefined && c2 !== c1) {
    return `${head}chapter ${c1} verse ${v1} to chapter ${c2} verse ${n2}`;
  }
  return n2 === v1
    ? `${head}chapter ${c1}, verse ${v1}`
    : `${head}chapter ${c1}, verses ${v1} to ${n2}`;
}

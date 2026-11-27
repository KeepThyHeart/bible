/**
 * Turn the text a user types into the "compile passage notes" dialog
 * ("Rom 7:24-8:4; 1 Cor 15:50-58, Isa 53") into a list of verse-id passages.
 *
 * Uses the reference engine: `scan` finds the references it is sure of (it
 * reads `Rom 8:1, 3` as two ranges of Romans 8 and `..., Isa 53` as a new
 * book), then `parse` with `allowWholeBook` reads the leftover text between
 * matches, which catches what `scan` refuses: two-letter abbreviations without
 * a verse (`Ps 23, 24`) and bare books (`Jude`). Leftover text that is only
 * separators is ignored; anything else is reported as unrecognized.
 * `extractReferences` is deliberately not used.
 */
import { MAX_CHAPTERS, VerseIdHelper, referenceEngineFor, type ReferenceEngine, type ReferenceRange } from '@bible/core/browser';
import { i18nService } from '../I18nService';

export interface PassageSpec {
  label: string;
  book: number;
  startId: number;
  endId: number;
  /** The text this passage was read from. */
  source: string;
}

export interface ParsePassageListResult {
  passages: PassageSpec[];
  unrecognized: string[];
}

const FALLBACK_LAST_CHAPTER = 150;

/** Verse-id span of a range (engine semantics); a whole book runs to its last chapter. */
export function rangeToIds(r: ReferenceRange): { startId: number; endId: number } | null {
  const book = r.book as number;
  const calc = (c: number, v: number) => VerseIdHelper.calculate(book, c, v);
  if (!Number.isInteger(book) || book < 1 || book > 66) return null;
  if (r.wholeBook) {
    return { startId: calc(1, 1), endId: calc(MAX_CHAPTERS[book] ?? FALLBACK_LAST_CHAPTER, 999) };
  }
  if (!Number.isInteger(r.chapter) || r.chapter < 1 || r.chapter > 999) return null;
  let startId: number;
  let endId: number;
  if (r.verse === undefined) {
    const endChapter = r.endChapter ?? r.endVerse ?? r.chapter;
    startId = calc(r.chapter, 1);
    endId = calc(endChapter, 999);
  } else {
    const endChapter = r.endChapter ?? r.chapter;
    const endVerse = r.endVerse ?? (r.endChapter ? 999 : r.verse);
    startId = calc(r.chapter, r.verse);
    endId = calc(endChapter, endVerse);
  }
  if (!Number.isFinite(startId) || !Number.isFinite(endId)) return null;
  // A backwards range is a typo; collapse to the start rather than fetching nothing.
  return { startId, endId: Math.max(startId, endId) };
}

const SEPARATORS = /[\s,;，；、.]+/g;

function isOnlySeparators(s: string): boolean {
  const stripped = s.replace(SEPARATORS, ' ').trim();
  return stripped === '' || /^(and|&)$/i.test(stripped);
}

/** Drop leading/trailing separators and a dangling "and". */
function trimSeparators(s: string): string {
  return s
    .replace(/^[\s,;，；、.]+|[\s,;，；、.]+$/g, '')
    .replace(/^(?:and|&)\s+/i, '')
    .replace(/\s+(?:and|&)$/i, '')
    .trim();
}

interface Positioned {
  offset: number;
  spec: PassageSpec;
}

export function parsePassageList(
  text: string,
  opts: { canonical?: boolean; engine?: ReferenceEngine } = {},
): ParsePassageListResult {
  const engine = opts.engine ?? referenceEngineFor(i18nService.currentLocale);
  const found: Positioned[] = [];
  const unrecognized: string[] = [];

  const add = (range: ReferenceRange, source: string, offset: number): void => {
    const ids = rangeToIds(range);
    if (!ids) {
      unrecognized.push(source.trim());
      return;
    }
    found.push({
      offset,
      spec: { label: engine.format(range), book: range.book as number, ...ids, source: source.trim() },
    });
  };

  const matches = engine.scan(text, { requireCapital: false });
  let cursor = 0;
  const gapNotes: Array<{ offset: number; text: string }> = [];
  for (const m of matches) {
    if (m.start > cursor) gapNotes.push({ offset: cursor, text: text.slice(cursor, m.start) });
    add(m, m.text, m.start);
    cursor = Math.max(cursor, m.end);
  }
  if (cursor < text.length) gapNotes.push({ offset: cursor, text: text.slice(cursor) });

  // Gap text: split on item separators (each piece parsed on its own so one
  // bad piece does not hide its neighbours), keeping the offset of each piece.
  const unrecognizedAt: Array<{ offset: number; text: string }> = [];
  for (const gap of gapNotes) {
    const pieceRe = /[^;；\n]+/g;
    let pm: RegExpExecArray | null;
    while ((pm = pieceRe.exec(gap.text)) !== null) {
      const raw = pm[0];
      const offset = gap.offset + pm.index;
      if (isOnlySeparators(raw)) continue;
      const piece = trimSeparators(raw);
      if (!piece || isOnlySeparators(piece)) continue;
      const res = engine.parse(piece, { allowWholeBook: true });
      if (res.ok && res.ranges.length > 0) {
        for (const r of res.ranges) add(r, piece, offset);
      } else {
        unrecognizedAt.push({ offset, text: piece });
      }
    }
  }
  unrecognizedAt.sort((a, b) => a.offset - b.offset);
  unrecognized.push(...unrecognizedAt.map((u) => u.text));

  // Array.prototype.sort is stable: equal offsets (a list of ranges from one
  // gap piece) keep the order the engine returned them in.
  found.sort((a, b) => a.offset - b.offset);
  let passages = found.map((f) => f.spec);
  if (opts.canonical) passages = [...passages].sort((a, b) => a.startId - b.startId);
  return { passages, unrecognized };
}

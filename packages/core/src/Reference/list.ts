import type { ReferenceEngine } from './engine';
import type { RefBook, ReferenceParseFailure, ReferenceRange } from './types';

/** One passage of a parsed list. Offsets index the original input. */
export interface ReferenceListItem {
  range: ReferenceRange;
  text: string;
  start: number;
  end: number;
}

export interface ReferenceListError {
  text: string;
  start: number;
  end: number;
  reason: ReferenceParseFailure | 'too-many';
  book?: RefBook;
}

export interface ReferenceListResult {
  ok: boolean;
  items: ReferenceListItem[];
  errors: ReferenceListError[];
}

export interface ReferenceListOptions {
  /** Accept a bare book name as the whole book. Default true. */
  allowWholeBook?: boolean;
  /** Reject chapters beyond the book's last chapter. Default true. */
  checkChapters?: boolean;
  /** Typo correction for book names. Default false. */
  fuzzy?: boolean;
  /** Most items accepted. Default 50. */
  maxItems?: number;
}

const SEPARATORS = /[;,，；、،]/gu;
const BOOK_START = /^\s*(?:\d\s*)?\p{L}/u;

interface Group {
  start: number;
  end: number;
}

/**
 * Parses a list of references that may span several books
 * ("Ps 23; Rom 8:28-39; Gen 1-2"). Reuses the engine's parser per book group;
 * only adds the split at list separators. Good items are returned even when
 * others fail (then `ok` is false).
 */
export function parseReferenceList(
  engine: ReferenceEngine,
  input: string,
  opts: ReferenceListOptions = {},
): ReferenceListResult {
  const allowWholeBook = opts.allowWholeBook ?? true;
  const checkChapters = opts.checkChapters ?? true;
  const fuzzy = opts.fuzzy ?? false;
  const maxItems = opts.maxItems ?? 50;

  // 1. Pieces between separators, trimmed, empty ones dropped.
  const pieces: Array<{ start: number; end: number; text: string }> = [];
  let from = 0;
  const push = (s: number, e: number) => {
    const raw = input.slice(s, e);
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text) pieces.push({ start: s + lead, end: s + lead + text.length, text });
  };
  for (const m of input.matchAll(SEPARATORS)) {
    push(from, m.index!);
    from = m.index! + 1;
  }
  push(from, input.length);

  if (pieces.length === 0) {
    return { ok: false, items: [], errors: [{ text: input.trim(), start: 0, end: input.length, reason: 'empty' }] };
  }

  // 2. Group pieces: a piece starting with a book attempt opens a new group.
  const groups: Group[] = [];
  for (const p of pieces) {
    if (groups.length === 0 || BOOK_START.test(p.text)) groups.push({ start: p.start, end: p.end });
    else groups[groups.length - 1].end = p.end;
  }

  // 3. Parse each group.
  const items: ReferenceListItem[] = [];
  const errors: ReferenceListError[] = [];
  for (const g of groups) {
    const text = input.slice(g.start, g.end);
    const res = engine.parse(text, { allowWholeBook, checkChapters, fuzzy, lists: true });
    if (res.ok) {
      for (const range of res.ranges) items.push({ range, text, start: g.start, end: g.end });
    } else {
      errors.push({ text, start: g.start, end: g.end, reason: res.reason, ...(res.book !== undefined ? { book: res.book } : {}) });
    }
  }

  // 4. Limits and verdict.
  if (items.length > maxItems) {
    items.length = maxItems;
    errors.push({ text: input.trim(), start: 0, end: input.length, reason: 'too-many' });
  }
  return { ok: errors.length === 0 && items.length > 0, items, errors };
}

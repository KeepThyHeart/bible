/**
 * Turns the text typed in the playlist editor into passages for the store, or into messages the reader can fix.
 * The core list parser reads the names; chapter and verse bounds are checked against the canonical table.
 */
import { parseReferenceList, ReadingPlans } from '@bible/core/browser';
import type { ReferenceEngine, ReferenceRange } from '@bible/core/browser';
import { MAX_PASSAGES, toPassages } from '@bible/audio';
import type { AudioPassage } from '@bible/audio';
import { checkChapterVerse } from '../../../services/referenceProblem';

export interface PassageItem {
  passage: AudioPassage;
  range: ReferenceRange;
  /** What the reader typed for this passage. */
  text: string;
}

export interface PassageError {
  /** The camelCase part of `audio.passages.error.<code>`. */
  code: 'empty' | 'noBook' | 'badNumbers' | 'outOfRange' | 'tooMany';
  params: Record<string, string | number>;
}

export interface PassageParse {
  ok: boolean;
  items: PassageItem[];
  errors: PassageError[];
}

const CODES: Record<string, PassageError['code']> = {
  empty: 'empty', 'no-book': 'noBook', 'bad-numbers': 'badNumbers', 'out-of-range': 'outOfRange', 'too-many': 'tooMany',
};

export function parsePassageInput(engine: ReferenceEngine, input: string): PassageParse {
  const res = parseReferenceList(engine, input, { maxItems: MAX_PASSAGES });
  const errors: PassageError[] = res.errors.map((e) => ({
    code: CODES[e.reason] ?? 'badNumbers',
    params: {
      text: e.text,
      max: MAX_PASSAGES,
      book: e.book ? engine.format({ book: e.book, chapter: 1, wholeBook: true }) : e.text,
    },
  }));
  const items: PassageItem[] = [];
  for (const it of res.items) {
    const r = it.range;
    const last = r.endChapter ?? r.chapter;
    const lastVerse = r.endVerse;
    const bad = checkChapterVerse(r.book, r.chapter, r.verse) ?? checkChapterVerse(r.book, last, lastVerse);
    if (bad) {
      errors.push({ code: 'outOfRange', params: { text: it.text, book: engine.format({ book: r.book, chapter: 1, wholeBook: true }), max: MAX_PASSAGES } });
      continue;
    }
    const [passage] = toPassages([r], (b) => ReadingPlans.chapterCount(b));
    if (passage) items.push({ passage, range: r, text: it.text });
  }
  if (items.length === 0 && errors.length === 0) errors.push({ code: 'empty', params: {} });
  return { ok: errors.length === 0 && items.length > 0, items, errors };
}

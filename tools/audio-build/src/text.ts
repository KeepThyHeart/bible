/**
 * The text of a chapter as it is spoken, and the hash that ties a recording to it.
 *
 * The preparer is core's `TextPreparer`, the same instance of code the web app
 * runs for live speech, so recordings and on-device speech say the same words.
 */

import { createHash } from 'node:crypto';
import type { ITextPreparer, VerseText } from './core';

export interface PreparedChapter {
  /** The spoken lead-in ("John, chapter 3."), or null when there is none. */
  intro: string | null;
  /** Verses with speakable text, ascending. Verse 0 is a Psalm title. */
  verses: Array<{ verse: number; text: string }>;
  /** SHA-256 of the whole prepared chapter. */
  textHash: string;
}

export interface PrepareInput {
  moduleAbbr: string;
  book: number;
  chapter: number;
  bookName: string;
  language: string;
  verses: VerseText[];
  readIntro?: boolean;
}

/** Same rules as the player: a repeated verse number is ignored, an empty verse is skipped. */
export function prepareChapterText(prep: ITextPreparer, input: PrepareInput): PreparedChapter {
  const seen = new Set<number>();
  const verses: PreparedChapter['verses'] = [];
  for (const raw of input.verses) {
    if (seen.has(raw.verse)) continue;
    seen.add(raw.verse);
    const text = prep.verse(raw, input.language).trim();
    if (text) verses.push({ verse: raw.verse, text });
  }
  verses.sort((a, b) => a.verse - b.verse);
  let intro: string | null = null;
  if (input.readIntro !== false && verses.length > 0) {
    const t = prep.chapterIntro({ moduleAbbr: input.moduleAbbr, book: input.book, chapter: input.chapter }, input.bookName, input.language).trim();
    intro = t || null;
  }
  return { intro, verses, textHash: hashChapterText(intro, verses) };
}

export function hashChapterText(intro: string | null, verses: ReadonlyArray<{ verse: number; text: string }>): string {
  const h = createHash('sha256');
  h.update(JSON.stringify({ intro, verses: verses.map(v => [v.verse, v.text]) }));
  return h.digest('hex');
}

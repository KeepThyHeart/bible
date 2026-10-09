/**
 * Turning host verse DTOs into the `VerseText` the panel renders.
 *
 * Two things make this more than a field rename.
 *
 * **Tokenisation is a contract, not a convenience.** Scoring compares typed
 * words against `VerseText.words` by index, and the panel renders blanks by
 * index into the same array. If the panel re-split the text it would only take
 * one disagreement about a hyphen for a user to be marked wrong on a word they
 * typed correctly. So the split happens here, once, and the array travels.
 *
 * **The formatting DTO is in transition.** The host historically exposed only
 * a legacy shape - one poetry indent for a whole verse and a bare
 * `sectionHeading` string - which cannot express a line break inside a verse
 * (Psalm 1:1 is three lines) or distinguish a psalm superscription from an
 * editorial heading. A richer block shape is being added. This module reads
 * the block shape when it is there and falls back to the legacy fields when it
 * is not, so the extension runs against either host build and simply renders
 * better against the newer one.
 */

import type { BibleVerseDto } from './ports';
import type { Line, VerseText } from './types';

/**
 * The block-shaped formatting the host may or may not send yet.
 *
 * Declared structurally rather than imported so that this file compiles
 * against a host build that does not have these fields. Everything is
 * optional and every read is guarded.
 */
interface BlockFormatting {
  paragraph_start?: boolean;
  lines?: { start: number; end: number; level: number }[];
  heading?: string;
  heading_kind?: 'section' | 'psalm_title';
}

interface LegacyFormatting {
  paragraphStart?: boolean;
  poetry?: { isPoetry?: boolean; indentLevel?: number };
  sectionHeading?: string;
}

type AnyFormatting = LegacyFormatting & {
  block?: BlockFormatting;
  lines?: BlockFormatting['lines'];
  heading?: string;
  headingKind?: 'section' | 'psalm_title';
  heading_kind?: 'section' | 'psalm_title';
};

/**
 * Split verse text into scoreable words.
 *
 * Collapses all whitespace and drops empty fragments. Punctuation is kept
 * attached to its word: it is what the reader sees, and stripping it here
 * would make the rendered text wrong. Comparison, not tokenisation, is where
 * punctuation gets ignored - see `wordsMatch` in `exercises/normalize.ts`.
 */
export function splitWords(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

/** Clamp an arbitrary indent number onto the 1..3 the renderer supports. */
function clampLevel(level: number): 1 | 2 | 3 {
  if (level <= 1) return 1;
  if (level >= 3) return 3;
  return 2;
}

/**
 * Read poetic lines out of whichever formatting shape the host sent.
 *
 * Returns null for prose. The legacy fallback is honest about its limits: it
 * can say "this whole verse is one poetic line at this indent" and nothing
 * more, because that is genuinely all the legacy field carries. Inventing line
 * breaks from punctuation was considered and rejected - a guessed break in the
 * middle of a psalm looks like a bug, and a wrong break changes what the user
 * is asked to recall.
 */
function readLines(fmt: AnyFormatting | undefined, wordCount: number): Line[] | null {
  if (!fmt) return null;

  const blockLines = fmt.block?.lines ?? fmt.lines;
  if (blockLines && blockLines.length > 0) {
    return blockLines.map((l) => ({
      start: Math.max(0, l.start),
      end: Math.min(wordCount - 1, l.end),
      level: clampLevel(l.level),
    }));
  }

  if (fmt.poetry?.isPoetry) {
    return [{ start: 0, end: Math.max(0, wordCount - 1), level: clampLevel(fmt.poetry.indentLevel ?? 1) }];
  }

  return null;
}

/**
 * Read a psalm superscription, and only a superscription.
 *
 * The user asked for psalm titles and explicitly not section headings, which
 * is a distinction the legacy `sectionHeading` string cannot make - one field,
 * no kind. So against a legacy host this returns null rather than guessing:
 * showing an editorial heading the user asked not to see is a worse failure
 * than showing no title at all, and the block shape resolves it properly.
 */
function readPsalmTitle(fmt: AnyFormatting | undefined): string | null {
  if (!fmt) return null;
  const heading = fmt.block?.heading ?? fmt.heading;
  const kind = fmt.block?.heading_kind ?? fmt.heading_kind ?? fmt.headingKind;
  if (heading && kind === 'psalm_title') return heading;
  return null;
}

export interface VerseLabeller {
  (verseId: number): string;
}

/** Convert one host DTO into the panel's verse shape. */
export function toVerseText(dto: BibleVerseDto, label: string): VerseText {
  // `textPlain` is the same text with inline markup removed. Prefer it: the
  // words are what gets typed and compared, and a stray tag inside a token
  // would make a correct answer unmatchable.
  const source = (dto as { textPlain?: string }).textPlain ?? dto.text;
  const words = splitWords(source);
  const fmt = dto.formattingData as AnyFormatting | undefined;

  return {
    verseId: dto.verseId,
    label,
    words,
    lines: readLines(fmt, words.length),
    psalmTitle: readPsalmTitle(fmt),
    paragraphStart: Boolean(fmt?.block?.paragraph_start ?? fmt?.paragraphStart),
  };
}

/**
 * How many verses of context to fetch either side of a passage.
 *
 * Enough to establish where you are without turning a message into a chapter.
 * Three is roughly a paragraph, and the 256 KB panel message cap is nowhere
 * near threatened by it.
 */
export const CONTEXT_VERSES = 3;

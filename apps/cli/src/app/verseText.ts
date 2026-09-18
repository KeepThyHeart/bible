/**
 * `BibleVerse` → styled runs for the terminal.
 *
 * Core stores presentation as *data*: `bible_verse.text` is clean UTF-8 with no
 * markup at all, and `formatting.spans` names word ranges that carry a role —
 * `words_of_christ`, `supplied`, `divine_name` (see `Data/Text/VerseFormatting.ts`).
 * Turning a role into an appearance is the renderer's job, and this is the
 * terminal's renderer. `Services/VerseFormatter.ts` is the HTML one; it emits
 * `<span>`s and is no use here.
 *
 * Measured against the bundled KJV, which carries all three:
 *
 * | Span | Verses | Terminal treatment |
 * |---|---|---|
 * | `supplied` | 14,233 | italic — as they are printed in a real KJV |
 * | `divine_name` | 5,826 | **uppercased** — see below |
 * | `words_of_christ` | 2,026 | red, toggled by `w` |
 *
 * ## Why divine names are uppercased rather than styled
 *
 * The stored text reads `Lord`, not `LORD`: the small-caps rendering that every
 * printed Bible uses lives in the span, not in the characters. A terminal has no
 * small caps and no way to synthesise them, so the only faithful rendering left
 * is full uppercase. Doing nothing would silently print `Lord` where the KJV
 * prints `LORD` — a difference that matters, because it is exactly the
 * distinction between the divine name and the title.
 */
import type { BibleVerse, VerseSpanType } from '@bible/core';
import { splitVerseWords, VerseIdHelper } from '@bible/core';

import { mergeStyle, type Style, type StyledSegment, type Theme } from '../term/style';

export interface VerseDisplayOptions {
  readonly theme: Theme;
  /** Colour the words of Christ. Toggled by `w`; a display setting, not a copy option (§5.3). */
  readonly redLetter: boolean;
  /** Italicise translator-supplied words. */
  readonly showSupplied: boolean;
}

/** A verse reduced to what the reader needs to lay it out. */
export interface DisplayVerse {
  readonly verseId: number;
  /** Verse number within its chapter. */
  readonly verse: number;
  /** Styled runs, in order. Joining their text reproduces `plainText`. */
  readonly runs: readonly StyledSegment[];
  /** Clean text, for copying and for width arithmetic. */
  readonly plainText: string;
  readonly paragraphStart: boolean;
  /** A psalm title or section heading attached to this verse. */
  readonly heading: string | undefined;
}

export function toDisplayVerse(verse: BibleVerse, options: VerseDisplayOptions): DisplayVerse {
  const { verse: verseNumber } = VerseIdHelper.parse(verse.verseId);
  const source = { text: verse.text, spans: verse.formatting.spans ?? [] };

  const words = splitVerseWords(source.text);
  const styles = new Array<Style | undefined>(words.length).fill(undefined);
  const uppercase = new Array<boolean>(words.length).fill(false);

  for (const span of source.spans) {
    const style = styleForSpan(span.type, options);
    for (let i = Math.max(0, span.start); i <= Math.min(words.length - 1, span.end); i += 1) {
      if (span.type === 'divine_name') uppercase[i] = true;
      if (style === undefined) continue;
      // Merged rather than replaced: a word can be both supplied and spoken by
      // Christ, and dropping either would lose real information.
      styles[i] = styles[i] === undefined ? style : mergeStyle(styles[i], style);
    }
  }

  const runs: StyledSegment[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const text = uppercase[i] === true ? words[i]!.toUpperCase() : words[i]!;
    const style = styles[i];
    const last = runs[runs.length - 1];
    // Coalesce so a verse with no spans is one run rather than one per word.
    if (last !== undefined && sameStyle(last.style, style)) {
      runs[runs.length - 1] = { ...last, text: `${last.text} ${text}` };
    } else {
      runs.push(style === undefined ? { text } : { text, style });
    }
  }

  return {
    verseId: verse.verseId,
    verse: verseNumber,
    runs,
    plainText: runs.map((run) => run.text).join(' '),
    paragraphStart: verse.isParagraphStart(),
    heading: verse.getSectionHeading(),
  };
}

function styleForSpan(type: VerseSpanType, options: VerseDisplayOptions): Style | undefined {
  switch (type) {
    case 'words_of_christ':
      return options.redLetter ? options.theme.wordsOfChrist : undefined;
    case 'supplied':
      return options.showSupplied ? options.theme.supplied : undefined;
    case 'emphasis':
      return options.theme.supplied;
    // `divine_name` changes the characters, not the style, and `quotation` /
    // `transliteration` have no terminal treatment worth the visual noise.
    default:
      return undefined;
  }
}

/**
 * Theme styles are shared objects, so identity settles almost every comparison.
 * The field compare is the fallback for merged styles, which are fresh objects.
 */
function sameStyle(a: Style | undefined, b: Style | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return (
    a.fg === b.fg &&
    a.bg === b.bg &&
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.reverse === b.reverse
  );
}

/**
 * Input dispatch (NAV-1), implementing DesignSpec §4.1.
 *
 * There is one input line and no mode to enter. What you type is parsed as a
 * reference first; if it parses you go there, and if it does not, it is a
 * search. That single rule is what removes the mode switch, the match list, and
 * the search prefix from the interface — so the rule has to be reliable, which
 * is what this file is for.
 *
 * Everything here is pure: it turns text plus "where the cursor is" into an
 * {@link Intent}. It performs no navigation and runs no query, so every row of
 * the §4.1 table can be asserted directly.
 *
 * **Context-relative forms are resolved here, not by core.** `16`, `3:16` and
 * `16-17` only mean anything relative to the chapter you are reading, and
 * core's `ReferenceParser` — correctly — has no notion of that. Anything that
 * names a book is handed to core.
 */
import { ENGLISH_BOOK_NAMES, type ParsedReference, ReferenceParser } from '@bible/core';

/**
 * Two-letter forms the CLI resolves that core does not.
 *
 * Core's table already carries 65 two-character abbreviations — `jn`, `mt`,
 * `mk`, `lk`, `ps`, `rm` and the rest all resolve exactly. `jo` is the notable
 * gap, and leaving it out is worse than it sounds: with no exact entry it
 * *fuzzy*-matches to **Joshua**, so `jo 3:16` silently navigates to Joshua 3:16
 * instead of John 3:16. Being sent to the wrong book without a word is the one
 * outcome the one-line design cannot afford.
 *
 * Kept here rather than in core deliberately (DesignSpec §2.4): changing core's
 * alias map would change desktop and web behaviour too.
 */
export const CLI_BOOK_ALIASES: ReadonlyMap<string, number> = new Map([['jo', 43]]);

function cliBookNames(): Map<string, number> {
  const names = new Map(ENGLISH_BOOK_NAMES);
  for (const [alias, book] of CLI_BOOK_ALIASES) names.set(alias, book);
  return names;
}

/** A reference resolved to absolute coordinates. */
export interface ResolvedReference {
  readonly book: number;
  readonly chapter: number;
  /** Absent for a whole-chapter reference. */
  readonly verse: number | undefined;
  readonly endChapter: number | undefined;
  readonly endVerse: number | undefined;
}

export type Intent =
  /** Nothing typed. */
  | { readonly kind: 'empty' }
  /** Go here. */
  | { readonly kind: 'reference'; readonly reference: ResolvedReference }
  /** Search the open modules. `forced` when the leading `/` was used. */
  | { readonly kind: 'search'; readonly query: string; readonly forced: boolean }
  /** `:` — `name` is empty when the bare colon opened the list. */
  | { readonly kind: 'command'; readonly name: string; readonly args: string }
  /** `<` and `>` — by the unit being read (§4.3). */
  | { readonly kind: 'step-unit'; readonly delta: 1 | -1 }
  /** `+5` / `-5`. */
  | { readonly kind: 'step-verse'; readonly delta: number };

/** Where the cursor is, so the relative forms mean something. */
export interface InputContext {
  readonly book: number;
  readonly chapter: number;
}

// Context-relative forms, in the order they must be tried. Each is anchored, so
// anything containing a book name falls through to core's parser.
const VERSE = /^(\d+)$/;
const VERSE_RANGE = /^(\d+)\s*-\s*(\d+)$/;
const CHAPTER_VERSE = /^(\d+)\s*:\s*(\d+)$/;
const CHAPTER_VERSE_RANGE = /^(\d+)\s*:\s*(\d+)\s*-\s*(\d+)$/;
const CROSS_CHAPTER_RANGE = /^(\d+)\s*:\s*(\d+)\s*-\s*(\d+)\s*:\s*(\d+)$/;
const VERSE_STEP = /^([+-])\s*(\d+)$/;

export interface ClassifyOptions {
  /** Defaults to a parser with core's English book tables. */
  readonly parser?: ReferenceParser;
}

const defaultParser = new ReferenceParser({ bookNames: cliBookNames() });

export function classifyInput(
  input: string,
  context: InputContext,
  options: ClassifyOptions = {},
): Intent {
  const text = input.trim();
  if (text === '') return { kind: 'empty' };

  // `:` is checked before everything else so a command can never be mistaken
  // for a reference — `:16` is a command, not verse 16.
  if (text.startsWith(':')) {
    const body = text.slice(1).trim();
    const spaceAt = body.indexOf(' ');
    return spaceAt === -1
      ? { kind: 'command', name: body, args: '' }
      : { kind: 'command', name: body.slice(0, spaceAt), args: body.slice(spaceAt + 1).trim() };
  }

  // The slash is the only escape hatch: it forces text that *would* parse as a
  // reference to be searched instead (§4.1).
  if (text.startsWith('/')) {
    return { kind: 'search', query: text.slice(1).trim(), forced: true };
  }

  if (text === '<') return { kind: 'step-unit', delta: -1 };
  if (text === '>') return { kind: 'step-unit', delta: 1 };

  const step = VERSE_STEP.exec(text);
  if (step) {
    const magnitude = Number.parseInt(step[2]!, 10);
    return { kind: 'step-verse', delta: step[1] === '-' ? -magnitude : magnitude };
  }

  const relative = resolveRelative(text, context);
  if (relative) return { kind: 'reference', reference: relative };

  const parser = options.parser ?? defaultParser;
  const parsed = parser.parse(text);
  if (parsed.isValid && parsed.book !== undefined && !isUntrustworthyFuzzyMatch(parsed)) {
    return { kind: 'reference', reference: fromParsed(parsed) };
  }

  // Not a reference, so it is a search. No prefix, no match list, no mode.
  return { kind: 'search', query: text, forced: false };
}

/**
 * The forms that only mean something relative to the current passage.
 *
 * A bare number is a *verse*, not a chapter — DesignSpec §4.1 is explicit, and
 * the alternative would make `23` ambiguous in Psalms with no way to say which
 * was meant.
 */
function resolveRelative(text: string, context: InputContext): ResolvedReference | undefined {
  const crossChapter = CROSS_CHAPTER_RANGE.exec(text);
  if (crossChapter) {
    return {
      book: context.book,
      chapter: Number.parseInt(crossChapter[1]!, 10),
      verse: Number.parseInt(crossChapter[2]!, 10),
      endChapter: Number.parseInt(crossChapter[3]!, 10),
      endVerse: Number.parseInt(crossChapter[4]!, 10),
    };
  }

  const chapterVerseRange = CHAPTER_VERSE_RANGE.exec(text);
  if (chapterVerseRange) {
    return {
      book: context.book,
      chapter: Number.parseInt(chapterVerseRange[1]!, 10),
      verse: Number.parseInt(chapterVerseRange[2]!, 10),
      endChapter: undefined,
      endVerse: Number.parseInt(chapterVerseRange[3]!, 10),
    };
  }

  const chapterVerse = CHAPTER_VERSE.exec(text);
  if (chapterVerse) {
    return {
      book: context.book,
      chapter: Number.parseInt(chapterVerse[1]!, 10),
      verse: Number.parseInt(chapterVerse[2]!, 10),
      endChapter: undefined,
      endVerse: undefined,
    };
  }

  const verseRange = VERSE_RANGE.exec(text);
  if (verseRange) {
    return {
      book: context.book,
      chapter: context.chapter,
      verse: Number.parseInt(verseRange[1]!, 10),
      endChapter: undefined,
      endVerse: Number.parseInt(verseRange[2]!, 10),
    };
  }

  const verse = VERSE.exec(text);
  if (verse) {
    return {
      book: context.book,
      chapter: context.chapter,
      verse: Number.parseInt(verse[1]!, 10),
      endChapter: undefined,
      endVerse: undefined,
    };
  }

  return undefined;
}

/**
 * Reject a *fuzzy* match on a one- or two-character book name.
 *
 * Core skips such keys during fuzzy matching for its own callers, but the
 * abbreviation still reaches the fuzzy stage from here, and two characters
 * carry too little signal to correct a typo with: `jo` becomes Joshua, and the
 * user is moved to a different book with no indication that a guess was made.
 *
 * An *exact* alias is unaffected — `jn`, `mt`, `ps` and the rest still resolve.
 * A rejected guess falls through to search, where being wrong costs the user
 * nothing but a second look.
 */
function isUntrustworthyFuzzyMatch(parsed: ParsedReference): boolean {
  if (!parsed.fuzzyMatch) return false;
  const entered = (parsed.bookName ?? '').replace(/[\s.]/g, '');
  return entered.length <= 2;
}

function fromParsed(parsed: ParsedReference): ResolvedReference {
  return {
    book: parsed.book!,
    chapter: parsed.chapter ?? 1,
    verse: parsed.verse,
    endChapter: parsed.endChapter,
    endVerse: parsed.endVerse,
  };
}

/**
 * True when the reference names a span rather than a single verse — the reader
 * selects the range on arrival (§4.1).
 */
export function isRange(reference: ResolvedReference): boolean {
  return reference.endVerse !== undefined || reference.endChapter !== undefined;
}

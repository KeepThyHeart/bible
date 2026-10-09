/**
 * The command box grammar: text in, a `Command` out. Pure and synchronous, so
 * the whole table of "what does Enter do with this?" is exercised directly.
 *
 * Rule: if the text reads as an exact command, it is that command; otherwise it
 * is a search. Order matters and is the ambiguity policy:
 *
 *   1. empty, `.`, `clear`/`x`, `?`, `blank`
 *   2. a bare verse: `18`, `v18`, `:18`, `18-20`  (in the current chapter)
 *   3. a passage: book [chapter[[: ]verse[-verse]]] [translation]
 *   4. a hymn: `h|hymn|song` then a number or title, then a verse list
 *   5. everything else: search
 *
 * Passage precedes hymn so `song 2:1` is Song of Solomon while `song amazing
 * grace` is a hymn. Nothing here touches stores or i18n: the app's book table
 * arrives through `CommandContext` (see `commandContext.ts` for the real one).
 */

export type Command =
  | { type: 'none' }
  | {
      type: 'passage';
      book: number;
      chapter: number;
      verseStart?: number;
      verseEnd?: number;
      /** Only when the text named a translation; otherwise the host's default applies. */
      module?: string;
      /** The book name was typo-corrected ("jonh 3:16"). */
      fuzzy?: boolean;
    }
  | { type: 'verse'; verseStart: number; verseEnd?: number }
  | {
      type: 'hymn';
      /** Hymnal number as typed, when the first word after `hymn` is a number. */
      number?: string;
      title?: string;
      /** Verse-order tokens ('1', '2', 'R'), ranges already expanded. May be empty. */
      verses: string[];
    }
  | { type: 'blank' }
  | { type: 'clear' }
  | { type: 'help' }
  | { type: 'search'; query: string };

export type CommandType = Command['type'];

/** Everything the parser needs from the outside world. */
export interface CommandContext {
  /** Exact book lookup by name or alias ("john", "jn", "1 john", "1jn"); null when unknown. */
  resolveBook(name: string): number | null;
  /** Typo-tolerant lookup, used only when the exact one fails and a chapter follows. Optional. */
  fuzzyBook?(name: string): number | null;
  /** Translation lookup by abbreviation, case-insensitive; returns the canonical abbreviation. */
  resolveModule(name: string): string | null;
  /** Localized display name for a book. */
  bookName(book: number): string;
  /** Book names in canonical order, for Tab completion. */
  bookNames(): Array<{ book: number; name: string }>;
  /** "John 3:16" / "John 3:16-18" / "John 3", as the app writes references. */
  formatRef(book: number, chapter: number, verseStart?: number, verseEnd?: number): string;
  /** Translation used when the text names none (shown in the hint). */
  defaultModule?: string;
  /** The passage currently on screen, for the hint of a bare verse. */
  current?: { book: number; chapter: number } | null;
}

const MAX_CHAPTER = 150;
const MAX_VERSE = 176;
const MAX_HYMN_VERSES = 30;

function clean(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function inRange(n: number, max: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= max;
}

// --- bare verse ------------------------------------------------------------

const VERSE_ONLY_RE = /^(?:v(?:v|erses?)?\.?\s*|:\s*)?(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?$/i;

function parseVerseOnly(text: string): Command | null {
  const m = VERSE_ONLY_RE.exec(text);
  if (!m) return null;
  const verseStart = Number(m[1]);
  const end = m[2] ? Number(m[2]) : undefined;
  if (!inRange(verseStart, MAX_VERSE)) return null;
  if (end !== undefined && (!inRange(end, MAX_VERSE) || end < verseStart)) return null;
  return end !== undefined && end !== verseStart
    ? { type: 'verse', verseStart, verseEnd: end }
    : { type: 'verse', verseStart };
}

// --- passage ---------------------------------------------------------------

/** "location" = the part after the book: `3`, `3:16`, `3 16`, `3:16-18`, `3 16-18`. */
function parseLocation(rest: string): { chapter: number; verseStart?: number; verseEnd?: number } | null {
  const r = rest.replace(/\s*([-–—])\s*/g, '-').trim();
  const chapterOnly = /^(\d{1,3})$/.exec(r);
  if (chapterOnly) {
    const chapter = Number(chapterOnly[1]);
    return inRange(chapter, MAX_CHAPTER) ? { chapter } : null;
  }
  const m = /^(\d{1,3})(?:[:. ]|\s*,\s*)(\d{1,3})(?:-(\d{1,3}))?$/.exec(r);
  if (!m) return null;
  const chapter = Number(m[1]);
  const verseStart = Number(m[2]);
  const end = m[3] ? Number(m[3]) : undefined;
  if (!inRange(chapter, MAX_CHAPTER) || !inRange(verseStart, MAX_VERSE)) return null;
  if (end !== undefined && (!inRange(end, MAX_VERSE) || end < verseStart)) return null;
  return end !== undefined && end !== verseStart
    ? { chapter, verseStart, verseEnd: end }
    : { chapter, verseStart };
}

function stripDot(word: string): string {
  return word.replace(/\.$/, '');
}

function parsePassage(text: string, ctx: CommandContext): Command | null {
  // "john3:16" / "ps23" -> "john 3:16" / "ps 23"; a leading digit ("1john") is left alone.
  const spaced = text.replace(/([a-z])\.?(?=\d)/gi, '$1 ');
  let tokens = spaced.split(' ');
  if (tokens.length === 0) return null;

  // Trailing translation: "john 3:16 esv". Only after something numeric or a
  // book, so "ps esv" is not misread. A word that is also a book (none of the
  // usual translation abbreviations are) would already have been taken as one.
  let module: string | undefined;
  if (tokens.length >= 2) {
    const last = tokens[tokens.length - 1];
    if (/^[a-z][a-z0-9-]*$/i.test(last)) {
      const resolved = ctx.resolveModule(last);
      if (resolved && ctx.resolveBook(tokens.join(' ')) === null) {
        module = resolved;
        tokens = tokens.slice(0, -1);
      }
    }
  }

  for (let n = Math.min(3, tokens.length); n >= 1; n--) {
    const name = tokens.slice(0, n).map(stripDot).join(' ');
    const book = ctx.resolveBook(name);
    if (book === null) continue;
    const rest = tokens.slice(n).join(' ');
    if (rest === '') {
      // A bare book name opens its first chapter.
      return { type: 'passage', book, chapter: 1, ...(module ? { module } : {}) };
    }
    const loc = parseLocation(rest);
    if (!loc) continue;
    return { type: 'passage', book, ...loc, ...(module ? { module } : {}) };
  }

  // Typo-tolerant, only with a chapter after the name ("jonh 3:16").
  if (ctx.fuzzyBook) {
    const firstDigit = tokens.findIndex((t, i) => i > 0 && /^\d/.test(t));
    if (firstDigit > 0 && firstDigit <= 3) {
      const book = ctx.fuzzyBook(tokens.slice(0, firstDigit).map(stripDot).join(' '));
      const loc = book === null ? null : parseLocation(tokens.slice(firstDigit).join(' '));
      if (book !== null && loc) {
        return { type: 'passage', book, ...loc, fuzzy: true, ...(module ? { module } : {}) };
      }
    }
  }
  return null;
}

// --- hymn ------------------------------------------------------------------

const HYMN_PREFIX_RE = /^(?:h|hymns?|song)(?![a-z0-9])[\s:.\-–—]*(.+)$/i;

/** One verse-list token: `1`, `1-3`, `1,2,5`, `v1`, `v1-3`, `R`. Null when it is not one. */
function expandVerseToken(token: string): string[] | null {
  const body = token.replace(/^v(?:erses?)?\.?/i, '').replace(/[-–—]/g, '-');
  if (!/^(?:\d+(?:-\d+)?|r)(?:,(?:\d+(?:-\d+)?|r))*,?$/i.test(body)) return null;
  const out: string[] = [];
  for (const part of body.split(',')) {
    if (!part) continue;
    if (/^r$/i.test(part)) { out.push('R'); continue; }
    const [a, b] = part.split('-').map(Number);
    if (b === undefined) out.push(String(a));
    else if (b >= a && b - a < MAX_HYMN_VERSES) for (let i = a; i <= b; i++) out.push(String(i));
    else return null;
  }
  return out;
}

function parseHymn(text: string): Command | null {
  const m = HYMN_PREFIX_RE.exec(text);
  if (!m) return null;
  const rest = m[1].replace(/\s*([-–—])\s*(?=\d)/g, '-').trim();
  // "h 23" needs "h" followed by content, but "h" + only a dash is nothing.
  const tokens = rest.split(' ').filter(Boolean);
  if (tokens.length === 0) return null;

  let number: string | undefined;
  if (/^\d+$/.test(tokens[0])) {
    number = tokens.shift();
  }

  // Verse list peeled from the end, up to the first non-verse word.
  const verses: string[] = [];
  const tail: string[][] = [];
  while (tokens.length > (number ? 0 : 1)) {
    const expanded = expandVerseToken(tokens[tokens.length - 1]);
    if (!expanded) break;
    tail.unshift(expanded);
    tokens.pop();
  }
  for (const group of tail) verses.push(...group);
  if (verses.length > MAX_HYMN_VERSES) verses.length = MAX_HYMN_VERSES;

  if (number) {
    // "hymn 23 1 2": anything left over that is not a verse makes it a title after all.
    if (tokens.length > 0) return { type: 'hymn', title: [number, ...tokens].join(' ').replace(/,$/, ''), verses };
    return { type: 'hymn', number, verses };
  }
  const title = tokens.join(' ').replace(/[,;:]+$/, '').trim();
  if (!title) return null;
  return { type: 'hymn', title, verses };
}

// --- entry point -----------------------------------------------------------

export function parseCommand(text: string, ctx: CommandContext): Command {
  const t = clean(text);
  if (!t) return { type: 'none' };
  const lower = t.toLowerCase();

  if (t === '.' || lower === 'blank' || lower === 'unblank') return { type: 'blank' };
  if (lower === 'x' || lower === 'clear') return { type: 'clear' };
  if (t === '?' || lower === 'help') return { type: 'help' };

  const verse = parseVerseOnly(t);
  if (verse) return verse;

  const passage = parsePassage(t, ctx);
  if (passage) return passage;

  const hymn = parseHymn(t);
  if (hymn) return hymn;

  return { type: 'search', query: t };
}

// --- hint line -------------------------------------------------------------

export type HintTranslate = (key: string, params: Record<string, string | number>, fallback: string) => string;

/** English fallback used by tests and when no translator is passed. */
const englishHint: HintTranslate = (_key, _params, fallback) => fallback;

function versesLabel(verses: string[]): string {
  return verses.join(', ');
}

/**
 * What Enter will do, as a short phrase for the hint line. Returns null for an
 * empty box. Keys live under `present.command.hint.*`.
 */
export function describeCommand(cmd: Command, ctx: CommandContext, t: HintTranslate = englishHint): string | null {
  switch (cmd.type) {
    case 'none':
      return null;
    case 'passage': {
      const ref = ctx.formatRef(cmd.book, cmd.chapter, cmd.verseStart, cmd.verseEnd);
      const module = (cmd.module ?? ctx.defaultModule ?? '').toUpperCase();
      return module
        ? t('present.command.hint.passage', { ref, module }, `Show ${ref} (${module})`)
        : t('present.command.hint.passageNoModule', { ref }, `Show ${ref}`);
    }
    case 'verse': {
      const cur = ctx.current;
      const ref = cur ? ctx.formatRef(cur.book, cur.chapter, cmd.verseStart, cmd.verseEnd) : null;
      if (ref) return t('present.command.hint.verseIn', { ref }, `Show ${ref}`);
      const n = cmd.verseEnd ? `${cmd.verseStart}-${cmd.verseEnd}` : String(cmd.verseStart);
      return t('present.command.hint.verse', { verse: n }, `Go to verse ${n}`);
    }
    case 'hymn': {
      const what = cmd.title ?? cmd.number ?? '';
      if (cmd.verses.length > 0) {
        const verses = versesLabel(cmd.verses);
        return cmd.number && !cmd.title
          ? t('present.command.hint.hymnNumberVerses', { number: cmd.number, verses }, `Show hymn ${cmd.number}, verses ${verses}`)
          : t('present.command.hint.hymnVerses', { title: what, verses }, `Show hymn '${what}', verses ${verses}`);
      }
      return cmd.number && !cmd.title
        ? t('present.command.hint.hymnNumber', { number: cmd.number }, `Show hymn ${cmd.number}`)
        : t('present.command.hint.hymn', { title: what }, `Show hymn '${what}'`);
    }
    case 'blank':
      return t('present.command.hint.blank', {}, 'Blank or unblank the screen');
    case 'clear':
      return t('present.command.hint.clear', {}, 'Clear highlights');
    case 'help':
      return t('present.command.hint.help', {}, 'Show help');
    case 'search':
      return t('present.command.hint.search', { query: cmd.query }, `Search for '${cmd.query}'`);
  }
}

// --- Tab completion --------------------------------------------------------

export interface Completion {
  /** The full replacement text, with the book name completed and a trailing space. */
  text: string;
  /** Every book that matched, canonical order, so a repeated Tab can cycle. */
  candidates: string[];
}

/**
 * Complete a book-name prefix. Only fires while the text is still just a
 * (possibly numbered) book prefix: `jo`, `1 co`, `song of`. Once a chapter has
 * been typed there is nothing to complete. `cycle` picks among several matches.
 */
export function completeBook(text: string, ctx: CommandContext, cycle = 0): Completion | null {
  const t = text.replace(/^\s+/, '');
  if (!/^[0-9]?\s?[a-z][a-z .]*$/i.test(t) || t.trim() === '') return null;
  const prefix = clean(t).toLowerCase().replace(/\.$/, '');
  const compact = (s: string) => s.toLowerCase().replace(/\s+/g, '');
  const candidates = ctx.bookNames()
    .map(b => b.name)
    .filter(name => {
      const n = name.toLowerCase();
      return n.startsWith(prefix) || compact(n).startsWith(compact(prefix));
    });
  if (candidates.length === 0) return null;
  const pick = candidates[((cycle % candidates.length) + candidates.length) % candidates.length];
  return { text: `${pick} `, candidates };
}

/**
 * Recognising a hymn line in the notes and resolving it against the library.
 *
 * Two halves, both pure:
 *
 *  - `parseHymnLine` reads what the preacher wrote -- `Hymn 23`,
 *    `Hymn: Amazing Grace (verses 1, 2, 5)`, `Song – It Is Well v1-3` -- into
 *    a number or a title plus an optional verse list, without looking at the
 *    library at all.
 *  - `resolveHymn` finds the hymn: a number matches a hymnal number, anything
 *    else is a fuzzy title match (normalised, then exact, prefix, word-prefix
 *    and finally trigram similarity). Anything it cannot settle on its own --
 *    no match, several close matches, a verse the hymn does not have -- comes
 *    back as `'choose'` with a translatable reason, never as a guess.
 *
 * The library is a parameter rather than an import so tests need no data and
 * the notes chunk does not pull the library in.
 */

import type { PresentHymnItem } from '../../lib/protocol';
import type { HymnLibraryEntry, NotesReason } from './types';

// ---------------------------------------------------------------------------
// Parsing a line
// ---------------------------------------------------------------------------

export interface ParsedHymnLine {
  /** Where the line's content starts and ends (whitespace trimmed), relative to the line. */
  from: number;
  to: number;
  /** `Hymn 23` -> '23'. */
  number?: string;
  /** The title as written, quotes stripped. May sit alongside a number (`Hymn 23: Amazing Grace`). */
  title?: string;
  /** Tokens as written and expanded: `1–3, R` -> ['1', '2', '3', 'R']. Absent means the hymn's own order. */
  verses?: string[];
  /** The verse list was there but did not make sense (`3–1`). */
  versesInvalid?: boolean;
}

const PREFIX_RE = /^(\s*)(?:hymn|song)\b[\s:#.\-–—]*/i;

const LIST_TOKEN = String.raw`(?:\d{1,2}|[Rr])`;
const LIST_SEP = String.raw`\s*(?:,|;|&|\band\b|[-–—]|\s)\s*`;
const LIST_BODY = `${LIST_TOKEN}(?:${LIST_SEP}${LIST_TOKEN})*`;
const LIST_KEYWORD = String.raw`(?:verses?|vv?\.?|vs\.?|stanzas?|st\.)`;

/** `(verses 1, 2, 5)`, `(1–3, R)` at the end of the line. */
const PAREN_LIST_RE = new RegExp(String.raw`\(\s*(?:${LIST_KEYWORD}\s*)?(${LIST_BODY})\s*\)\s*$`);
/** `v1-3`, `vv. 1–3`, `verses 1, 2 and 5` at the end of the line. */
const KEYWORD_LIST_RE = new RegExp(String.raw`(?:^|[\s,;:–—-])${LIST_KEYWORD}\s*(${LIST_BODY})\s*$`, 'i');

/** `23`, `#23`, `23: Amazing Grace`, `23 Amazing Grace` -- but not `10,000 Reasons`. */
const NUMBER_RE = /^#?\s*(\d{1,4}[a-z]?)(?:$|\s*[:.\-–—]\s+(.*)$|\s+(.*)$)/i;

/** Expand a verse list into tokens. Returns null when it does not make sense. */
export function parseVerseList(list: string): string[] | null {
  const out: string[] = [];
  const re = new RegExp(`(${LIST_TOKEN})(?:\\s*[-–—]\\s*(${LIST_TOKEN}))?`, 'g');
  for (const match of list.matchAll(re)) {
    const a = match[1].toUpperCase();
    const b = match[2]?.toUpperCase();
    if (b === undefined) { out.push(a); continue; }
    if (a === 'R' || b === 'R') return null;
    const start = Number(a);
    const end = Number(b);
    if (end < start || end - start > 30) return null;
    for (let n = start; n <= end; n++) out.push(String(n));
  }
  return out.length ? out : null;
}

function stripQuotes(value: string): string {
  return value.replace(/^["“”'‘’]+|["“”'‘’]+$/g, '').trim();
}

/**
 * Parse one line of notes as a hymn line, or return null when it is not one.
 *
 * The caller decides first whether the line is a Bible reference (`Song of
 * Solomon 2:4` starts with "Song" too); this only looks at the words.
 */
export function parseHymnLine(line: string): ParsedHymnLine | null {
  const prefix = PREFIX_RE.exec(line);
  if (!prefix) return null;

  const from = prefix[1].length;
  const to = line.trimEnd().length;
  let rest = line.slice(prefix[0].length, to);
  const out: ParsedHymnLine = { from, to };

  const listMatch = PAREN_LIST_RE.exec(rest) ?? KEYWORD_LIST_RE.exec(rest);
  if (listMatch) {
    const verses = parseVerseList(listMatch[1]);
    if (verses) out.verses = verses;
    else out.versesInvalid = true;
    rest = rest.slice(0, listMatch.index);
  }

  rest = rest.replace(/[\s,:;.\-–—]+$/, '').trim();

  const number = NUMBER_RE.exec(rest);
  if (number) {
    out.number = number[1].toLowerCase();
    const title = stripQuotes(number[2] ?? number[3] ?? '');
    if (title) out.title = title;
  } else {
    const title = stripQuotes(rest);
    if (title) out.title = title;
  }

  if (!out.number && !out.title) return null;
  return out;
}

// ---------------------------------------------------------------------------
// Fuzzy title matching
// ---------------------------------------------------------------------------

/** Lower case, accents and punctuation gone, apostrophes dropped, spaces collapsed. */
export function normalizeTitle(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’‘`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function trigrams(value: string): Set<string> {
  const padded = `  ${value} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  return out;
}

function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared++;
  return (2 * shared) / (a.size + b.size);
}

interface IndexedTitle { norm: string; words: string[]; grams: Set<string>; weight: number }
interface IndexedHymn { hymn: HymnLibraryEntry; titles: IndexedTitle[] }

const indexCache = new WeakMap<readonly HymnLibraryEntry[], IndexedHymn[]>();

function indexLibrary(library: readonly HymnLibraryEntry[]): IndexedHymn[] {
  const cached = indexCache.get(library);
  if (cached) return cached;
  const index = library.map(hymn => {
    const titles: IndexedTitle[] = [];
    const add = (raw: string | undefined, weight: number): void => {
      const norm = raw ? normalizeTitle(raw) : '';
      if (norm) titles.push({ norm, words: norm.split(' '), grams: trigrams(norm), weight });
    };
    add(hymn.title, 1);
    for (const alt of hymn.altTitles ?? []) add(alt, 1);
    // A first line is how many people name a hymn, but a title that equals the
    // query should still win over a first line that does.
    add(hymn.firstLine, 0.97);
    return { hymn, titles };
  });
  indexCache.set(library, index);
  return index;
}

/** Score in [0, 1] of one normalised query against one indexed title. */
function scoreTitle(query: string, queryWords: string[], queryGrams: Set<string>, title: IndexedTitle): number {
  if (title.norm === query) return 1;
  // Prefix: "it is well" -> "it is well with my soul"; "amaz" -> "amazing grace".
  if (title.norm.startsWith(query)) return 0.9;
  // Every query word starts some title word: "grace" -> "amazing grace".
  if (queryWords.every(word => title.words.some(t => t.startsWith(word)))) return 0.8;
  return 0.85 * dice(queryGrams, title.grams);
}

export interface HymnMatch {
  hymn: HymnLibraryEntry;
  score: number;
}

/** Below this, a title is not considered a match at all. */
const MIN_SCORE = 0.5;
/** A runner-up at or above this makes a non-exact best match ambiguous... */
const AMBIGUOUS_FLOOR = 0.75;
/** ...as does any runner-up this close to the best. */
const AMBIGUOUS_GAP = 0.08;

/** Hymns whose titles match `query`, best first, weak matches dropped. */
export function matchHymnTitle(query: string, library: readonly HymnLibraryEntry[]): HymnMatch[] {
  const norm = normalizeTitle(query);
  if (!norm) return [];
  const words = norm.split(' ');
  const grams = trigrams(norm);

  const out: HymnMatch[] = [];
  for (const { hymn, titles } of indexLibrary(library)) {
    let best = 0;
    for (const title of titles) best = Math.max(best, scoreTitle(norm, words, grams, title) * title.weight);
    if (best >= MIN_SCORE) out.push({ hymn, score: best });
  }
  return out.sort((a, b) => b.score - a.score);
}

function isAmbiguous(matches: HymnMatch[]): boolean {
  if (matches.length < 2) return false;
  const [best, second] = matches;
  if (second.score >= best.score) return true;
  if (best.score >= 1) return false;
  return second.score >= AMBIGUOUS_FLOOR || best.score - second.score <= AMBIGUOUS_GAP;
}

// ---------------------------------------------------------------------------
// Verse order
// ---------------------------------------------------------------------------

export interface VerseOrderResult {
  /** Undefined means the hymn's own order. */
  verseOrder?: string[];
  /** Tokens the hymn does not have (`'7'`, or `'R'` for a hymn without a refrain). */
  missing: string[];
}

/**
 * The order to sing, per design Q9: the refrain after each listed verse when
 * the hymn has one, unless the list names `R` itself, in which case exactly
 * the order written.
 */
export function verseOrderFor(verses: readonly string[] | undefined, hymn: HymnLibraryEntry): VerseOrderResult {
  if (!verses) return { missing: [] };
  const missing: string[] = [];
  for (const token of verses) {
    if (token === 'R') { if (!hymn.hasRefrain) missing.push(token); continue; }
    if (hymn.verseCount > 0 && Number(token) > hymn.verseCount) missing.push(token);
  }
  const available = verses.filter(token => !missing.includes(token));
  if (verses.includes('R')) return { verseOrder: available, missing };
  if (!hymn.hasRefrain) return { verseOrder: available, missing };
  return { verseOrder: available.flatMap(token => [token, 'R']), missing };
}

// ---------------------------------------------------------------------------
// Resolving a parsed line
// ---------------------------------------------------------------------------

export interface HymnResolution {
  status: 'ok' | 'choose';
  /** Null when there is no hymn to show at all. */
  item: PresentHymnItem | null;
  reason?: NotesReason;
  /** For the chooser, best first. */
  candidates?: string[];
}

const MAX_CANDIDATES = 8;

function reason(key: string, params?: NotesReason['params']): NotesReason {
  return params ? { key: `present.notes.reason.${key}`, params } : { key: `present.notes.reason.${key}` };
}

function hymnalMatches(hymn: HymnLibraryEntry, number: string, hymnal?: string): boolean {
  return hymn.hymnals.some(ref =>
    ref.number.toLowerCase() === number
    && (hymnal === undefined || ref.hymnal.toLowerCase() === hymnal.toLowerCase()));
}

function withVerses(parsed: ParsedHymnLine, hymn: HymnLibraryEntry, label: string): HymnResolution {
  const item: PresentHymnItem = { kind: 'hymn', hymnId: hymn.id };
  if (parsed.versesInvalid) {
    return { status: 'choose', item, reason: reason('hymnVerseListInvalid', { title: label }), candidates: [hymn.id] };
  }
  const { verseOrder, missing } = verseOrderFor(parsed.verses, hymn);
  if (verseOrder) item.verseOrder = verseOrder;
  if (missing.includes('R')) {
    return { status: 'choose', item, reason: reason('hymnNoRefrain', { title: hymn.title }), candidates: [hymn.id] };
  }
  if (missing.length) {
    return {
      status: 'choose', item,
      reason: reason('hymnVerseMissing', { title: hymn.title, verses: missing.join(', ') }),
      candidates: [hymn.id],
    };
  }
  if (verseOrder && verseOrder.length === 0) {
    return { status: 'choose', item: null, reason: reason('hymnVerseListInvalid', { title: label }), candidates: [hymn.id] };
  }
  return { status: 'ok', item };
}

/**
 * Find the hymn a parsed line names. `library` undefined means "not loaded":
 * every line then needs a choice, which the next run with a library settles.
 */
export function resolveHymn(
  parsed: ParsedHymnLine,
  library: readonly HymnLibraryEntry[] | undefined,
  options: { hymnal?: string } = {},
): HymnResolution {
  const label = parsed.title ?? parsed.number ?? '';
  if (!library) return { status: 'choose', item: null, reason: reason('hymnLibraryUnavailable') };

  if (parsed.number) {
    let byNumber = library.filter(hymn => hymnalMatches(hymn, parsed.number!));
    if (options.hymnal) {
      const preferred = byNumber.filter(hymn => hymnalMatches(hymn, parsed.number!, options.hymnal));
      if (preferred.length) byNumber = preferred;
    }
    if (byNumber.length === 1) return withVerses(parsed, byNumber[0], label);
    if (byNumber.length > 1) {
      // A title alongside the number ("Hymn 23: Amazing Grace") settles a collision.
      if (parsed.title) {
        const ranked = matchHymnTitle(parsed.title, byNumber);
        if (ranked.length && !isAmbiguous(ranked)) return withVerses(parsed, ranked[0].hymn, label);
      }
      return {
        status: 'choose', item: null,
        reason: reason('hymnNumberAmbiguous', { number: parsed.number }),
        candidates: byNumber.slice(0, MAX_CANDIDATES).map(hymn => hymn.id),
      };
    }
    if (!parsed.title) {
      return { status: 'choose', item: null, reason: reason('hymnNumberNotFound', { number: parsed.number }) };
    }
  }

  const matches = matchHymnTitle(parsed.title!, library);
  if (!matches.length) {
    return { status: 'choose', item: null, reason: reason('hymnNotFound', { title: parsed.title! }) };
  }
  if (isAmbiguous(matches)) {
    return {
      status: 'choose', item: null,
      reason: reason('hymnAmbiguous', { title: parsed.title! }),
      candidates: matches.slice(0, MAX_CANDIDATES).map(match => match.hymn.id),
    };
  }
  return withVerses(parsed, matches[0].hymn, label);
}

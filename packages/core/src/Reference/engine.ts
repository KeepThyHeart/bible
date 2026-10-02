/**
 * ReferenceEngine: one data-driven parser and formatter for every language.
 *
 * Pipeline (see the 0077 design, section 4): normalise -> match the book in
 * each locale in priority order (longest exact name first, then a unique
 * prefix, then optional typo correction) -> read the chapter/verse tail with
 * that locale's separators -> resolve (single-chapter books, whole books,
 * bookless context).
 */
import { CHAPTER_COUNTS, OSIS_LOCALE, chapterCount, isSingleChapter, osisId } from './canon';
import { booksBelow, compileLocale, type CompiledLocale, type Terminal, type TrieNode } from './compile';
import { formatParts } from './format';
import {
  foldName,
  foldText,
  hasCase,
  isDigit,
  isLetter,
  normalizeText,
  type FoldedText,
  type FoldMode,
} from './normalize';
import {
  getMergedReferenceLocale,
  loadedReferenceLocaleFor,
  loadedReferenceLocales,
  referenceLocalesVersion,
} from './registry';
import { parseTail, type RawRange } from './tail';
import type {
  BookNameStyle,
  RefBook,
  BookSuggestion,
  ReferenceFormatOptions,
  ReferenceFormatPart,
  ReferenceLocaleData,
  ReferenceMatch,
  EngineParseOptions,
  ReferenceParseResult,
  ReferenceScanOptions,
  ReferenceRange,
} from './types';

export interface ReferenceEngineOptions {
  /** BCP 47 tags in priority order, e.g. [uiLocale, 'en']. Tags with no loaded data are skipped. */
  locales: readonly string[];
  /** 'all': when nothing matched, also try every other loaded locale (navigation box only). */
  fallback?: 'none' | 'all';
  /** Parse-only names at the lowest priority, e.g. the open Bible module's own book names. */
  extraAliases?: ReadonlyArray<{ name: string; book: RefBook }>;
  /** Locale data given directly instead of by tag (adapters for custom tables). Tried before `locales`. */
  inline?: readonly ReferenceLocaleData[];
}

export interface BookLookup {
  book: RefBook;
  locale: string;
  via: 'exact' | 'prefix' | 'fuzzy';
  /** The folded name that matched. */
  name: string;
  alternatives?: RefBook[];
}

const compiledCache = new Map<string, { version: number; compiled: CompiledLocale }>();
let osisCompiled: CompiledLocale | undefined;

function compiledFor(tag: string): CompiledLocale | undefined {
  const version = referenceLocalesVersion();
  const hit = compiledCache.get(tag);
  if (hit && hit.version === version) return hit.compiled;
  const data = getMergedReferenceLocale(tag);
  if (!data) return undefined;
  const compiled = compileLocale(data);
  compiledCache.set(tag, { version, compiled });
  return compiled;
}

function osis(): CompiledLocale {
  return (osisCompiled ??= compileLocale(OSIS_LOCALE));
}

const engineCache = new Map<string, ReferenceEngine>();

interface Candidate {
  loc: CompiledLocale;
  t: Terminal;
  /** Normalised index after the name. */
  end: number;
}

export class ReferenceEngine {
  /** Locales tried in order (last is always "osis"). */
  private readonly locs: CompiledLocale[];
  private fallbackLocs?: CompiledLocale[];

  private constructor(
    locs: CompiledLocale[],
    private readonly fallback: 'none' | 'all',
  ) {
    this.locs = locs;
  }

  /** An engine for these options; cached until locale data changes. */
  static create(opts: ReferenceEngineOptions): ReferenceEngine {
    const cacheable = !opts.inline;
    const key = cacheable
      ? `${referenceLocalesVersion()}|${opts.locales.join(',')}|${opts.fallback ?? 'none'}|${JSON.stringify(opts.extraAliases ?? [])}`
      : '';
    if (cacheable) {
      const hit = engineCache.get(key);
      if (hit) return hit;
    }
    const locs: CompiledLocale[] = [];
    const seen = new Set<string>();
    for (const data of opts.inline ?? []) locs.push(compileLocale(data));
    for (const t of opts.locales) {
      const tag = loadedReferenceLocaleFor(t);
      if (!tag || seen.has(tag)) continue;
      const c = compiledFor(tag);
      if (c) {
        seen.add(tag);
        locs.push(c);
      }
    }
    if (opts.extraAliases?.length) {
      const books: Record<string, { aliases: string[] }> = {};
      for (const a of opts.extraAliases) (books[String(a.book)] ??= { aliases: [] }).aliases.push(a.name);
      locs.push(compileLocale({ tag: 'module', books, ordinals: {}, match: { minPrefix: 0 } }));
    }
    locs.push(osis());
    const engine = new ReferenceEngine(locs, opts.fallback ?? 'none');
    if (cacheable) {
      if (engineCache.size > 64) engineCache.clear();
      engineCache.set(key, engine);
    }
    return engine;
  }

  /** Data tags this engine tries, in order (without the OSIS pseudo-locale). */
  get locales(): string[] {
    return this.locs.filter((l) => l.tag !== 'osis').map((l) => l.tag);
  }

  private fallbacks(): CompiledLocale[] {
    if (this.fallback !== 'all') return [];
    if (!this.fallbackLocs) {
      const have = new Set(this.locs.map((l) => l.tag));
      this.fallbackLocs = loadedReferenceLocales()
        .filter((t) => !have.has(t))
        .map((t) => compiledFor(t))
        // Draft data is only used when asked for by name (UI locale, an installed Bible's language).
        .filter((c): c is CompiledLocale => !!c && c.data.status !== 'draft');
    }
    return this.fallbackLocs;
  }

  // ---------------------------------------------------------------- parsing

  parse(input: string, opts: EngineParseOptions = {}): ReferenceParseResult {
    const norm = normalizeText(input);
    const s = norm.text;
    const a = s.length - s.trimStart().length;
    const b = s.trimEnd().length;
    if (a >= b) return { ok: false, reason: 'empty' };
    const lists = opts.lists !== false;
    const folds = new Map<string, FoldedText>();
    let partial: RefBook | undefined;
    let failure: 'no-book' | 'bad-numbers' | 'out-of-range' = 'no-book';

    const finish = (
      book: RefBook,
      raw: RawRange[],
      loc: string,
      matched: string,
      via: 'exact' | 'prefix' | 'fuzzy' | 'context',
      alternatives?: RefBook[],
    ): ReferenceParseResult | undefined => {
      const ranges = resolveRanges(book, raw);
      const bad = opts.validateNumbers === false ? undefined : checkRanges(ranges, opts.checkChapters === true);
      if (bad) {
        partial = book;
        failure = bad;
        return undefined;
      }
      const r: ReferenceParseResult = { ok: true, ranges, book, locale: loc, matched, via };
      if (alternatives?.length) r.alternatives = alternatives;
      return r;
    };

    const bookAt = (i: number) => this.locs.some((l) => this.candidatesAt(l, s, i, folds).length > 0);
    const tryTail = (loc: CompiledLocale, from: number) => {
      const tail = parseTail(s, from, loc.syntax, { lists, bookAt });
      if (!tail) return undefined;
      return s.slice(tail.end, b).trim() === '' ? tail : undefined;
    };

    const restIsEmpty = (from: number) => /^[\s.]*$/.test(s.slice(from, b));

    // 1. Exact names at the start, locale by locale, longest first.
    const exactPass = (locs: CompiledLocale[]) => {
      for (const loc of locs) {
        for (const cand of this.candidatesAt(loc, s, a, folds)) {
          const matched = s.slice(a, cand.end).trim();
          if (restIsEmpty(cand.end)) {
            partial ??= cand.t.book;
            if (opts.allowWholeBook) {
              return {
                ok: true,
                ranges: [{ book: cand.t.book, chapter: 1, wholeBook: true }],
                book: cand.t.book,
                locale: loc.tag,
                matched,
                via: 'exact',
                ...(cand.t.alternatives ? { alternatives: cand.t.alternatives } : {}),
              } as ReferenceParseResult;
            }
            continue;
          }
          const tail = tryTail(loc, cand.end);
          if (!tail) {
            partial ??= cand.t.book;
            if (failure === 'no-book') failure = 'bad-numbers';
            continue;
          }
          const r = finish(cand.t.book, tail.ranges, loc.tag, matched, 'exact', cand.t.alternatives);
          if (r) return r;
        }
      }
      return undefined;
    };
    const exact = exactPass(this.locs);
    if (exact) return exact;

    // Book text and number part, for prefix and fuzzy matching.
    const split = /^((?:[1-3] ?)?[^\d]*?[^\d\s.:,;\-])[\s.]*(\d.*)?$/u.exec(s.slice(a, b));
    if (split && split[2] !== undefined) {
      const bookText = split[1];
      const tailFrom = a + split[1].length;

      // 2. A unique prefix across the tried locales.
      if (opts.prefix !== false) {
        const found = this.prefixLookup(bookText);
        if (found) {
          const loc = this.locs.find((l) => l.tag === found.locale)!;
          const tail = tryTail(loc, tailFrom);
          if (tail) {
            const r = finish(found.book, tail.ranges, found.locale, bookText, 'prefix');
            if (r) return r;
          } else partial ??= found.book;
        }
      }

      // 3. Typo correction.
      if (opts.fuzzy) {
        const found = this.fuzzyLookup(bookText);
        if (found) {
          const loc = this.locs.find((l) => l.tag === found.locale)!;
          const tail = tryTail(loc, tailFrom);
          if (tail) {
            const r = finish(found.book, tail.ranges, found.locale, bookText, 'fuzzy');
            if (r) return r;
          }
        }
      }
    }

    // 4. Every other loaded locale (navigation box only).
    const fb = this.fallbacks();
    if (fb.length) {
      const r = exactPass(fb);
      if (r) return r;
    }

    // 5. Bookless input in a known book.
    if (opts.context) {
      const loc = this.locs[0];
      const tail = parseTail(s, a, loc.syntax, { lists, bookless: true, contextChapter: opts.context.chapter });
      if (tail && s.slice(tail.end, b).trim() === '') {
        const r = finish(opts.context.book, tail.ranges, 'context', '', 'context');
        if (r) return r;
      }
    }

    return partial !== undefined ? { ok: false, reason: failure === 'no-book' ? 'bad-numbers' : failure, book: partial } : { ok: false, reason: 'no-book' };
  }

  /** Exact name terminals starting at normalised index `at`, longest first, with boundaries checked. */
  private candidatesAt(loc: CompiledLocale, s: string, at: number, folds: Map<string, FoldedText>): Candidate[] {
    const f = foldedFor(s, loc.fold, folds);
    const fi = f.fromNorm[at];
    if (fi === undefined || fi >= f.text.length) return [];
    const out: Candidate[] = [];
    let node: TrieNode | undefined = loc.trie;
    let i = fi;
    while (node && i < f.text.length) {
      node = node.next.get(f.text[i]);
      i++;
      if (!node) break;
      if (node.terminal) {
        // The name must end on a whole normalised character.
        const endN = i >= f.text.length ? s.length : f.toNorm[i];
        if (i < f.text.length && f.toNorm[i] === f.toNorm[i - 1]) continue;
        if (!loc.spaceless && isLetter(s[endN])) continue;
        out.push({ loc, t: node.terminal, end: endN });
      }
    }
    return out.reverse();
  }

  // ---------------------------------------------------------------- lookups

  /** Folded name -> book for one of this engine's locales (for legacy alias tables). */
  namesOf(tag: string): Array<[string, RefBook]> {
    const loc = this.locs.find((l) => l.tag === tag);
    return loc ? [...loc.names].map(([k, t]) => [k, t.book] as [string, RefBook]) : [];
  }

  /** A book by name alone: exact, then (optionally) unique prefix and fuzzy. */
  lookupBook(name: string, opts: { prefix?: boolean; fuzzy?: boolean } = {}): BookLookup | undefined {
    for (const loc of this.locs) {
      const key = foldName(name, loc.fold);
      const t = loc.names.get(key);
      if (t) return { book: t.book, locale: loc.tag, via: 'exact', name: key, ...(t.alternatives ? { alternatives: t.alternatives } : {}) };
    }
    if (opts.prefix) {
      const p = this.prefixLookup(name);
      if (p) return p;
    }
    if (opts.fuzzy) return this.fuzzyLookup(name);
    return undefined;
  }

  private prefixLookup(text: string): BookLookup | undefined {
    const books = new Set<RefBook>();
    let first: { locale: string; name: string } | undefined;
    for (const loc of this.locs) {
      if (loc.minPrefix <= 0) continue;
      const key = foldName(text, loc.fold);
      const letters = key.replace(/[\d\s]/g, '');
      if ([...letters].length < loc.minPrefix) continue;
      let node: TrieNode | undefined = loc.trie;
      for (const ch of key) {
        node = node.next.get(ch);
        if (!node) break;
      }
      if (!node) continue;
      const below = booksBelow(node);
      if (below.size === 0) continue;
      for (const bk of below) books.add(bk);
      first ??= { locale: loc.tag, name: key };
    }
    if (books.size !== 1 || !first) return undefined;
    return { book: [...books][0], locale: first.locale, via: 'prefix', name: first.name };
  }

  /** Closest name over all tried locales: smallest distance, then locale priority, overlap, length. */
  private fuzzyLookup(text: string): BookLookup | undefined {
    let best: { key: string; book: RefBook; locale: string; d: number; o: number; l: number } | undefined;
    for (const loc of this.locs) {
      if (loc.tag === 'osis' || loc.tag === 'module') continue;
      const input = foldName(text, loc.fold);
      const len = [...input].length;
      const maxDistance = Math.min(2, Math.floor(len / 2));
      if (maxDistance < 1) continue;
      for (const [key, book] of loc.fuzzyKeys) {
        if ([...key].length <= 2) continue;
        const d = damerau(input, key);
        if (d > maxDistance) continue;
        if (best && d > best.d) continue;
        const o = overlap(input, key);
        const l = Math.abs(len - [...key].length);
        if (!best || d < best.d || (best.locale === loc.tag && (o > best.o || (o === best.o && l < best.l)))) {
          best = { key, book, locale: loc.tag, d, o, l };
        }
      }
    }
    return best ? { book: best.book, locale: best.locale, via: 'fuzzy', name: best.key } : undefined;
  }

  // ---------------------------------------------------------------- scanning

  /**
   * Find references in prose. Stricter than {@link parse}: exact names only,
   * no prefixes, typos or whole books; a short name ("Is", "约") needs a full
   * chapter and verse after it; in scripts with case the name must start
   * with a capital (so "job 3" in a sentence is left alone).
   */
  scan(text: string, opts: ReferenceScanOptions = {}): ReferenceMatch[] {
    const norm = normalizeText(text);
    const s = norm.text;
    const folds = new Map<string, FoldedText>();
    const requireCapital = opts.requireCapital !== false;
    const out: ReferenceMatch[] = [];
    const origStart = (i: number) => norm.start[i] ?? text.length;
    const origEnd = (i: number) => (i > 0 ? norm.end[i - 1] : 0);

    let i = 0;
    outer: while (i < s.length) {
      const ch = s[i];
      if (ch === ' ') {
        i++;
        continue;
      }
      for (const loc of this.locs) {
        if (!loc.spaceless) {
          if (!isLetter(ch) && !isDigit(ch)) continue;
          const prev = s[i - 1];
          if (isLetter(prev) || isDigit(prev)) continue;
        }
        for (const cand of this.candidatesAt(loc, s, i, folds)) {
          if (cand.t.inputOnly) continue;
          if (requireCapital) {
            const firstLetter = [...s.slice(i, cand.end)].find((c) => isLetter(c));
            if (firstLetter && hasCase(firstLetter) && firstLetter !== firstLetter.toUpperCase()) continue;
          }
          // At most one space between name and number in prose.
          let j = cand.end;
          if (s[j] === '.') j++;
          if (s[j] === ' ') j++;
          if (!isDigit(s[j])) continue;
          const tail = parseTail(s, cand.end, loc.syntax, {
            lists: true,
            scan: true,
            bookAt: (k) => this.locs.some((l) => this.candidatesAt(l, s, k, folds).some((x) => !x.t.inputOnly)),
          });
          if (!tail) continue;
          if (cand.t.short && tail.ranges[0].verse === undefined) continue;
          const ranges = resolveRanges(cand.t.book, tail.ranges);
          if (checkRanges(ranges, false)) continue;
          ranges.forEach((r, k) => {
            const raw = tail.ranges[k];
            const startN = k === 0 ? i : raw.start;
            const start = origStart(startN);
            const end = origEnd(raw.end);
            const m: ReferenceMatch = { ...r, start, end, text: text.slice(start, end), locale: loc.tag };
            if (k > 0) m.continuation = true;
            out.push(m);
          });
          i = tail.end;
          continue outer;
        }
      }
      i++;
    }
    return out;
  }

  // ---------------------------------------------------------------- suggestions

  /** Books whose name starts with the typed text, or has a word that does. Labels are in the first locale. */
  suggest(prefix: string, limit = 8): BookSuggestion[] {
    if (limit <= 0) return [];
    const rank = new Map<RefBook, { r: number; locale: string }>();
    const note = (book: RefBook, r: number, locale: string) => {
      const prev = rank.get(book);
      if (!prev || r < prev.r) rank.set(book, { r, locale });
    };
    for (const loc of this.locs) {
      if (loc.tag === 'osis') continue;
      const q = foldName(prefix, loc.fold);
      if (!q || /\d/.test(q.replace(/^[1-3]\s?/, ''))) continue;
      for (const [n, b] of Object.entries(loc.books)) {
        if (!b.long) continue;
        const f = foldName(b.long, loc.fold);
        if (f.startsWith(q)) note(Number(n), 0, loc.tag);
        else if (f.split(' ').some((w) => w.startsWith(q))) note(Number(n), 2, loc.tag);
      }
      for (const [key, t] of loc.names) if (key.startsWith(q)) note(t.book, 1, loc.tag);
    }
    return [...rank.entries()]
      .sort((x, y) => x[1].r - y[1].r || x[0] - y[0])
      .slice(0, limit)
      .map(([book, v]) => ({ book, label: this.bookName(book), locale: v.locale }));
  }

  // ---------------------------------------------------------------- formatting

  /** Display name in the first locale that has it, else OSIS id, else "Book N". */
  bookName(book: RefBook, style: BookNameStyle = 'long', locale?: string): string {
    const order = locale ? [this.localeFor(locale), ...this.locs] : this.locs;
    for (const loc of order) {
      if (!loc || loc.tag === 'module') continue;
      const b = loc.books[String(book)];
      if (!b?.long) continue;
      if (style === 'short') return b.short ?? b.medium ?? b.long;
      if (style === 'medium') return b.medium ?? b.long;
      return b.long;
    }
    return osisId(book) ?? `Book ${book}`;
  }

  private localeFor(tag: string): CompiledLocale | undefined {
    const own = this.locs.find((l) => l.tag === tag);
    if (own) return own;
    const t = loadedReferenceLocaleFor(tag);
    return t ? compiledFor(t) : undefined;
  }

  /** Structured output, for callers that style or bidi-isolate the parts. */
  formatParts(refs: ReferenceRange | readonly ReferenceRange[], opts: ReferenceFormatOptions = {}): ReferenceFormatPart[] {
    const loc = (opts.locale ? this.localeFor(opts.locale) : undefined) ?? this.locs[0];
    const ranges = Array.isArray(refs) ? (refs as ReferenceRange[]) : [refs as ReferenceRange];
    return formatParts(ranges, {
      locale: loc,
      style: opts.style ?? 'long',
      digits: opts.digits ?? loc.format.digits,
      bookName: (bk, st) => this.bookName(bk, st, loc.tag),
    });
  }

  /** "John 3:16-18", "约翰福音3:16", "يوحنا ٣:١٦" - in the first (or given) locale's conventions. */
  format(refs: ReferenceRange | readonly ReferenceRange[], opts: ReferenceFormatOptions = {}): string {
    return this.formatParts(refs, opts)
      .map((p) => p.value)
      .join('');
  }
}

// -------------------------------------------------------------------- helpers

function foldedFor(s: string, mode: FoldMode, cache: Map<string, FoldedText>): FoldedText {
  const key = `${mode.caseLocale}|${mode.foldMarks}`;
  let f = cache.get(key);
  if (!f) {
    f = foldText(s, mode);
    cache.set(key, f);
  }
  return f;
}

/** Single-chapter books ("Jude 5" is 1:5), and tidy same-chapter ranges. */
function resolveRanges(book: RefBook, raw: RawRange[]): ReferenceRange[] {
  const single = isSingleChapter(book);
  return raw.map((r) => {
    const v: ReferenceRange = { book, chapter: r.chapter };
    if (r.verse !== undefined) v.verse = r.verse;
    if (r.endChapter !== undefined) v.endChapter = r.endChapter;
    if (r.endVerse !== undefined) v.endVerse = r.endVerse;
    if (single && v.verse === undefined && !r.explicitChapter) {
      v.verse = v.chapter;
      v.chapter = 1;
      if (v.endChapter !== undefined) {
        v.endVerse = v.endChapter;
        delete v.endChapter;
      }
    }
    if (v.endChapter !== undefined && v.endChapter === v.chapter) {
      delete v.endChapter;
      if (v.verse === undefined) delete v.endVerse;
    }
    return v;
  });
}

function checkRanges(ranges: ReferenceRange[], counts: boolean): 'bad-numbers' | 'out-of-range' | undefined {
  for (const r of ranges) {
    if (r.chapter < 1 || (r.verse !== undefined && r.verse < 1)) return 'bad-numbers';
    if (r.endChapter !== undefined && r.endChapter < r.chapter) return 'bad-numbers';
    if (r.endVerse !== undefined && r.verse !== undefined && r.endChapter === undefined && r.endVerse < r.verse) return 'bad-numbers';
    if (r.endVerse !== undefined && r.endVerse < 1) return 'bad-numbers';
    if (counts) {
      const max = chapterCount(r.book) ?? CHAPTER_COUNTS.length;
      if (r.chapter > max || (r.endChapter ?? 0) > max) return 'out-of-range';
    }
  }
  return undefined;
}

/** Damerau-Levenshtein (optimal string alignment) distance over code points. */
export function damerau(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  const m = x.length;
  const n = y.length;
  const d: number[][] = [];
  for (let i = 0; i <= m; i++) {
    d[i] = new Array<number>(n + 1);
    d[i][0] = i;
  }
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}

function overlap(a: string, b: string): number {
  const count = new Map<string, number>();
  for (const ch of a) count.set(ch, (count.get(ch) ?? 0) + 1);
  let o = 0;
  for (const ch of b) {
    const r = count.get(ch) ?? 0;
    if (r > 0) {
      o++;
      count.set(ch, r - 1);
    }
  }
  return o;
}

/**
 * The engine for a UI locale: that language, any extra languages (installed
 * Bibles, "also accept references in"), then English, then OSIS ids.
 */
export function referenceEngineFor(
  uiLocale: string,
  extra: readonly string[] = [],
  opts: Omit<ReferenceEngineOptions, 'locales'> = {},
): ReferenceEngine {
  return ReferenceEngine.create({ ...opts, locales: [uiLocale, ...extra, 'en'] });
}

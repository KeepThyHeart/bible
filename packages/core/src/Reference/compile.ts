/**
 * Turns locale data (after inheritance) into the indexes the engine matches
 * against: a trie of folded names per locale, plus resolved syntax and format.
 */
import { foldName, type FoldMode } from './normalize';
import type {
  RefBook,
  ReferenceBookData,
  ReferenceFormatData,
  ReferenceLocaleData,
  ReferenceSyntaxData,
} from './types';

/** Root defaults every locale inherits last. No locale is assumed to use ":" unless it inherits it from here. */
export const ROOT_SYNTAX: Required<ReferenceSyntaxData> = {
  chapterVerse: [':'],
  range: ['-'],
  list: [',', ';'],
  chapterSuffix: [],
  verseSuffix: [],
};

export const ROOT_FORMAT: Required<Omit<ReferenceFormatData, 'numberingSystem'>> & { numberingSystem?: string } = {
  bookGap: ' ',
  chapterVerse: ':',
  range: '-',
  list: '; ',
  verseList: ', ',
  digits: 'latin',
};

export interface Terminal {
  book: RefBook;
  /** From the data as written (not an ordinal or spacing variant). */
  explicit: boolean;
  /** Short form: in prose it needs a full chapter and verse after it. */
  short: boolean;
  /** Typed input only, never matched in prose: word ordinals ("First John", "Primera de Corintios") read as ordinary words there. */
  inputOnly?: boolean;
  /** A unique prefix of this name is accepted ("Deuter"). Long and medium names only, not aliases or ordinal words. */
  prefixable?: boolean;
  alternatives?: RefBook[];
}

export interface TrieNode {
  next: Map<string, TrieNode>;
  terminal?: Terminal;
  /** Books reachable below (lazily computed), for unique-prefix matching. */
  books?: Set<RefBook>;
}

export interface CompiledLocale {
  tag: string;
  data: ReferenceLocaleData;
  fold: FoldMode;
  spaceless: boolean;
  minPrefix: number;
  trie: TrieNode;
  /** Explicit folded names in data order, for fuzzy matching. */
  fuzzyKeys: Array<[string, RefBook]>;
  /** Folded name -> terminal, the same entries as the trie. */
  names: Map<string, Terminal>;
  syntax: Required<ReferenceSyntaxData>;
  format: typeof ROOT_FORMAT;
  books: Record<string, ReferenceBookData>;
  /** Same folded string pointing at different books inside this locale (validator report). */
  clashes: Array<{ name: string; books: RefBook[] }>;
}

/** Merge a child over its parent: objects field by field, books per book, arrays replaced. */
export function mergeLocaleData(parent: ReferenceLocaleData, child: ReferenceLocaleData): ReferenceLocaleData {
  const books: Record<string, ReferenceBookData> = { ...(parent.books ?? {}) };
  for (const [k, v] of Object.entries(child.books ?? {})) books[k] = { ...(books[k] ?? {}), ...v };
  return {
    ...parent,
    ...child,
    match: { ...parent.match, ...child.match },
    books,
    ordinals: child.ordinals ?? parent.ordinals,
    syntax: { ...parent.syntax, ...child.syntax },
    ambiguous: { ...parent.ambiguous, ...child.ambiguous },
    format: { ...parent.format, ...child.format },
  };
}

function insert(root: TrieNode, key: string, t: Terminal): void {
  let node = root;
  for (const ch of key) {
    let n = node.next.get(ch);
    if (!n) {
      n = { next: new Map() };
      node.next.set(ch, n);
    }
    node = n;
  }
  node.terminal = t;
}

export function booksBelow(node: TrieNode): Set<RefBook> {
  if (node.books) return node.books;
  const s = new Set<RefBook>();
  if (node.terminal?.prefixable) {
    s.add(node.terminal.book);
  }
  for (const n of node.next.values()) for (const b of booksBelow(n)) s.add(b);
  node.books = s;
  return s;
}

const SPACELESS_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/** Compile fully merged data (inheritance already applied). */
export function compileLocale(data: ReferenceLocaleData): CompiledLocale {
  const books = data.books ?? {};
  const allNames = Object.values(books).flatMap((b) => [b.long, ...(b.aliases ?? [])]).filter(Boolean).join('');
  const spaceless = data.match?.spaceless ?? SPACELESS_SCRIPT.test(allNames);
  const fold: FoldMode = {
    caseLocale: data.match?.caseLocale ?? caseLocaleFor(data.tag),
    foldMarks: data.match?.foldMarks ?? true,
  };
  const minPrefix = data.match?.minPrefix ?? (spaceless ? 0 : 3);

  const names = new Map<string, Terminal>();
  const level = new Map<string, number>(); // 0 explicit, 1 generated
  const dropped = new Set<string>();
  const clashes: Array<{ name: string; books: RefBook[] }> = [];
  const fuzzyKeys: Array<[string, RefBook]> = [];
  const ambiguous = new Map<string, { prefer: RefBook; also: RefBook[] }>();
  for (const [k, v] of Object.entries(data.ambiguous ?? {})) ambiguous.set(foldName(k, fold), v);

  const add = (raw: string, book: RefBook, explicit: boolean, short: boolean, inputOnly = false, prefixable = false) => {
    const key = foldName(raw, fold);
    if (!key) return;
    if (dropped.has(key)) {
      if (!explicit) return;
      dropped.delete(key);
    }
    const lv = explicit ? 0 : 1;
    const amb = ambiguous.get(key);
    if (amb) {
      if (!names.has(key)) names.set(key, { book: amb.prefer, explicit: true, short: true, alternatives: amb.also });
      level.set(key, 0);
      return;
    }
    const prev = names.get(key);
    if (prev) {
      if (prev.book === book) {
        if (explicit && !prev.explicit) prev.explicit = true;
        if (prefixable) prev.prefixable = true;
        if (!short) prev.short = false;
        level.set(key, Math.min(level.get(key)!, lv));
        return;
      }
      const prevLv = level.get(key)!;
      if (lv < prevLv) {
        names.set(key, { book, explicit, short, ...(prefixable ? { prefixable } : {}) });
        level.set(key, lv);
      } else if (lv === prevLv) {
        if (lv === 0) clashes.push({ name: key, books: [prev.book, book] });
        else {
          names.delete(key);
          dropped.add(key);
        }
      }
      return;
    }
    const t: Terminal = { book, explicit, short };
    if (inputOnly) t.inputOnly = true;
    if (prefixable) t.prefixable = true;
    names.set(key, t);
    level.set(key, lv);
    if (explicit) fuzzyKeys.push([key, book]);
  };

  const ordinals = data.ordinals ?? {};
  const isShort = (s: string) => [...foldName(s, fold).replace(/\s/g, '')].length <= 2;

  for (let n = 1; n <= 66; n++) {
    const b = books[String(n)];
    if (!b) continue;
    const explicit: Array<[string, boolean, boolean]> = [];
    if (b.long) explicit.push([b.long, isShort(b.long), true]);
    if (b.medium) explicit.push([b.medium, isShort(b.medium), true]);
    if (b.short) explicit.push([b.short, b.scanShort === false || isShort(b.short), false]);
    for (const a of b.aliases ?? []) explicit.push([a, isShort(a), false]);
    for (const [name, short, pfx] of explicit) add(name, n, true, short, false, pfx);
    // Generated variants: ordinal words for a leading 1/2/3, and "1Cor" for "1 Cor".
    if (!spaceless) {
      for (const [name, short, pfx] of explicit) {
        const m = /^([1-3])\s*(\S.*)$/u.exec(name.trim());
        if (!m) continue;
        const [, d, stem] = m;
        add(`${d}${stem}`, n, false, short, false, pfx);
        add(`${d} ${stem}`, n, false, short, false, pfx);
        for (const w of ordinals[d] ?? []) add(`${w} ${stem}`, n, false, short, !/^(?:\d+|[ivxIVX]+)$/.test(w));
      }
    }
  }

  // Listed ambiguous forms always resolve to their preferred book, even when no book lists them as a name.
  for (const [key, amb] of ambiguous) {
    if (!names.has(key)) names.set(key, { book: amb.prefer, explicit: true, short: true, alternatives: amb.also });
  }

  const trie: TrieNode = { next: new Map() };
  for (const [k, t] of names) insert(trie, k, t);

  return {
    tag: data.tag,
    data,
    fold,
    spaceless,
    minPrefix,
    trie,
    fuzzyKeys,
    names,
    syntax: { ...ROOT_SYNTAX, ...stripUndefined(data.syntax) } as Required<ReferenceSyntaxData>,
    format: { ...ROOT_FORMAT, ...stripUndefined(data.format) },
    books,
    clashes,
  };
}

function stripUndefined<T extends object>(o: T | undefined): Partial<T> {
  const r: Partial<T> = {};
  if (!o) return r;
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (r as Record<string, unknown>)[k] = v;
  return r;
}

/** Turkic languages need their own case folding; everything else uses the root rules (so caches are shared). */
function caseLocaleFor(tag: string): string {
  const primary = tag.split('-')[0].toLowerCase();
  return primary === 'tr' || primary === 'az' || primary === 'crh' ? primary : '';
}

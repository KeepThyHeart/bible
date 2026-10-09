/**
 * The games' Bible text, read through the host's `DatabaseManager`.
 *
 * The standalone games server opened its own copies of module files. Inside the
 * Bible app the verses come from the modules the app already has installed (and
 * the visibility rules the site configured), so there is exactly one copy of
 * every translation and the text a game shows is the text the reader shows.
 * Nothing here alters a verse: `BibleRepository` hands over `text` as stored.
 *
 * A translation is read once into memory (about 31k short rows, a few MB) the
 * first time a game asks for it. Draws then run over that array, which keeps
 * the filter and offset rules of `BibleModule` without a second SQL dialect to
 * keep in step, and lets a room replay from its seed deterministically.
 */

import type { DatabaseManager } from '../../../DatabaseManager.js';
import { BOOK_COUNT, SECTIONS, bookRange, chapterRange } from '../../../../src/modules/games/shared/verseId.js';
import type { VerseId } from '../../../../src/modules/games/shared/verseId.js';
import type { ModuleInfo, Verse, VerseFilter, VerseSource } from './BibleModule.js';
import type { TranslationCatalog, TranslationSummary } from './ModuleCatalog.js';

/** The slice of a Bible repository this adapter reads (kept narrow so tests can stand in for it). */
export interface VerseRepoLike {
  getVerseRange(first: number, last: number): Array<{ verseId: number; text: string; wordCount?: number | null }>;
}

/** Every verse id a book filter admits, as inclusive spans. */
function spansFor(filter: VerseFilter): Array<[VerseId, VerseId]> {
  const books = new Set<number>();
  for (const book of filter.books ?? []) if (book >= 1 && book <= BOOK_COUNT) books.add(book);
  for (const section of filter.sections ?? []) {
    const [from, to] = SECTIONS[section];
    for (let book = from; book <= to; book += 1) books.add(book);
  }
  if (books.size === 0) return [[bookRange(1).first, bookRange(BOOK_COUNT).last]];
  return [...books].sort((a, b) => a - b).map((book) => [bookRange(book).first, bookRange(book).last]);
}

function offsetWithin(total: number, random: () => number): number {
  const offset = Math.floor(random() * total);
  return offset < 0 ? 0 : Math.min(offset, total - 1);
}

/** A translation held in memory, behaving exactly as `BibleModule` does. */
export class MemoryVerseSource implements VerseSource {
  private readonly verseList: Verse[];
  private readonly byId = new Map<VerseId, Verse>();

  constructor(
    readonly info: ModuleInfo,
    rows: ReadonlyArray<{ verseId: number; text: string; wordCount?: number | null }>
  ) {
    this.verseList = rows
      .map((row) => ({ id: row.verseId, text: row.text, wordCount: row.wordCount ?? null }))
      .sort((a, b) => a.id - b.id);
    for (const verse of this.verseList) this.byId.set(verse.id, verse);
  }

  verse(id: VerseId): Verse | null {
    return this.byId.get(id) ?? null;
  }

  verses(ids: readonly VerseId[]): Verse[] {
    const found: Verse[] = [];
    for (const id of ids) {
      const verse = this.byId.get(id);
      if (verse) found.push(verse);
    }
    return found;
  }

  range(first: VerseId, last: VerseId): Verse[] {
    return this.verseList.filter((verse) => verse.id >= first && verse.id <= last);
  }

  chapter(book: number, chapter: number): Verse[] {
    const { first, last } = chapterRange(book, chapter);
    return this.range(first, last);
  }

  book(book: number): Verse[] {
    const { first, last } = bookRange(book);
    return this.range(first, last);
  }

  private matching(filter: VerseFilter): Verse[] {
    const spans = spansFor(filter);
    const minWords = filter.minWords ?? 0;
    return this.verseList.filter(
      (verse) =>
        (verse.wordCount ?? 0) >= minWords && spans.some(([first, last]) => verse.id >= first && verse.id <= last)
    );
  }

  verseCount(filter: VerseFilter = {}): number {
    return this.matching(filter).length;
  }

  randomVerse(filter: VerseFilter = {}, random: () => number = Math.random): Verse | null {
    const pool = this.matching(filter);
    return pool.length === 0 ? null : (pool[offsetWithin(pool.length, random)] ?? null);
  }

  randomVerses(count: number, filter: VerseFilter = {}, random: () => number = Math.random): Verse[] {
    const pool = this.matching(filter);
    const wanted = Math.min(count, pool.length);
    const offsets = new Set<number>();
    const attemptCap = wanted * 20;
    for (let attempt = 0; offsets.size < wanted && attempt < attemptCap; attempt += 1) {
      offsets.add(offsetWithin(pool.length, random));
    }
    for (let offset = 0; offsets.size < wanted; offset += 1) offsets.add(offset);
    const verses: Verse[] = [];
    for (const offset of offsets) {
      const verse = pool[offset];
      if (verse) verses.push(verse);
    }
    return verses;
  }
}

interface InfoLike {
  abbreviation: string;
  fullName: string;
  languageCode?: string | null;
  copyright?: string | null;
  licenseSpdx?: string | null;
  licenseUrl?: string | null;
  versification?: string | null;
}

function toModuleInfo(info: InfoLike): ModuleInfo {
  return {
    abbreviation: info.abbreviation,
    fullName: info.fullName,
    languageCode: info.languageCode ?? null,
    copyright: info.copyright ?? null,
    licenseSpdx: info.licenseSpdx ?? null,
    licenseUrl: info.licenseUrl ?? null,
    canon: null,
    versification: info.versification ?? null,
    moduleType: 'bible',
  };
}

export interface DatabaseManagerCatalogOptions {
  /** Hides a Bible the site has switched off (`isModuleActive`); all are visible when omitted. */
  isVisible?: (abbreviation: string) => boolean;
}

export class DatabaseManagerCatalog implements TranslationCatalog {
  private readonly loaded = new Map<string, MemoryVerseSource | null>();

  constructor(
    private readonly db: DatabaseManager,
    private readonly options: DatabaseManagerCatalogOptions = {}
  ) {}

  /** Listing reads module info and a row count only: text is loaded when a room first draws from a translation. */
  list(): TranslationSummary[] {
    const isVisible = this.options.isVisible ?? (() => true);
    const summaries: TranslationSummary[] = [];
    for (const module of this.db.getModuleMetadataRepo().getByType('bible')) {
      const abbreviation = module.abbreviation || module.getAbbreviation();
      if (!abbreviation || !isVisible(abbreviation)) continue;
      const repo = this.db.getBibleRepo(abbreviation);
      const info = repo?.getModuleInfo();
      const verseCount = repo?.getVerseCount() ?? 0;
      if (!repo || !info || verseCount === 0) continue;
      summaries.push({ ...toModuleInfo(info), path: '', verseCount });
    }
    return summaries.sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));
  }

  get(abbreviation: string): VerseSource | null {
    const key = abbreviation.toUpperCase();
    if (this.options.isVisible && !this.options.isVisible(abbreviation)) return null;
    if (this.loaded.has(key)) return this.loaded.get(key) ?? null;
    const repo = this.db.getBibleRepo(abbreviation);
    let source: MemoryVerseSource | null = null;
    if (repo) {
      const info = repo.getModuleInfo();
      const rows = (repo as unknown as VerseRepoLike).getVerseRange(bookRange(1).first, bookRange(BOOK_COUNT).last);
      if (info && rows.length > 0) {
        source = new MemoryVerseSource(
          toModuleInfo(info),
          rows
        );
      }
    }
    this.loaded.set(key, source);
    return source;
  }

  has(abbreviation: string): boolean {
    return this.get(abbreviation) !== null;
  }

  /** The host owns the repositories; this only drops its own in-memory copies. */
  closeAll(): void {
    this.loaded.clear();
  }
}

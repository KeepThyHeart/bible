/**
 * Verse text and metadata from a Bible module, through the same repository the apps use
 * (`BibleRepository` over the module's SQLite file). The module format is not parsed here.
 */

import BetterSqlite3 from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BibleRepository, getBookName, type ISql, type SqlParameter, type SqlResult, type SqlRow } from './core';
import type { VerseText } from './core';
import type { TextRights } from './rights';

/** Read-only `ISql` over better-sqlite3 (a module is content: nothing here writes it). */
class ReadonlySql implements ISql {
  private db: BetterSqlite3.Database | null;
  constructor(private readonly path: string) {
    this.db = new BetterSqlite3(path, { readonly: true, fileMustExist: true });
    this.db.pragma('busy_timeout = 5000');
  }
  queryOne<T = SqlRow>(sql: string, params?: SqlParameter[] | { [key: string]: SqlParameter }): T | undefined {
    const stmt = this.db!.prepare(sql);
    return (params ? stmt.get(params) : stmt.get()) as T | undefined;
  }
  queryAll<T = SqlRow>(sql: string, params?: SqlParameter[] | { [key: string]: SqlParameter }): T[] {
    const stmt = this.db!.prepare(sql);
    return (params ? stmt.all(params) : stmt.all()) as T[];
  }
  execute(): SqlResult { throw new Error('Modules are read-only here.'); }
  transaction<T>(callback: () => T): T { return callback(); }
  close(): void { this.db?.close(); this.db = null; }
  isOpen(): boolean { return this.db !== null; }
  getDatabasePath(): string { return this.path; }
}

export interface ModuleText {
  abbreviation: string;
  language: string;
  rights: TextRights;
  /** Book number to the chapter numbers the module has, ascending. */
  chapters(): Map<number, number[]>;
  verses(book: number, chapter: number): VerseText[];
  bookName(book: number): string;
  close(): void;
}

/** `<modulesDir>/bible_<abbr lower case>.db`, as the apps lay modules out. */
export function findModuleFile(abbr: string, modulesDir: string): string | undefined {
  for (const name of [`bible_${abbr.toLowerCase()}.db`, `bible_${abbr}.db`]) {
    const p = join(modulesDir, name);
    if (existsSync(p)) return p;
  }
  return undefined;
}

export function openModuleText(file: string): ModuleText {
  const sql = new ReadonlySql(file);
  const repo = new BibleRepository(sql);
  const info = repo.getModuleInfo();
  if (!info) throw new Error(`${file} is not a Bible module (no module_info).`);
  return {
    abbreviation: info.abbreviation,
    language: info.languageCode || 'en',
    rights: {
      abbreviation: info.abbreviation,
      fullName: info.fullName,
      licenseSpdx: info.licenseSpdx,
      licenseUrl: info.licenseUrl,
      copyright: info.copyright,
      publisher: info.publisher,
      publicDomain: info.isPublicDomain(),
    },
    chapters() {
      const rows = sql.queryAll<{ verse_id: number }>('SELECT DISTINCT verse_id / 1000 AS verse_id FROM bible_verse ORDER BY 1');
      const out = new Map<number, number[]>();
      for (const r of rows) {
        const book = Math.floor(r.verse_id / 1000);
        const chapter = r.verse_id % 1000;
        if (book < 1 || book > 66 || chapter < 1) continue;
        const list = out.get(book) ?? [];
        list.push(chapter);
        out.set(book, list);
      }
      return out;
    },
    verses(book, chapter) {
      return repo.getChapter(book, chapter).map(v => ({ verse: v.verseId % 1000, text: v.text }));
    },
    bookName: book => getBookName(book, 'long'),
    close: () => sql.close(),
  };
}

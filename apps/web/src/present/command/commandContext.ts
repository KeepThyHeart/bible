/**
 * The real `CommandContext`: the app's own book table (localized names plus the
 * English and locale abbreviations the search box already understands),
 * installed translations, and reference formatting. Kept apart from
 * `command.ts` so the parser stays pure and testable without i18n or stores.
 */

import { getLocalizer } from '@bible/core/browser';
import i18n from '../../i18n';
import { headerBookAliases, parseReference } from '../../utils/referenceParse';
import { getAllBookNames, getLocalizedBookName } from '../../utils/bookNames';
import { formatPassageRef } from '../../constants';
import { moduleStore } from '../../stores/moduleStore';
import type { CommandContext } from './command';

function norm(name: string): string {
  return name.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

let cachedLang = '';
let cachedTable: Map<string, number> | null = null;

function bookTable(): Map<string, number> {
  if (cachedTable && cachedLang === i18n.language) return cachedTable;
  const table = new Map<string, number>();
  const add = (name: string, book: number) => {
    const key = norm(name);
    if (!key) return;
    table.set(key, book);
    // "1 john" is also typed "1john".
    if (/^\d /.test(key)) table.set(key.replace(' ', ''), book);
  };
  for (const [abbr, book] of Object.entries(headerBookAliases(getLocalizer(i18n.language)))) add(abbr, book);
  for (const [num, name] of Object.entries(getAllBookNames())) add(name, Number(num));
  cachedTable = table;
  cachedLang = i18n.language;
  return table;
}

export interface CommandContextOptions {
  /** Translation used when the text names none. */
  defaultModule?: string;
  /** Passage currently on screen, for relative commands' hints. */
  current?: { book: number; chapter: number } | null;
  /** Override the installed-translation list (default: moduleStore's Bibles). */
  modules?: string[];
}

export function buildCommandContext(opts: CommandContextOptions = {}): CommandContext {
  const modules = opts.modules ?? moduleStore.getBibleModules().map(m => m.abbreviation);
  const byLower = new Map(modules.map(m => [m.toLowerCase(), m]));
  return {
    resolveBook: name => bookTable().get(norm(name)) ?? null,
    fuzzyBook: name => {
      if (name.replace(/\s/g, '').length <= 2) return null;
      const ref = parseReference(`${name} 1`, headerBookAliases(getLocalizer(i18n.language)));
      return ref?.fuzzyMatch ? ref.book : null;
    },
    resolveModule: name => byLower.get(name.toLowerCase()) ?? null,
    bookName: book => moduleStore.getBookName(book) ?? getLocalizedBookName(book),
    bookNames: () => {
      const out: Array<{ book: number; name: string }> = [];
      for (let book = 1; book <= 66; book++) out.push({ book, name: moduleStore.getBookName(book) });
      return out;
    },
    formatRef: (book, chapter, verseStart, verseEnd) => {
      const base = formatPassageRef(book, chapter, verseStart ?? null, moduleStore.getBookName(book));
      return verseStart !== undefined && verseEnd !== undefined && verseEnd !== verseStart
        ? `${base}–${verseEnd}`
        : base;
    },
    defaultModule: opts.defaultModule,
    current: opts.current ?? null,
  };
}

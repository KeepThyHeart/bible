/**
 * Strong's dictionaries store entries under a zero-padded key with no prefix
 * ("00026") and open each definition with the raw lexicon line
 * ("26 ἀγάπη ajgavph agape {ag-ah'-pay} from 25; ..."). The rest of the app
 * says "G26", so lookups and headings translate between the two (B-165).
 */

import { looseTranslit } from '../core.js';
import type { IDictionaryRepository } from '@bible/core';

/** 'G' or 'H' for a Strong's lexicon module (by abbreviation), else null. */
export function strongsLanguageOf(moduleName: string): 'G' | 'H' | null {
  if (!/^strongs/i.test(moduleName)) return null;
  return /hebrew/i.test(moduleName) ? 'H' : 'G';
}

/**
 * "G26", "g0026", "H 430", "26", "00026", "31a" -> `{ prefix, key }` with the key
 * as stored ("00026"). Null when the text is not a bare Strong's number.
 */
export function parseStrongsKeyInput(input: string): { prefix: 'G' | 'H' | null; key: string } | null {
  const m = /^\s*([GgHh])?\s*0*(\d{1,5})([A-Za-z])?\s*$/.exec(input ?? '');
  if (!m) return null;
  return {
    prefix: m[1] ? (m[1].toUpperCase() as 'G' | 'H') : null,
    key: m[2].padStart(5, '0') + (m[3] ? m[3].toUpperCase() : ''),
  };
}

export interface StrongsHead {
  word: string;
  transliteration: string;
  pronunciation: string;
  /** The definition without its raw opening line (Hebrew: after the transliteration and pronunciation words). */
  body: string;
}

/**
 * Greek: "N <greek words> <encoded words> <translit> {pron}" - the words before the
 * encoded form are as many as the encoded ones, so 3588 "ὁ ἡ τό oJ hJ tov ho {ho}" parses too.
 * Hebrew carries no script in the definition: "N translit pron ..." gives the transliteration only; the lemma
 * comes from the entry's own `word` column when that holds Hebrew letters (B-179).
 */
/** The entry's `word` when it holds Hebrew letters (U+0590-U+05FF), else ''. */
export function hebrewLemma(word?: string | null): string {
  const w = (word ?? '').trim();
  return /[\u0590-\u05FF]/.test(w) ? w : '';
}

export function parseStrongsHead(definition: string, language: 'G' | 'H', entryWord?: string | null): StrongsHead | null {
  const def = definition ?? '';
  if (language === 'G') {
    const m = /^\s*\d+\s+([^{}]+?)\s*\{([^}]*)\}\s*/.exec(def);
    if (!m) return null;
    const tokens = m[1].split(/\s+/);
    if (tokens.length < 3 || tokens.length % 2 === 0) return null;
    const k = (tokens.length - 1) / 2;
    return {
      word: tokens.slice(0, k).join(' '),
      transliteration: tokens[tokens.length - 1],
      pronunciation: m[2],
      body: def.slice(m[0].length),
    };
  }
  const m = /^\s*\d+\s+(\S+)\s+(\S+)\s*/.exec(def);
  if (!m) return null;
  return { word: hebrewLemma(entryWord), transliteration: m[1].replace(/^'/, ''), pronunciation: m[2].replace(/[;,]$/, ''), body: def.slice(m[0].length) };
}

type LooseIndex = Array<{ entry: ReturnType<IDictionaryRepository['getAllEntries']>[number]; loose: string }>;
const looseIndexes = new WeakMap<object, LooseIndex>();

/**
 * Entries of a Strong's lexicon whose transliteration matches `query` loosely (y/i, doubled
 * letters, kh/ch; B-178): "elohim" finds 'elohiym. Exact matches first, then prefix matches.
 * Used only when the plain search found nothing. Plain Latin queries only.
 */
export function looseStrongsMatches(repo: IDictionaryRepository, language: 'G' | 'H', query: string, limit = 30) {
  const loose = looseTranslit(query);
  if (!loose) return [];
  let index = looseIndexes.get(repo);
  if (!index) {
    index = [];
    for (const entry of repo.getAllEntries({ limit: 20000 })) {
      const head = parseStrongsHead(entry.definition ?? '', language);
      const key = head ? looseTranslit(head.transliteration) : '';
      if (key) index.push({ entry, loose: key });
    }
    looseIndexes.set(repo, index);
  }
  const exact = index.filter(e => e.loose === loose);
  const prefix = index.filter(e => e.loose !== loose && e.loose.startsWith(loose));
  return [...exact, ...prefix].slice(0, limit).map(e => e.entry);
}

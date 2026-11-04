/**
 * Strong's dictionaries store entries under a zero-padded key with no prefix
 * ("00026") and open each definition with the raw lexicon line
 * ("26 ἀγάπη ajgavph agape {ag-ah'-pay} from 25; ..."). The rest of the app
 * says "G26", so lookups and headings translate between the two (B-165).
 */

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
  /** The definition without its raw opening line (Greek only; Hebrew has no clean boundary). */
  body: string;
}

/**
 * Greek: "N <greek words> <encoded words> <translit> {pron}" - the words before the
 * encoded form are as many as the encoded ones, so 3588 "ὁ ἡ τό oJ hJ tov ho {ho}" parses too.
 * Hebrew carries no script: "N translit pron ..." gives the transliteration only.
 */
export function parseStrongsHead(definition: string, language: 'G' | 'H'): StrongsHead | null {
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
  const m = /^\s*\d+\s+(\S+)\s+(\S+)/.exec(def);
  if (!m) return null;
  return { word: '', transliteration: m[1].replace(/^'/, ''), pronunciation: m[2].replace(/[;,]$/, ''), body: def };
}

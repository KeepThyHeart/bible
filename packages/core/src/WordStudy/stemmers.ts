/**
 * Per-language stemming for word study.
 *
 * English gets a real Porter stemmer. Other major languages get a *light*
 * suffix stripper (plural / common verb endings): good enough to group forms
 * of a word, and deliberately conservative so it does not merge unrelated
 * words. Anything else has no stemmer; word groups can still use prefix
 * wildcards (`lov*`) and explicit variant lists. New stemmers can be added
 * with {@link registerStemmer}.
 */

export type Stemmer = (foldedWord: string) => string;

// ---- Porter (1980) stemmer, English -------------------------------------

const isCons = (w: string, i: number): boolean => {
  const c = w[i];
  if ('aeiou'.includes(c)) return false;
  if (c === 'y') return i === 0 ? true : !isCons(w, i - 1);
  return true;
};

function measure(w: string): number {
  let n = 0;
  let i = 0;
  const len = w.length;
  while (i < len && isCons(w, i)) i++;
  while (i < len) {
    while (i < len && !isCons(w, i)) i++;
    if (i >= len) break;
    n++;
    while (i < len && isCons(w, i)) i++;
  }
  return n;
}

const hasVowel = (w: string): boolean => {
  for (let i = 0; i < w.length; i++) if (!isCons(w, i)) return true;
  return false;
};
const endsDouble = (w: string): boolean =>
  w.length >= 2 && w[w.length - 1] === w[w.length - 2] && isCons(w, w.length - 1);
const endsCvc = (w: string): boolean => {
  const n = w.length;
  if (n < 3) return false;
  if (!isCons(w, n - 1) || isCons(w, n - 2) || !isCons(w, n - 3)) return false;
  return !'wxy'.includes(w[n - 1]);
};

function replaceSuffix(w: string, rules: Array<[string, string]>, minM: number): string {
  for (const [suf, rep] of rules) {
    if (w.endsWith(suf)) {
      const stem = w.slice(0, -suf.length);
      return measure(stem) > minM - 1 ? stem + rep : w;
    }
  }
  return w;
}

export function porterStem(input: string): string {
  let w = input;
  if (w.length <= 2 || !/^[a-z]+$/.test(w)) return w;

  // 1a
  if (w.endsWith('sses')) w = w.slice(0, -2);
  else if (w.endsWith('ies')) w = w.slice(0, -2);
  else if (!w.endsWith('ss') && w.endsWith('s')) w = w.slice(0, -1);

  // 1b
  let flag = false;
  if (w.endsWith('eed')) {
    if (measure(w.slice(0, -3)) > 0) w = w.slice(0, -1);
  } else if (w.endsWith('ed') && hasVowel(w.slice(0, -2))) {
    w = w.slice(0, -2); flag = true;
  } else if (w.endsWith('ing') && hasVowel(w.slice(0, -3))) {
    w = w.slice(0, -3); flag = true;
  } else if (w.endsWith('eth') && hasVowel(w.slice(0, -3))) {
    // Archaic third-person "-eth" (loveth, saith) - common in older Bibles.
    w = w.slice(0, -3); flag = true;
  }
  if (flag) {
    if (w.endsWith('at') || w.endsWith('bl') || w.endsWith('iz')) w += 'e';
    else if (endsDouble(w) && !'lsz'.includes(w[w.length - 1])) w = w.slice(0, -1);
    else if (measure(w) === 1 && endsCvc(w)) w += 'e';
  }
  // 1c
  if (w.endsWith('y') && hasVowel(w.slice(0, -1))) w = w.slice(0, -1) + 'i';

  // 2
  w = replaceSuffix(w, [
    ['ational', 'ate'], ['tional', 'tion'], ['enci', 'ence'], ['anci', 'ance'], ['izer', 'ize'],
    ['abli', 'able'], ['alli', 'al'], ['entli', 'ent'], ['eli', 'e'], ['ousli', 'ous'],
    ['ization', 'ize'], ['ation', 'ate'], ['ator', 'ate'], ['alism', 'al'], ['iveness', 'ive'],
    ['fulness', 'ful'], ['ousness', 'ous'], ['aliti', 'al'], ['iviti', 'ive'], ['biliti', 'ble'],
  ], 1);
  // 3
  w = replaceSuffix(w, [
    ['icate', 'ic'], ['ative', ''], ['alize', 'al'], ['iciti', 'ic'], ['ical', 'ic'], ['ful', ''], ['ness', ''],
  ], 1);
  // 4
  for (const suf of ['al', 'ance', 'ence', 'er', 'ic', 'able', 'ible', 'ant', 'ement', 'ment', 'ent',
    'ou', 'ism', 'ate', 'iti', 'ous', 'ive', 'ize']) {
    if (w.endsWith(suf)) {
      if (measure(w.slice(0, -suf.length)) > 1) w = w.slice(0, -suf.length);
      break;
    }
  }
  if (w.endsWith('ion')) {
    const stem = w.slice(0, -3);
    if (measure(stem) > 1 && (stem.endsWith('s') || stem.endsWith('t'))) w = stem;
  }
  // 5
  if (w.endsWith('e')) {
    const stem = w.slice(0, -1);
    const m = measure(stem);
    if (m > 1 || (m === 1 && !endsCvc(stem))) w = stem;
  }
  if (measure(w) > 1 && endsDouble(w) && w.endsWith('l')) w = w.slice(0, -1);
  return w;
}

// ---- Light stemmers -----------------------------------------------------

function suffixStripper(suffixes: string[], minStem = 3): Stemmer {
  const sorted = [...suffixes].sort((a, b) => b.length - a.length);
  return (w: string) => {
    for (const s of sorted) {
      if (w.length - s.length >= minStem && w.endsWith(s)) return w.slice(0, -s.length);
    }
    return w;
  };
}

const registry = new Map<string, Stemmer>([
  ['en', porterStem],
  ['es', suffixStripper(['aciones', 'amente', 'ando', 'iendo', 'ados', 'adas', 'idos', 'idas', 'ado', 'ada',
    'ido', 'ida', 'ar', 'er', 'ir', 'es', 'as', 'os', 's'])],
  ['pt', suffixStripper(['acoes', 'amente', 'ando', 'endo', 'ados', 'adas', 'idos', 'idas', 'ado', 'ada',
    'ido', 'ida', 'ar', 'er', 'ir', 'es', 'as', 'os', 's'])],
  ['fr', suffixStripper(['ations', 'ement', 'ant', 'ees', 'ent', 'ons', 'ez', 'er', 'es', 'ee', 's', 'e'])],
  ['it', suffixStripper(['azioni', 'mente', 'ando', 'endo', 'ati', 'ate', 'ato', 'ata', 'are', 'ere', 'ire',
    'i', 'e', 'o', 'a'])],
  ['de', suffixStripper(['ungen', 'ung', 'heit', 'keit', 'lich', 'en', 'er', 'es', 'em', 'et', 'st', 'te',
    'e', 'n', 's', 't'], 4)],
  ['nl', suffixStripper(['heden', 'heid', 'en', 'er', 'je', 'e', 's'], 4)],
]);

/** Register (or replace) the stemmer for a primary language subtag such as `en`. */
export function registerStemmer(language: string, stemmer: Stemmer): void {
  registry.set(primaryLanguage(language), stemmer);
}

export function primaryLanguage(tag: string | undefined): string {
  return (tag ?? '').toLowerCase().split(/[-_]/)[0];
}

/** The stemmer for a BCP 47 tag or ISO code ("en", "en-US", "spa"), or undefined. */
export function getStemmer(language: string | undefined): Stemmer | undefined {
  const p = primaryLanguage(language);
  const alias: Record<string, string> = { eng: 'en', spa: 'es', por: 'pt', fra: 'fr', fre: 'fr', ita: 'it',
    deu: 'de', ger: 'de', nld: 'nl', dut: 'nl' };
  return registry.get(alias[p] ?? p);
}

export function hasStemmer(language: string | undefined): boolean {
  return getStemmer(language) !== undefined;
}

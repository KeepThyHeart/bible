/**
 * Normalisers: turn a written word into a comparison form.
 *
 *  - {@link normalizeToken}: light (NFC, edge punctuation, curly apostrophes, optional case fold).
 *    Keeps accents, so "Él" and "el" stay distinct. Used by keyword marks.
 *  - {@link foldWord}: aggressive (accents, niqqud, case, final sigma, apostrophes gone).
 *    Used for accent-insensitive search and stem matching in any script.
 *  - {@link normalizeArchaic}: maps archaic English forms (thou, hath, ...) to modern ones.
 */

import { canonicalLanguage } from './language';

const EDGE_PUNCT = /^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu;
const EDGE_TRIM_MARKS = /^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu;
const APOSTROPHES = /['’ʼ׳]/g;

/** Strip characters that are not letters, digits or combining marks from both edges. */
export function trimEdgePunctuation(s: string): string {
  return s.replace(EDGE_TRIM_MARKS, '');
}

/** Matching form of a token: NFC, edge punctuation stripped, curly apostrophes folded, case-folded unless `matchCase`. */
export function normalizeToken(text: string, matchCase = false): string {
  let s = text.normalize('NFC').replace(/[‘’]/g, "'").replace(EDGE_PUNCT, '');
  if (!matchCase) s = s.toLowerCase();
  return s;
}

/**
 * Fold a word for accent- and case-insensitive comparison in any script.
 * NFD, drop combining marks (Greek accents/breathings, Hebrew niqqud and
 * cantillation, Latin diacritics), lowercase, final sigma to sigma, drop
 * apostrophes.
 */
export function foldWord(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .replace(APOSTROPHES, '');
}

/** Fold a lemma or transliteration query: foldWord plus dropping Strong's-style `' - { }` marks. */
export function foldLemma(s: string): string {
  return foldWord(s).replace(/[\-{}`]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Archaic English -> modern English, for word forms that stemming cannot
 * reach (pronouns and irregular verbs). Keys are folded lower-case words.
 * Regular "-eth"/"-est" verbs are deliberately not rewritten here (it would corrupt
 * teeth, Nazareth, twentieth): the English stemmer handles "-eth".
 */
export const ARCHAIC_EN: Readonly<Record<string, string>> = {
  thou: 'you', thee: 'you', thy: 'your', thine: 'your', ye: 'you', thyself: 'yourself',
  hath: 'has', hast: 'have', doth: 'does', dost: 'do', didst: 'did', art: 'are', wast: 'was', wert: 'were',
  shalt: 'shall', wilt: 'will', canst: 'can', wouldest: 'would', shouldest: 'should', couldest: 'could',
  saith: 'says', saidst: 'said', hither: 'here', thither: 'there', whither: 'where',
  nay: 'no', yea: 'yes', unto: 'to', ere: 'before', wherefore: 'why', whosoever: 'whoever', whatsoever: 'whatever',
};

/** Modernise one folded English word from {@link ARCHAIC_EN}; other words come back unchanged. */
export function normalizeArchaic(foldedWord: string, language: string | undefined = 'en'): string {
  if (canonicalLanguage(language) !== 'en') return foldedWord;
  return ARCHAIC_EN[foldedWord] ?? foldedWord;
}

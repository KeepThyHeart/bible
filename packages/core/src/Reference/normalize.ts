/**
 * Input normalisation and per-locale folding, with offset maps back to the
 * original text so `scan()` can report where a reference really is.
 *
 * Two layers:
 *  1. {@link normalizeText}: script-neutral clean-up that every locale shares.
 *     NFKC per code point (full-width "３：１６" becomes "3:16"), every Unicode
 *     decimal digit to 0-9, every dash to "-", bidi controls and tatweel
 *     removed, whitespace runs collapsed to one space.
 *  2. {@link foldText}: what book-name matching compares - lower case (with
 *     the locale's own case rules, so Turkish İ/ı fold correctly), decomposed,
 *     optionally without combining marks, and with Arabic-script letter
 *     variants unified (ى/ی→ي, ک→ك, ة→ه).
 */

export interface NormalizedText {
  text: string;
  /** Original index of each UTF-16 unit of `text`. */
  start: number[];
  /** Original end index (exclusive) of the code point each unit came from. */
  end: number[];
}

export interface FoldMode {
  /** Locale for case folding; '' means the root (non-Turkic) rules. */
  caseLocale: string;
  foldMarks: boolean;
}

export interface FoldedText {
  text: string;
  /** Index into the normalized text for each folded unit. */
  toNorm: number[];
  /** Folded index where each normalized unit starts; length `normalized.length + 1`. */
  fromNorm: number[];
}

// Bidi controls (LRM, RLM, ALM, embeddings, isolates), BOM, ZWSP, Arabic tatweel.
const STRIP = /^[​‎‏؜‪-‮⁦-⁩﻿ـ]$/u;
const DASH = /^[‐-―−﹘﹣－]$/u;
const SPACE = /^\s$/u;
const DIGIT = /^\p{Nd}$/u;

/** ASCII value of any Unicode decimal digit (Nd runs are blocks of ten starting at zero). */
export function digitValue(cp: number): number {
  let start = cp;
  while (start > 0 && DIGIT.test(String.fromCodePoint(start - 1))) start--;
  return (cp - start) % 10;
}

const digitCache = new Map<number, string>();

export function normalizeText(input: string): NormalizedText {
  const out: string[] = [];
  const start: number[] = [];
  const end: number[] = [];
  let lastSpace = false;
  let i = 0;
  for (const ch of input) {
    const len = ch.length;
    let rep: string;
    if (STRIP.test(ch)) rep = '';
    else if (SPACE.test(ch)) rep = lastSpace ? '' : ' ';
    else if (DASH.test(ch)) rep = '-';
    else if (ch === '\u05F3' || ch === '\u2019') rep = "'"; // Hebrew geresh, right single quote
    else if (ch === '\u05F4') rep = '"'; // Hebrew gershayim
    else if (ch >= '0' && ch <= '9') rep = ch;
    else if (DIGIT.test(ch)) {
      const cp = ch.codePointAt(0)!;
      let d = digitCache.get(cp);
      if (d === undefined) {
        d = String(digitValue(cp));
        digitCache.set(cp, d);
      }
      rep = d;
    } else {
      rep = ch.normalize('NFKC');
      if (SPACE.test(rep)) rep = lastSpace ? '' : ' ';
    }
    if (rep) {
      for (let k = 0; k < rep.length; k++) {
        start.push(i);
        end.push(i + len);
      }
      out.push(rep);
      lastSpace = rep.endsWith(' ');
    }
    i += len;
  }
  return { text: out.join(''), start, end };
}

/** Plain normalised string, for callers that need no offsets. */
export function normalizeString(input: string): string {
  return normalizeText(input).text.trim();
}

const ARABIC_FOLD: Record<string, string> = {
  'ى': 'ي', // alef maksura -> yeh
  'ی': 'ي', // farsi yeh -> yeh
  'ک': 'ك', // keheh -> kaf
  'ة': 'ه', // teh marbuta -> heh
  'ۀ': 'ه', // heh with yeh above -> heh
};
const JOINERS = /[‌‍]/g;
const MARKS = /\p{M}/gu;

const foldCache = new Map<string, Map<string, string>>();

/** Fold one code point (already normalised). Deterministic per (char, mode). */
export function foldChar(ch: string, mode: FoldMode): string {
  const key = `${mode.caseLocale}|${mode.foldMarks ? 1 : 0}`;
  let cache = foldCache.get(key);
  if (!cache) {
    cache = new Map();
    foldCache.set(key, cache);
  }
  const hit = cache.get(ch);
  if (hit !== undefined) return hit;
  let s: string = ARABIC_FOLD[ch] ?? ch;
  try {
    s = mode.caseLocale ? s.toLocaleLowerCase(mode.caseLocale) : s.toLowerCase();
  } catch {
    s = s.toLowerCase();
  }
  s = s.normalize('NFD');
  if (mode.foldMarks) s = s.replace(MARKS, '');
  s = s.replace(JOINERS, '');
  let r = '';
  for (const c of s) r += ARABIC_FOLD[c] ?? c;
  cache.set(ch, r);
  return r;
}

/** Fold normalised text for matching, keeping a map back to it. */
export function foldText(norm: string, mode: FoldMode): FoldedText {
  let text = '';
  const toNorm: number[] = [];
  const fromNorm: number[] = new Array(norm.length + 1);
  let i = 0;
  for (const ch of norm) {
    const f = foldChar(ch, mode);
    for (let k = 0; k < ch.length; k++) fromNorm[i + k] = text.length;
    for (let k = 0; k < f.length; k++) toNorm.push(i);
    text += f;
    i += ch.length;
  }
  fromNorm[norm.length] = text.length;
  return { text, toNorm, fromNorm };
}

/** Fold a name from locale data the same way input is folded; trailing period dropped, spaces collapsed. */
export function foldName(name: string, mode: FoldMode): string {
  return foldText(normalizeString(name), mode).text.replace(/\.$/, '').replace(/\s+/g, ' ').trim();
}

/** True if the character is a letter or combining mark (word character for boundaries). */
export function isLetter(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{M}]/u.test(ch);
}

export function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

/** Scripts with upper/lower case, for the scan capital-letter rule. */
export function hasCase(ch: string): boolean {
  return ch.toLowerCase() !== ch.toUpperCase();
}

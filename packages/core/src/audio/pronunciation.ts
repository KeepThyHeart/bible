/**
 * Pronunciation overlay: IPA corrections on top of the speech engine's own phonemizer.
 *
 * espeak-ng (behind Piper and Kokoro) mispronounces names ("Melchizedek"), archaic forms
 * ("hast", "saith") and homographs whose sound depends on the sentence ("had read",
 * "Blessed are" vs "God blessed them"). The data lives outside this repository (the
 * `bible-scripts` repo, `pronunciation/`, installed into `<data>/audio/pronunciation/`) in
 * three layers, all IPA in espeak's own style:
 *
 * - **locale lexicon** (`en-us/lexicon.json`): word to IPA for every module spoken in the
 *   locale, plus `senses`, the IPA of each meaning of a homograph (`blessed`: adjective, verb).
 *   A lower-case key matches the word in any case; a capitalised key (`Job`) matches only a
 *   capitalised word, so a name does not change a common word spelt the same way. A key may
 *   be a hyphenated compound (`beth-lehem`). Possessives are derived (`Job's` = `Job` + z).
 * - **language senses** (`en/KJV.json`): which meaning each homograph has, per verse and word
 *   index. Accent-neutral: one file serves every locale of the language.
 * - **locale overrides** (`en-us/KJV.json`, optional): IPA for single occurrences.
 *
 * Occurrences carry the word and a hash of the verse's spoken text, so an edited verse drops
 * its entries instead of putting them on the wrong word. Precedence for a word: override,
 * then its sense through the lexicon's `senses`, then the lexicon entry, then espeak.
 *
 * `applyPronunciation` turns a spoken text into the same text with corrected words replaced
 * by markers `⟦word|ipa⟧`. Engines that understand markers splice the IPA in (see
 * `piperPhonemes.ts`); any other consumer calls `stripPronunciation` to get the words back.
 * Markers contain no sentence punctuation or whitespace, so sentence splitters are unaffected.
 *
 * Pure: no DOM, no Node. Shared by the web player and `tools/audio-build`.
 */

import { getUsfmBookByNumber } from '../Export/UsfmBookCodes';

export const PRONUNCIATION_LEXICON_FORMAT = 'kth-pron-lexicon/2';
export const PRONUNCIATION_SENSES_FORMAT = 'kth-pron-senses/1';
export const PRONUNCIATION_MODULE_FORMAT = 'kth-pron-module/1';

export interface PronunciationLexicon {
  locale: string;
  entries: ReadonlyMap<string, string>;
  /** Homograph (lower case) to meaning label to IPA. */
  senses: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

export interface PronunciationVerse {
  hash: string;
  /** Word index to [word as written, IPA (overrides) or meaning label (senses)]. */
  words: ReadonlyMap<number, readonly [string, string]>;
}

/** Which meaning each homograph has in a module (`<language>/<MODULE>.json`). */
export interface PronunciationSenses {
  module: string;
  language: string;
  verses: ReadonlyMap<string, PronunciationVerse>;
}

/** IPA for single occurrences of a module in one locale (`<locale>/<MODULE>.json`). */
export interface PronunciationModule {
  module: string;
  locale: string;
  verses: ReadonlyMap<string, PronunciationVerse>;
}

export interface PronunciationOverlay {
  lexicon?: PronunciationLexicon | null;
  senses?: PronunciationSenses | null;
  module?: PronunciationModule | null;
}

/** IPA a marker can carry: no whitespace, no marker syntax, no sentence or clause punctuation. */
const IPA_OK = /^[^\s⟦⟧|.!?;:,"]+$/u;
const LABEL_OK = /^[a-z][a-z0-9-]*$/;

const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** A locale lexicon, or null when it is not one. Bad entries are dropped, not fatal. */
export function parsePronunciationLexicon(json: unknown): PronunciationLexicon | null {
  if (!isObject(json) || json.format !== PRONUNCIATION_LEXICON_FORMAT || typeof json.locale !== 'string' || !isObject(json.entries)) return null;
  const entries = new Map<string, string>();
  for (const [k, v] of Object.entries(json.entries)) {
    if (k && typeof v === 'string' && IPA_OK.test(v)) entries.set(k, v);
  }
  const senses = new Map<string, Map<string, string>>();
  if (isObject(json.senses)) {
    for (const [word, raw] of Object.entries(json.senses)) {
      if (!isObject(raw)) continue;
      const m = new Map<string, string>();
      for (const [label, ipa] of Object.entries(raw)) if (LABEL_OK.test(label) && typeof ipa === 'string' && IPA_OK.test(ipa)) m.set(label, ipa);
      if (m.size > 0) senses.set(word.toLowerCase(), m);
    }
  }
  return { locale: json.locale.toLowerCase(), entries, senses };
}

function parseVerses(raw: unknown, ok: (value: string) => boolean): Map<string, PronunciationVerse> | null {
  if (!isObject(raw)) return null;
  const verses = new Map<string, PronunciationVerse>();
  for (const [ref, v] of Object.entries(raw)) {
    if (!isObject(v) || typeof v.hash !== 'string' || !isObject(v.words)) continue;
    const words = new Map<number, readonly [string, string]>();
    for (const [i, w] of Object.entries(v.words)) {
      const n = Number(i);
      if (Number.isInteger(n) && n >= 0 && Array.isArray(w) && w.length === 2
        && typeof w[0] === 'string' && typeof w[1] === 'string' && ok(w[1])) words.set(n, [w[0], w[1]]);
    }
    if (words.size > 0) verses.set(ref, { hash: v.hash, words });
  }
  return verses;
}

/** A language senses file, or null when it is not one. */
export function parsePronunciationSenses(json: unknown): PronunciationSenses | null {
  if (!isObject(json) || json.format !== PRONUNCIATION_SENSES_FORMAT || typeof json.module !== 'string' || typeof json.language !== 'string') return null;
  const verses = parseVerses(json.verses, l => LABEL_OK.test(l));
  return verses ? { module: json.module, language: json.language.toLowerCase(), verses } : null;
}

/** A locale override file, or null when it is not one. */
export function parsePronunciationModule(json: unknown): PronunciationModule | null {
  if (!isObject(json) || json.format !== PRONUNCIATION_MODULE_FORMAT || typeof json.module !== 'string' || typeof json.locale !== 'string') return null;
  const verses = parseVerses(json.verses, ipa => IPA_OK.test(ipa));
  return verses ? { module: json.module, locale: json.locale.toLowerCase(), verses } : null;
}

/** The three files of an overlay, relative to the pronunciation root. */
export function pronunciationFiles(moduleAbbr: string, locale: string): { lexicon: string; senses: string; module: string } {
  const language = locale.split('-')[0];
  return { lexicon: `${locale}/lexicon.json`, senses: `${language}/${moduleAbbr}.json`, module: `${locale}/${moduleAbbr}.json` };
}

/** `GEN.1.22`, the key module files use (verse 0 is a Psalm title). */
export function pronunciationVerseKey(book: number, chapter: number, verse: number): string | undefined {
  const code = getUsfmBookByNumber(book)?.code;
  return code ? `${code}.${chapter}.${verse}` : undefined;
}

/** FNV-1a 64 of the UTF-8 text, 16 hex digits: ties an occurrence to the text it was decided for. */
export function spokenTextHash(text: string): string {
  let h = 0xcbf29ce484222325n;
  for (const b of new TextEncoder().encode(text)) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

/** The locale a voice's language selects (`en-US` to `en-us`). */
export const pronunciationLocale = (voiceLanguage: string): string => voiceLanguage.toLowerCase().replace(/_/g, '-');

// -- applying ------------------------------------------------------------------

/** A word run: words joined by hyphens. Word indices count the words, not the runs. */
const WORD_RUN = /\p{L}+(?:'\p{L}+)*(?:-\p{L}+(?:'\p{L}+)*)*/gu;
const WORD = /\p{L}+(?:'\p{L}+)*/gu;
const MARKER = /⟦([^|⟧]*)\|([^⟧]*)⟧/gu;

const STRESS_OR_LENGTH = /[ˈˌː̩]/gu;

/** `z`, `s` or `ᵻz`, by the last sound of the base. */
function possessiveSuffix(ipa: string): string {
  const last = ipa.replace(STRESS_OR_LENGTH, '').slice(-1);
  if ('szʃʒ'.includes(last)) return 'ᵻz';
  if ('ptkfθ'.includes(last)) return 's';
  return 'z';
}

function lookup(lexicon: PronunciationLexicon, token: string, possessive = true): string | undefined {
  const lower = token.toLowerCase();
  const capitalised = token[0] !== token[0].toLowerCase();
  const hit = (capitalised ? lexicon.entries.get(lower[0].toUpperCase() + lower.slice(1)) : undefined) ?? lexicon.entries.get(lower);
  if (hit || !possessive || !lower.endsWith("'s")) return hit;
  const base = lookup(lexicon, token.slice(0, -2), false);
  return base ? base + possessiveSuffix(base) : undefined;
}

const marker = (word: string, ipa: string): string => `⟦${word}|${ipa}⟧`;

/**
 * `text` (a verse as `TextPreparer.verse` speaks it) with corrected words replaced by markers.
 * `verseKey` (`pronunciationVerseKey`) enables the module's occurrence entries (senses, overrides) for that verse;
 * without it only the lexicon applies (chapter intros).
 */
export function applyPronunciation(text: string, overlay: PronunciationOverlay | null | undefined, verseKey?: string): string {
  const lexicon = overlay?.lexicon ?? null;
  let overrides: PronunciationVerse['words'] | null = null;
  let senses: PronunciationVerse['words'] | null = null;
  if (verseKey && (overlay?.module || overlay?.senses)) {
    const hash = spokenTextHash(text);
    const o = overlay.module?.verses.get(verseKey);
    if (o && o.hash === hash) overrides = o.words;
    const s = lexicon ? overlay.senses?.verses.get(verseKey) : undefined;
    if (s && s.hash === hash) senses = s.words;
  }
  if (!lexicon && !overrides) return text;
  const same = (entry: readonly [string, string] | undefined, word: string): entry is readonly [string, string] =>
    !!entry && entry[0].toLowerCase() === word.toLowerCase();

  let out = '';
  let at = 0;
  let index = 0;
  for (const run of text.matchAll(WORD_RUN)) {
    const words = [...run[0].matchAll(WORD)];
    const start = run.index;
    if (words.length > 1 && lexicon) {
      const whole = lookup(lexicon, run[0]);
      if (whole) {
        out += text.slice(at, start) + marker(run[0], whole);
        at = start + run[0].length;
        index += words.length;
        continue;
      }
    }
    for (const w of words) {
      const o = overrides?.get(index);
      const s = senses?.get(index);
      const ipa = (same(o, w[0]) ? o[1] : undefined)
        ?? (same(s, w[0]) ? lexicon!.senses.get(w[0].toLowerCase())?.get(s[1]) : undefined)
        ?? (lexicon ? lookup(lexicon, w[0]) : undefined);
      if (ipa) {
        const wStart = start + w.index;
        out += text.slice(at, wStart) + marker(w[0], ipa);
        at = wStart + w[0].length;
      }
      index++;
    }
  }
  return at === 0 ? text : out + text.slice(at);
}

/** The text with every marker back to its word. */
export function stripPronunciation(text: string): string {
  return text.includes('⟦') ? text.replace(MARKER, '$1') : text;
}

export function hasPronunciation(text: string): boolean {
  return text.includes('⟦');
}

export type PronunciationRun = { kind: 'text'; text: string } | { kind: 'ipa'; word: string; ipa: string };

/** The text as alternating plain runs and corrected words, in order. Empty plain runs are left out. */
export function splitPronunciation(text: string): PronunciationRun[] {
  const out: PronunciationRun[] = [];
  let at = 0;
  for (const m of text.matchAll(MARKER)) {
    if (m.index > at) out.push({ kind: 'text', text: text.slice(at, m.index) });
    out.push({ kind: 'ipa', word: m[1], ipa: m[2] });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) });
  return out;
}

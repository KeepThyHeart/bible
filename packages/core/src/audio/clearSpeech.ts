/**
 * Clear speech: rewrite espeak-style IPA for careful, distinct diction, the way a reader
 * speaking slowly for learners (or over a poor line) would say the words. American English
 * reading aloud reduces and elides a great deal; these rules undo the reductions that cost
 * the most clarity:
 *
 * | From                        | To            | Example                                   |
 * |-----------------------------|---------------|-------------------------------------------|
 * | glottal stop `ʔ` + syllabic | `t` + `ə` + C | begotten `bᵻɡˈɑːʔn̩` -> `bᵻɡˈɑːtən`         |
 * | any other glottal stop `ʔ`  | `t`           |                                           |
 * | syllabic `n̩ l̩ m̩ ɹ̩`         | `ən əl əm əɹ` | (U+0329 combining mark)                   |
 * | flap `ɾ`                    | `t`           | city, water, mighty                       |
 * | reduced `ᵻ`                 | `ɪ`           | before, behold, believeth                 |
 * | reduced `ɐ`                 | `ʌ`           | against, among, about                     |
 * | the word "the" `ðə`         | `ðʌ`          | whole word only                           |
 *
 * Stress marks and punctuation are left as they are: they carry the intonation. The input is
 * any phoneme string an engine is about to speak, after pronunciation corrections have been
 * spliced in, so the corrections are made clear too.
 */

const SYLLABIC = '̩';
const WORD_EDGE = '\\s,.;:!?—…"«»“”()';

interface Rule { pattern: RegExp; replacement: string; adds: string[] }

const RULES: Rule[] = [
  { pattern: new RegExp(`ʔ([nlmɹ])${SYLLABIC}`, 'gu'), replacement: 'tə$1', adds: ['t', 'ə'] },
  { pattern: /ʔ/gu, replacement: 't', adds: ['t'] },
  { pattern: new RegExp(`([nlmɹ])${SYLLABIC}`, 'gu'), replacement: 'ə$1', adds: ['ə'] },
  { pattern: /ɾ/gu, replacement: 't', adds: ['t'] },
  { pattern: /ᵻ/gu, replacement: 'ɪ', adds: ['ɪ'] },
  { pattern: /ɐ/gu, replacement: 'ʌ', adds: ['ʌ'] },
  { pattern: new RegExp(`(?<=^|[${WORD_EDGE}])ðə(?=$|[${WORD_EDGE}])`, 'gu'), replacement: 'ðʌ', adds: ['ʌ'] },
];

/**
 * The clear-speech form of `ipa`. `known` (a voice's or model's symbol test) skips any rule
 * whose new symbols the engine cannot say, leaving those sounds as they were.
 */
export function clearSpeechIpa(ipa: string, known?: (symbol: string) => boolean): string {
  let out = ipa;
  for (const r of RULES) {
    if (known && !r.adds.every(known)) continue;
    out = out.replace(r.pattern, r.replacement);
  }
  return out;
}

/** The same for a sentence as single-code-point symbols (Piper's phonemizer output). */
export function clearSpeechSymbols(symbols: string[], known?: (symbol: string) => boolean): string[] {
  return [...clearSpeechIpa(symbols.join(''), known)];
}

/**
 * Shared text tools (task 0089): tokenising, normalising, stemming, stop
 * words and word/phrase matching. Pure TypeScript, no DOM, no I/O; exported
 * from `@bible/core/browser` and `@bible/core`. See README.md in this folder.
 */
export { primaryLanguage, canonicalLanguage } from './language';
export { tokenizeVerseWords, tokenizePhrase } from './tokenize';
export type { TextWord } from './tokenize';
export {
  normalizeToken, foldWord, foldLemma, trimEdgePunctuation,
  normalizeArchaic, modernizeVerbEnding, ARCHAIC_EN,
} from './normalize';
export { porterStem, getStemmer, hasStemmer, registerStemmer } from './stemmers';
export type { Stemmer } from './stemmers';
export { getStopWords, registerStopWords, isStopWord } from './stopwords';
export {
  findSequences, findPhraseMatches, compileTermMatcher, countForms, parseTermQuery,
} from './matcher';
export type { TermMatcher, TermMatcherOptions, TermMatch } from './matcher';

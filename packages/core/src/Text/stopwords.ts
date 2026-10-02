/**
 * Stop-word lists (function words that carry little meaning), per language.
 * Small and conservative; extend with {@link registerStopWords}. Entries are
 * folded (see `foldWord`), so test with `isStopWord`, which folds for you.
 */
import { canonicalLanguage } from './language';
import { normalizeToken } from './normalize';

const lists = new Map<string, Set<string>>();

function words(s: string): Set<string> {
  return new Set(s.split(/\s+/).filter(Boolean));
}

lists.set('en', words(`a about after all also am an and any are as at be because been but by can could did do does for from had has have he her him his i if in into is it its me my no not of on or our out shall she should so than that the their them then there they this those thou thee thy thine to unto up upon us was we were what when which who whom will with would ye you your yea hath saith said things thing`));
lists.set('es', words(`a al algo ante aquel aquella aquí como con contra cual cuando de del desde donde e el ella ellas ellos en entre era eran es esa ese eso esta este esto fue ha han hay la las le les lo los me mi mis muy ni no nos o para pero por porque que quien se ser si sin sobre su sus te tu tus un una uno y ya yo`));

/**
 * The stop-word set for a language (empty when none is known). Entries are
 * lower-case with accents kept; compare with `normalizeToken(word)` or use
 * {@link isStopWord}.
 */
export function getStopWords(language: string | undefined): ReadonlySet<string> {
  return lists.get(canonicalLanguage(language)) ?? new Set();
}

/** Register (or replace) the stop words for a language; entries are lower-cased. */
export function registerStopWords(language: string, stopWords: Iterable<string>): void {
  lists.set(canonicalLanguage(language), new Set([...stopWords].map((w) => normalizeToken(w))));
}

/** Is `word` (any case, edge punctuation ignored) a stop word of `language`? */
export function isStopWord(word: string, language: string | undefined): boolean {
  return getStopWords(language).has(normalizeToken(word));
}

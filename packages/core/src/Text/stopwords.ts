/**
 * Stop-word lists (function words that carry little meaning), per language.
 * Small and conservative; extend with {@link registerStopWords}. Entries are
 * folded (see `foldWord`), so test with `isStopWord`, which folds for you.
 */
import { canonicalLanguage } from './language';
import { foldWord } from './normalize';

const lists = new Map<string, Set<string>>();

function words(s: string): Set<string> {
  return new Set(s.split(/\s+/).filter(Boolean).map(foldWord));
}

lists.set('en', words(`a about after all also am an and any are as at be because been being but by can could did do does doth
  for from had has hath have he her hers him his i if in into is it its me my no nor not of on or our out
  shall she should so than that the their them then there here they this those these thou thee thy thine to unto
  up upon us was were we what when which who whom whose whence will with would ye yet you your yea saith said
  things thing might may`));
lists.set('es', words(`a al algo ante aquel aquella aqui como con contra cual cuando de del desde donde e el ella ellas ellos
  en entre era eran es esa ese eso esta este esto fue ha han hay la las le les lo los me mi mis muy ni no nos o
  para pero por porque que quien se ser si sin sobre su sus te tu tus un una uno unos unas y ya yo son he`));

/** The stop-word set for a language (empty when none is known). */
export function getStopWords(language: string | undefined): ReadonlySet<string> {
  return lists.get(canonicalLanguage(language)) ?? new Set();
}

export function registerStopWords(language: string, stopWords: Iterable<string>): void {
  lists.set(canonicalLanguage(language), new Set([...stopWords].map(foldWord)));
}

export function isStopWord(word: string, language: string | undefined): boolean {
  return getStopWords(language).has(foldWord(word));
}

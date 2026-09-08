/**
 * Splitting a TSK cross-reference phrase into its keyword and its aside.
 *
 * The Treasury of Scripture Knowledge stores the phrase a group hangs off in
 * the same column as any editorial remark about it, run together with no
 * delimiter:
 *
 *   "locusts.The word {arbeh,} Locust, is derived from {ravah,}..."
 *   "thou mayest freely eat.  Heb. eating thou shalt eat."
 *
 * Printed raw under a verse, that reads as corrupted data. Study mode shows the
 * keyword and keeps the aside out of the flow (as the hovered title), which is
 * the same split the web Study pane applies in
 * `apps/web/src/components/StudyPane/StudyCrossRefs.tsx`.
 */

/** A phrase separated into the keyword TSK indexed and any trailing remark. */
export interface SplitPhrase {
  keyword: string;
  aside: string | null;
}

/** Below this length a phrase is a bare keyword; no split is attempted. */
const MIN_SPLITTABLE_LENGTH = 30;
/** A candidate aside shorter than this is punctuation noise, not a remark. */
const MIN_ASIDE_LENGTH = 10;
/** Never split inside the first few characters - that is the keyword itself. */
const MIN_KEYWORD_LENGTH = 4;

/**
 * Split a raw TSK phrase into `{ keyword, aside }`.
 *
 * The break is the first period that is followed either by two or more spaces
 * or by an immediate capital letter - the two shapes TSK actually uses. A
 * phrase with neither comes back whole, with `aside: null`.
 */
export function splitTskPhrase(phrase: string): SplitPhrase {
  if (!phrase || phrase.length < MIN_SPLITTABLE_LENGTH) return { keyword: phrase, aside: null };

  for (let i = MIN_KEYWORD_LENGTH; i < phrase.length - MIN_ASIDE_LENGTH; i++) {
    if (phrase[i] !== '.') continue;

    // "thou mayest freely eat.  Heb. eating thou shalt eat."
    if (phrase[i + 1] === ' ' && phrase[i + 2] === ' ') {
      let start = i + 1;
      while (start < phrase.length && phrase[start] === ' ') start++;
      const aside = phrase.substring(start);
      if (aside.length >= MIN_ASIDE_LENGTH) return { keyword: phrase.substring(0, i), aside };
      continue;
    }

    // "locusts.The word {arbeh,}..."
    if (phrase[i + 1] >= 'A' && phrase[i + 1] <= 'Z') {
      const aside = phrase.substring(i + 1);
      if (aside.length >= MIN_ASIDE_LENGTH) return { keyword: phrase.substring(0, i), aside };
    }
  }

  return { keyword: phrase, aside: null };
}

/**
 * The display keyword for a phrase: split, then with trailing periods trimmed.
 *
 * TSK terminates most phrases with a period ("Yea."). The renderer supplies its
 * own punctuation, so keeping theirs produces "Yea..".
 */
export function tskPhraseKeyword(phrase: string): string {
  return splitTskPhrase(phrase.replace(/\.+$/, '')).keyword.replace(/\.+$/, '');
}

/** The aside for a phrase, trailing periods trimmed, or null when there is none. */
export function tskPhraseAside(phrase: string): string | null {
  const aside = splitTskPhrase(phrase.replace(/\.+$/, '')).aside;
  return aside === null ? null : aside.replace(/\.+$/, '');
}

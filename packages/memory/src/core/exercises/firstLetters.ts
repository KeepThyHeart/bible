/**
 * First letters - the shared third and last rung.
 *
 * Every word is reduced to its initial and the user types the verse back in
 * full. It is the closest thing to unaided recitation the extension can grade,
 * which is why it sits at the top of both ladders.
 *
 * ## There are no tiers
 *
 * This is worth stating plainly because an earlier design had two mechanisms
 * here and BOTH were cut:
 *
 *   - a staged partial reveal, where a struggling user got the first two
 *     letters, then three, and so on; and
 *   - a capitalisation tier, where the initial's case was progressively
 *     normalised away to remove the sentence-boundary hint.
 *
 * Neither exists. A correct answer reveals the WHOLE word, always, and there
 * is no state anywhere in this module that could stage anything - no tier
 * parameter, no level, no per-word reveal depth. That absence is deliberate:
 * a staged reveal makes the score depend on how much help was taken, and
 * `AttemptRow.score` has nowhere to record that, so two attempts scoring 0.8
 * would silently mean different things.
 *
 * The initial is shown with the capitalisation the text prints, for the same
 * reason `normalize.ts` ignores case when grading: the case is the
 * typesetter's, so it may be displayed but must never be marked.
 */

import type { StepResult, VerseText } from '../types';
import { stripEdgePunctuation, wordsMatch } from './normalize';

/**
 * The first letter of each word, aligned one-to-one with `verse.words`.
 *
 * Punctuation is handled by taking the initial of the word's *content* rather
 * than of the raw token: an opening quotation mark, a bracket or a pilcrow
 * would otherwise be shown as the cue for the word behind it, and `"` is not a
 * hint about anything. Trailing punctuation never mattered here, but it is
 * removed by the same call.
 *
 * A token with no content at all (a stray `--` in a module's text) yields
 * `''`. The panel renders an empty cue; grading falls through to `wordsMatch`,
 * which handles the same case on its own terms.
 */
export function initials(verse: VerseText): string[] {
  const words = verse.words;
  if (!words) return [];
  return words.map((word) => {
    const content = stripEdgePunctuation(word);
    // Not `content[0]`: an initial outside the Basic Multilingual Plane is a
    // surrogate pair, and half a surrogate pair renders as a replacement box.
    for (const ch of content) return ch;
    return '';
  });
}

/**
 * Grade a submitted first-letters step.
 *
 * Whole-word comparison, one entry per word in the verse. There is no credit
 * for producing the right initial - the initial was given.
 *
 * Not blocking: like `blanks`, the user submits once and moves on. Unlike the
 * picker, there is nothing here that a retry would resolve; a user who cannot
 * recall the word will not recall it on the second click either, and the
 * card's schedule is the mechanism for bringing it back.
 *
 * @param typed  One answer per word, positionally aligned with `verse.words`.
 *   A short array counts the remaining words wrong - the user stopped, and
 *   stopping is a recall failure, not a missing measurement.
 *
 * @returns `wrong` holds indices into `verse.words`. `reveal.words` is the
 *   whole verse, which is also the whole answer.
 */
export function gradeFirstLetters(verse: VerseText, typed: string[]): StepResult {
  const words = verse.words || [];
  const wrong: number[] = [];

  for (let i = 0; i < words.length; i += 1) {
    const given = i < typed.length ? typed[i] : '';
    if (!wordsMatch(given, words[i])) wrong.push(i);
  }

  return {
    correct: wrong.length === 0,
    wrong,
    blocking: false,
    reveal: { words: words.slice() },
  };
}

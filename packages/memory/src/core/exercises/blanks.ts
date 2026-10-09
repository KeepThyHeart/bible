/**
 * Fill in the missing words - the shared second rung.
 *
 * The whole exercise lives or dies on WHICH words are hidden. Two failure
 * modes are easy to fall into and this file is shaped to avoid both:
 *
 *   - **Blanking uniformly at random** hides "the", "of" and "a" in proportion
 *     to how common they are, which is very often. Typing "the" into a gap is
 *     not recall, it is grammar, and a step made mostly of those feels like
 *     busywork while reporting a high score. It measures nothing and it is
 *     boring, which is the worse of the two problems.
 *   - **Excluding function words entirely** overcorrects. Some function words
 *     are genuinely the hard part - "nor" versus "and" in Psalm 1:1, "in"
 *     versus "into" - and a user who learns that short words are never tested
 *     stops attending to them, which is exactly the sloppiness the rung exists
 *     to catch.
 *
 * So function words are down-weighted, not banned: rare rather than
 * impossible. See `weightFor`.
 *
 * The other rule is adjacency, documented on `MAX_BLANK_RUN`.
 */

import type { StepResult, VerseText } from '../types';
import { normalizeWord, wordsMatch } from './normalize';
import { mulberry32, seedFrom, weightedPick, type Rng } from './rng';

/**
 * Fraction of words hidden at `difficulty` 0 and 1 respectively.
 *
 * The floor is not zero. A step with no blanks is not an easy exercise, it is
 * a non-exercise, and `difficulty` 0 has to still ask the user for something.
 * The ceiling stops short of what the adjacency rule would allow (2/3) because
 * a step that close to the limit is mostly determined by the constraint solver
 * rather than by the difficulty the user chose.
 */
export const MIN_BLANK_FRACTION = 0.15;
export const MAX_BLANK_FRACTION = 0.6;

/**
 * The adjacency rule: at most two blanks in a row, never three.
 *
 * A single blank is a cloze - the words on both sides carry it. A PAIR of
 * blanks is a real recall test and still anchored: "the ___ ___ of the LORD"
 * gives the user a phrase to reach for. A run of three or more removes the
 * local context entirely, at which point the user is not filling a gap, they
 * are reciting from memory with no cue - and reciting with no cue is a
 * different exercise, which is precisely what the `firstletters` rung above
 * this one is. Letting `blanks` drift into it would collapse two rungs of the
 * ladder into one and make the progression meaningless.
 */
export const MAX_BLANK_RUN = 2;

/**
 * Words that are cheap to guess from grammar alone.
 *
 * Deliberately includes the archaic pronouns and auxiliaries that dominate the
 * KJV ("thou", "hath", "unto"), because in that text they are as predictable
 * as "the" is in a modern one. It is a weighting hint, not a filter - see the
 * file header.
 */
const FUNCTION_WORDS = new Set([
  'a', 'all', 'am', 'an', 'and', 'any', 'are', 'art', 'as', 'at', 'be', 'been',
  'but', 'by', 'can', 'did', 'do', 'doth', 'down', 'for', 'from', 'had', 'has',
  'hast', 'hath', 'have', 'he', 'her', 'here', 'him', 'his', 'how', 'i', 'if',
  'in', 'into', 'is', 'it', 'its', 'me', 'mine', 'my', 'no', 'nor', 'not', 'o',
  'of', 'on', 'or', 'our', 'out', 'shall', 'she', 'should', 'so', 'some',
  'such', 'than', 'that', 'the', 'thee', 'their', 'them', 'then', 'there',
  'these', 'they', 'thine', 'this', 'those', 'thou', 'thy', 'to', 'unto', 'up',
  'upon', 'us', 'was', 'we', 'were', 'what', 'when', 'which', 'who', 'whom',
  'will', 'with', 'would', 'ye', 'yet', 'you', 'your',
]);

/** Weight for a function word or a one-or-two letter token. */
const WEIGHT_FUNCTION = 1;
/** Weight for an ordinary content word. */
const WEIGHT_CONTENT = 3;
/** Weight for a long content word - the most worth testing. */
const WEIGHT_LONG_CONTENT = 5;
/** Length at which a content word counts as long. */
const LONG_WORD_LENGTH = 6;

/**
 * How likely a word is to be chosen as a blank, relative to its neighbours.
 *
 * Returns 0 only for a token with no word content at all (a stray pilcrow),
 * which cannot be blanked because there would be nothing to type into the gap.
 */
function weightFor(word: string): number {
  const normalized = normalizeWord(word);
  if (normalized === '') return 0;
  if (normalized.length <= 2) return WEIGHT_FUNCTION;
  if (FUNCTION_WORDS.has(normalized)) return WEIGHT_FUNCTION;
  return normalized.length >= LONG_WORD_LENGTH ? WEIGHT_LONG_CONTENT : WEIGHT_CONTENT;
}

/** Would adding `index` to `chosen` create a run longer than MAX_BLANK_RUN? */
function createsOverlongRun(chosen: Set<number>, index: number): boolean {
  let run = 1;
  for (let i = index - 1; chosen.has(i); i -= 1) run += 1;
  for (let i = index + 1; chosen.has(i); i += 1) run += 1;
  return run > MAX_BLANK_RUN;
}

/**
 * Choose which words to hide.
 *
 * @param verse  The verse being practised.
 * @param difficulty  0..1, mapped onto MIN_BLANK_FRACTION..MAX_BLANK_FRACTION.
 *   Values outside the range are clamped rather than rejected: a caller that
 *   computed 1.02 from a slider should get the hardest step, not an exception
 *   mid-session.
 * @param rng  Injected for reproducibility. The default is seeded from the
 *   verse id and the difficulty, so the same card at the same difficulty
 *   always blanks the same words - a user who submits, sees what they missed
 *   and immediately practises again gets to close that specific gap instead of
 *   being handed a fresh set of holes. See `rng.ts`.
 *
 * @returns Indices into `verse.words`, ascending.
 */
export function selectBlanks(
  verse: VerseText,
  difficulty: number,
  rng: Rng = mulberry32(seedFrom(verse.verseId, Math.round(clamp01(difficulty) * 1000))),
): number[] {
  const words = verse.words;
  if (!words || words.length === 0) return [];

  // Eligible = has something to type. Punctuation-only tokens are excluded
  // here rather than given weight 0 and filtered later, so that the target
  // count below is a fraction of *blankable* words, not of raw tokens.
  const eligible: number[] = [];
  const weights: number[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const weight = weightFor(words[i]);
    if (weight > 0) {
      eligible.push(i);
      weights.push(weight);
    }
  }
  if (eligible.length === 0) return [];

  const fraction =
    MIN_BLANK_FRACTION + clamp01(difficulty) * (MAX_BLANK_FRACTION - MIN_BLANK_FRACTION);
  // At least one blank, always: see MIN_BLANK_FRACTION.
  const target = Math.min(
    eligible.length,
    Math.max(1, Math.round(eligible.length * fraction)),
  );

  const chosen = new Set<number>();
  // A live copy of the weights; picking sets an entry to 0 to remove it,
  // which keeps the index alignment with `eligible` intact.
  const live = weights.slice();

  while (chosen.size < target) {
    const slot = weightedPick(live, rng);
    if (slot < 0) break; // Nothing selectable left.
    live[slot] = 0;

    const index = eligible[slot];
    // Once a word is blocked by the adjacency rule it stays blocked: choosing
    // more blanks elsewhere can only lengthen runs, never shorten them. So a
    // rejected candidate is dropped rather than reconsidered, and the loop
    // always terminates.
    if (createsOverlongRun(chosen, index)) continue;
    chosen.add(index);
  }

  // The result can fall short of `target` when the adjacency rule blocks the
  // remaining candidates. That is the correct outcome - the constraint is a
  // hard rule about what makes a usable exercise, and the difficulty is a
  // request. Better a slightly easier step than an unrecallable one.
  return Array.from(chosen).sort((a, b) => a - b);
}

/**
 * Grade a submitted blanks step.
 *
 * NOT blocking, unlike the picker. The user submits once, sees which gaps they
 * missed alongside the right answers, and moves on; the card's schedule is
 * what brings the missed words back, not an in-session retry loop. Drilling
 * the same gap until it is right within one sitting produces a score that
 * measures persistence rather than recall.
 *
 * @param typed  Answers positionally aligned with `blankIndices` - `typed[k]`
 *   is the answer for `blankIndices[k]`. A short array means the user left the
 *   remaining gaps empty, which counts as wrong rather than as unanswered:
 *   there is no third state in the score.
 *
 * @returns `wrong` holds indices into `verse.words` (the same space as
 *   `blankIndices` and `BlanksStep.blankIndices`), NOT positions within
 *   `typed`. The panel needs to highlight a word in the rendered verse, and
 *   translating back from a position would put that mapping in two places.
 */
export function gradeBlanks(
  verse: VerseText,
  blankIndices: number[],
  typed: string[],
): StepResult {
  const wrong: number[] = [];
  const answers: string[] = [];

  for (let k = 0; k < blankIndices.length; k += 1) {
    const index = blankIndices[k];
    const target = verse.words[index];
    if (target === undefined) {
      // A blank index outside the verse: a bug upstream. Skip it rather than
      // marking the user wrong for a gap that does not exist.
      continue;
    }
    answers.push(target);
    const given = k < typed.length ? typed[k] : '';
    if (!wordsMatch(given, target)) wrong.push(index);
  }

  return {
    correct: wrong.length === 0,
    wrong,
    blocking: false,
    // Revealed unconditionally, because the step is over either way and seeing
    // the right words is the point of submitting. In blank order, so the panel
    // can pair `reveal.words[k]` with `blankIndices[k]`.
    reveal: { words: answers },
  };
}

/** Clamp to 0..1, mapping NaN to 0 rather than propagating it into the count. */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

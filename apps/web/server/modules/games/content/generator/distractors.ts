/**
 * Wrong answers that are worth offering.
 *
 * A multiple-choice question is only as good as its wrong answers. "Who built
 * the ark? Noah, Timothy, Esther, Pontius Pilate" is not a question, it is a
 * reading test. The wrong answers that make a group argue are the ones that
 * *could* have been right: another patriarch, another man of the same era,
 * another prophet.
 *
 * So every candidate is scored by how much it resembles the true answer, and
 * the ordering matters as much as the choice. The first three are the most
 * plausible — they are the standard set a round shows — and the rest are drawn
 * from a little further down the ranking, so a question replayed in the same
 * evening does not offer the same four names twice.
 *
 * Two kinds of candidate are never offered, whatever their score:
 *
 * - one the answer matcher would credit as the answer. A typed round compares
 *   with an edit budget, and a distractor inside that budget is a wrong answer
 *   the game would mark right.
 * - one the round already names. "Saul, Saul, why persecutest thou me?" with
 *   Paul among the options is a joke, and a clue that mentions Aaron makes
 *   Aaron a giveaway rather than a distractor.
 */

import { matchAnswer } from '../../../../../src/modules/games/shared/answers/match.js';
import { normaliseWords } from '../../../../../src/modules/games/shared/answers/normalise.js';
import { BOOK_COUNT, bookName, isOldTestament, sectionOf } from '../../../../../src/modules/games/shared/verseId.js';
import { PREFERRED_DISTRACTOR_COUNT, STANDARD_DISTRACTOR_COUNT, contentKey } from '../ContentDatabase.js';
import { ERAS } from './sources.js';
import type { Era, Person, Place } from './sources.js';

/**
 * How far past the standard three the variety tail reaches. Far enough that
 * repeat plays differ, near enough that the tail is still made of names that
 * belong in the same breath as the answer.
 */
export const TAIL_REACH = 12;

/** Something that could be offered, and how much it resembles the answer. */
export interface Candidate {
  name: string;
  accept: readonly string[];
  score: number;
}

export interface Answer {
  name: string;
  accept: readonly string[];
}

export interface PickRequest {
  answer: Answer;
  candidates: readonly Candidate[];
  /** Text the round shows. A candidate named in it is never offered. */
  shown: readonly string[];
  random: () => number;
  /** Defaults to the preferred count. */
  count?: number;
}

const FIRST_NEW_TESTAMENT_ERA = ERAS.indexOf('gospels');

function isOldTestamentEra(era: Era): boolean {
  return ERAS.indexOf(era) < FIRST_NEW_TESTAMENT_ERA;
}

/**
 * Outweighs everything else a candidate can score, so it partitions the pool
 * rather than tilting it: the other side is reached only once this side runs
 * out.
 */
const DOMINANT = 20;

/** Enough that a question about a prophet offers prophets before bystanders of the same era. */
const SHARED_ROLE = 3;

/**
 * Resemblance between two people. The weights are the whole tuning surface.
 *
 * Sex dominates, because a woman offered for a man is the easiest elimination
 * there is — most prompts and clues say which it is. Then era, because people
 * of the same story are the ones a group genuinely mixes up; then roles in
 * common; then being about as well known.
 */
export function personLikeness(answer: Person, other: Person): number {
  let score = 0;
  if (other.sex === answer.sex) score += DOMINANT;
  const gap = Math.abs(ERAS.indexOf(other.era) - ERAS.indexOf(answer.era));
  score += Math.max(0, 4 - 2 * gap);
  if (isOldTestamentEra(other.era) === isOldTestamentEra(answer.era)) score += 3;
  for (const role of other.roles) {
    if (answer.roles.includes(role)) score += SHARED_ROLE;
  }
  if (Math.abs(other.difficulty - answer.difficulty) <= 1) score += 1;
  return score;
}

/** Kind dominates for the same reason sex does: a city is no answer to which pool. */
export function placeLikeness(answer: Place, other: Place): number {
  let score = 0;
  if (other.kind === answer.kind) score += DOMINANT;
  if (other.testament === answer.testament) score += 3;
  if (Math.abs(other.difficulty - answer.difficulty) <= 1) score += 1;
  return score;
}

/** Books of the same section, then of the same testament, then near neighbours. */
export function bookLikeness(answer: number, other: number): number {
  let score = 0;
  if (sectionOf(other) === sectionOf(answer)) score += 4;
  if (isOldTestament(other) === isOldTestament(answer)) score += 3;
  if (Math.abs(other - answer) <= 3) score += 1;
  return score;
}

export function peopleLike(answer: Person, people: readonly Person[]): Candidate[] {
  return sameSide(
    people
      .filter((other) => contentKey(other.name) !== contentKey(answer.name))
      .map((other) => ({ name: other.name, accept: other.accept, score: personLikeness(answer, other) }))
  );
}

export function placesLike(answer: Place, places: readonly Place[]): Candidate[] {
  return sameSide(
    places
      .filter((other) => contentKey(other.name) !== contentKey(answer.name))
      .map((other) => ({ name: other.name, accept: other.accept, score: placeLikeness(answer, other) }))
  );
}

/**
 * Only the candidates on the answer's side of the dominant split, whenever
 * there are enough of them to fill a round. Otherwise the variety tail reaches
 * across once the near side runs short, and offers Rome as the name of a pool.
 * Fewer wrong answers is the better failure: a repeat play sees the same four
 * options, rather than one nobody would pick.
 */
function sameSide(candidates: Candidate[]): Candidate[] {
  const near = candidates.filter((candidate) => candidate.score >= DOMINANT);
  return near.length >= STANDARD_DISTRACTOR_COUNT ? near : candidates;
}

export function booksLike(answer: number): Candidate[] {
  const candidates: Candidate[] = [];
  for (let book = 1; book <= BOOK_COUNT; book += 1) {
    if (book === answer) continue;
    candidates.push({ name: bookName(book), accept: [], score: bookLikeness(answer, book) });
  }
  return candidates;
}

/**
 * The wrong answers for one question, most plausible first.
 *
 * Ties are broken by the caller's generator rather than by input order, so two
 * candidates that resemble the answer equally take turns across questions
 * instead of the one listed first always winning.
 */
export function pickDistractors(request: PickRequest): string[] {
  const count = request.count ?? PREFERRED_DISTRACTOR_COUNT;
  const shown = request.shown.map(normaliseWords);

  const ranked = request.candidates
    .filter((candidate) => !creditedAs(candidate, request.answer) && !namedIn(candidate, shown))
    .map((candidate) => ({ candidate, jitter: request.random() }))
    .sort((a, b) => b.candidate.score - a.candidate.score || a.jitter - b.jitter)
    .map((entry) => entry.candidate.name);

  const leading = ranked.slice(0, Math.min(STANDARD_DISTRACTOR_COUNT, count));
  const tail = ranked.slice(leading.length, leading.length + TAIL_REACH);
  return [...leading, ...sampleInOrder(tail, count - leading.length, request.random)];
}

/**
 * True when either side would be marked right for the other. Both directions
 * are asked because the matcher's edit budget comes from the accepted answer,
 * so a long name can absorb a short one that the short one cannot absorb back.
 */
export function creditedAs(candidate: Answer, answer: Answer): boolean {
  for (const form of [candidate.name, ...candidate.accept]) {
    if (matchAnswer(form, answer.name, answer.accept).matched) return true;
  }
  for (const form of [answer.name, ...answer.accept]) {
    if (matchAnswer(form, candidate.name, candidate.accept).matched) return true;
  }
  return false;
}

/** True when any form of the candidate's name appears, as whole words, in shown text. */
export function namedIn(candidate: Answer, shown: readonly (readonly string[])[]): boolean {
  for (const form of [candidate.name, ...candidate.accept]) {
    const words = normaliseWords(form);
    if (words.length === 0) continue;
    if (shown.some((text) => containsRun(text, words))) return true;
  }
  return false;
}

/**
 * True when `phrase` appears in `text` word for word, once both are reduced to
 * the form the answer matcher compares — so punctuation, case and curly
 * quotes cannot make a verbatim quotation look misquoted.
 */
export function mentions(text: string, phrase: string): boolean {
  const needle = normaliseWords(phrase);
  return needle.length > 0 && containsRun(normaliseWords(text), needle);
}

function containsRun(haystack: readonly string[], needle: readonly string[]): boolean {
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (needle.every((word, offset) => haystack[start + offset] === word)) return true;
  }
  return false;
}

/** `wanted` items drawn without replacement, returned in their original order. */
function sampleInOrder<T>(items: readonly T[], wanted: number, random: () => number): T[] {
  if (wanted <= 0) return [];
  if (wanted >= items.length) return [...items];
  const indices = items.map((_, index) => index);
  for (let index = 0; index < wanted; index += 1) {
    const swap = index + Math.floor(random() * (indices.length - index));
    const held = indices[index] as number;
    indices[index] = indices[swap] as number;
    indices[swap] = held;
  }
  return indices
    .slice(0, wanted)
    .sort((a, b) => a - b)
    .map((index) => items[index] as T);
}

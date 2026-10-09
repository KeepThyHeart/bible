/**
 * Which saying a round asks about.
 *
 * Two promises pull against each other here, and the order they are kept in is
 * the decision:
 *
 * 1. **No saying is asked twice in one game.** A quotation is recognised faster
 *    the second time it appears, and "Am I my brother's keeper?" twice in ten
 *    rounds is a round nobody had to think about.
 * 2. **The room's familiarity caps how obscure a saying may be**, meaning what
 *    it means for verses: `core` asks only the lines everyone knows, `any`
 *    asks anything.
 *
 * The capped pool is small — a handful of sayings are well known enough for
 * `core` — so a long game at a low ceiling runs out, and one promise has to
 * give. The ceiling gives, by as little as it can: the next saying comes from
 * the easiest tier that still has one unasked. The verse pool faces the same
 * choice and allows a repeat, but a repeated verse is a new question when a
 * different word is blanked, and a repeated saying is simply the same question.
 */

import type { QuestionRecord } from '../../content/index.js';

/** Items this game reads are tagged for it, and the tag is the whole of the query. */
export const WHO_SAID_IT_TAG = 'who-said-it';

function pickOne<T>(items: readonly T[], random: () => number): T | null {
  if (items.length === 0) return null;
  return items[Math.min(Math.floor(random() * items.length), items.length - 1)] ?? null;
}

/**
 * One saying from `candidates`, or null when every one has been asked.
 *
 * `ceiling` is the highest difficulty the room will take, or null for no cap.
 * `candidates` should arrive in a stable order — the library returns them by
 * id — so that the same generator draws the same saying.
 */
export function chooseQuestion(
  candidates: readonly QuestionRecord[],
  asked: ReadonlySet<string>,
  ceiling: number | null,
  random: () => number
): QuestionRecord | null {
  const fresh = candidates.filter((question) => !asked.has(question.id));
  const within =
    ceiling === null ? fresh : fresh.filter((question) => question.difficulty <= ceiling);
  if (within.length > 0) return pickOne(within, random);

  // Past the ceiling, stay as close to it as the content allows.
  const nearest = fresh.reduce(
    (lowest, question) => Math.min(lowest, question.difficulty),
    Number.POSITIVE_INFINITY
  );
  return pickOne(
    fresh.filter((question) => question.difficulty === nearest),
    random
  );
}

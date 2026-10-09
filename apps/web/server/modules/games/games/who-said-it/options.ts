/**
 * Which three wrong answers go up beside the speaker.
 *
 * A question arrives with its wrong answers ranked, most plausible first, and
 * eight or more of them. The first three are the ones worth asking: Rebekah
 * against Sarah is a question, Goliath against Sarah is not. But a group that
 * plays the same evening twice, or next week, remembers four names as a set
 * before it remembers a quotation, and a round that offers the same four again
 * is answered from memory of the round rather than of the Bible.
 *
 * So each of the three leading slots usually keeps its leader and occasionally
 * gives it up to a name from the tail. The tail exists for exactly this; it is
 * never the whole of a round, because a round made only of the least plausible
 * names is an easy round, and difficulty is the content's job, not the dice's.
 */

/** The answer plus three: enough that a guess is worth little, few enough to read from the back. */
export const DISTRACTORS_OFFERED = 3;

/**
 * How often one leading slot is handed to the tail. At a quarter, all three
 * leaders survive a little under half the time and at least two survive about
 * five times in six — mostly the best round, never quite the same one.
 */
export const TAIL_CHANCE = 0.25;

/** A draw that never lands past the end, whatever the generator returns. */
function indexBelow(count: number, random: () => number): number {
  return Math.min(Math.floor(random() * count), count - 1);
}

export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const list = [...items];
  for (let index = list.length - 1; index > 0; index -= 1) {
    const swap = indexBelow(index + 1, random);
    const held = list[index] as T;
    list[index] = list[swap] as T;
    list[swap] = held;
  }
  return list;
}

/**
 * Three wrong answers from a ranked list, leaders preferred.
 *
 * A list shorter than three yields what it has: the importer refuses such a
 * question for multiple choice, but a round with three options is better than
 * no round if one ever gets through.
 */
export function chooseDistractors(ranked: readonly string[], random: () => number): string[] {
  const leading = ranked.slice(0, DISTRACTORS_OFFERED);
  const tail = shuffled(ranked.slice(DISTRACTORS_OFFERED), random);
  return leading.map((leader) => {
    if (tail.length === 0 || random() >= TAIL_CHANCE) return leader;
    return tail.shift() as string;
  });
}

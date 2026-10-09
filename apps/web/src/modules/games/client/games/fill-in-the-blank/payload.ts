/**
 * The shapes this game puts on the wire, as the client expects to find them.
 *
 * The seam hands views an `unknown` payload on purpose: the shell must not
 * know what any game sends, and shared code is not the place to describe one
 * game's private message. So the server declares these shapes and the client
 * declares them again, and the wire is the contract between the two.
 *
 * That is also why they are narrowed rather than cast. A phone that has cached
 * an older bundle can be handed a payload it does not recognise, and rendering
 * "nothing to show" beats rendering `undefined` across a projector.
 */

/** Stable identifier for this game, matching the server module's. */
export const GAME_ID = 'fill-in-the-blank';

/** What both screens are given while the round is live, reference included. */
export interface BlankPrompt {
  /** Book, chapter and verse, e.g. "John 3:16". Empty when there is no verse. */
  reference: string;
  text: string;
  /** The marker standing in for the missing word, so it can be styled apart. */
  blank: string;
}

/** What the reveal draws, once the answers are in. */
export interface BlankReveal {
  reference: string;
  word: string;
  /** The verse either side of the word, so it can be highlighted in place. */
  before: string;
  after: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function asPrompt(view: unknown): BlankPrompt | null {
  if (!isRecord(view)) return null;
  const { text, blank, reference } = view;
  if (typeof text !== 'string' || typeof blank !== 'string' || blank === '') return null;
  // A server from before the reference travelled with the prompt is still a
  // server this phone must survive, so a missing one is empty rather than a
  // reason to refuse the whole payload.
  return { text, blank, reference: typeof reference === 'string' ? reference : '' };
}

export function asReveal(detail: unknown): BlankReveal | null {
  if (!isRecord(detail)) return null;
  const { reference, word, before, after } = detail;
  if (typeof reference !== 'string' || typeof word !== 'string') return null;
  if (typeof before !== 'string' || typeof after !== 'string') return null;
  return { reference, word, before, after };
}

/**
 * A round the server could not build a question for — no Bible module
 * installed. The prompt is well formed and simply has no verse in it.
 */
export function hasVerse(prompt: BlankPrompt | null): prompt is BlankPrompt {
  return prompt !== null && prompt.text !== '';
}

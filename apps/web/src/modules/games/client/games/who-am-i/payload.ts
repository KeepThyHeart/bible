/**
 * Reading what the server sent, rather than trusting it.
 *
 * A view payload arrives as `unknown`, and it genuinely can be: a phone that
 * loaded yesterday's bundle, a room whose game changed under a screen that was
 * asleep, a round the server had no person to build from. Each is read into a
 * shape or into null, and a null draws a line of plain text instead of
 * throwing in front of a group.
 *
 * The shapes are declared here as well as on the server on purpose. What passes
 * between the two is the wire, not a type.
 */

export const GAME_ID = 'who-am-i';

/** Server-paced in a group, so clue two means the same moment on every phone. */
export type Pacing = 'server' | 'player';

export interface WhoAmIOption {
  index: number;
  label: string;
}

export interface WhoAmIRound {
  pacing: Pacing;
  clues: string[];
  options: WhoAmIOption[];
  clueIntervalMs: number;
  /** Subtracted from the room's deadline, it gives the moment clue one appeared. */
  answerWindowMs: number;
  /** True when teams are voting together, so the screens explain that instead. */
  groupVote: boolean;
}

export interface RevealClue {
  text: string;
  reference: string | null;
  gotIt: number;
  points: number;
}

export interface WhoAmIReveal {
  person: string;
  clues: RevealClue[];
  options: string[];
  correctIndex: number;
  gotIt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringAt(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' ? value : null;
}

function numberAt(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positiveAt(source: Record<string, unknown>, key: string): number | null {
  const value = numberAt(source, key);
  return value !== null && value > 0 ? value : null;
}

export function readRound(view: unknown): WhoAmIRound | null {
  if (!isRecord(view)) return null;
  const clues = (Array.isArray(view['clues']) ? view['clues'] : []).filter(
    (clue): clue is string => typeof clue === 'string' && clue.length > 0
  );
  const clueIntervalMs = positiveAt(view, 'clueIntervalMs');
  const answerWindowMs = positiveAt(view, 'answerWindowMs');
  if (clues.length === 0 || clueIntervalMs === null || answerWindowMs === null) return null;

  const options: WhoAmIOption[] = [];
  for (const entry of Array.isArray(view['options']) ? view['options'] : []) {
    if (!isRecord(entry)) continue;
    const index = numberAt(entry, 'index');
    const label = stringAt(entry, 'label');
    if (index === null || label === null) continue;
    options.push({ index, label });
  }
  // A question with nothing to tap is not a question this game can ask.
  if (options.length === 0) return null;

  return {
    // Anything but an explicit hand-over to the player is the room's clock: the
    // comparable pace is the safe reading of a payload that does not say.
    pacing: view['pacing'] === 'player' ? 'player' : 'server',
    clues,
    options,
    clueIntervalMs,
    answerWindowMs,
    // Only an explicit true: a payload that does not say is the normal game.
    groupVote: view['groupVote'] === true,
  };
}

export function readReveal(detail: unknown): WhoAmIReveal | null {
  if (!isRecord(detail)) return null;
  const person = stringAt(detail, 'person');
  if (person === null || person.length === 0) return null;

  const clues: RevealClue[] = [];
  for (const entry of Array.isArray(detail['clues']) ? detail['clues'] : []) {
    if (!isRecord(entry)) continue;
    const text = stringAt(entry, 'text');
    if (text === null) continue;
    clues.push({
      text,
      reference: stringAt(entry, 'reference'),
      gotIt: numberAt(entry, 'gotIt') ?? 0,
      points: numberAt(entry, 'points') ?? 0,
    });
  }

  const options = (Array.isArray(detail['options']) ? detail['options'] : []).filter(
    (option): option is string => typeof option === 'string'
  );

  return {
    person,
    clues,
    options,
    correctIndex: numberAt(detail, 'correctIndex') ?? -1,
    gotIt: numberAt(detail, 'gotIt') ?? clues.reduce((total, clue) => total + clue.gotIt, 0),
  };
}

/** How the options are lettered, on both screens, so they can be said aloud. */
export const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

export function letterFor(index: number): string {
  return OPTION_LETTERS[index] ?? String(index + 1);
}

/**
 * The reverse of `letterFor`, for a keyboard answer: `a`/`b`/`c`/`d`/`e`/`f`,
 * either case. Anything else — a letter past the options actually offered, a
 * digit, a modifier key's own name — is not one of the lettered options, so
 * it answers nothing rather than guessing what was meant.
 */
export function indexForLetter(key: string): number | null {
  const index = OPTION_LETTERS.indexOf(key.toUpperCase() as (typeof OPTION_LETTERS)[number]);
  return index === -1 ? null : index;
}

/** The server's scale, repeated so a screen can say what the current clue is worth. */
export const MAX_CLUES = 5;
export const ROUND_POINTS = 100;

/**
 * What a right answer at this clue earns: full points at the first, a fifth at
 * the fifth. Shown as a caption only — the server does the scoring, and a
 * screen that disagreed with it would be wrong rather than authoritative.
 */
export function worthAt(clue: number): number {
  const seen = Math.min(MAX_CLUES, Math.max(1, Math.trunc(clue)));
  return Math.round((ROUND_POINTS * (MAX_CLUES - seen + 1)) / MAX_CLUES);
}

/**
 * Reading what the server sent, rather than trusting it.
 *
 * A view payload arrives as `unknown`, and it genuinely can be: a phone that
 * loaded yesterday's bundle, a room whose game changed under a screen that was
 * asleep, a round the server had nothing to build from. Every one of those ends
 * as a screen in front of a group, so each is read into a shape or into null,
 * and a null draws a line of plain text instead of throwing in a render.
 *
 * The shapes are declared here as well as on the server on purpose. What passes
 * between the two is the wire, not a type: the phone must survive a payload the
 * current server would never send, and it can only do that by checking.
 */

export type AnswerShape = 'choice' | 'reference';

/** How far a wrong option was drawn from the true reference. */
export type Distance = 'chapter' | 'book' | 'section' | 'testament' | 'anywhere';

/** The rung every wrong option was drawn from this round — this game's one difficulty knob. */
export type Closeness = Distance;

/** What an unrecognised value falls back to: the room's own default. */
export const DEFAULT_CLOSENESS: Closeness = 'section';

export interface ReferenceOption {
  index: number;
  label: string;
}

export interface Question {
  answerShape: AnswerShape;
  closeness: Closeness;
  translation: string;
  text: string;
  /** Empty for a typed round, where the phone offers a picker instead. */
  options: ReferenceOption[];
}

export interface RevealedOption {
  label: string;
  distance: Distance | null;
  correct: boolean;
}

export interface RevealDetail {
  answerShape: AnswerShape;
  reference: string;
  text: string;
  translation: string;
  options: RevealedOption[];
  credit: { exact: number; bookAndChapter: number; book: number };
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

function shapeAt(source: Record<string, unknown>): AnswerShape | null {
  const value = source['answerShape'];
  return value === 'choice' || value === 'reference' ? value : null;
}

function isDistance(value: unknown): value is Distance {
  return (
    value === 'chapter' ||
    value === 'book' ||
    value === 'section' ||
    value === 'testament' ||
    value === 'anywhere'
  );
}

function closenessAt(source: Record<string, unknown>): Closeness {
  const value = source['closeness'];
  // A closeness is a caption here, not a rule, so an unrecognised one is
  // worth less than the screen it would otherwise take down.
  return isDistance(value) ? value : DEFAULT_CLOSENESS;
}

export function readQuestion(view: unknown): Question | null {
  if (!isRecord(view)) return null;
  const answerShape = shapeAt(view);
  const text = stringAt(view, 'text');
  if (answerShape === null || text === null) return null;

  const options: ReferenceOption[] = [];
  for (const entry of Array.isArray(view['options']) ? view['options'] : []) {
    if (!isRecord(entry)) continue;
    const index = numberAt(entry, 'index');
    const label = stringAt(entry, 'label');
    if (index === null || label === null) continue;
    options.push({ index, label });
  }

  return {
    answerShape,
    closeness: closenessAt(view),
    translation: stringAt(view, 'translation') ?? '',
    text,
    options,
  };
}

function distanceAt(source: Record<string, unknown>): Distance | null {
  const value = source['distance'];
  return isDistance(value) ? value : null;
}

export function readDetail(detail: unknown): RevealDetail | null {
  if (!isRecord(detail)) return null;
  const answerShape = shapeAt(detail);
  const reference = stringAt(detail, 'reference');
  if (answerShape === null || reference === null || reference.length === 0) return null;

  const options: RevealedOption[] = [];
  for (const entry of Array.isArray(detail['options']) ? detail['options'] : []) {
    if (!isRecord(entry)) continue;
    const label = stringAt(entry, 'label');
    if (label === null) continue;
    options.push({ label, distance: distanceAt(entry), correct: entry['correct'] === true });
  }

  const credit = isRecord(detail['credit']) ? detail['credit'] : {};
  return {
    answerShape,
    reference,
    text: stringAt(detail, 'text') ?? '',
    translation: stringAt(detail, 'translation') ?? '',
    options,
    credit: {
      exact: numberAt(credit, 'exact') ?? 0,
      bookAndChapter: numberAt(credit, 'bookAndChapter') ?? 0,
      book: numberAt(credit, 'book') ?? 0,
    },
  };
}

/** How the option buttons are lettered, on both screens, so they can be said aloud. */
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

/**
 * Why an option was hard, in words a host can say. Only the reveal shows these:
 * during the question they would be a strong hint.
 */
export const DISTANCE_CAPTIONS: Record<Distance, string> = {
  chapter: 'same chapter',
  book: 'same book',
  section: 'same part of the Bible',
  testament: 'same testament',
  anywhere: 'the other testament',
};

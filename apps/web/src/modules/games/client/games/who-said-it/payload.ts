/**
 * Reading what the server sent, rather than trusting it.
 *
 * A view payload arrives as `unknown`, and it genuinely can be: a phone that
 * loaded yesterday's bundle, a room whose game changed under a screen that was
 * asleep, a round the server had nothing to ask. Every one of those ends as a
 * screen in front of a group, so each is read into a shape or into null, and a
 * null draws a line of plain text instead of throwing in a render.
 *
 * The shapes are declared here as well as on the server on purpose. What passes
 * between the two is the wire, not a type: the phone must survive a payload the
 * current server would never send, and it can only do that by checking.
 */

export interface SpeakerOption {
  index: number;
  label: string;
}

export interface Question {
  quote: string;
  options: SpeakerOption[];
}

export interface RevealedSpeaker {
  label: string;
  correct: boolean;
}

export interface RevealDetail {
  speaker: string;
  quote: string;
  reference: string;
  listener: string | null;
  text: string;
  translation: string;
  options: RevealedSpeaker[];
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

function entriesAt(source: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = source[key];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/**
 * A question, or null. A question with no names to tap is null too: this game
 * has no other way to answer, so drawing it would be a screen of buttons that
 * are not there, which reads as broken rather than as empty.
 */
export function readQuestion(view: unknown): Question | null {
  if (!isRecord(view)) return null;
  const quote = stringAt(view, 'quote');
  if (quote === null || quote.trim().length === 0) return null;

  const options: SpeakerOption[] = [];
  for (const entry of entriesAt(view, 'options')) {
    const index = numberAt(entry, 'index');
    const label = stringAt(entry, 'label');
    if (index === null || label === null) continue;
    options.push({ index, label });
  }
  if (options.length === 0) return null;

  return { quote, options };
}

export function readDetail(detail: unknown): RevealDetail | null {
  if (!isRecord(detail)) return null;
  const speaker = stringAt(detail, 'speaker');
  if (speaker === null || speaker.length === 0) return null;

  const options: RevealedSpeaker[] = [];
  for (const entry of entriesAt(detail, 'options')) {
    const label = stringAt(entry, 'label');
    if (label === null) continue;
    options.push({ label, correct: entry['correct'] === true });
  }

  const listener = stringAt(detail, 'listener');
  return {
    speaker,
    quote: stringAt(detail, 'quote') ?? '',
    reference: stringAt(detail, 'reference') ?? '',
    listener: listener !== null && listener.length > 0 ? listener : null,
    text: stringAt(detail, 'text') ?? '',
    translation: stringAt(detail, 'translation') ?? '',
    options,
  };
}

/** How the names are lettered, on both screens, so they can be said aloud. */
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

/** `Genesis 22:7 · KJV`, or whichever half of it is known. */
export function citation(detail: RevealDetail): string {
  return [detail.reference, detail.translation].filter((part) => part.length > 0).join(' · ');
}

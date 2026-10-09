/**
 * Reading what the server sent, rather than trusting it.
 *
 * A view payload arrives as `unknown`, and it genuinely can be: a phone that
 * loaded yesterday's bundle, a room whose game changed under a screen that was
 * asleep, a round the server had no case to build from. Each is read into a
 * shape or into null, and a null draws a line of plain text instead of
 * throwing in front of a group.
 *
 * The shapes are declared here as well as on the server on purpose. What passes
 * between the two is the wire, not a type.
 */

import type { GroupResult, TeamId } from '../../../shared/protocol.js';

export const GAME_ID = 'detective';

export interface CaseOption {
  index: number;
  label: string;
}

/** The big screen during play: the public clue and the names. */
export interface HostCase {
  question: string;
  opening: string;
  options: CaseOption[];
}

/** One phone during play: its own clue, or word that it is in from the next case. */
export type PhoneCase =
  | { kind: 'clue'; clue: string; shared: boolean; options: CaseOption[] }
  | { kind: 'waiting' };

export type ClueWhere = 'screen' | 'phones' | 'undealt';

export interface RevealClue {
  text: string;
  reference: string | null;
  where: ClueWhere;
}

export interface CaseReveal {
  person: string;
  options: string[];
  correctIndex: number;
  clues: RevealClue[];
}

/** What every case asks, for a payload that does not say. */
export const DEFAULT_QUESTION = 'Who is the mystery person?';

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

function optionsAt(source: Record<string, unknown>): CaseOption[] {
  const options: CaseOption[] = [];
  for (const entry of Array.isArray(source['options']) ? source['options'] : []) {
    if (!isRecord(entry)) continue;
    const index = numberAt(entry, 'index');
    const label = stringAt(entry, 'label');
    if (index === null || label === null) continue;
    options.push({ index, label });
  }
  return options;
}

export function readHostCase(view: unknown): HostCase | null {
  if (!isRecord(view)) return null;
  const opening = stringAt(view, 'opening');
  const options = optionsAt(view);
  // A case with nothing to vote on is not a case this game can put up.
  if (opening === null || opening.length === 0 || options.length === 0) return null;
  return { question: stringAt(view, 'question') ?? DEFAULT_QUESTION, opening, options };
}

export function readPhoneCase(view: unknown): PhoneCase | null {
  if (!isRecord(view)) return null;
  if (view['waiting'] === true) return { kind: 'waiting' };
  const clue = stringAt(view, 'clue');
  const options = optionsAt(view);
  if (clue === null || clue.length === 0 || options.length === 0) return null;
  return { kind: 'clue', clue, shared: view['shared'] === true, options };
}

function whereAt(source: Record<string, unknown>): ClueWhere {
  const value = source['where'];
  // Anything unrecognised is read as dealt: it is the common case, and the
  // caption is a courtesy rather than a claim anybody's score depends on.
  return value === 'screen' || value === 'undealt' ? value : 'phones';
}

export function readReveal(detail: unknown): CaseReveal | null {
  if (!isRecord(detail)) return null;
  const person = stringAt(detail, 'person');
  if (person === null || person.length === 0) return null;

  const clues: RevealClue[] = [];
  for (const entry of Array.isArray(detail['clues']) ? detail['clues'] : []) {
    if (!isRecord(entry)) continue;
    const text = stringAt(entry, 'text');
    if (text === null) continue;
    clues.push({ text, reference: stringAt(entry, 'reference'), where: whereAt(entry) });
  }

  const options = (Array.isArray(detail['options']) ? detail['options'] : []).filter(
    (option): option is string => typeof option === 'string'
  );

  return { person, options, correctIndex: numberAt(detail, 'correctIndex') ?? -1, clues };
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

export const WHERE_CAPTIONS: Readonly<Record<ClueWhere, string>> = {
  screen: 'on the big screen',
  phones: 'dealt to phones',
  undealt: 'not dealt this time',
};

/**
 * The group a phone voted in: its own team with teams on, or the whole room.
 * Null when the reveal carries no groups, which a current server never sends
 * for this game but an older one might.
 */
export function groupOf(
  groups: readonly GroupResult[] | undefined,
  teamsEnabled: boolean,
  teamId: TeamId | null
): GroupResult | null {
  if (groups === undefined || groups.length === 0) return null;
  const wanted = teamsEnabled ? teamId : null;
  return groups.find((group) => group.teamId === wanted) ?? null;
}

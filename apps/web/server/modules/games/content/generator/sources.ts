/**
 * The facts the question generator works from.
 *
 * Questions are not written one by one. People, places, sayings, timelines and
 * board questions are written once, each with the verse it rests on, and the
 * generator turns them into rounds. That split is the point: a playtest that
 * finds the distractors too easy is fixed by changing how they are chosen and
 * regenerating, not by re-editing three hundred rows by hand.
 *
 * So this file is strict in a way the importer does not need to be. Every
 * saying must name a speaker the generator knows, because a speaker it cannot
 * describe is a speaker it cannot find plausible wrong answers for. Every board
 * question about a person must name a person on file, for the same reason.
 */

import { BOOK_NAMES, parseRef } from '../../../../../src/modules/games/shared/verseId.js';
import type { VerseId } from '../../../../../src/modules/games/shared/verseId.js';
import { MAX_DIFFICULTY, MIN_DIFFICULTY, contentKey } from '../ContentDatabase.js';

/**
 * Where in the story a person belongs, in story order. Adjacent eras make
 * plausible wrong answers for each other; distant ones do not — nobody
 * mistakes Moses for Timothy.
 */
export const ERAS = [
  'beginnings',
  'patriarchs',
  'exodus',
  'judges',
  'kingdom',
  'prophets',
  'exile',
  'gospels',
  'church',
] as const;

export type Era = (typeof ERAS)[number];

export type Sex = 'male' | 'female';

export type Testament = 'old' | 'new';

export type PlaceKind = 'city' | 'region' | 'mountain' | 'water' | 'site';

export const PLACE_KINDS: readonly PlaceKind[] = ['city', 'region', 'mountain', 'water', 'site'];

/** What sort of thing a board question's answer is, which decides where wrong answers come from. */
export type AnswerKind = 'person' | 'place' | 'book' | 'other';

export const ANSWER_KINDS: readonly AnswerKind[] = ['person', 'place', 'book', 'other'];

export interface SourceClue {
  text: string;
  verseId: VerseId;
}

export interface Person {
  name: string;
  /** Other names a player may give: `Saul` for Paul, `Simon` for Peter. */
  accept: string[];
  sex: Sex;
  era: Era;
  /** `king`, `prophet`, `apostle` and so on. Shared roles make a wrong answer plausible. */
  roles: string[];
  /** How well known the person is, 1 being a household name. */
  difficulty: number;
  /** Vaguest first. A person with none still serves as a wrong answer. */
  clues: SourceClue[];
}

export interface Place {
  name: string;
  accept: string[];
  kind: PlaceKind;
  testament: Testament;
  difficulty: number;
}

export interface Saying {
  verseId: VerseId;
  speaker: string;
  /** Exactly as the verse has it, so the check can find it there. */
  quote: string;
  listener: string | null;
  difficulty: number;
}

export interface TimelineEvent {
  label: string;
  verseId: VerseId | null;
  note: string | null;
}

export interface Timeline {
  id: string;
  title: string;
  instructions: string | null;
  difficulty: number;
  tags: string[];
  /** In the order they happened. */
  events: TimelineEvent[];
}

export interface BoardQuestion {
  prompt: string;
  answer: string;
  accept: string[];
  kind: AnswerKind;
  /** Authored wrong answers. Required for `other`; the rest are generated. */
  distractors: string[];
  verseId: VerseId | null;
  difficulty: number;
  /** A line for a judge, for answers the accept list misses. */
  note: string | null;
}

export interface BoardCategory {
  title: string;
  tags: string[];
  questions: BoardQuestion[];
}

export interface Sources {
  people: Person[];
  places: Place[];
  sayings: Saying[];
  timelines: Timeline[];
  board: BoardCategory[];
}

/** Something in a source file the generator cannot use, named precisely enough to fix. */
export interface SourceProblem {
  kind: 'person' | 'place' | 'saying' | 'timeline' | 'board';
  item: string;
  detail: string;
}

export interface SourceReadResult {
  sources: Sources;
  problems: SourceProblem[];
}

/** The raw shape of the files, before anything has been checked. */
export interface RawSources {
  people?: unknown;
  places?: unknown;
  sayings?: unknown;
  timelines?: unknown;
  board?: unknown;
}

/** Board wrong answers the author must supply when nothing on file can be drawn from. */
export const MIN_AUTHORED_DISTRACTORS = 3;

/**
 * Reads every source list, keeping what is usable and naming what is not.
 *
 * An unusable item is dropped rather than failing the whole read, the way the
 * importer drops one bad row: a typo in one saying should not stop the other
 * two hundred from being generated. The caller decides whether any problem at
 * all is fatal, and the content tool says it is.
 */
export function readSources(raw: RawSources): SourceReadResult {
  const problems: SourceProblem[] = [];
  const people = readPeople(raw.people, problems);
  const places = readPlaces(raw.places, problems);
  const peopleByKey = new Map(people.map((person) => [contentKey(person.name), person]));
  const placesByKey = new Map(places.map((place) => [contentKey(place.name), place]));

  return {
    sources: {
      people,
      places,
      sayings: readSayings(raw.sayings, peopleByKey, problems),
      timelines: readTimelines(raw.timelines, problems),
      board: readBoard(raw.board, peopleByKey, placesByKey, problems),
    },
    problems,
  };
}

// ---------------------------------------------------------------------------
// People and places
// ---------------------------------------------------------------------------

function readPeople(value: unknown, problems: SourceProblem[]): Person[] {
  const people: Person[] = [];
  const seen = new Set<string>();

  for (const raw of list(value)) {
    const row = record(raw);
    const name = text(row?.['name']);
    const problem = (detail: string): void => {
      problems.push({ kind: 'person', item: name ?? describe(raw), detail });
    };
    if (row === null || name === null) {
      problem('a person needs a name');
      continue;
    }
    if (seen.has(contentKey(name))) {
      problem('listed twice; two entries would disagree about who this is');
      continue;
    }

    const sex = row['sex'];
    if (sex !== 'male' && sex !== 'female') {
      problem('sex must be male or female, which decides who is a plausible wrong answer');
      continue;
    }
    const era = row['era'];
    if (!isEra(era)) {
      problem(`era must be one of ${ERAS.join(', ')}`);
      continue;
    }
    const difficulty = readDifficulty(row['difficulty']);
    if (difficulty === null) {
      problem(`difficulty must be a whole number from ${MIN_DIFFICULTY} to ${MAX_DIFFICULTY}`);
      continue;
    }
    const clues = readSourceClues(row['clues']);
    if (typeof clues === 'string') {
      problem(clues);
      continue;
    }

    seen.add(contentKey(name));
    people.push({
      name,
      accept: strings(row['accept']),
      sex,
      era,
      roles: strings(row['roles']).map((role) => role.toLowerCase()),
      difficulty,
      clues,
    });
  }
  return people;
}

/** Clues or the reason they cannot be used. */
function readSourceClues(value: unknown): SourceClue[] | string {
  const clues: SourceClue[] = [];
  for (const raw of list(value)) {
    const row = record(raw);
    const clueText = text(row?.['text']);
    const reference = text(row?.['ref']);
    if (clueText === null || reference === null) {
      return 'every clue needs text and the reference it rests on';
    }
    const verseId = parseRef(reference);
    if (verseId === null) return `${reference} is not a book, chapter and verse`;
    clues.push({ text: clueText, verseId });
  }
  return clues;
}

function readPlaces(value: unknown, problems: SourceProblem[]): Place[] {
  const places: Place[] = [];
  const seen = new Set<string>();

  for (const raw of list(value)) {
    const row = record(raw);
    const name = text(row?.['name']);
    const problem = (detail: string): void => {
      problems.push({ kind: 'place', item: name ?? describe(raw), detail });
    };
    if (row === null || name === null) {
      problem('a place needs a name');
      continue;
    }
    if (seen.has(contentKey(name))) {
      problem('listed twice');
      continue;
    }
    const kind = row['kind'];
    if (!PLACE_KINDS.includes(kind as PlaceKind)) {
      problem(`kind must be one of ${PLACE_KINDS.join(', ')}`);
      continue;
    }
    const testament = row['testament'];
    if (testament !== 'old' && testament !== 'new') {
      problem('testament must be old or new');
      continue;
    }
    const difficulty = readDifficulty(row['difficulty']);
    if (difficulty === null) {
      problem(`difficulty must be a whole number from ${MIN_DIFFICULTY} to ${MAX_DIFFICULTY}`);
      continue;
    }

    seen.add(contentKey(name));
    places.push({ name, accept: strings(row['accept']), kind: kind as PlaceKind, testament, difficulty });
  }
  return places;
}

// ---------------------------------------------------------------------------
// Sayings
// ---------------------------------------------------------------------------

function readSayings(
  value: unknown,
  people: ReadonlyMap<string, Person>,
  problems: SourceProblem[]
): Saying[] {
  const sayings: Saying[] = [];
  const seen = new Set<string>();

  for (const raw of list(value)) {
    const row = record(raw);
    const quote = text(row?.['quote']);
    const problem = (detail: string): void => {
      problems.push({ kind: 'saying', item: quote ?? describe(raw), detail });
    };
    if (row === null || quote === null) {
      problem('a saying needs the words that were said');
      continue;
    }
    if (seen.has(contentKey(quote))) {
      problem('listed twice');
      continue;
    }
    const reference = text(row['ref']);
    const verseId = reference === null ? null : parseRef(reference);
    if (verseId === null) {
      problem(`${reference ?? 'no reference'} is not a book, chapter and verse`);
      continue;
    }
    const speaker = text(row['speaker']);
    const person = speaker === null ? undefined : people.get(contentKey(speaker));
    if (person === undefined) {
      problem(`${speaker ?? 'no speaker'} is not in the people file, so no wrong answers can be chosen`);
      continue;
    }
    const difficulty = readDifficulty(row['difficulty']);
    if (difficulty === null) {
      problem(`difficulty must be a whole number from ${MIN_DIFFICULTY} to ${MAX_DIFFICULTY}`);
      continue;
    }

    seen.add(contentKey(quote));
    sayings.push({
      verseId,
      speaker: person.name,
      quote,
      listener: text(row['listener']),
      difficulty,
    });
  }
  return sayings;
}

// ---------------------------------------------------------------------------
// Timelines
// ---------------------------------------------------------------------------

function readTimelines(value: unknown, problems: SourceProblem[]): Timeline[] {
  const timelines: Timeline[] = [];
  const seen = new Set<string>();

  for (const raw of list(value)) {
    const row = record(raw);
    const title = text(row?.['title']);
    const id = text(row?.['id']);
    const problem = (detail: string): void => {
      problems.push({ kind: 'timeline', item: title ?? id ?? describe(raw), detail });
    };
    if (row === null || title === null || id === null) {
      problem('a timeline needs an id and a title');
      continue;
    }
    if (seen.has(id)) {
      problem('another timeline already uses this id');
      continue;
    }
    const difficulty = readDifficulty(row['difficulty']);
    if (difficulty === null) {
      problem(`difficulty must be a whole number from ${MIN_DIFFICULTY} to ${MAX_DIFFICULTY}`);
      continue;
    }

    const events: TimelineEvent[] = [];
    let broken: string | null = null;
    for (const item of list(row['events'])) {
      const event = typeof item === 'string' ? { label: item } : record(item);
      const label = text(event?.['label']);
      if (event === null || label === null) {
        broken = 'an event has no label';
        break;
      }
      const reference = text(event['ref']);
      const verseId = reference === null ? null : parseRef(reference);
      if (reference !== null && verseId === null) {
        broken = `${reference} is not a book, chapter and verse`;
        break;
      }
      events.push({ label, verseId, note: text(event['note']) });
    }
    if (broken !== null) {
      problem(broken);
      continue;
    }
    const labels = new Set(events.map((event) => contentKey(event.label)));
    if (labels.size !== events.length) {
      problem('two events share a label, so no ordering of them is unique');
      continue;
    }

    seen.add(id);
    timelines.push({
      id,
      title,
      instructions: text(row['instructions']),
      difficulty,
      tags: strings(row['tags']).map((tag) => tag.toLowerCase()),
      events,
    });
  }
  return timelines;
}

// ---------------------------------------------------------------------------
// The category board
// ---------------------------------------------------------------------------

function readBoard(
  value: unknown,
  people: ReadonlyMap<string, Person>,
  places: ReadonlyMap<string, Place>,
  problems: SourceProblem[]
): BoardCategory[] {
  const categories: BoardCategory[] = [];

  for (const raw of list(value)) {
    const row = record(raw);
    const title = text(row?.['title']);
    if (row === null || title === null) {
      problems.push({ kind: 'board', item: describe(raw), detail: 'a category needs a title' });
      continue;
    }

    const questions: BoardQuestion[] = [];
    for (const item of list(row['questions'])) {
      const question = readBoardQuestion(item, people, places);
      if (typeof question === 'string') {
        const prompt = text(record(item)?.['prompt']) ?? describe(item);
        problems.push({ kind: 'board', item: `${title}: ${prompt}`, detail: question });
        continue;
      }
      questions.push(question);
    }

    categories.push({ title, tags: strings(row['tags']).map((tag) => tag.toLowerCase()), questions });
  }
  return categories;
}

function readBoardQuestion(
  raw: unknown,
  people: ReadonlyMap<string, Person>,
  places: ReadonlyMap<string, Place>
): BoardQuestion | string {
  const row = record(raw);
  const prompt = text(row?.['prompt']);
  const answer = text(row?.['answer']);
  if (row === null || prompt === null || answer === null) return 'a question needs a prompt and an answer';

  const kind = row['kind'] ?? 'other';
  if (!ANSWER_KINDS.includes(kind as AnswerKind)) {
    return `kind must be one of ${ANSWER_KINDS.join(', ')}`;
  }
  const distractors = strings(row['distractors']);
  if (kind === 'person' && !people.has(contentKey(answer))) {
    return `${answer} is not in the people file, so no wrong answers can be chosen`;
  }
  if (kind === 'place' && !places.has(contentKey(answer))) {
    return `${answer} is not in the places file, so no wrong answers can be chosen`;
  }
  if (kind === 'book' && !BOOK_NAMES.some((book) => contentKey(book) === contentKey(answer))) {
    return `${answer} is not the name of a book`;
  }
  if (kind === 'other' && distractors.length < MIN_AUTHORED_DISTRACTORS) {
    return `an answer of kind other needs at least ${MIN_AUTHORED_DISTRACTORS} authored wrong answers`;
  }

  const reference = text(row['ref']);
  const verseId = reference === null ? null : parseRef(reference);
  if (reference !== null && verseId === null) return `${reference} is not a book, chapter and verse`;

  const difficulty = readDifficulty(row['difficulty']);
  if (difficulty === null) {
    return `difficulty must be a whole number from ${MIN_DIFFICULTY} to ${MAX_DIFFICULTY}`;
  }

  return {
    prompt,
    answer,
    accept: strings(row['accept']),
    kind: kind as AnswerKind,
    distractors,
    verseId,
    difficulty,
    note: text(row['note']),
  };
}

// ---------------------------------------------------------------------------
// Field reading
// ---------------------------------------------------------------------------

function isEra(value: unknown): value is Era {
  return typeof value === 'string' && (ERAS as readonly string[]).includes(value);
}

function readDifficulty(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_DIFFICULTY &&
    value <= MAX_DIFFICULTY
    ? value
    : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function strings(value: unknown): string[] {
  return list(value).flatMap((entry) => {
    const trimmed = text(entry);
    return trimmed === null ? [] : [trimmed];
  });
}

function describe(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value) ?? String(value);
}

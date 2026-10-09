/**
 * Turning the facts in `content/source/` into rounds for five games.
 *
 * The output is exactly what the importer reads, one file per game, so
 * generated content goes through the same row-by-row validation as anything
 * written by hand, and the content tool's check runs over it unchanged.
 *
 * Generation is deterministic. Each item draws from a generator seeded by its
 * own identity rather than from one shared stream, so adding a saying changes
 * that saying's question and nothing else — the diff of a regeneration is the
 * diff of what was actually edited.
 *
 * Which game a question belongs to is a tag, not a column. A question set is
 * authored against content rather than against a game, and a who-said-it
 * question is a perfectly good category-board question too; a tag lets a game
 * find its own material without the schema deciding it can belong to nothing
 * else.
 */

import { createHash } from 'node:crypto';
import { BOOK_NAMES, formatRef } from '../../../../../src/modules/games/shared/verseId.js';
import { seededRandom } from '../../room/state.js';
import { MAX_DIFFICULTY, PREFERRED_DISTRACTOR_COUNT, contentKey } from '../ContentDatabase.js';
import { booksLike, peopleLike, pickDistractors, placesLike } from './distractors.js';
import type { Candidate } from './distractors.js';
import type { BoardCategory, BoardQuestion, Person, Saying, Sources, Timeline } from './sources.js';

/** Recorded on every generated row, so a host or a check can tell it from hand-written content. */
export const GENERATED_SOURCE = 'generator';

/**
 * A who-am-I needs enough clues to reveal one at a time and still have the last
 * one settle it; a detective case needs one public clue and several to deal
 * out. Five serves both.
 */
export const MIN_IDENTITY_CLUES = 5;

/** Orderings drawn from one timeline, so no single story dominates the game. */
export const LISTS_PER_TIMELINE = 5;

/** Four items for an easy timeline, five once the story is less familiar. */
export function itemsPerList(difficulty: number): number {
  return difficulty <= 2 ? 4 : 5;
}

/** Tries at finding a subset of a timeline not already used, before settling for fewer lists. */
const SUBSET_ATTEMPTS = 64;

export const GAME_TAGS = {
  whoSaidIt: 'who-said-it',
  whoAmI: 'who-am-i',
  detective: 'detective',
  putInOrder: 'put-in-order',
  categoryBoard: 'category-board',
} as const;

/** One question row as the importer reads it. */
export interface GeneratedQuestion {
  id: string;
  type: 'multiple-choice';
  prompt: string;
  promptVerseId: number | null;
  answer: string;
  accept: string[];
  contextNote: string | null;
  difficulty: number;
  tags: string[];
  source: string;
  distractors: string[];
  clues: { text: string; verseId: number | null }[];
}

export interface GeneratedSet {
  id: string;
  name: string;
  description: string | null;
  difficulty: number;
  tags: string[];
  questionIds: string[];
}

export interface GeneratedList {
  id: string;
  title: string;
  instructions: string;
  difficulty: number;
  tags: string[];
  source: string;
  items: { label: string; verseId: number | null; note: string | null }[];
}

export interface GeneratedFile {
  /** File name under the output directory, e.g. `who-said-it.json`. */
  name: string;
  questions: GeneratedQuestion[];
  sets: GeneratedSet[];
  orderedLists: GeneratedList[];
}

export interface GenerateOptions {
  /** Changes every draw at once. Leave it alone unless the whole batch should reshuffle. */
  seed?: number;
}

export function generate(sources: Sources, options: GenerateOptions = {}): GeneratedFile[] {
  const seed = options.seed ?? 1;
  const board = boardContent(sources, seed);
  return [
    file('who-said-it.json', { questions: sayingQuestions(sources, seed) }),
    file('who-am-i.json', { questions: identityQuestions(sources, 'whoAmI', seed) }),
    file('detective.json', { questions: identityQuestions(sources, 'detective', seed) }),
    file('put-in-order.json', { orderedLists: orderings(sources.timelines, seed) }),
    file('category-board.json', board),
  ];
}

function file(name: string, content: Partial<Omit<GeneratedFile, 'name'>>): GeneratedFile {
  return { name, questions: [], sets: [], orderedLists: [], ...content };
}

// ---------------------------------------------------------------------------
// Who said it
// ---------------------------------------------------------------------------

export function sayingQuestions(sources: Sources, seed: number): GeneratedQuestion[] {
  return sources.sayings.flatMap((saying) => {
    const speaker = personNamed(sources.people, saying.speaker);
    if (speaker === undefined) return [];
    const id = `${GAME_TAGS.whoSaidIt}-${shortHash(saying.quote)}`;
    return [
      {
        id,
        type: 'multiple-choice' as const,
        prompt: `Who said, “${saying.quote}”`,
        promptVerseId: saying.verseId,
        answer: speaker.name,
        accept: [...speaker.accept],
        contextNote: sayingNote(saying),
        difficulty: saying.difficulty,
        tags: [GAME_TAGS.whoSaidIt, speaker.era],
        source: GENERATED_SOURCE,
        distractors: pickDistractors({
          answer: speaker,
          candidates: peopleLike(speaker, sources.people),
          shown: [saying.quote],
          random: randomFor(id, seed),
        }),
        clues: [],
      },
    ];
  });
}

function sayingNote(saying: Saying): string {
  const where = formatRef(saying.verseId);
  return saying.listener === null ? where : `${where}, spoken to ${saying.listener}`;
}

// ---------------------------------------------------------------------------
// Who am I, and the detective game
// ---------------------------------------------------------------------------

/**
 * Both games are a person described in clues, and both are generated from the
 * same clues — told apart by how the clues are dealt.
 *
 * A who-am-I shows the vaguest clue as its prompt and reveals the rest in
 * order. A detective case shows the vaguest clue to the whole room and deals
 * the others out, one to a phone, so no single player holds the whole picture.
 */
export function identityQuestions(
  sources: Sources,
  game: 'whoAmI' | 'detective',
  seed: number
): GeneratedQuestion[] {
  const tag = GAME_TAGS[game];
  return sources.people
    .filter((person) => person.clues.length >= MIN_IDENTITY_CLUES)
    .map((person) => {
      const id = `${tag}-${slug(person.name)}`;
      const [opening, ...rest] = person.clues;
      const openingText = opening?.text ?? '';
      const clues = game === 'whoAmI' ? person.clues : rest;
      return {
        id,
        type: 'multiple-choice' as const,
        prompt:
          game === 'whoAmI' ? `Who am I? ${openingText}` : `Who is the mystery person? ${openingText}`,
        promptVerseId: opening?.verseId ?? null,
        answer: person.name,
        accept: [...person.accept],
        contextNote: null,
        difficulty: person.difficulty,
        tags: [tag, person.era],
        source: GENERATED_SOURCE,
        distractors: pickDistractors({
          answer: person,
          candidates: peopleLike(person, sources.people),
          shown: person.clues.map((clue) => clue.text),
          random: randomFor(id, seed),
        }),
        clues: clues.map((clue) => ({ text: clue.text, verseId: clue.verseId })),
      };
    });
}

// ---------------------------------------------------------------------------
// Put in order
// ---------------------------------------------------------------------------

/**
 * Several orderings from each timeline, each a different handful of its
 * events. A list whose items sit next to each other in the story is harder
 * than one spread across it — the burning bush against the plagues is easy,
 * the third plague against the fourth is not — so adjacency raises difficulty.
 */
export function orderings(timelines: readonly Timeline[], seed: number): GeneratedList[] {
  return timelines.flatMap((timeline) => {
    const size = Math.min(itemsPerList(timeline.difficulty), timeline.events.length);
    const random = randomFor(`${GAME_TAGS.putInOrder}-${timeline.id}`, seed);
    const subsets: number[][] = [];
    const seen = new Set<string>();
    for (
      let attempt = 0;
      attempt < SUBSET_ATTEMPTS && subsets.length < LISTS_PER_TIMELINE;
      attempt += 1
    ) {
      const subset = chooseIndices(timeline.events.length, size, random);
      const key = subset.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      subsets.push(subset);
    }

    return subsets.map((subset, index) => {
      const adjacent = subset.some((position, at) => at > 0 && position - (subset[at - 1] as number) === 1);
      return {
        id: `${GAME_TAGS.putInOrder}-${timeline.id}-${index + 1}`,
        title: subsets.length === 1 ? timeline.title : `${timeline.title}, set ${index + 1}`,
        instructions: timeline.instructions ?? 'Put these in the order they happened.',
        difficulty: Math.min(MAX_DIFFICULTY, timeline.difficulty + (adjacent ? 1 : 0)),
        tags: [GAME_TAGS.putInOrder, ...timeline.tags],
        source: GENERATED_SOURCE,
        items: subset.map((position) => {
          const event = timeline.events[position];
          return { label: event?.label ?? '', verseId: event?.verseId ?? null, note: event?.note ?? null };
        }),
      };
    });
  });
}

/** `size` distinct positions below `length`, in ascending order. */
function chooseIndices(length: number, size: number, random: () => number): number[] {
  const positions = Array.from({ length }, (_, index) => index);
  for (let index = 0; index < size; index += 1) {
    const swap = index + Math.floor(random() * (length - index));
    const held = positions[index] as number;
    positions[index] = positions[swap] as number;
    positions[swap] = held;
  }
  return positions.slice(0, size).sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// The category board
// ---------------------------------------------------------------------------

/**
 * One question set per category, its questions in rising difficulty — which is
 * the board's column read top to bottom.
 */
export function boardContent(
  sources: Sources,
  seed: number
): { questions: GeneratedQuestion[]; sets: GeneratedSet[] } {
  const questions: GeneratedQuestion[] = [];
  const sets: GeneratedSet[] = [];

  for (const category of sources.board) {
    const categorySlug = slug(category.title);
    const built = category.questions.map((question, index) =>
      boardQuestion(sources, category, categorySlug, question, index, seed)
    );
    questions.push(...built);
    if (built.length === 0) continue;
    const ordered = [...built].sort((a, b) => a.difficulty - b.difficulty);
    sets.push({
      id: `${GAME_TAGS.categoryBoard}-${categorySlug}`,
      name: category.title,
      description: null,
      difficulty: Math.round(built.reduce((total, row) => total + row.difficulty, 0) / built.length),
      tags: [GAME_TAGS.categoryBoard, ...category.tags],
      questionIds: ordered.map((row) => row.id),
    });
  }
  return { questions, sets };
}

function boardQuestion(
  sources: Sources,
  category: BoardCategory,
  categorySlug: string,
  question: BoardQuestion,
  index: number,
  seed: number
): GeneratedQuestion {
  const id = `${GAME_TAGS.categoryBoard}-${categorySlug}-${index + 1}`;
  const person = question.kind === 'person' ? personNamed(sources.people, question.answer) : undefined;
  const place =
    question.kind === 'place'
      ? sources.places.find((candidate) => contentKey(candidate.name) === contentKey(question.answer))
      : undefined;
  const accept = [...new Set([...question.accept, ...(person?.accept ?? []), ...(place?.accept ?? [])])];

  return {
    id,
    type: 'multiple-choice',
    prompt: question.prompt,
    promptVerseId: question.verseId,
    answer: question.answer,
    accept,
    contextNote: question.note,
    difficulty: question.difficulty,
    tags: [GAME_TAGS.categoryBoard, categorySlug, ...category.tags],
    source: GENERATED_SOURCE,
    distractors: boardDistractors(question, accept, candidatesFor(sources, question), id, seed),
    clues: [],
  };
}

function candidatesFor(sources: Sources, question: BoardQuestion): Candidate[] {
  if (question.kind === 'person') {
    const person = personNamed(sources.people, question.answer);
    return person === undefined ? [] : peopleLike(person, sources.people);
  }
  if (question.kind === 'place') {
    const place = sources.places.find(
      (candidate) => contentKey(candidate.name) === contentKey(question.answer)
    );
    return place === undefined ? [] : placesLike(place, sources.places);
  }
  if (question.kind === 'book') {
    const book = BOOK_NAMES.findIndex((name) => contentKey(name) === contentKey(question.answer)) + 1;
    return book === 0 ? [] : booksLike(book);
  }
  return [];
}

/**
 * Authored wrong answers lead, because an author who took the trouble to write
 * one knew something the scoring does not; generated ones fill the rest.
 */
function boardDistractors(
  question: BoardQuestion,
  accept: readonly string[],
  candidates: readonly Candidate[],
  id: string,
  seed: number
): string[] {
  const authored = question.distractors;
  const wanted = PREFERRED_DISTRACTOR_COUNT - authored.length;
  if (candidates.length === 0 || wanted <= 0) return [...authored];
  const authoredKeys = new Set(authored.map(contentKey));
  const generated = pickDistractors({
    answer: { name: question.answer, accept },
    candidates: candidates.filter((candidate) => !authoredKeys.has(contentKey(candidate.name))),
    shown: [question.prompt],
    random: randomFor(id, seed),
    count: wanted,
  });
  return [...authored, ...generated];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function personNamed(people: readonly Person[], name: string): Person | undefined {
  return people.find((person) => contentKey(person.name) === contentKey(name));
}

/** A generator seeded by what is being generated, so items do not disturb each other. */
function randomFor(key: string, seed: number): () => number {
  const digest = createHash('sha1').update(`${seed}:${key}`).digest();
  return seededRandom(digest.readUInt32BE(0)).random;
}

function shortHash(text: string): string {
  return createHash('sha1').update(contentKey(text)).digest('hex').slice(0, 10);
}

/** Lowercase words joined by hyphens: `The Garden of Eden` becomes `the-garden-of-eden`. */
export function slug(text: string): string {
  return contentKey(text).replace(/\s+/g, '-');
}
